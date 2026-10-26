import { YTMusicCache } from "@/cache/ytmusic-cache.js";
import { YTMusicLibraryHandler } from "@/yt-music.library-handler.js";
import { YTMusicConfigManager } from "@/yt-music.settings.js";
import path from "path";
import fs from "fs";
import Innertube, { UniversalCache } from "youtubei.js";
import { Readable } from "stream";
import { exec } from "node:child_process";
import { resolveYtDlp } from "@/ytdlp.js";

/**
 * Live integration test for the audio pipeline. Exercises the real yt-dlp /
 * googlevideo path and asserts the producer streams audio and caches its
 * format resolution.
 *
 * Run: npm run test:audio <videoId>
 * Exits non-zero if any assertion fails.
 */

if (process.argv.length < 3) {
	console.error("Video ID not specified");
	console.error("Usage: npm run test:audio <Video ID>");
	process.exit(1);
}

const videoId = process.argv[2]!;

let passed = 0;
let failed = 0;

function assert(condition: unknown, label: string): boolean {
	if (condition) {
		passed++;
		console.log(`  PASS  ${label}`);
		return true;
	}
	failed++;
	console.error(`  FAIL  ${label}`);
	return false;
}

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

async function readStreamLimited(stream: Readable, limit: number): Promise<number> {
	return new Promise((resolve, reject) => {
		let bytes = 0;
		const onData = (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes >= limit) {
				cleanup();
				resolve(bytes);
			}
		};
		const cleanup = () => {
			stream.off("data", onData);
			stream.off("end", onEnd);
			stream.off("error", onError);
			stream.destroy();
		};
		const onEnd = () => resolve(bytes);
		const onError = (err: Error) => {
			cleanup();
			reject(err);
		};
		stream.on("data", onData);
		stream.on("end", onEnd);
		stream.on("error", onError);
	});
}

