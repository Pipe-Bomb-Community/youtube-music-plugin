import {
	AlbumExternalUrlHelper,
	ArtistExternalUrlHelper,
	ExternalUrl,
	ExternalUrlSource,
	TrackExternalUrlHelper,
} from "@sdk";

export class YTMusicExternalUrlSource implements ExternalUrlSource {
	getArtistUrls(helper: ArtistExternalUrlHelper): ExternalUrl[] | null {
		const handle = helper.getIdentity("youtube_handle");
		if (handle) {
			return [
				{
					name: `@${handle.identity}`,
					url: `https://music.youtube.com/@${handle.identity}`,
					iconId: "logo",
				},
			];
		}

		const channelId = helper.getIdentity("youtube_channel_id");
		if (channelId) {
			return [
				{
					name: "YouTube Music",
					url: `https://music.youtube.com/channel/${channelId.identity}`,
					iconId: "logo",
				},
			];
		}

		return null;
	}

	getTrackUrls(helper: TrackExternalUrlHelper): ExternalUrl[] | null {
		return null;
	}

	getAlbumUrls(helper: AlbumExternalUrlHelper): ExternalUrl[] | null {
		return null;
	}
}
