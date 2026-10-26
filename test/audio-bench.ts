import path from "path";
import fs from "fs";
import Innertube, { UniversalCache } from "youtubei.js";
import { YTMusicCache } from "@/cache/ytmusic-cache.js";
import { YTMusicLibraryHandler } from "@/yt-music.library-handler.js";
import { YTMusicConfigManager } from "@/yt-music.settings.js";
import { resolveYtDlp } from "@/ytdlp.js";
import { Readable } from "stream";
import { exec } from "node:child_process";

/**
 * Timing benchmark for the audio path. Reports time-to-audio components:
 *
 *   - cold getAudioProducer  (fresh cache dir: yt-dlp --dump-json + format selection)
 *   - warm getAudioProducer  (same cache dir: cache hit when the plugin caches)
 *   - getDuration
 *   - getPart setup (time for the producer to hand back the range stream)
 *   - getStream setup + first byte
 *
 * Run: npx tsx test/audio-bench.ts [videoId]
 */

const videoId = process.argv[2] ?? "dQw4w9WgXcQ";

function now(): [number, number] {
	return process.hrtime();
}

function ms(start: [number, number]): number {
	const end = process.hrtime(start);
	return end[0] * 1000 + end[1] / 1e6;
}

async function firstByte(stream: Readable): Promise<number> {
	return new Promise((resolve, reject) => {
		let resolved = false;
		const started = now();
		stream.on("data", () => {
			if (resolved) return;
			resolved = true;
			stream.destroy();
			resolve(ms(started));
		});
		stream.once("error", (e) => {
			if (resolved) return;
			resolved = true;
			reject(e);
		});
	});
}

async function consume(stream: Readable | Buffer): Promise<number> {
	if (Buffer.isBuffer(stream)) return stream.length;
	let bytes = 0;
	return new Promise((resolve, reject) => {
		stream.on("data", (c: Buffer) => (bytes += c.length));
		stream.on("end", () => resolve(bytes));
		stream.on("error", reject);
	});
}

async function makeHandler(cacheDir: string) {
	const innertube = await Innertube.create({
		cache: new UniversalCache(true, path.join(cacheDir, "innertube")),
	});
	const cache = new YTMusicCache(path.join(cacheDir, "cache.sqlite"), innertube);
	const configManager = new YTMusicConfigManager();
	await configManager.enable({
		delete: async () => {},
		getValue: () => null as any,
		setValue: async () => {},
	});
	const ytDlpResolution = await resolveYtDlp(cacheDir);
	return new YTMusicLibraryHandler(
		cache,
		configManager,
		Promise.resolve(ytDlpResolution.path),
	);
}

(async () => {
	console.log(`Benchmarking audio path for videoId=${videoId}`);

	// --- cold: fresh cache dir ---
	const coldDir = path.join("temp", `bench-cold-${Date.now()}`);
	fs.mkdirSync(coldDir, { recursive: true });
	const coldHandler = await makeHandler(coldDir);
	const coldStart = now();
	await coldHandler.getAudioProducer(videoId, null);
	const coldMs = ms(coldStart);

	// --- warm: reuse the same handler/cache ---
	const warm: number[] = [];
	for (let i = 0; i < 5; i++) {
		const t = now();
		const p = await coldHandler.getAudioProducer(videoId, null);
		warm.push(ms(t));
		if (i === 0) {
			if (!p || p.type !== "stream") throw new Error("unexpected producer");
			const meta = await p.getMetadata();
			const part = await p.getPart(0, Math.min(65535, meta.size - 1));
			const bytes = await consume(part);
			console.log(`  warm producer sanity: ${bytes} bytes, mime=${meta.mimeType}`);
		}
	}

	const producer = await coldHandler.getAudioProducer(videoId, null);
	if (!producer || producer.type !== "stream") {
		throw new Error("no stream producer");
	}
	const meta = await producer.getMetadata();

	// --- getPart setup ---
	const partStart = now();
	const part = await producer.getPart(0, Math.min(65535, meta.size - 1));
	const partMs = ms(partStart);

	// --- getStream setup + first byte ---
	const streamStart = now();
	const stream = await producer.getStream();
	const streamMs = ms(streamStart);
	const fb = await firstByte(stream);

	await new Promise<void>((resolve) => {
		exec(`pkill -f "yt-[d]lp" || true`, () => resolve());
	});

	console.log("\n==== RESULTS ====");
	console.log(`getAudioProducer cold : ${coldMs.toFixed(0)} ms`);
	console.log(
		`getAudioProducer warm : ${warm.map((n) => n.toFixed(0)).join(", ")} ms`,
	);
	console.log(`getPart (setup)        : ${partMs.toFixed(0)} ms`);
	console.log(`getStream (setup)      : ${streamMs.toFixed(0)} ms`);
	console.log(`getStream (first byte) : ${fb.toFixed(0)} ms`);

	try {
		fs.rmSync(coldDir, { recursive: true, force: true });
	} catch {}
})();
