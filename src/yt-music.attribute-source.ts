import {
	AlbumInformationHelper,
	AlbumMetadata,
	ArtistInformationHelper,
	ArtistMetadata,
	AttributeSource,
	AttributeSourceApiContext,
	AttributeValue,
	BufferAttributeValue,
	IdentifiableTrackArtistMetadata,
	TrackAttributionHelper,
	TrackMetadata,
} from "@sdk";
import YTMusic, { AlbumDetailed, ArtistFull } from "atexovi-ytmusic-api";
import { extname } from "path";
import Axios from "axios";
import { YTMArtistStub, YTMSong, YTMThumbnail } from "./types.js";

export class YTMusicAttributeSource implements AttributeSource {
	readonly id = "youtube-music";
	private api!: AttributeSourceApiContext;

	constructor(private readonly ytMusic: YTMusic.default) {}

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

	toTrackMetadata(song: YTMSong): TrackMetadata {
		const attributes: AttributeValue[] = [];

		if (song.name) {
			attributes.push({
				key: "title",
				value: song.name,
			});
		}

		if (song.duration) {
			attributes.push({
				key: "duration",
				value: song.duration,
			});
		}

		if (song.thumbnails?.length) {
			attributes.push({
				key: "front",
				value: this.toThumbnailAttribute(song.thumbnails),
			});
		}

		const artists: IdentifiableTrackArtistMetadata[] = [];
		if (song.artist?.artistId && song.artist.name) {
			artists.push({
				...this.toMinimalArtistMetadata(song.artist),
				pluginId: "youtube-music",
				identityId: "youtube_music_artist_id",
				identity: song.artist.artistId,
			});
		}

		return {
			artists,
			attributes,
		};
	}

	toArtistMetadata(artist: ArtistFull): ArtistMetadata {
		const attributes: AttributeValue[] = [];

		if (artist.name) {
			attributes.push({
				key: "name",
				value: artist.name,
			});
		}

		if (artist.thumbnails?.length) {
			attributes.push({
				key: "thumb",
				value: this.toThumbnailAttribute(artist.thumbnails),
			});
		}

		return { attributes };
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

	toAlbumMetadata(album: AlbumDetailed): AlbumMetadata {
		const attributes: AttributeValue[] = [];

		if (album.name) {
			attributes.push({
				key: "title",
				value: album.name,
			});
		}
		if (album.thumbnails?.length) {
			attributes.push({
				key: "front",
				value: this.toThumbnailAttribute(album.thumbnails),
			});
		}
		if (album.year) {
			attributes.push({
				key: "year",
				value: album.year,
			});
		}

		const artists: IdentifiableTrackArtistMetadata[] = [];
		if (album.artist?.artistId && album.artist.name) {
			artists.push({
				...this.toMinimalArtistMetadata(album.artist),
				pluginId: "youtube-music",
				identityId: "youtube_music_artist_id",
				identity: album.artist.artistId,
			});
		}

		return {
			attributes,
			artists,
		};
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

	getTrackAttributeValues(
		helper: TrackAttributionHelper,
	): Promise<TrackMetadata> {
		throw new Error("Method not implemented.");
	}

	getArtistAttributeValues(
		helper: ArtistInformationHelper,
	): Promise<ArtistMetadata> {
		throw new Error("Method not implemented.");
	}

	getAlbumAttributeValues(
		helper: AlbumInformationHelper,
	): Promise<AlbumMetadata> {
		throw new Error("Method not implemented.");
	}
}
