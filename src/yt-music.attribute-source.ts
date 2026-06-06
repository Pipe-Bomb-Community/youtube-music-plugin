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
} from "@sdk";
import Axios from "axios";
import { YTMArtistStub, YTMThumbnail } from "./types.js";
import { YTMusicCache } from "./cache/ytmusic-cache.js";

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
				return {
					artists: track.artists,
					attributes: track.attributes,
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
		const channelId = helper.getIdentity("youtube_music_channel_id");
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
