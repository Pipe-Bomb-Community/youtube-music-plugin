import Innertube, { Parser, YTNodes, YTMusic } from "youtubei.js";
import { PersistentCache } from "./persistent-cache.js";
import {
	AlbumMetadata,
	ArtistMetadata,
	AttributeValue,
	EphemeralArtistContent,
	EphemeralTrack,
	IdentifiableAlbumMetadata,
} from "@pipe-bomb/plugin-sdk";
import {
	deserializeAllThumbnails,
	extractAudioPlaylistId,
	listItemToTrack,
	mostCommonDate,
	normalizeIsoDate,
	parseReleaseDate,
	serializeThumbnailAttribute,
	toAlbum,
	toArtist,
	toUser,
	twoColumnBrowseToPlaylistMetadata,
	twoRowItemToAlbum,
	upNextToEphemeralTrack,
} from "../utils.js";
import { YtDlpFormat } from "../types/yt-dlp.js";

const HOUR = 3600 * 1000;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
const MONTH = DAY * 30;

const RELEASE_DATE_SAMPLE = 30;
const RELEASE_DATE_CONCURRENCY = 5;

const CACHE_VERSION = "v2";

const AUDIO_FORMAT_VERSION = "v1";
const AUDIO_FORMAT_TTL = 30 * 60 * 1000;

export interface CachedAudioFormat {
	format: YtDlpFormat;
	duration: number | null;
}

export class YTMusicCache {
	private readonly cache: PersistentCache;

	constructor(
		dbFile: string,
		private readonly innertube: Innertube,
	) {
		this.cache = new PersistentCache(dbFile);
	}

	private static audioFormatKey(videoId: string) {
		return `audio-format:${AUDIO_FORMAT_VERSION}:${videoId}`;
	}

	async getAudioFormat(videoId: string): Promise<CachedAudioFormat | null> {
		return this.cache.get<CachedAudioFormat>(YTMusicCache.audioFormatKey(videoId));
	}

	async setAudioFormat(videoId: string, value: CachedAudioFormat) {
		await this.cache.setWithTtl(
			YTMusicCache.audioFormatKey(videoId),
			value,
			AUDIO_FORMAT_TTL,
		);
	}

	async deleteAudioFormat(videoId: string) {
		await this.cache.delete(YTMusicCache.audioFormatKey(videoId));
	}

	private async getCachedTrackEntry(videoId: string) {
		return this.cache.getOrFind<{
			id: string;
			track: EphemeralTrack | null;
			albumId: string | null;
		}>(
			`song-upnext:${CACHE_VERSION}:${videoId}`,
			async () => {
				const info = await this.innertube.music
					.getUpNext(videoId, false)
					.then((panel_1) => panel_1.contents?.[0]);
				let track: EphemeralTrack | null = null;
				let albumId: string | null = null;
				if (info && info.is(YTNodes.PlaylistPanelVideo)) {
					track = upNextToEphemeralTrack(info, videoId);
					albumId = info.album?.id ?? null;
				}
				if (track) {
					await this.enrichTrackMetadata(track, videoId);
				}
				return { id: videoId, track, albumId };
			},
			{
				ttl: MONTH,
			},
		);
	}

	private async enrichTrackMetadata(track: EphemeralTrack, videoId: string) {
		if (!track.attributes) {
			return;
		}
		try {
			const info = await this.innertube.getBasicInfo(videoId);
			const basicInfo = info.basic_info;
			if (typeof basicInfo?.view_count == "number") {
				track.attributes.push({
					key: "views",
					value: basicInfo.view_count,
				});
			}
			const description = basicInfo?.short_description?.trim();
			if (description) {
				track.attributes.push({
					key: "description",
					value: description,
				});
			}
			const releaseDate =
				parseReleaseDate(description) ?? this.getMediaDate(info);
			if (releaseDate) {
				track.attributes.push({
					key: "release_date",
					value: releaseDate,
				});
			}
			await this.cache.set(`track-date:${videoId}`, releaseDate ?? "");
		} catch {}
	}

	private getMediaDate(info: any): string | null {
		const microformat = info?.page?.[0]?.microformat;
		const rawDate =
			microformat?.publish_date ??
			microformat?.upload_date ??
			microformat?.playerMicroformatRenderer?.publishDate ??
			microformat?.playerMicroformatRenderer?.uploadDate;
		return normalizeIsoDate(rawDate);
	}

	private async getTrackDate(videoId: string): Promise<string | null> {
		const cached = await this.cache.get<string>(`track-date:${videoId}`);
		if (cached !== null) {
			return cached || null;
		}
		let date: string | null = null;
		try {
			const info = await this.innertube.getBasicInfo(videoId);
			date =
				parseReleaseDate(info.basic_info?.short_description) ??
				this.getMediaDate(info);
		} catch {}
		await this.cache.set(`track-date:${videoId}`, date ?? "");
		return date;
	}

	async getLyrics(videoId: string): Promise<string | null> {
		const cached = await this.cache.get<string>(`lyrics:${videoId}`);
		if (cached !== null) {
			return cached || null;
		}
		let lyrics = "";
		try {
			const shelf = await this.innertube.music.getLyrics(videoId);
			lyrics = shelf?.description?.toString()?.trim() ?? "";
		} catch {}
		await this.cache.set(`lyrics:${videoId}`, lyrics);
		return lyrics || null;
	}

