import type PipeBomb from "@sdk";
import YTMusic from "atexovi-ytmusic-api";
import { YTMusicLibraryHandler } from "./yt-music.library-handler.js";
import { YTMusicEphemeralSource } from "./yt-music.ephemeral-source.js";
import { YTMusicAttributeSource } from "./yt-music.attribute-source.js";

export default class Plugin implements PipeBomb.Plugin {
	private api!: PipeBomb.PluginApiContext;
	private logger!: PipeBomb.Logger;

	enable(apiContext: PipeBomb.PluginApiContext) {
		this.api = apiContext;
		this.logger = apiContext.getLogger();

		this.api.registerLanguageDirectory("language");
		this.api.registerIconDirectory("icons");

		const ytMusic = new YTMusic.default();
		ytMusic.initialize().then(() => {
			const libraryHandler = new YTMusicLibraryHandler(ytMusic);
			const attributeSource = new YTMusicAttributeSource(ytMusic);
			const ephemeralSource = new YTMusicEphemeralSource(
				libraryHandler,
				attributeSource,
				ytMusic,
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
