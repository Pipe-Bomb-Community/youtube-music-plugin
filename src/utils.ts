import {
	AlbumMetadata,
	AttributeValue,
	BufferAttributeValue,
	EphemeralTrack,
	IdentifiableAlbumMetadata,
	IdentifiableTrackArtistMetadata,
} from "@pipe-bomb/plugin-sdk";
import { YTMThumbnail } from "./types.js";
import Axios from "axios";
import { YTNodes, YTMusic, RawData, Parser, IRawResponse } from "youtubei.js";
import { YtDlpFormat } from "./types/yt-dlp.js";

export function compare<T extends string | number>(a: T, b: T) {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
}

/**
 * Extract a 4-digit year from free text such as an album subtitle
 * ("Album • 2020"). Returns the last match, or null when absent.
 */
export function extractYear(text: string | undefined | null): number | null {
	if (!text) {
		return null;
	}
	const matches = text.match(/(19|20)\d{2}/g);
	if (!matches || matches.length === 0) {
		return null;
	}
	const year = parseInt(matches[matches.length - 1]!, 10);
	return Number.isNaN(year) ? null : year;
}

export function cleanArtistName(
	name: string | undefined | null,
): string | null {
	if (!name) {
		return null;
	}
	const trimmed = name.trim();
	if (!trimmed) {
		return null;
	}
	const topicSuffix = " - topic";
	if (trimmed.toLowerCase().endsWith(topicSuffix)) {
		const stripped = trimmed.slice(0, -topicSuffix.length).trim();
		if (stripped) {
			return stripped;
		}
	}
	return trimmed;
}

export function normalizeIsoDate(
	value: string | undefined | null,
): string | null {
	if (!value) {
		return null;
	}
	const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
	if (!match) {
		return null;
	}
	const date = `${match[1]}-${match[2]}-${match[3]}`;
	return Number.isNaN(Date.parse(date)) ? null : date;
}

export function parseReleaseDate(
	description: string | undefined | null,
): string | null {
	if (!description) {
		return null;
	}
	const match = description.match(/Released on:\s*(\d{4}-\d{2}-\d{2})/i);
	return normalizeIsoDate(match?.[1]);
}

export function parseDurationText(
	value: string | undefined | null,
): number | null {
	if (!value) {
		return null;
	}
	const match = value.match(/^(?:(\d+):)?(\d+):(\d+)$/);
	if (!match) {
		return null;
	}
	const hours = match[1] ? parseInt(match[1], 10) : 0;
	const minutes = parseInt(match[2]!, 10);
	const seconds = parseInt(match[3]!, 10);
	if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) {
		return null;
	}
	return hours * 3600 + minutes * 60 + seconds;
}

export function isExplicit(badges: unknown): boolean {
	if (!Array.isArray(badges)) {
		return false;
	}
	return badges.some((badge: any) => {
		const iconType: unknown = badge?.icon_type;
		if (
			typeof iconType == "string" &&
			iconType.toUpperCase().includes("EXPLICIT")
		) {
			return true;
		}
		const label: unknown = badge?.label;
		return typeof label == "string" && label.toLowerCase().includes("explicit");
	});
}

const RELEASE_TYPES = [
	"album",
	"single",
	"ep",
	"lp",
	"compilation",
	"soundtrack",
	"live",
];

export function extractReleaseType(
	text: string | undefined | null,
): string | null {
	if (!text) {
		return null;
	}
	for (const part of text.split(/[•·|]/)) {
		const token = part.trim().toLowerCase();
		if (!RELEASE_TYPES.includes(token)) {
			continue;
		}
		if (token == "ep" || token == "lp") {
			return token.toUpperCase();
		}
		return token.charAt(0).toUpperCase() + token.slice(1);
	}
	return null;
}

export function extractTrackCount(
	text: string | undefined | null,
): number | null {
	if (!text) {
		return null;
	}
	const match = text.match(/(\d[\d,]*)\s*songs?/i);
	if (!match) {
		return null;
	}
	const count = parseInt(match[1]!.replace(/,/g, ""), 10);
	return Number.isNaN(count) ? null : count;
}

export function extractAudioPlaylistId(
	url: string | undefined | null,
): string | null {
	if (!url) {
		return null;
	}
	const match =
		url.match(/[?&]list=([A-Za-z0-9_-]+)/) ??
		url.match(/(OLAK5uy_[A-Za-z0-9_-]+)/);
	return match?.[1] ?? null;
}

