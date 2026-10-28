import { YTMusicLibraryHandler } from "@/yt-music.library-handler.js";
import { PassThrough, Readable } from "stream";

/**
 * Deterministic unit test for the stream guards that prevent server-side cache
 * workers from waiting forever. No network or yt-dlp process.
 *
 * Run: npx tsx test/hang-guards.test.ts
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

function waitForEnd(stream: Readable, timeoutMs = 2_000): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		stream.once("end", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

const handler = Object.create(
	YTMusicLibraryHandler.prototype,
) as YTMusicLibraryHandler;
const guard = (handler as any).guardReadable.bind(handler);

async function testStalledSourceEnds() {
	const source = new PassThrough();
	const guarded = guard(source, 50);
	let output = "";
	guarded.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});

	const ended = waitForEnd(guarded);
	source.write("hello");
	const didEnd = await ended;

	assert(didEnd, "stalled source is closed after the idle timeout");
	assert(output === "hello", "data received before the stall is preserved");
}

async function testErroringSourceEndsWithoutError() {
	const source = new PassThrough();
	const guarded = guard(source, 1_000);
	let errored = false;
	guarded.on("error", () => {
		errored = true;
	});

	const ended = waitForEnd(guarded);
	guarded.resume();
	source.destroy(new Error("upstream failed"));

	assert(await ended, "erroring source still ends the guarded stream");
	assert(!errored, "guarded stream does not propagate the upstream error");
}

async function testNormalSourceEnds() {
	const source = new PassThrough();
	const guarded = guard(source, 1_000);
	let output = "";
	guarded.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});

	const ended = waitForEnd(guarded);
	source.end("ok");

	assert(await ended, "normal source completion ends the guarded stream");
	assert(output === "ok", "normal data is forwarded");
}

async function testConsumerAbortDestroysSource() {
	const source = new PassThrough();
	const guarded = guard(source, 1_000);
	guarded.resume();
	guarded.destroy();

	await new Promise((resolve) => setTimeout(resolve, 25));
	assert(source.destroyed, "destroying the guard destroys the source");
}

await testStalledSourceEnds();
await testErroringSourceEndsWithoutError();
await testNormalSourceEnds();
await testConsumerAbortDestroysSource();

console.log(`\n==== ${passed} passed, ${failed} failed ====\n`);
process.exit(failed ? 1 : 0);
