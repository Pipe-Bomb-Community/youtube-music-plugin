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

export class YTMusicAttributeSource implements AttributeSource {
	readonly id = "youtube-music";
	private api!: AttributeSourceApiContext;

	constructor() {}

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