	/**
	 * Resolves an album's release date from its tracks. Each track is stamped with its own
	 * date (its description's `Released on:` line, else its upload/publish date), and the
	 * album date is the *most common* track date — not the earliest, so a single released
	 * years before the album does not drag the album date backwards.
	 */
	private async resolveAlbumReleaseDates(
		tracks: EphemeralTrack[],
	): Promise<string | null> {
		const ids = tracks
			.map((track) => track.id)
			.filter((id) => !!id)
			.slice(0, RELEASE_DATE_SAMPLE);

		const dates: string[] = [];
		for (let i = 0; i < ids.length; i += RELEASE_DATE_CONCURRENCY) {
			const batch = ids.slice(i, i + RELEASE_DATE_CONCURRENCY);
			const results = await Promise.all(
				batch.map(async (id) => ({ id, date: await this.getTrackDate(id) })),
			);
			for (const { id, date } of results) {
				if (!date) {
					continue;
				}
				dates.push(date);
				const track = tracks.find((t) => t.id == id);
				if (
					track?.attributes &&
					!track.attributes.some((a) => a.key == "release_date")
				) {
					track.attributes.push({
						key: "release_date",
						value: date,
					});
				}
			}
		}

		return mostCommonDate(dates);
	}

	private stampTrackReleaseDate(tracks: EphemeralTrack[], releaseDate: string) {
		for (const track of tracks) {
			if (
				track.attributes &&
				!track.attributes.some((attribute) => attribute.key == "release_date")
			) {
				track.attributes.push({
					key: "release_date",
					value: releaseDate,
				});
			}
		}
	}

	async getTrack(videoId: string) {
		return (await this.getCachedTrackEntry(videoId)).track;
	}

	async getTrackAlbumId(videoId: string): Promise<string | null> {
		return (await this.getCachedTrackEntry(videoId)).albumId ?? null;
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
			albumId: string | null;
		}>(
			Array.from(indexMap.keys()).map(
				(trackId) => `song-upnext:${CACHE_VERSION}:${trackId}`,
			),
		);
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
			`album:${CACHE_VERSION}:${albumId}`,
			async () => {
				const album = await this.innertube.music.getAlbum(albumId);
				const { artists, attributes, tracks } = toAlbum(album);
				const resolvedTracks = await this.resolveAlbumTracks(album, tracks);

				const releaseDate = await this.resolveAlbumReleaseDates(resolvedTracks);
				if (releaseDate) {
					attributes.push({
						key: "release_date",
						value: releaseDate,
					});
					this.stampTrackReleaseDate(resolvedTracks, releaseDate);
				}

				await this.cache.set(
					`album-tracks:${CACHE_VERSION}:${albumId}`,
					resolvedTracks,
				);

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
			`album-tracks:${CACHE_VERSION}:${albumId}`,
			async () => {
				const album = await this.innertube.music.getAlbum(albumId);
				const { artists, attributes, tracks } = toAlbum(album);
				const resolvedTracks = await this.resolveAlbumTracks(album, tracks);

				const releaseDate = await this.resolveAlbumReleaseDates(resolvedTracks);
				if (releaseDate) {
					attributes.push({
						key: "release_date",
						value: releaseDate,
					});
					this.stampTrackReleaseDate(resolvedTracks, releaseDate);
				}

				await this.cache.set(`album:${CACHE_VERSION}:${albumId}`, {
					artists,
					attributes,
				});

				return resolvedTracks;
			},
			{
				ttl: WEEK,
			},
		);
	}

	private async resolveAlbumTracks(
		album: YTMusic.Album,
		fallbackTracks: EphemeralTrack[],
	): Promise<EphemeralTrack[]> {
		const audioPlaylistId = extractAudioPlaylistId(album.url);
		if (!audioPlaylistId) {
			return fallbackTracks;
		}
		let tracks: EphemeralTrack[];
		try {
			tracks = await this.fetchPlaylistTracks(audioPlaylistId);
		} catch {
			return fallbackTracks;
		}
		if (!tracks.length) {
			return fallbackTracks;
		}

		tracks.forEach((track, index) => {
			if (
				track.attributes &&
				!track.attributes.some((attribute) => attribute.key == "track_number")
			) {
				track.attributes.push({
					key: "track_number",
					value: index + 1,
				});
			}
		});

		return tracks;
	}

	async getPlaylistMetadata(playlistId: string): Promise<AlbumMetadata> {
		if (!playlistId.startsWith("VL")) {
			playlistId = `VL${playlistId}`;
		}

		const { artists, attributes } = await this.cache.getOrFind<AlbumMetadata>(
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
		return {
			artists,
			attributes: [
				...(attributes ?? []),
				{
					key: "releaseradar_exclude",
					value: true,
				},
			],
		};
	}

	private async fetchPlaylistTracks(
		playlistId: string,
	): Promise<EphemeralTrack[]> {
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
	}

	async getPlaylistTracks(playlistId: string) {
		return this.cache.getOrFind<EphemeralTrack[]>(
			`playlist-tracks:${playlistId}`,
			() => this.fetchPlaylistTracks(playlistId),
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
