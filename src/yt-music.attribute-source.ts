import {
	AlbumInformationHelper,
	AlbumMetadata,
	ArtistInformationHelper,
	ArtistMetadata,
	AttributeSource,
	AttributeSourceApiContext,
	AttributeValue,
	BufferAttributeValue,
	TrackAttributionHelper,
	TrackMetadata,
} from "@pipe-bomb/plugin-sdk";
import Axios from "axios";
import { YTMArtistStub, YTMThumbnail } from "./types.js";
import { YTMusicCache } from "./cache/ytmusic-cache.js";
import { formatDateString, formatNumber } from "./utils.js";

function formatDuration(value: number): string {
	let seconds = Math.floor(value);
	let minutes = Math.floor(seconds / 60);
	seconds -= minutes * 60;
	const hours = Math.floor(minutes / 60);
	minutes -= hours * 60;
	if (hours) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
			.toString()
			.padStart(2, "0")}`;
	}
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export class YTMusicAttributeSource implements AttributeSource {
	readonly id = "youtube-music";
	private api!: AttributeSourceApiContext;

	constructor(private readonly cache: YTMusicCache) {}

	enable(attributeSourceApiContext: AttributeSourceApiContext): void {
		this.api = attributeSourceApiContext;

		this.api.registerTrackAttributes([
			{
				key: "title",
				type: "string",
				supportsMultiple: false,
			},
			{
				key: "duration",
				type: "decimal",
				supportsMultiple: false,
				formatter: formatDuration,
			},
			{
				key: "front",
				type: "buffer",
				supportsMultiple: false,
			},
			{
				key: "year",
				type: "integer",
				supportsMultiple: false,
			},
			{
				key: "album",
				type: "string",
				supportsMultiple: false,
			},
			{
				key: "artist",
				type: "string",
				supportsMultiple: true,
			},
			{
				key: "track_number",
				type: "integer",
				supportsMultiple: false,
			},
			{
				key: "disc_number",
				type: "integer",
				supportsMultiple: false,
			},
			{
				key: "explicit",
				type: "boolean",
				supportsMultiple: false,
				formatter: (explicit) => (explicit ? "Explicit" : ""),
			},
			{
				key: "lyrics",
				type: "string",
				supportsMultiple: false,
			},
			{
				key: "views",
				type: "integer",
				supportsMultiple: false,
				formatter: formatNumber,
			},
			{
				key: "description",
				type: "string",
				supportsMultiple: false,
			},
			{
				key: "release_date",
				type: "string",
				supportsMultiple: false,
				formatter: formatDateString,
			},
		]);

		this.api.registerArtistAttributes([
			{
				key: "name",
				type: "string",
				supportsMultiple: false,
			},
			{
				key: "thumb",
				type: "buffer",
				supportsMultiple: false,
			},
			{
				key: "background",
				type: "buffer",
				supportsMultiple: false,
			},
			{
				key: "description",
				type: "string",
				supportsMultiple: false,
			},
		]);

		this.api.registerAlbumAttributes([
			{
				key: "title",
				type: "string",
				supportsMultiple: false,
			},
			{
				key: "front",
				type: "buffer",
				supportsMultiple: false,
			},
			{
				key: "year",
				type: "integer",
				supportsMultiple: false,
			},
			{
				key: "artist",
				type: "string",
				supportsMultiple: true,
			},
			{
				key: "release_type",
				type: "string",
				supportsMultiple: true,
				formatter: (value) => value,
			},
			{
				key: "track_count",
				type: "integer",
				supportsMultiple: false,
			},
			{
				key: "duration",
				type: "decimal",
				supportsMultiple: false,
				formatter: formatDuration,
			},
			{
				key: "description",
				type: "string",
				supportsMultiple: false,
			},
			{
				key: "explicit",
				type: "boolean",
				supportsMultiple: false,
			},
			{
				key: "release_date",
				type: "string",
				supportsMultiple: false,
			},
			{
				key: "releaseradar_exclude",
				type: "boolean",
				supportsMultiple: false,
			},
		]);
	}

	getName(): string {
		return "YouTube Music";
	}

	toMinimalArtistMetadata(
		artistStub: YTMArtistStub,
		thumbnails?: YTMThumbnail[],
	): ArtistMetadata {
		const attributes: AttributeValue[] = [];

		if (artistStub.name) {
			attributes.push({ key: "name", value: artistStub.name });
		}
		if (thumbnails?.length) {
			attributes.push({
				key: "thumb",
				value: this.toThumbnailAttribute(thumbnails),
			});
		}

		return { attributes };
	}

	toThumbnailAttribute(thumbnails: YTMThumbnail[]): BufferAttributeValue {
		if (!thumbnails?.length) {
			throw new Error("No thumbnails provided");
		}

		const sortedThumbnails = this.sortThumbnails(thumbnails);

		return {
			extension: "jpg",
			buffer: async () => {
				for (const thumbnail of sortedThumbnails) {
					try {
						const { data } = await Axios.get<Buffer>(thumbnail.url, {
							responseType: "arraybuffer",
							timeout: 15_000,
						});
						return data;
					} catch {}
				}
				throw new Error("No thumbnail response");
			},
		};
	}

	private sortThumbnails(thumbnails: YTMThumbnail[]) {
		return [...thumbnails].sort(
			(a, b) => b.width * b.height - a.width * a.height,
		);
	}

	async getTrackAttributeValues(
		helper: TrackAttributionHelper,
	): Promise<TrackMetadata> {
		const trackId = await helper.getIdentity("youtube_music_track_id");
		if (trackId) {
			const track = await this.cache.getTrack(trackId.identity);
			if (track) {
				const attributes: AttributeValue[] = track.attributes
					? [...track.attributes]
					: [];

				const lyrics = await this.cache.getLyrics(trackId.identity);
				if (lyrics && !attributes.some((a) => a.key == "lyrics")) {
					attributes.push({
						key: "lyrics",
						value: lyrics,
					});
				}

				return {
					artists: track.artists,
					attributes,
				};
			}
		}

		return {
			artists: null,
			attributes: null,
		};
	}

	async getArtistAttributeValues(
		helper: ArtistInformationHelper,
	): Promise<ArtistMetadata> {
		const channelId = helper.getIdentity("youtube_channel_id");
		if (channelId) {
			return this.cache.getChannelMetadata(channelId.identity);
		}

		return {
			attributes: null,
		};
	}

	async getAlbumAttributeValues(
		helper: AlbumInformationHelper,
	): Promise<AlbumMetadata> {
		const albumId = await helper.getIdentity("youtube_music_album_id");
		if (albumId) {
			return this.cache.getAlbumMetadata(albumId.identity);
		}

		const playlistId = await helper.getIdentity("youtube_music_playlist_id");
		if (playlistId) {
			return this.cache.getPlaylistMetadata(playlistId.identity);
		}

		return {
			artists: null,
			attributes: null,
		};
	}
}
