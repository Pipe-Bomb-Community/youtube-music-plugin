import {
	IdentifierDependency,
	Logger,
	TrackIdentifier,
	TrackIdentifierTarget,
	TrackInformationHelper,
} from "@sdk";
import { YTMusicCache } from "../cache/ytmusic-cache.js";

export class AlbumIdTrackIdentifier implements TrackIdentifier {
	readonly id = "youtube_music_album_id";
	readonly target: TrackIdentifierTarget = "album";

	constructor(private readonly cache: YTMusicCache) {}

	async identify(
		helper: TrackInformationHelper,
		_logger: Logger,
	): Promise<string[] | null> {
		const trackId = await helper.getIdentity("youtube_music_track_id");
		if (!trackId) {
			return null;
		}

		const albumId = await this.cache.getTrackAlbumId(trackId.identity);
		if (!albumId) {
			return null;
		}

		return [albumId];
	}

	getDependencies(): IdentifierDependency[] {
		return [
			{
				pluginId: null,
				sourceId: "youtube_music_track_id",
			},
		];
	}

	getSoftDependencies(): IdentifierDependency[] {
		return [];
	}
}
