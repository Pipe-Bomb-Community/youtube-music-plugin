import {
	AlbumMetadata,
	AttributeValue,
	BufferAttributeValue,
	EphemeralTrack,
	IdentifiableAlbumMetadata,
	IdentifiableTrackArtistMetadata,
} from "@sdk";
import { YTMThumbnail } from "./types.js";
import Axios from "axios";
import { YTNodes, YTMusic, RawData, Parser, IRawResponse } from "youtubei.js";

export function compare<T extends string | number>(a: T, b: T) {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
}

export function serializeThumbnailAttribute(
	thumbnails: YTMThumbnail[],
): BufferAttributeValue {
	if (!thumbnails?.length) {
		throw new Error("No thumbnails provided");
	}

	const sortedThumbnails = sortThumbnails(thumbnails);

	return {
		type: "serialized-thumbnails",
		extension: "jpg",
		thumbnails: sortedThumbnails,
	} as any;
}

export function deserializeThumbnailAttribute(
	attribute: BufferAttributeValue,
): BufferAttributeValue {
	return {
		extension: attribute.extension,
		buffer: async () => {
			for (const thumbnail of (attribute as any).thumbnails) {
				try {
					const { data } = await Axios.get<Buffer>(thumbnail.url, {
						responseType: "arraybuffer",
					});
					return data;
				} catch {}
			}
			throw new Error("No thumbnail response");
		},
	};
}

export function deserializeAllThumbnails(rootNode: any) {
	const toTraverse: any[] = [rootNode];

	while (toTraverse.length) {
		const current = toTraverse.shift();

		// Skip nulls or undefined elements safely
		if (!current) continue;

		if (Array.isArray(current)) {
			// Renamed inner token to avoid confusing the compiler/crawler
			toTraverse.push(
				...current.filter((item) => item && typeof item === "object"),
			);
		} else {
			for (const key in current) {
				// Defensive check: null is an object in JS, ensure it's truthy
				if (current[key] && typeof current[key] === "object") {
					if (key === "attributes" && Array.isArray(current.attributes)) {
						const attributes: AttributeValue[] = current.attributes;

						for (const attribute of attributes) {
							if (
								attribute?.value &&
								typeof attribute.value === "object" &&
								(attribute.value as any).type === "serialized-thumbnails"
							) {
								// Direct mutation of the object reference
								attribute.value = deserializeThumbnailAttribute(
									attribute.value,
								);
							}
						}
					} else {
						toTraverse.push(current[key]);
					}
				}
			}
		}
	}
}

export function sortThumbnails(thumbnails: YTMThumbnail[]) {
	return [...thumbnails].sort(
		(a, b) => b.width * b.height - a.width * a.height,
	);
}

export function toAlbumArtists(
	header: YTNodes.MusicResponsiveHeader | YTNodes.MusicDetailHeader,
) {
	const artists: IdentifiableTrackArtistMetadata[] = [];

	if (header?.is(YTNodes.MusicResponsiveHeader)) {
		const strapline = header.strapline_text_one;
		const runs = strapline.runs;

		if (runs) {
			for (const [index, run] of runs.entries() ?? []) {
				const endpoint = (run as any).endpoint as
					| YTNodes.NavigationEndpoint
					| undefined;
				if (!endpoint) {
					continue;
				}

				const browseId = endpoint?.payload?.browseId as string | undefined;
				if (!browseId) {
					continue;
				}

				let joinPhrase: string | null = null;

				if (runs.length > index + 1) {
					const nextRun = runs[index + 1];
					if (nextRun && !(nextRun as any).endpoint) {
						joinPhrase = nextRun.text;
					}
				}

				artists.push({
					pluginId: "youtube-music",
					identityId: "youtube_music_artist_id",
					identity: browseId,
					joinPhrase,
					attributes: [
						{
							key: "name",
							value: run.text,
						},
					],
				});
			}
		}
	}

	return artists;
}

export function listItemToTrack(
	item: YTNodes.MusicResponsiveListItem,
): EphemeralTrack | null {
	if (!item.title) {
		return null;
	}

	let id: string | null = item.id ?? null;
	if (!id) {
		for (const flexColumn of item.flex_columns) {
			if (flexColumn.title.text == item.title) {
				const videoId = flexColumn.title.endpoint?.payload?.videoId;
				if (videoId) {
					id = videoId;
				}
			}
		}
	}

	if (!id) {
		return null;
	}

	const attributes: AttributeValue[] = [
		{
			key: "title",
			value: item.title,
		},
	];
	if (item.thumbnail?.contents.length) {
		attributes.push({
			key: "front",
			value: serializeThumbnailAttribute(item.thumbnail.contents),
		});
	}
	if (item.duration) {
		attributes.push({
			key: "duration",
			value: item.duration.seconds,
		});
	}

	const artists: IdentifiableTrackArtistMetadata[] = [];
	if (item.artists) {
		for (const resultArtist of item.artists) {
			if (resultArtist.channel_id) {
				artists.push({
					pluginId: "youtube-music",
					identityId: "youtube_music_artist_id",
					identity: resultArtist.channel_id,
					attributes: [
						{
							key: "name",
							value: resultArtist.name,
						},
					],
				});
			}
		}
	}

	return {
		id,
		title: item.title,
		attributes,
		artists,
		identityId: "youtube_music_track_id",
		identity: id,
	};
}

