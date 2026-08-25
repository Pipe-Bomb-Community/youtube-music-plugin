import type PipeBomb from "@sdk";
import { YTMusicLibraryHandler } from "./yt-music.library-handler.js";
import { YTMusicEphemeralSource } from "./yt-music.ephemeral-source.js";
import { YTMusicAttributeSource } from "./yt-music.attribute-source.js";
import Innertube, { UniversalCache } from "youtubei.js";
import path from "path";
import { TrackIdTrackIdentifier } from "./identity/track-id.track-identifier.js";
import { ChannelIdTrackIdentifier } from "./identity/channel-id.track-identifier.js";
import { YTMusicConfigManager } from "./yt-music.settings.js";
import { YTMusicCache } from "./cache/ytmusic-cache.js";
import { HandleArtistIdentifier } from "./identity/handle.artist-identifier.js";
import { AlbumIdTrackIdentifier } from "./identity/album-id.track-identifier.js";
import { ArtistIdAlbumIdentifier } from "./identity/artist-id.album-identifier.js";
import { YTMusicExternalUrlSource } from "./ytmusic.url-source.js";

export default class Plugin implements PipeBomb.Plugin {
	private api!: PipeBomb.PluginApiContext;
	private logger!: PipeBomb.Logger;

	enable(apiContext: PipeBomb.PluginApiContext) {
		this.api = apiContext;
		this.logger = apiContext.getLogger();

		this.api.registerLanguageDirectory("language");
		this.api.registerIconDirectory("icons");

		const configManager = new YTMusicConfigManager();
		this.api.registerConfigManager(configManager);

		this.api.requestCacheDirectory().then(async (cacheDir) => {
			const innertube = await Innertube.create({
				cache: new UniversalCache(true, path.join(cacheDir, "innertube")),
			});

			const cache = new YTMusicCache(
				path.join(cacheDir, "cache.sqlite"),
				innertube,
			);

			this.api.registerTrackIdentifier(new TrackIdTrackIdentifier());
			this.api.registerTrackIdentifier(new ChannelIdTrackIdentifier(cache));
			this.api.registerTrackIdentifier(new AlbumIdTrackIdentifier(cache));
			this.api.registerArtistIdentifier(new HandleArtistIdentifier(cache));
			this.api.registerAlbumIdentifier(new ArtistIdAlbumIdentifier(cache));

			this.api.registerExternalUrlSource(new YTMusicExternalUrlSource());

			const libraryHandler = new YTMusicLibraryHandler(cache, configManager);
			const attributeSource = new YTMusicAttributeSource(cache);
			const ephemeralSource = new YTMusicEphemeralSource(
				libraryHandler,
				attributeSource,
				innertube,
				cache,
			);

			this.api.registerLibraryHandler(libraryHandler);
			this.api.registerAttributeSource(attributeSource);
			this.api.registerEphemeralSource(ephemeralSource);
		});
	}

	disable() {}

	public getLogger() {
		return this.logger;
	}

	public getApi() {
		return this.api;
	}
}
