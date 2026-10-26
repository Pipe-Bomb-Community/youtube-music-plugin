import { selectBestAudioFormat } from "@/utils.js";
import { YtDlpFormat } from "@/types/yt-dlp.js";

/**
 * Deterministic unit test for the audio format selection logic. No network.
 *
 * Run: npx tsx test/format-selection.test.ts
 * Exits non-zero if any assertion fails.
 */

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

function fmt(overrides: Partial<YtDlpFormat> & { url?: string } = {}): YtDlpFormat {
	return {
		format_id: "140",
		format_note: null,
		format_index: null,
		ext: "m4a",
		protocol: "https",
		url: "https://example.com/audio",
		manifest_url: undefined,
		acodec: "mp4a.40.2",
		vcodec: "none",
		audio_ext: "m4a",
		video_ext: "none",
		container: "m4a_dash",
		width: null,
		height: null,
		resolution: "audio only",
		fps: null,
		asr: 44100,
		audio_channels: 2,
		tbr: null,
		vbr: null,
		abr: 128,
		filesize: 1000,
		filesize_approx: null,
		quality: null,
		preference: null,
		source_preference: null,
		language_preference: null,
		language: null,
		dynamic_range: null,
		aspect_ratio: null,
		has_drm: undefined,
		available_at: undefined,
		rows: undefined,
		columns: undefined,
		fragments: undefined,
		downloader_options: undefined,
		http_headers: {
			"User-Agent": "test",
			Accept: "*/*",
			"Accept-Language": "en",
			"Sec-Fetch-Mode": "cors",
		},
		format: "140 - audio only (medium)",
		...overrides,
	};
}

// --- Cases ---

assert(
	selectBestAudioFormat([]) === null,
	"empty list returns null",
);

assert(
	selectBestAudioFormat([
		fmt({ format_id: "251", acodec: "opus", abr: 128, url: "https://x/opus" }),
		fmt({ format_id: "140", acodec: "mp4a.40.2", abr: 128, url: "https://x/m4a" }),
	])?.format_id === "251",
	"opus preferred over mp4a at equal abr",
);

assert(
	selectBestAudioFormat([
		fmt({ format_id: "low", acodec: "opus", abr: 48, url: "https://x/low" }),
		fmt({ format_id: "high", acodec: "opus", abr: 160, url: "https://x/high" }),
	])?.format_id === "high",
	"higher abr wins",
);

assert(
	selectBestAudioFormat([
		fmt({
			format_id: "vid",
			vcodec: "vp9",
			url: "https://x/video",
		}),
		fmt({ format_id: "aud", acodec: "opus", abr: 128, url: "https://x/audio" }),
	])?.format_id === "aud",
	"video formats are excluded",
);

assert(
	selectBestAudioFormat([
		fmt({ format_id: "noacodec", acodec: "none", url: "https://x/na" }),
		fmt({ format_id: "ok", acodec: "opus", abr: 128, url: "https://x/ok" }),
	])?.format_id === "ok",
	"formats without an audio codec are excluded",
);

assert(
	selectBestAudioFormat([
		fmt({
			format_id: "hls",
			protocol: "m3u8_native",
			acodec: "opus",
			abr: 256,
			url: "https://x/hls",
		}),
		fmt({ format_id: "direct", acodec: "opus", abr: 128, url: "https://x/direct" }),
	])?.format_id === "direct",
	"m3u8 (HLS) formats are excluded",
);

assert(
	selectBestAudioFormat([
		fmt({
			format_id: "drm",
			acodec: "opus",
			abr: 256,
			has_drm: true,
			url: "https://x/drm",
		}),
		fmt({ format_id: "clean", acodec: "opus", abr: 128, url: "https://x/clean" }),
	])?.format_id === "clean",
	"DRM formats are excluded",
);

assert(
	selectBestAudioFormat([
		fmt({ format_id: "a", acodec: "opus", abr: 128, asr: 48000, url: "https://x/48" }),
		fmt({ format_id: "b", acodec: "opus", abr: 128, asr: 44100, url: "https://x/44" }),
	])?.format_id === "a",
	"asr breaks abr ties",
);

assert(
	selectBestAudioFormat([
		fmt({ format_id: "nourl", acodec: "opus", abr: 256, url: "" }),
		fmt({ format_id: "withurl", acodec: "opus", abr: 128, url: "https://x/ok" }),
	])?.format_id === "withurl",
	"formats without a direct url are skipped",
);

assert(
	selectBestAudioFormat([
		fmt({ format_id: "nourl", acodec: "opus", abr: 256, url: "" }),
	]) === null,
	"returns null when no format has a url",
);

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
process.exit(failed > 0 ? 1 : 0);