export function toAlbum(album: YTMusic.Album) {
	const header = album.header;

	const attributes: AttributeValue[] = [];
	const artists: IdentifiableTrackArtistMetadata[] = [];
	let thumbnail: BufferAttributeValue | null = null;

	if (header) {
		if (header.title.text) {
			attributes.push({
				key: "title",
				value: header.title.text,
			});
		}

		artists.push(...toAlbumArtists(header));

		if (header.is(YTNodes.MusicResponsiveHeader)) {
			if (header.thumbnail?.contents.length) {
				thumbnail = serializeThumbnailAttribute(header.thumbnail.contents);
				attributes.push({
					key: "front",
					value: thumbnail,
				});
			}
		}
	}

	const tracks: EphemeralTrack[] = [];
	const ids: string[] = [];

	for (const item of album.contents) {
		if (item.item_type != "song" && item.item_type != "video") {
			continue;
		}

		ids.push(item.id!);

		const track = listItemToTrack(item);
		if (track) {
			if (
				thumbnail &&
				track.attributes &&
				!track.attributes.some((attribute) => attribute.key == "front")
			) {
				track.attributes.push({
					key: "front",
					value: thumbnail,
				});
			}
			if (!track.artists?.length) {
				track.artists = artists;
			}

			tracks.push(track);
		}
	}

	return {
		artists,
		attributes,
		tracks,
	};
}

export function upNextToEphemeralTrack(
	info: YTNodes.PlaylistPanelVideo,
	videoId?: string,
): EphemeralTrack | null {
	let id: string | null = info.video_id ?? null;
	if (!id) {
		const videoId = info.endpoint.payload?.videoId;
		if (videoId) {
			id = videoId;
		}
	}

	if (!id) {
		if (videoId) {
			id = videoId;
		} else {
			return null;
		}
	}

	const attributes: AttributeValue[] = [
		{
			key: "duration",
			value: info.duration.seconds,
		},
	];
	if (info.title.text) {
		attributes.push({
			key: "title",
			value: info.title.text,
		});
	}
	if (info.thumbnail?.length) {
		attributes.push({
			key: "front",
			value: serializeThumbnailAttribute(info.thumbnail),
		});
	}
	if (info.album?.year) {
		const year = parseInt(info.album.year);
		if (!isNaN(year)) {
			attributes.push({
				key: "year",
				value: year,
			});
		}
	}

	const artists: IdentifiableTrackArtistMetadata[] = [];
	if (info.artists) {
		let artistString = info.author;
		for (const [i, artist] of info.artists.entries()) {
			let joinPhrase: string | null = null;

			const currentIndex = artistString.indexOf(artist.name);
			if (currentIndex >= 0) {
				artistString = artistString.substring(
					currentIndex + artist.name.length,
				);

				if (i == info.artists.length - 1) {
					joinPhrase = artistString;
				} else {
					const nextArtistName = info.artists[i + 1]!.name;
					const nextIndex = artistString.indexOf(nextArtistName);
					if (nextIndex >= 0) {
						joinPhrase = artistString.substring(0, nextIndex);
						artistString = artistString.substring(nextIndex);
					}
				}
			}

			if (!artist.channel_id) {
				continue;
			}

			artists.push({
				pluginId: "youtube-music",
				identityId: "youtube_music_artist_id",
				identity: artist.channel_id,
				joinPhrase,
				attributes: [
					{
						key: "name",
						value: artist.name,
					},
				],
			});
		}
	}

	return {
		identityId: "youtube_music_track_id",
		identity: id,
		attributes,
		artists,
		id,
		title: info.title.text ?? "Unknown Track",
	};
}