export function mostCommonDate(dates: string[]): string | null {
	const counts = new Map<string, number>();
	for (const date of dates) {
		counts.set(date, (counts.get(date) ?? 0) + 1);
	}
	let best: string | null = null;
	let bestCount = 0;
	for (const [date, count] of counts) {
		if (
			count > bestCount ||
			(count === bestCount && best !== null && date > best)
		) {
			best = date;
			bestCount = count;
		}
	}
	return best;
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

export function deserializeAllThumbnails(rootNode: any): boolean {
	const toTraverse: any[] = [rootNode];
	let corrupt = false;

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
							if (attribute?.value && typeof attribute.value === "object") {
								if ((attribute.value as any).type === "serialized-thumbnails") {
									// Direct mutation of the object reference
									attribute.value = deserializeThumbnailAttribute(
										attribute.value,
									);
								} else if (
									!("buffer" in attribute.value) ||
									typeof (attribute.value as any).extension != "string"
								) {
									// A buffer attribute persisted without its callable
									// `buffer` (e.g. a stale cache entry) is unusable.
									corrupt = true;
								}
							}
						}
					} else {
						toTraverse.push(current[key]);
					}
				}
			}
		}
	}

	return corrupt;
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
					identityId: "youtube_channel_id",
					identity: browseId,
					joinPhrase,
					attributes: [
						{
							key: "name",
							value: cleanArtistName(run.text) ?? run.text,
						},
					],
				});
			}
		}
	} else if (header?.is(YTNodes.MusicDetailHeader)) {
		const author = header.author;
		if (author?.channel_id && author.name) {
			artists.push({
				pluginId: "youtube-music",
				identityId: "youtube_channel_id",
				identity: author.channel_id,
				attributes: [
					{
						key: "name",
						value: cleanArtistName(author.name) ?? author.name,
					},
				],
			});
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
	if (item.album?.name) {
		attributes.push({
			key: "album",
			value: item.album.name,
		});
	}
	if (item.index?.text) {
		const trackNumber = parseInt(item.index.text, 10);
		if (!Number.isNaN(trackNumber)) {
			attributes.push({
				key: "track_number",
				value: trackNumber,
			});
		}
	}
	attributes.push({
		key: "disc_number",
		value: 1,
	});
	if (isExplicit(item.badges)) {
		attributes.push({
			key: "explicit",
			value: true,
		});
	}

	const artists: IdentifiableTrackArtistMetadata[] = [];
	if (item.artists) {
		for (const resultArtist of item.artists) {
			const name = cleanArtistName(resultArtist.name);
			if (name) {
				attributes.push({
					key: "artist",
					value: name,
				});
			}
			if (resultArtist.channel_id) {
				artists.push({
					pluginId: "youtube-music",
					identityId: "youtube_channel_id",
					identity: resultArtist.channel_id,
					attributes: [
						{
							key: "name",
							value: name ?? resultArtist.name,
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

		for (const artist of artists) {
			const name = artist.attributes?.find((a) => a.key == "name")?.value;
			if (typeof name == "string") {
				attributes.push({
					key: "artist",
					value: name,
				});
			}
		}

		if (header.is(YTNodes.MusicResponsiveHeader)) {
			if (header.thumbnail?.contents.length) {
				thumbnail = serializeThumbnailAttribute(header.thumbnail.contents);
				attributes.push({
					key: "front",
					value: thumbnail,
				});
			}
			const year = extractYear(header.subtitle?.text);
			if (year !== null) {
				attributes.push({
					key: "year",
					value: year,
				});
			}
			const releaseType = extractReleaseType(header.subtitle?.text);
			if (releaseType) {
				attributes.push({
					key: "release_type",
					value: releaseType,
				});
			}
			const trackCount =
				extractTrackCount(header.second_subtitle?.text) ??
				extractTrackCount(header.subtitle?.text);
			if (trackCount !== null) {
				attributes.push({
					key: "track_count",
					value: trackCount,
				});
			}
			if (header.description?.description?.text) {
				attributes.push({
					key: "description",
					value: header.description.description.text,
				});
			}
			if (isExplicit(header.subtitle_badge)) {
				attributes.push({
					key: "explicit",
					value: true,
				});
			}
		} else if (header.is(YTNodes.MusicDetailHeader)) {
			if (header.thumbnails?.length) {
				thumbnail = serializeThumbnailAttribute(
					header.thumbnails as unknown as YTMThumbnail[],
				);
				attributes.push({
					key: "front",
					value: thumbnail,
				});
			}
			const year = extractYear(header.year);
			if (year !== null) {
				attributes.push({
					key: "year",
					value: year,
				});
			}
			const releaseType = extractReleaseType(header.subtitle?.text);
			if (releaseType) {
				attributes.push({
					key: "release_type",
					value: releaseType,
				});
			}
			const trackCount =
				extractTrackCount(header.song_count) ?? parseInt(header.song_count, 10);
			if (!Number.isNaN(trackCount)) {
				attributes.push({
					key: "track_count",
					value: trackCount,
				});
			}
			if (header.description?.text) {
				attributes.push({
					key: "description",
					value: header.description.text,
				});
			}
			if (isExplicit(header.badges)) {
				attributes.push({
					key: "explicit",
					value: true,
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
			if (
				track.attributes &&
				!track.attributes.some((attribute) => attribute.key == "artist")
			) {
				for (const artist of artists) {
					const name = artist.attributes?.find((a) => a.key == "name")?.value;
					if (typeof name == "string") {
						track.attributes.push({
							key: "artist",
							value: name,
						});
					}
				}
			}

			tracks.push(track);
		}
	}

	let totalDuration = 0;
	let hasDuration = false;
	for (const track of tracks) {
		const duration = track.attributes?.find((a) => a.key == "duration")?.value;
		if (typeof duration == "number") {
			totalDuration += duration;
			hasDuration = true;
		}
	}
	if (hasDuration) {
		attributes.push({
			key: "duration",
			value: totalDuration,
		});
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
	if (info.album?.name) {
		attributes.push({
			key: "album",
			value: info.album.name,
		});
	}
	attributes.push({
		key: "disc_number",
		value: 1,
	});
	if (isExplicit(info.badges)) {
		attributes.push({
			key: "explicit",
			value: true,
		});
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

			const name = cleanArtistName(artist.name);
			if (name) {
				attributes.push({
					key: "artist",
					value: name,
				});
			}

			if (!artist.channel_id) {
				continue;
			}

			artists.push({
				pluginId: "youtube-music",
				identityId: "youtube_channel_id",
				identity: artist.channel_id,
				joinPhrase,
				attributes: [
					{
						key: "name",
						value: name ?? artist.name,
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

					const year = extractYear(content.subtitle?.text);
					if (year !== null) {
						attributes.push({
							key: "year",
							value: year,
						});
					}

					const trackCount =
						extractTrackCount(content.second_subtitle?.text) ??
						extractTrackCount(content.subtitle?.text);
					if (trackCount !== null) {
						attributes.push({
							key: "track_count",
							value: trackCount,
						});
					}

					if (content.description?.description?.text) {
						attributes.push({
							key: "description",
							value: content.description.description.text,
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
							const name = cleanArtistName(userName) ?? userName;
							attributes.push({
								key: "artist",
								value: name,
							});
							artists.push({
								pluginId: "youtube-music",
								identityId: "youtube_channel_id",
								identity: userId,
								attributes: [
									{
										key: "name",
										value: name,
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

	const year = extractYear(item.year);
	if (year !== null) {
		attributes.push({
			key: "year",
			value: year,
		});
	}

	const releaseType = extractReleaseType(item.subtitle?.text);
	if (releaseType) {
		attributes.push({
			key: "release_type",
			value: releaseType,
		});
	}

	if (isExplicit(item.badges)) {
		attributes.push({
			key: "explicit",
			value: true,
		});
	}

	const artists: IdentifiableTrackArtistMetadata[] = [];

	if (item.artists?.length) {
		for (const artist of item.artists) {
			const name = cleanArtistName(artist.name);
			if (name) {
				attributes.push({
					key: "artist",
					value: name,
				});
			}
			if (!artist.channel_id) continue;

			artists.push({
				pluginId: "youtube-music",
				identityId: "youtube_channel_id",
				identity: artist.channel_id,
				attributes: [
					{
						key: "name",
						value: name ?? artist.name,
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

export function toArtist(response: IRawResponse) {
	const attributes: AttributeValue[] = [];

	if (response.header) {
		const parsedNode = Parser.parse(response.header).item();
		if (parsedNode.is(YTNodes.MusicImmersiveHeader)) {
			if (parsedNode.title) {
				attributes.push({
					key: "name",
					value:
						cleanArtistName(parsedNode.title.toString()) ??
						parsedNode.title.toString(),
				});
			}

			if (parsedNode.thumbnail?.contents.length) {
				attributes.push({
					key: "background",
					value: serializeThumbnailAttribute(parsedNode.thumbnail.contents),
				});
			}

			if (parsedNode.description?.text) {
				attributes.push({
					key: "description",
					value: parsedNode.description.text,
				});
			}
		}
	}

	return {
		attributes,
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
					value:
						cleanArtistName(parsedNode.title.text) ?? parsedNode.title.text,
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
															identityId: "youtube_channel_id",
															identity: artistId.payload.browseId,
															attributes: [
																{
																	key: "name",
																	value: cleanArtistName(run.text) ?? run.text,
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

	const year = extractYear(item.year);
	if (year !== null) {
		attributes.push({
			key: "year",
			value: year,
		});
	}

	const artists: IdentifiableTrackArtistMetadata[] = [];
	if (item.author?.channel_id) {
		const name = cleanArtistName(item.author.name) ?? item.author.name;
		attributes.push({
			key: "artist",
			value: name,
		});
		artists.push({
			pluginId: "youtube-music",
			identityId: "youtube_channel_id",
			identity: item.author.channel_id,
			attributes: [
				{
					key: "name",
					value: name,
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

export function getMimeType(format: YtDlpFormat): string {
	switch (format.ext) {
		case "webm":
			return "audio/webm";
		case "m4a":
			return "audio/mp4";
		case "mp3":
			return "audio/mpeg";
		case "ogg":
			return "audio/ogg";
		case "aac":
			return "audio/aac";
		default:
			return "application/octet-stream";
	}
}

export function formatNumber(number: number) {
	return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatDateString(dateString: string) {
	const [year, month, day] = dateString.split("-");
	if (year === undefined || month === undefined || day === undefined) {
		return dateString;
	}
	return `${day}/${month}/${year}`;
}