(async () => {
	const cacheDir = path.join("temp", `audio-${Date.now()}`);
	fs.mkdirSync(cacheDir, { recursive: true });

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
		getValue: () => null as any,
		setValue: async () => {},
	});

	const ytDlpResolution = await resolveYtDlp(cacheDir);
	const libraryHandler = new YTMusicLibraryHandler(
		cache,
		configManager,
		Promise.resolve(ytDlpResolution.path),
	);

	console.log(`Testing audio for https://www.youtube.com/watch?v=${videoId}`);

	const audioProducer = await libraryHandler.getAudioProducer(videoId, null);
	if (!audioProducer || audioProducer.type != "stream") {
		console.error("No stream audio producer returned");
		process.exit(1);
	}

	const metadata = await audioProducer.getMetadata();
	assert(metadata.size > 0, `metadata size is positive (${metadata.size})`);
	assert(
		metadata.mimeType.startsWith("audio/"),
		`metadata mimeType is audio/* (${metadata.mimeType})`,
	);

	const partSize = Math.min(65536, metadata.size);

	console.log(`\nTest 1: getPart first ${partSize} bytes`);
	const part1 = await audioProducer.getPart(0, partSize - 1);
	const bytes1 = await consumePart(part1);
	assert(bytes1 === partSize, `got ${bytes1} bytes, expected ${partSize}`);

	const midStart = Math.floor(metadata.size / 2);
	const midEnd = midStart + partSize - 1;
	console.log(
		`\nTest 2: getPart middle ${partSize} bytes (${midStart}–${midEnd})`,
	);
	const part2 = await audioProducer.getPart(midStart, midEnd);
	const bytes2 = await consumePart(part2);
	assert(bytes2 === partSize, `got ${bytes2} bytes, expected ${partSize}`);

	console.log(`\nTest 3: getStream first ${partSize} bytes (direct HTTP)`);
	const stream = await audioProducer.getStream();
	const bytes3 = await readStreamLimited(stream, partSize);
	assert(bytes3 >= partSize, `got ${bytes3} bytes, expected >= ${partSize}`);

	console.log(`\nTest 4: getDuration returns a sane value without ffprobe`);
	const duration = await audioProducer.getDuration();
	assert(
		typeof duration == "number" && duration > 0 && duration < 3600,
		`duration is a sane number (${duration}s)`,
	);

	console.log(`\nTest 5: format resolution is cached`);
	const cachedFormat = await cache.getAudioFormat(videoId);
	assert(
		!!cachedFormat?.format?.url,
		`cache holds a resolved format (url length ${cachedFormat?.format?.url?.length ?? 0})`,
	);
	assert(
		cachedFormat?.duration != null,
		`cache holds a duration (${cachedFormat?.duration}s)`,
	);

	console.log(`\nTest 6: warm producer reuses the cache and still streams`);
	const warmProducer = await libraryHandler.getAudioProducer(videoId, null);
	assert(!!warmProducer && warmProducer.type == "stream", "warm producer created");
	if (warmProducer && warmProducer.type == "stream") {
		const warmPart = await warmProducer.getPart(0, partSize - 1);
		const warmBytes = await consumePart(warmPart);
		assert(warmBytes === partSize, `warm producer served ${warmBytes} bytes`);
	}

	console.log(`\nTest 7: cache invalidation forces a re-resolve`);
	await cache.deleteAudioFormat(videoId);
	const afterDelete = await cache.getAudioFormat(videoId);
	assert(afterDelete === null, "cache entry removed after delete");
	const reResolved = await libraryHandler.getAudioProducer(videoId, null);
	assert(
		!!reResolved && reResolved.type == "stream",
		"producer re-created after cache invalidation",
	);
	const reCached = await cache.getAudioFormat(videoId);
	assert(!!reCached?.format?.url, "cache repopulated after re-resolve");

	console.log(`\nTest 8: expired streaming URL self-heals (re-resolves) and retries`);
	const fresh = await cache.getAudioFormat(videoId);
	if (!fresh?.format?.url) {
		console.error("  SKIP: no cached format to corrupt");
	} else {
		const corruptedUrl = new URL(fresh.format.url);
		const sig = corruptedUrl.searchParams.get("sig");
		if (!sig) {
			console.error("  SKIP: format url has no sig param to corrupt");
		} else {
			corruptedUrl.searchParams.set("sig", sig.slice(0, -4) + "0000");
			await cache.setAudioFormat(videoId, {
				format: { ...fresh.format, url: corruptedUrl.toString() },
				duration: fresh.duration,
			});

			const staleProducer = await libraryHandler.getAudioProducer(
				videoId,
				null,
			);
			if (!staleProducer || staleProducer.type != "stream") {
				assert(false, "producer created with corrupted cached format");
			} else {
				const healedPart = await staleProducer.getPart(0, partSize - 1);
				const healedBytes = await consumePart(healedPart);
				assert(
					healedBytes === partSize,
					`self-healed and served ${healedBytes} bytes (403 → re-resolve)`,
				);
			}

			const healedCache = await cache.getAudioFormat(videoId);
			assert(
				!!healedCache?.format?.url &&
					healedCache.format.url !== corruptedUrl.toString(),
				"cache re-resolved to a fresh url after expiry",
			);
		}
	}

	console.log(`\nTest 9: unreachable direct URL falls back to yt-dlp downloader (getPart)`);
	const fallback = await cache.getAudioFormat(videoId);
	if (!fallback?.format?.url) {
		console.error("  SKIP: no cached format to corrupt");
	} else {
		// A connection-refused address is not an "expired" status, so it skips
		// the re-resolve path and exercises the yt-dlp downloader fallback.
		await cache.setAudioFormat(videoId, {
			format: { ...fallback.format, url: "https://127.0.0.1:1/videoplayback" },
			duration: fallback.duration,
		});

		const fallbackProducer = await libraryHandler.getAudioProducer(videoId, null);
		if (!fallbackProducer || fallbackProducer.type != "stream") {
			assert(false, "producer created with unreachable cached format");
		} else {
			const fallbackPart = await fallbackProducer.getPart(0, partSize - 1);
			const fallbackBytes = await consumePart(fallbackPart);
			assert(
				fallbackBytes === partSize,
				`fallback served ${fallbackBytes} bytes via yt-dlp`,
			);
		}
	}

	console.log(`\nTest 10: unreachable direct URL falls back to yt-dlp downloader (getStream)`);
	const fallbackStreamFormat = await cache.getAudioFormat(videoId);
	if (!fallbackStreamFormat?.format?.url) {
		console.error("  SKIP: no cached format to corrupt");
	} else {
		await cache.setAudioFormat(videoId, {
			format: {
				...fallbackStreamFormat.format,
				url: "https://127.0.0.1:1/videoplayback",
			},
			duration: fallbackStreamFormat.duration,
		});

		const streamProducer = await libraryHandler.getAudioProducer(videoId, null);
		if (!streamProducer || streamProducer.type != "stream") {
			assert(false, "producer created with unreachable cached format");
		} else {
			const stream = await streamProducer.getStream();
			const streamBytes = await readStreamLimited(stream, partSize);
			assert(
				streamBytes >= partSize,
				`fallback streamed ${streamBytes} bytes via yt-dlp`,
			);
		}
	}

	// The fallback spawns yt-dlp children; kill any stragglers so they don't
	// keep the process alive. (Bracket pattern avoids matching this shell.)
	await new Promise<void>((resolve) => {
		exec(`pkill -f "yt-[d]lp" || true`, () => resolve());
	});

	console.log(`\n==== ${passed} passed, ${failed} failed ====`);

	try {
		fs.rmSync(cacheDir, { recursive: true, force: true });
	} catch {}

	process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
	console.error("FATAL", e);
	process.exit(1);
});
