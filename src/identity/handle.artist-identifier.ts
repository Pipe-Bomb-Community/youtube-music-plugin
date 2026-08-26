import {
	ArtistIdentifier,
	ArtistInformationHelper,
	IdentifierDependency,
	Logger,
} from "@pipe-bomb/plugin-sdk";
import { YTMusicCache } from "../cache/ytmusic-cache.js";

export class HandleArtistIdentifier implements ArtistIdentifier {
	readonly id = "youtube_handle";

	constructor(private readonly cache: YTMusicCache) {}

	async identify(
		helper: ArtistInformationHelper,
		_logger: Logger,
	): Promise<string[] | null> {
		const channelIds = new Set<string>(
			helper
				.getIdentity("youtube_channel_id", null, true)
				?.map((i) => i.identity) ?? [],
		);

		const handles: string[] = [];

		for (const channelId of channelIds) {
			const handle = (
				await this.cache.getChannelHandle(channelId)
			)?.toLowerCase();
			if (handle && !handles.includes(handle)) {
				handles.push(handle);
			}
		}

		return handles;
	}

	getDependencies(): IdentifierDependency[] {
		return [];
	}

	getSoftDependencies(): IdentifierDependency[] {
		return [
			{
				pluginId: null,
				sourceId: "youtube_channel_id",
			},
		];
	}
}
