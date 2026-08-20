import { YTMusicCache } from "@/cache/ytmusic-cache.js";
import { YTMusicLibraryHandler } from "@/yt-music.library-handler.js";
import { YTMusicConfigManager } from "@/yt-music.settings.js";
import path from "path";
import Innertube, { UniversalCache } from "youtubei.js";

if (process.argv.length < 3) {
	console.error("Video ID not specified");
	console.error("Usage: npm run test:audio <Video ID>");
	process.exit(1);
}

const videoId = process.argv[2]!;

(async () => {
	const cacheDir = "temp";
	const innertube = await Innertube.create({
		cache: new UniversalCache(true, path.join(cacheDir, "innertube")),
	});

	const cache = new YTMusicCache(
		path.join(cacheDir, "cache.sqlite"),
		innertube,
	);

	const configManager = new YTMusicConfigManager();
	await configManager.enable({
		delete: async () => {},
		getValue: (key) => {
			switch (key) {
				case "extractor-args":
					return "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416 youtube:player_client=mweb";
				case "plugin-dirs":
					return "/home/eyezah/Documents/bgutil-ytdlp-pot-provider";
			}
			return null as any;
		},
		setValue: async () => {},
	});

	const libraryHandler = new YTMusicLibraryHandler(cache, configManager);
	console.log(`Attempting to load https://www.youtube.com/watch?v=${videoId}`);

	const audioProducer = await libraryHandler.getAudioProducer(videoId, null);
	if (!audioProducer) {
		console.error("No audio producer returned");
		process.exit(1);
	}

	if (audioProducer.type == "stream") {
		const metadata = await audioProducer.getMetadata();
		console.log("Metadata:", metadata);

		console.log("Attempting to load stream");
		const part = await audioProducer.getPart(0, metadata.size - 1);
		console.log("Stream loaded:", part);
	}
})();
