import {
	AlbumIdentifier,
	AlbumIdentifierTarget,
	AlbumInformationHelper,
	IdentifierDependency,
	Logger,
} from "@pipe-bomb/plugin-sdk";
import { YTMusicCache } from "../cache/ytmusic-cache.js";

export class ArtistIdAlbumIdentifier implements AlbumIdentifier {
	readonly id = "youtube_channel_id";
	readonly target: AlbumIdentifierTarget = "artist";

	constructor(private readonly cache: YTMusicCache) {}

	async identify(
		helper: AlbumInformationHelper,
		_logger: Logger,
	): Promise<string[] | null> {
		const albumId = await helper.getIdentity("youtube_music_album_id");
		if (!albumId) {
			return null;
		}

		const album = await this.cache.getAlbumMetadata(albumId.identity);
		if (!album?.artists?.length) {
			return null;
		}

		return album.artists.map((artist) => artist.identity);
	}

	getDependencies(): IdentifierDependency[] {
		return [
			{
				pluginId: null,
				sourceId: "youtube_music_album_id",
			},
		];
	}

	getSoftDependencies(): IdentifierDependency[] {
		return [];
	}
}
