import { YTMusicCache } from "@/cache/ytmusic-cache.js";
import { YTMusicLibraryHandler } from "@/yt-music.library-handler.js";
import { YTMusicConfigManager } from "@/yt-music.settings.js";
import path from "path";
import Innertube, { UniversalCache } from "youtubei.js";
import { Readable } from "stream";
import { resolveYtDlp } from "@/ytdlp.js";

if (process.argv.length < 3) {
	console.error("Video ID not specified");
	console.error("Usage: npm run test:audio <Video ID>");
	process.exit(1);
}

const videoId = process.argv[2]!;

async function consumePart(part: Buffer | Readable): Promise<number> {
	if (Buffer.isBuffer(part)) {
		return part.length;
	}
	return new Promise((resolve, reject) => {
		let bytes = 0;
		part.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
		});
		part.on("end", () => resolve(bytes));
		part.on("error", reject);
	});
}

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
					return "youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416";
				case "plugin-dirs":
					// Must point to the directory containing yt_dlp_plugins/
					return "/home/eyezah/Documents/bgutil-ytdlp-pot-provider/plugin";
			}
			return null as any;
		},
		setValue: async () => {},
	});

	const ytDlpResolution = await resolveYtDlp(cacheDir);
	const ytDlpPath = Promise.resolve(ytDlpResolution.path);

	const libraryHandler = new YTMusicLibraryHandler(
		cache,
		configManager,
		ytDlpPath,
	);
	console.log(`Attempting to load https://www.youtube.com/watch?v=${videoId}`);

	const audioProducer = await libraryHandler.getAudioProducer(videoId, null);
	if (!audioProducer) {
		console.error("No audio producer returned");
		process.exit(1);
	}

	if (audioProducer.type == "stream") {
		const metadata = await audioProducer.getMetadata();
		console.log("Metadata:", metadata);

		const partSize = Math.min(65536, metadata.size);

		console.log(`\nTest 1: getPart first ${partSize} bytes`);
		const part1 = await audioProducer.getPart(0, partSize - 1);
		const bytes1 = await consumePart(part1);
		const ok1 = bytes1 === partSize;
		console.log(
			`  Got ${bytes1} bytes, expected ${partSize} — ${ok1 ? "PASS" : "FAIL"}`,
		);

		const midStart = Math.floor(metadata.size / 2);
		const midEnd = midStart + partSize - 1;
		console.log(
			`\nTest 2: getPart middle ${partSize} bytes (${midStart}–${midEnd})`,
		);
		const part2 = await audioProducer.getPart(midStart, midEnd);
		const bytes2 = await consumePart(part2);
		const ok2 = bytes2 === partSize;
		console.log(
			`  Got ${bytes2} bytes, expected ${partSize} — ${ok2 ? "PASS" : "FAIL"}`,
		);

		if (!ok1 || !ok2) {
			console.error("\nSome tests FAILED");
			process.exit(1);
		}
		console.log("\nAll tests passed");
	}
})();
