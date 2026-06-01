import {
	Identifier,
	IdentifierDependency,
	Logger,
	TrackIdentifier,
	TrackIdentifierTarget,
	TrackInformationHelper,
} from "@sdk";

export class TrackIdTrackIdentifier implements TrackIdentifier {
	readonly id = "youtube_music_track_id";
	readonly target: TrackIdentifierTarget = "track";

	async identify(
		helper: TrackInformationHelper,
		_logger: Logger,
	): Promise<string[] | null> {
		if (
			helper.getPluginId() != "youtube-music" ||
			helper.getLibraryId() != "youtube-music"
		) {
			return null;
		}
		return [helper.getTrackId()];
	}

	getDependencies(): IdentifierDependency[] {
		return [];
	}

	getSoftDependencies(): IdentifierDependency[] {
		return [];
	}
}
