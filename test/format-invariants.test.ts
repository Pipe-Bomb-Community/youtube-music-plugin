import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "stream";
import { resolveYtDlp } from "@/ytdlp.js";
import { getMimeType, selectBestAudioFormat } from "@/utils.js";
import { YtDlpFormat } from "@/types/yt-dlp.js";

/**
 * Invariant test: validates that *real* yt-dlp output still matches the shape
 * the audio code depends on. This is the guard against YouTube changing its
 * format/URL/header structure in a way that breaks playback.
 *
 * Run: npx tsx test/format-invariants.test.ts [videoId]
 * Exits non-zero if any invariant fails.
 */

const videoId = process.argv[2] ?? "dQw4w9WgXcQ";
const execFileAsync = promisify(execFile);

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

async function readFirstBytes(stream: Readable, limit: number): Promise<number> {
	let bytes = 0;
	return new Promise((resolve, reject) => {
		stream.on("data", (c: Buffer) => {
			bytes += c.length;
			if (bytes >= limit) {
				stream.destroy();
				resolve(bytes);
			}
		});
		stream.on("end", () => resolve(bytes));
		stream.on("error", reject);
	});
}

(async () => {
	const { path: ytDlp } = await resolveYtDlp("temp");

	const { stdout } = await execFileAsync(ytDlp, [
		"--dump-json",
		"--format",
		"bestaudio",
		"--no-update",
		`https://youtube.com/watch?v=${videoId}`,
	]);

	const response = JSON.parse(stdout);

	console.log("[1] response shape");
	assert(Array.isArray(response.formats), "formats is an array");
	assert(
		response.formats.length > 0,
		`formats is non-empty (${response.formats?.length})`,
	);
	assert(
		typeof response.duration == "number" && response.duration > 0,
		`duration is a positive number (${response.duration})`,
	);

	const audioOnly = response.formats.filter(
		(f: YtDlpFormat) =>
			f.acodec && f.acodec != "none" && (!f.vcodec || f.vcodec == "none"),
	);
	assert(
		audioOnly.length > 0,
		`at least one audio-only format exists (${audioOnly.length})`,
	);

	console.log("[2] format fields the producer depends on");
	const sample = audioOnly[0] as YtDlpFormat;
	assert(typeof sample.acodec == "string", "format has an acodec");
	assert(
		typeof sample.vcodec == "string",
		"format has a vcodec (may be 'none')",
	);
	assert(typeof sample.protocol == "string", "format has a protocol");
	assert(typeof sample.ext == "string", "format has an ext (for mime type)");
	assert(
		sample.http_headers && typeof sample.http_headers["User-Agent"] == "string",
		"format has http_headers with a User-Agent",
	);
	assert(
		typeof (sample.filesize ?? sample.filesize_approx) == "number" &&
			(sample.filesize ?? sample.filesize_approx)! > 0,
		"format has a positive filesize/filesize_approx",
	);

	console.log("[3] selection picks a usable format");
	const best = selectBestAudioFormat(response.formats);
	assert(!!best, "selectBestAudioFormat returns a format");
	if (best) {
		assert(!!best.url, "selected format has a direct url");
		assert(
			best.acodec && best.acodec != "none",
			`selected format is audio (acodec=${best.acodec})`,
		);
		assert(
			!best.vcodec || best.vcodec == "none",
			`selected format has no video (vcodec=${best.vcodec})`,
		);
		assert(
			best.protocol && !best.protocol.includes("m3u8"),
			`selected format is not HLS (protocol=${best.protocol})`,
		);
		assert(!best.has_drm, "selected format is not DRM");
		assert(
			getMimeType(best).startsWith("audio/"),
			`selected format mime is audio/* (${getMimeType(best)})`,
		);
	}

	console.log("[4] selected format actually streams (URL + headers valid)");
	if (best) {
		const res = await fetch(best.url, {
			headers: {
				...best.http_headers,
				Range: "bytes=0-65535",
			},
		});
		assert(
			res.status === 206 || res.status === 200,
			`range request returns ${res.status}`,
		);
		if (res.body) {
			const bytes = await readFirstBytes(
				Readable.fromWeb(res.body as any),
				65536,
			);
			assert(bytes >= 65536, `streamed ${bytes} bytes`);
		}
	}

	console.log(`\n==== ${passed} passed, ${failed} failed ====`);
	process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
	console.error("FATAL", e);
	process.exit(1);
});
