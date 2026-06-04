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
	listItemToTrack,
	serializeThumbnailAttribute,
	toAlbum,
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
					.getUpNext(videoId)
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

		return this.cache.getOrFind<AlbumMetadata | null>(
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

	async getArtistMetadata(artistId: string) {
		return this.cache.getOrFind<ArtistMetadata>(
			`artist:${artistId}`,
			async () => {
				const result = await this.innertube.music.getArtist(artistId);

				const attributes: AttributeValue[] = [];

				if (result.header?.title) {
					attributes.push({
						key: "name",
						value: result.header.title.toString(),
					});
				}

				if (result.header instanceof YTNodes.MusicImmersiveHeader) {
					if (result.header.thumbnail?.contents.length) {
						attributes.push({
							key: "background",
							value: serializeThumbnailAttribute(
								result.header.thumbnail.contents,
							),
						});
					}
				}

				return { attributes };
			},
			{
				ttl: MONTH,
			},
		);
	}

	async getUserMetadata(userId: string) {
		return this.cache.getOrFind<ArtistMetadata>(
			`user:${userId}`,
			async () => {
				const result = await this.innertube.actions.execute("/browse", {
					browseId: userId,
					client: "YTMUSIC",
				});

				const { attributes, albums } = toUser(result.data);
				await this.cache.set(`user-content:${userId}`, { albums });

				return { attributes };
			},
			{
				ttl: DAY,
			},
		);
	}

	async getArtistContent(artistId: string) {
		return this.cache.getOrFind<EphemeralArtistContent>(
			`artist-content:${artistId}`,
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
			`user-content:${userId}`,
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
