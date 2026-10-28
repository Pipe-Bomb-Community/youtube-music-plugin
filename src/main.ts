import type PipeBomb from "@pipe-bomb/plugin-sdk";
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
import { resolveYtDlp, updateYtDlp } from "./ytdlp.js";
import {
	captureYouTubeiLogs,
	releaseYouTubeiLogs,
} from "./youtubei-log.js";

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			},
		);
	});
}

const INNERTUBE_REQUEST_TIMEOUT = 30_000;

function fetchWithTimeout(
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
): ReturnType<typeof fetch> {
	const controller = new AbortController();
	const outerSignal = init?.signal;
	const onAbort = () => controller.abort(outerSignal?.reason);

	if (outerSignal) {
		if (outerSignal.aborted) {
			onAbort();
		} else {
			outerSignal.addEventListener("abort", onAbort, { once: true });
		}
	}

	const timer = setTimeout(
		() => controller.abort(new Error("YouTube Music request timed out")),
		INNERTUBE_REQUEST_TIMEOUT,
	);

	return fetch(input, { ...init, signal: controller.signal }).finally(() => {
		clearTimeout(timer);
		outerSignal?.removeEventListener("abort", onAbort);
	});
}

export default class Plugin implements PipeBomb.Plugin {
	private api!: PipeBomb.PluginApiContext;
	private logger!: PipeBomb.Logger;

	enable(apiContext: PipeBomb.PluginApiContext) {
		this.api = apiContext;
		this.logger = apiContext.getLogger();

		captureYouTubeiLogs(this.logger);

		this.api.registerLanguageDirectory("language");
		this.api.registerIconDirectory("icons");

		const configManager = new YTMusicConfigManager();
		this.api.registerConfigManager(configManager);

		this.api.requestCacheDirectory().then(async (cacheDir) => {
			const ytDlpResolution = await resolveYtDlp(cacheDir);
			const ytDlpPath = Promise.resolve(ytDlpResolution.path);

			const innertube = await withTimeout(
				Innertube.create({
					cache: new UniversalCache(true, path.join(cacheDir, "innertube")),
					fetch: fetchWithTimeout,
				}),
				60_000,
				"Timed out initializing YouTube Music client",
			);

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

			const libraryHandler = new YTMusicLibraryHandler(
				cache,
				configManager,
				ytDlpPath,
			);
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

			if (ytDlpResolution.managed) {
				this.api.registerTask({
					id: "update-yt-dlp",
					resumable: false,
					run: async (ctx) => {
						ctx.update(0);
						await updateYtDlp(ytDlpResolution.path, this.logger);
						ctx.update(100);
					},
				});
			}
		});
	}

	disable() {
		releaseYouTubeiLogs();
	}

	public getLogger() {
		return this.logger;
	}

	public getApi() {
		return this.api;
	}
}
