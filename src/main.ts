import type PipeBomb from "@sdk";
import { YTMusicLibraryHandler } from "./yt-music.library-handler.js";
import { YTMusicEphemeralSource } from "./yt-music.ephemeral-source.js";
import { YTMusicAttributeSource } from "./yt-music.attribute-source.js";
import Innertube, { ClientType, UniversalCache } from "youtubei.js";
import path from "path";

export default class Plugin implements PipeBomb.Plugin {
	private api!: PipeBomb.PluginApiContext;
	private logger!: PipeBomb.Logger;

	enable(apiContext: PipeBomb.PluginApiContext) {
		this.api = apiContext;
		this.logger = apiContext.getLogger();

		this.api.registerLanguageDirectory("language");
		// this.api.registerIconDirectory("icons");

		this.api.requestCacheDirectory().then(async (cacheDir) => {
			const innertube = await Innertube.create({
				client_type: ClientType.MWEB,
				cache: new UniversalCache(true, path.join(cacheDir, "innertube")),
			});

			const libraryHandler = new YTMusicLibraryHandler(innertube);
			const attributeSource = new YTMusicAttributeSource();
			const ephemeralSource = new YTMusicEphemeralSource(
				libraryHandler,
				attributeSource,
				innertube,
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