export function twoColumnBrowseToPlaylistMetadata(
	rawData: RawData,
): AlbumMetadata | null {
	const attributes: AttributeValue[] = [];
	const artists: IdentifiableTrackArtistMetadata[] = [];

	const parsedNode = Parser.parse(rawData).item();
	if (!parsedNode.is(YTNodes.TwoColumnBrowseResults)) {
		return null;
	}
	for (const [tabIndex, tab] of parsedNode.tabs.entries()) {
		if (tab.content?.is(YTNodes.SectionList)) {
			for (const [tabContentIndex, content] of tab.content.contents.entries()) {
				if (content.is(YTNodes.MusicResponsiveHeader)) {
					if (content.title.text) {
						attributes.push({
							key: "title",
							value: content.title.text,
						});
					}

					if (content.thumbnail?.contents.length) {
						attributes.push({
							key: "front",
							value: serializeThumbnailAttribute(content.thumbnail.contents),
						});
					}

					const rawHeader = (rawData as any).twoColumnBrowseResultsRenderer
						?.tabs?.[tabIndex]?.tabRenderer?.content.sectionListRenderer
						?.contents?.[tabContentIndex]?.musicResponsiveHeaderRenderer;

					if (rawHeader) {
						const facepile = rawHeader.facepile;

						const userName: string | undefined =
							facepile?.avatarStackViewModel.text?.content;
						const userId: string | undefined =
							facepile?.avatarStackViewModel.rendererContext?.commandContext
								?.onTap?.innertubeCommand?.browseEndpoint?.browseId;

						if (userName && userId) {
							artists.push({
								pluginId: "youtube-music",
								identityId: "youtube_music_user_id",
								identity: userId,
								attributes: [
									{
										key: "name",
										value: userName,
									},
								],
							});
						}
					}
				}
			}
		}
	}

	return { attributes, artists };
}

export function twoRowItemToAlbum(
	item: YTNodes.MusicTwoRowItem,
): IdentifiableAlbumMetadata | null {
	if (!item.id || !item.title) {
		return null;
	}

	const attributes: AttributeValue[] = [
		{
			key: "title",
			value: item.title.toString(),
		},
	];

	if (item.thumbnail?.length) {
		attributes.push({
			key: "front",
			value: serializeThumbnailAttribute(item.thumbnail),
		});
	}

	const artists: IdentifiableTrackArtistMetadata[] = [];

	if (item.artists?.length) {
		for (const artist of item.artists) {
			if (!artist.channel_id) continue;

			artists.push({
				pluginId: "youtube-music",
				identityId: "youtube_music_artist_id",
				identity: artist.channel_id,
				attributes: [
					{
						key: "name",
						value: artist.name,
					},
				],
			});
		}
	}

	return {
		pluginId: "youtube-music",
		identityId: "youtube_music_album_id",
		identity: item.id,
		attributes,
		artists,
	};
}

export function toUser(response: IRawResponse) {
	const attributes: AttributeValue[] = [];

	if (response.header) {
		const parsedNode = Parser.parse(response.header).item();
		if (parsedNode.is(YTNodes.MusicVisualHeader)) {
			if (parsedNode.title.text) {
				attributes.push({
					key: "name",
					value: parsedNode.title.text,
				});
			}

			if (parsedNode.foreground_thumbnail?.length) {
				attributes.push({
					key: "thumb",
					value: serializeThumbnailAttribute(parsedNode.foreground_thumbnail),
				});
			}
			if (parsedNode.thumbnail?.length) {
				attributes.push({
					key: "background",
					value: serializeThumbnailAttribute(parsedNode.thumbnail),
				});
			}
		}
	}

	const albums: IdentifiableAlbumMetadata[] = [];

	if (response.contents) {
		const parsedNode = Parser.parse(response.contents).item();
		if (parsedNode.is(YTNodes.SingleColumnBrowseResults)) {
			for (const tab of parsedNode.tabs) {
				if (tab.content?.is(YTNodes.SectionList)) {
					for (const shelf of tab.content.contents) {
						if (shelf.is(YTNodes.MusicCarouselShelf)) {
							for (const item of shelf.contents) {
								if (item.is(YTNodes.MusicTwoRowItem)) {
									const album = twoRowItemToAlbum(item);
									if (album) {
										album.identityId = "youtube_music_playlist_id";

										if (item.subtitle) {
											for (const run of item.subtitle.runs ?? []) {
												const artistId = (run as any)
													.endpoint as YTNodes.NavigationEndpoint;
												if (artistId?.payload?.browseId) {
													album.artists = [
														{
															pluginId: "youtube-music",
															identityId: "youtube_music_user_id",
															identity: artistId.payload.browseId,
															attributes: [
																{
																	key: "name",
																	value: run.text,
																},
															],
														},
													];
												}
											}
										}

										albums.push(album);
									}
								}
							}
						}
					}
				}
			}
		}
	}

	return {
		attributes,
		albums,
	};
}

export function listItemToAlbum(
	item: YTNodes.MusicResponsiveListItem,
): IdentifiableAlbumMetadata | null {
	if (!item.id || !item.title) {
		return null;
	}

	const attributes: AttributeValue[] = [{ key: "title", value: item.title }];

	if (item.thumbnail?.contents.length) {
		attributes.push({
			key: "front",
			value: serializeThumbnailAttribute(item.thumbnail.contents),
		});
	}

	const artists: IdentifiableTrackArtistMetadata[] = [];
	if (item.author?.channel_id) {
		artists.push({
			pluginId: "youtube-music",
			identityId: "youtube_music_artist_id",
			identity: item.author.channel_id,
			attributes: [
				{
					key: "name",
					value: item.author.name,
				},
			],
		});
	}

	return {
		pluginId: "youtube-music",
		identityId: "youtube_music_album_id",
		identity: item.id,
		attributes,
		artists,
	};
}
