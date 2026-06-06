import Innertube, { Parser, YTNodes } from "youtubei.js";
import { PersistentCache } from "./persistent-cache.js";
import {
	AlbumMetadata,
	ArtistMetadata,
	AttributeValue,
	EphemeralArtistContent,
	EphemeralTrack,
	IdentifiableAlbumMetadata,
} from "@sdk";
import {
	deserializeAllThumbnails,
	listItemToTrack,
	serializeThumbnailAttribute,
	toAlbum,
	toArtist,
	toUser,
	twoColumnBrowseToPlaylistMetadata,
	twoRowItemToAlbum,
	upNextToEphemeralTrack,
} from "../utils.js";

const HOUR = 3600 * 1000;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
const MONTH = DAY * 30;

export class YTMusicCache {
	private readonly cache: PersistentCache;

	constructor(
		dbFile: string,
		private readonly innertube: Innertube,
	) {
		this.cache = new PersistentCache(dbFile);
	}

	async getTrack(videoId: string) {
		const response = await this.cache.getOrFind<{
			id: string;
			track: EphemeralTrack | null;
		}>(
			`song-upnext:${videoId}`,
			async () => {
				const info = await this.innertube.music
					.getUpNext(videoId, false)
					.then((panel_1) => panel_1.contents?.[0]);
				if (info && info.is(YTNodes.PlaylistPanelVideo)) {
					const track = upNextToEphemeralTrack(info, videoId);
					return { id: videoId, track };
				}
				return {
					id: videoId,
					track: null,
				};
			},
			{
				ttl: MONTH,
			},
		);

		return response.track;
	}

	async getTracks(trackIds: string[]) {
		const indexMap = new Map<string, Set<number>>();
		for (const [index, trackId] of trackIds.entries()) {
			const array = indexMap.get(trackId);
			if (array) {
				array.add(index);
			} else {
				indexMap.set(trackId, new Set([index]));
			}
		}

		const output: (EphemeralTrack | null)[] = Array(trackIds.length).fill(null);

		const cacheTracks = await this.cache.getMany<{
			id: string;
			track: EphemeralTrack | null;
		}>(Array.from(indexMap.keys()).map((trackId) => `song-upnext:${trackId}`));
		for (const cacheTrack of cacheTracks) {
			if (cacheTrack) {
				const indexes = indexMap.get(cacheTrack.id);
				if (indexes) {
					for (const index of indexes) {
						output[index] = cacheTrack.track;
					}
					indexMap.delete(cacheTrack.id);
				}
			}
		}

		// todo: maybe chunk this?
		const results = await Promise.allSettled(
			Array.from(indexMap.keys()).map((id) =>
				this.getTrack(id).then((track) => ({ id, track })),
			),
		);
		for (const result of results) {
			if (result.status == "fulfilled" && result.value.track) {
				const indexes = indexMap.get(result.value.id);
				if (indexes) {
					for (const index of indexes) {
						output[index] = result.value.track;
					}
				}
			}
		}

		return output.filter((track) => !!track);
	}

	async getAlbumMetadata(albumId: string) {
		return this.cache.getOrFind<AlbumMetadata>(
			`album:${albumId}`,
			async () => {
				const album = await this.innertube.music.getAlbum(albumId);
				const { artists, attributes, tracks } = toAlbum(album);
				await this.cache.set(`album-tracks:${albumId}`, tracks);

				return {
					artists,
					attributes,
				};
			},
			{
				ttl: MONTH,
			},
		);
	}

	async getAlbumTracks(albumId: string) {
		return this.cache.getOrFind<EphemeralTrack[]>(
			`album-tracks:${albumId}`,
			async () => {
				const album = await this.innertube.music.getAlbum(albumId);
				const { artists, attributes, tracks } = toAlbum(album);
				await this.cache.set(`album:${albumId}`, { artists, attributes });

				return tracks;
			},
			{
				ttl: WEEK,
			},
		);
	}

	async getPlaylistMetadata(playlistId: string) {
		if (!playlistId.startsWith("VL")) {
			playlistId = `VL${playlistId}`;
		}

		return this.cache.getOrFind<AlbumMetadata>(
			`playlist:${playlistId}`,
			async () => {
				const result = await this.innertube.actions.execute("/browse", {
					browseId: playlistId,
					client: "YTMUSIC",
				});

				if (result.data.contents) {
					const playlist = twoColumnBrowseToPlaylistMetadata(
						result.data.contents,
					);
					if (playlist) {
						return {
							artists: playlist.artists,
							attributes: playlist.attributes,
						};
					}
				}

				throw new Error("Unable to locate or parse playlist");
			},
			{
				ttl: HOUR,
			},
		);
	}

	async getPlaylistTracks(playlistId: string) {
		return this.cache.getOrFind<EphemeralTrack[]>(
			`playlist-tracks:${playlistId}`,
			async () => {
				let playlist = await this.innertube.music.getPlaylist(playlistId);
				const tracks: EphemeralTrack[] = [];

				while (playlist) {
					const items = playlist.contents ?? [];
					for (const item of items) {
						if (item.is(YTNodes.ContinuationItem)) {
							continue;
						}

						if (item.item_type != "song" && item.item_type != "video") {
							continue;
						}

						const track = listItemToTrack(item);
						if (track) {
							tracks.push(track);
						}
					}

					if (!playlist.has_continuation) {
						break;
					}
					playlist = await playlist.getContinuation();
				}

				return tracks;
			},
			{
				ttl: DAY,
			},
		);
	}

