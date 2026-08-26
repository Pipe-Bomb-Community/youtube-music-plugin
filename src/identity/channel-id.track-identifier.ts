import {
	IdentifierDependency,
	Logger,
	TrackIdentifier,
	TrackIdentifierTarget,
	TrackInformationHelper,
} from "@pipe-bomb/plugin-sdk";
import { YTMusicCache } from "../cache/ytmusic-cache.js";

export class ChannelIdTrackIdentifier implements TrackIdentifier {
	readonly id = "youtube_channel_id";
	readonly target: TrackIdentifierTarget = "artist";

	constructor(private readonly cache: YTMusicCache) {}

	async identify(
		helper: TrackInformationHelper,
		_logger: Logger,
	): Promise<string[] | null> {
		const trackId = await helper.getIdentity("youtube_music_track_id");
		if (!trackId) {
			return null;
		}

		const track = await this.cache.getTrack(trackId.identity);
		if (track?.artists) {
			return track.artists.map((artist) => artist.identity);
		}
		return null;
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
