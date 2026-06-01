import {
	IdentifierDependency,
	Logger,
	TrackIdentifier,
	TrackIdentifierTarget,
	TrackInformationHelper,
} from "@sdk";
import Innertube, { YTNodes } from "youtubei.js";

export class ArtistIdTrackIdentifier implements TrackIdentifier {
	readonly id = "youtube_music_artist_id";
	readonly target: TrackIdentifierTarget = "artist";

	constructor(private readonly innertube: Innertube) {}

	async identify(
		helper: TrackInformationHelper,
		_logger: Logger,
	): Promise<string[] | null> {
		const trackId = await helper.getIdentity("youtube_music_track_id");
		if (!trackId) {
			return null;
		}
		const panel = await this.innertube.music.getUpNext(trackId.identity, false);
		const track = panel.contents?.[0];
		if (!track || !track.is(YTNodes.PlaylistPanelVideo)) {
			return null;
		}

		const ids: string[] = [];
		for (const artist of track.artists ?? []) {
			if (artist.channel_id) {
				ids.push(artist.channel_id);
			}
		}

		return ids;
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