	async getChannelHandle(channelId: string) {
		const handle = await this.cache.getOrFind<string>(
			`channel-handle:${channelId}`,
			async () => {
				const result = await this.innertube.actions.execute("/browse", {
					browseId: channelId,
					client: "YTMUSIC",
				});
				if (result.status_code != 200 || !result.data?.contents) {
					throw new Error("Invalid response from YouTube");
				}

				const microformat = Parser.parse(result.data.microformat).item();
				if (microformat.is(YTNodes.MicroformatData)) {
					const end = microformat.url_canonical.split("/").pop()!;
					if (end.startsWith("@")) {
						return end.substring(1);
					}
					return "";
				}
				throw new Error("Unable to parse Microformat");
			},
		);
		return handle || null;
	}

	async handleToChannelId(handle: string) {
		if (handle.startsWith("@")) {
			handle = handle.substring(1);
		}
		handle = handle.toLowerCase();

		return this.cache.getOrFind<string | null>(
			`handle-channel:${handle}`,
			async () => {
				const endpoint = await this.innertube.resolveURL(
					`https://music.youtube.com/@${handle}`,
				);
				return endpoint.payload?.browseId ?? null;
			},
			{
				ttl: MONTH,
			},
		);
	}

	async getChannelType(channelId: string) {
		return this.cache.getOrFind<"artist" | "user">(
			`channel-type:${channelId}`,
			async () => {
				const result = await this.innertube.actions.execute("/browse", {
					browseId: channelId,
					client: "YTMUSIC",
				});
				if (result.status_code != 200 || !result.data?.contents) {
					throw new Error("Invalid response from YouTube");
				}

				const contents = Parser.parse(result.data.contents).item();
				if (contents.is(YTNodes.SingleColumnBrowseResults)) {
					for (const tab of contents.tabs) {
						if (tab.selected) {
							if (tab.title == "Music") {
								return "artist";
							}
							if (tab.title == "Home") {
								return "user";
							}
						}
					}
				}

				throw new Error("Unable to parse channel");
			},
			{
				ttl: MONTH,
			},
		);
	}

	async getChannelMetadata(channelId: string) {
		const result = await this.innertube.actions.execute("/browse", {
			browseId: channelId,
			client: "YTMUSIC",
		});
		if (result.status_code != 200 || !result.data?.contents) {
			throw new Error("Invalid response from YouTube");
		}

		const microformat = Parser.parse(result.data.microformat).item();
		if (microformat.is(YTNodes.MicroformatData)) {
			const end = microformat.url_canonical.split("/").pop()!;
			if (end.startsWith("@")) {
				await this.cache.set(`channel-handle:${channelId}`, end.substring(1));
			} else {
				await this.cache.set(`channel-handle:${channelId}`, "");
			}
		}

		const contents = Parser.parse(result.data.contents).item();

		if (contents.is(YTNodes.SingleColumnBrowseResults)) {
			for (const tab of contents.tabs) {
				if (tab.selected) {
					if (tab.title == "Music") {
						await this.cache.set(`channel-type:${channelId}`, "artist");
						const output = toArtist(result.data);
						deserializeAllThumbnails(output);
						return output;
					}
					if (tab.title == "Home") {
						await this.cache.set(`channel-type:${channelId}`, "user");
						const output = toUser(result.data);
						deserializeAllThumbnails(output);
						return output;
					}
				}
			}
		}

		throw new Error("Unable to locate or parse channel");
	}

	async getArtistContent(artistId: string) {
		return this.cache.getOrFind<EphemeralArtistContent>(
			`channel-content:${artistId}`,
			async () => {
				const artist = await this.innertube.music.getArtist(artistId);

				const tracks: EphemeralTrack[] = [];
				const albums: IdentifiableAlbumMetadata[] = [];

				for (const section of artist.sections ?? []) {
					const contents = section?.contents;

					if (!contents) continue;

					for (const item of contents) {
						if (
							item instanceof YTNodes.MusicResponsiveListItem &&
							item.item_type == "song"
						) {
							const track = listItemToTrack(item);
							if (track) tracks.push(track);
						}

						if (
							item instanceof YTNodes.MusicTwoRowItem &&
							item.item_type == "album"
						) {
							const album = twoRowItemToAlbum(item);
							if (album) {
								albums.push(album);
							}
						}
					}
				}

				return {
					tracks,
					albums,
				};
			},
			{
				ttl: DAY,
			},
		);
	}

	async getUserContent(userId: string) {
		return this.cache.getOrFind<EphemeralArtistContent>(
			`channel-content:${userId}`,
			async () => {
				const result = await this.innertube.actions.execute("/browse", {
					browseId: userId,
					client: "YTMUSIC",
				});

				const { attributes, albums } = toUser(result.data);
				await this.cache.set(`user:${userId}`, { attributes });

				return { albums, tracks: [] };
			},
		);
	}
}
