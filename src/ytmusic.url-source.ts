import {
	AlbumExternalUrlHelper,
	ArtistExternalUrlHelper,
	ExternalUrl,
	ExternalUrlSource,
	TrackExternalUrlHelper,
} from "@pipe-bomb/plugin-sdk";

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
		const track = helper.getIdentity("youtube_music_track_id");
		if (track) {
			return [
				{
					name: "YouTube Music",
					url: `https://music.youtube.com/watch?v=${track.identity}`,
					iconId: "logo",
				},
			];
		}

		return null;
	}

	getAlbumUrls(helper: AlbumExternalUrlHelper): ExternalUrl[] | null {
		const album = helper.getIdentity("youtube_music_album_id");
		if (album) {
			return [
				{
					name: "YouTube Music",
					url: `https://music.youtube.com/browse/${album.identity}`,
					iconId: "logo",
				},
			];
		}

		const playlist = helper.getIdentity("youtube_music_playlist_id");
		if (playlist) {
			const id = playlist.identity.startsWith("VL")
				? playlist.identity.substring(2)
				: playlist.identity;
			return [
				{
					name: "YouTube Music",
					url: `https://music.youtube.com/playlist?list=${id}`,
					iconId: "logo",
				},
			];
		}

		return null;
	}
}
