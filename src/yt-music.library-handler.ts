import {
	AudioProducer,
	AudioProducerType,
	LibraryHandler,
	LibraryHandlerApiContext,
	StreamAudioProducer,
	TaskRunContext,
} from "@pipe-bomb/plugin-sdk";
import Axios, { AxiosError } from "axios";
import { PassThrough, Readable } from "stream";
import { spawn } from "child_process";
import https from "https";
import { YtDlpFormat, YtDlpResponse } from "./types/yt-dlp.js";
import { YTMusicConfigManager } from "./yt-music.settings.js";
import { CachedAudioFormat, YTMusicCache } from "./cache/ytmusic-cache.js";
import { getMimeType, selectBestAudioFormat } from "./utils.js";

/**
 * Slices a byte stream to a single range `[start, start+length)`, destroying the
 * source as soon as the requested bytes have been emitted.
 */
function streamRange(source: Readable, start: number, length: number): Readable {
	const out = new PassThrough();
	let position = 0;
	let emitted = 0;

	const onData = (chunk: Buffer) => {
		const chunkStart = position;
		const chunkEnd = position + chunk.length;
		position = chunkEnd;

		if (chunkEnd <= start) {
			return;
		}

		const from = Math.max(0, start - chunkStart);
		const to = Math.min(chunk.length, start + length - chunkStart);
		if (to > from) {
			emitted += to - from;
			out.write(chunk.subarray(from, to));
		}

		if (emitted >= length) {
			cleanup();
		}
	};

	const onEnd = () => {
		out.end();
	};

	const onError = (e: Error) => {
		out.destroy(e);
	};

	const cleanup = () => {
		source.off("data", onData);
		source.off("end", onEnd);
		source.off("error", onError);
		source.destroy();
		out.end();
	};

	source.on("data", onData);
	source.on("end", onEnd);
	source.on("error", onError);
	return out;
}

export class YTMusicLibraryHandler implements LibraryHandler {
	readonly id = "youtube-music";
	private api!: LibraryHandlerApiContext;
	private activeProducerCreations = 0;
	private readonly producerCreationQueue: (() => void)[] = [];
	private readonly httpsAgent = new https.Agent({
		keepAlive: true,
		maxSockets: 25,
		maxFreeSockets: 10,
	});

	constructor(
		private readonly cache: YTMusicCache,
		private readonly config: YTMusicConfigManager,
		private readonly ytDlpPath: Promise<string>,
	) {}

	getName(): string {
		return "YouTube Music";
	}

	enable(libraryHandlerApiContext: LibraryHandlerApiContext) {
		this.api = libraryHandlerApiContext;
	}

	private getCookiesArgs(): string[] {
		const args: string[] = [];
		const browser = this.config.getCookiesBrowser();
		if (browser) {
			args.push("--cookies-from-browser", browser);
		}
		const file = this.config.getCookiesFile();
		if (file) {
			args.push("--cookies", file);
		}
		return args;
	}

	private getPluginDirsArgs(): string[] {
		return this.config.getPluginDirs().flatMap((dir) => ["--plugin-dirs", dir]);
	}

	private getEnvWithPlugins(): NodeJS.ProcessEnv {
		const dirs = this.config.getPluginDirs();
		if (dirs.length === 0) {
			return process.env;
		}
		const env = { ...process.env };
		const pythonPath = dirs.join(":");
		// PYTHONPATH is required for Nix-installed yt-dlp where --plugin-dirs
		// is silently ignored due to Python path isolation (PYTHONNOUSERSITE=true).
		env.PYTHONPATH = env.PYTHONPATH
			? `${pythonPath}:${env.PYTHONPATH}`
			: pythonPath;
		return env;
	}

	private async createDlpSession() {
		await new Promise<void>((resolve) => {
			if (this.activeProducerCreations < this.config.getConcurrentProducers()) {
				resolve();
			} else {
				this.producerCreationQueue.push(resolve);
			}
		});

		this.activeProducerCreations++;
		let completed = false;
		return () => {
			if (!completed) {
				completed = true;
				this.activeProducerCreations--;
				if (
					this.activeProducerCreations < this.config.getConcurrentProducers()
				) {
					const callback = this.producerCreationQueue.shift();
					callback?.();
				}
			}
		};
	}

	private buildExtractorArgs(): string[] {
		const args: string[] = [];
		const extractorArgs = this.config.getExtractorArgs();
		if (extractorArgs) {
			for (const part of extractorArgs.split(" ")) {
				if (part) {
					args.push("--extractor-args", part);
				}
			}
		}
		return args;
	}

	private async runYtDlpDumpJson(videoId: string): Promise<YtDlpResponse> {
		const [endSession, ytDlp] = await Promise.all([
			this.createDlpSession(),
			this.ytDlpPath,
		]);
		try {
			return await new Promise<YtDlpResponse>((resolve, reject) => {
				const args = [
					"--dump-json",
					"--format",
					"bestaudio",
					"--no-update",
				];
				args.push(...this.buildExtractorArgs());
				args.push(...this.getPluginDirsArgs(), ...this.getCookiesArgs());

				const child = spawn(
					ytDlp,
					[...args, `https://youtube.com/watch?v=${videoId}`],
					{ env: this.getEnvWithPlugins() },
				);

				const timer = setTimeout(() => {
					child.kill("SIGKILL");
					reject(new Error("yt-dlp timed out"));
				}, 25_000);

				child.stderr.on("data", () => {});

				let output = "";
				child.stdout.on("data", (chunk: Buffer) => {
					output += chunk.toString();
				});

				child.on("error", (e) => {
					clearTimeout(timer);
					reject(e);
				});

				child.on("close", (code) => {
					clearTimeout(timer);
					if (code) {
						reject(new Error(`yt-dlp exited with code ${code}`));
					} else {
						try {
							resolve(JSON.parse(output));
						} catch {
							reject(new Error("Returned invalid JSON"));
						}
					}
				});
			});
		} finally {
			endSession();
		}
	}

	/**
	 * Resolves the best audio format for a video. Uses the persistent cache so
	 * repeat plays skip the yt-dlp subprocess entirely. Pass `force` to bypass
	 * the cache (used to re-resolve after a streaming URL has expired).
	 */
	private async resolveBestFormat(
		videoId: string,
		force = false,
	): Promise<CachedAudioFormat> {
		if (!force) {
			const cached = await this.cache.getAudioFormat(videoId);
			if (cached?.format?.url) {
				return cached;
			}
		}

		const response = await this.runYtDlpDumpJson(videoId);
		const bestFormat = selectBestAudioFormat(response.formats);
		if (!bestFormat) {
			throw new Error("No supported formats");
		}

		const resolved: CachedAudioFormat = {
			format: bestFormat,
			duration: response.duration ?? null,
		};
		await this.cache.setAudioFormat(videoId, resolved);
		return resolved;
	}

	/**
	 * Resolves formats for a set of tracks in the background (bounded by the
	 * concurrent-producers limit). Intended to be fire-and-forget so the format
	 * cache is warm by the time the user presses play.
	 */
	async prewarmFormats(videoIds: string[]) {
		const ids = [...new Set(videoIds.filter((id) => !!id))];
		if (ids.length === 0) {
			return;
		}
		const concurrency = Math.min(
			Math.max(1, this.config.getConcurrentProducers()),
			ids.length,
		);
		let index = 0;
		const worker = async () => {
			while (true) {
				const id = ids[index++];
				if (!id) {
					return;
				}
				try {
					await this.resolveBestFormat(id);
				} catch {}
			}
		};
		await Promise.allSettled(
			Array.from({ length: concurrency }, () => worker()),
		);
	}

	private async fetchPart(
		format: YtDlpFormat,
		start: number,
		end: number,
	): Promise<Readable> {
		const { data } = await Axios.get<Readable>(format.url, {
			responseType: "stream",
			timeout: 15_000,
			httpsAgent: this.httpsAgent,
			decompress: false,
			headers: {
				...format.http_headers,
				"Accept-Encoding": "identity",
				range: `bytes=${start}-${end}`,
			},
		});
		return data;
	}

	/**
	 * Spawns yt-dlp to download a single format to stdout. Used as a fallback
	 * when the direct HTTP fetch of `format.url` is refused: yt-dlp's downloader
	 * solves YouTube's signature (`n`) challenge and throttling that a plain HTTP
	 * client cannot, so it succeeds where `fetchPart`/`getStream` return 403.
	 */
	private async spawnYtDlpDownload(
		videoId: string,
		formatId: string,
	) {
		const [endSession, ytDlp] = await Promise.all([
			this.createDlpSession(),
			this.ytDlpPath,
		]);

		const args = [
			"-f",
			formatId,
			"-o",
			"-",
			"--no-update",
			"--downloader",
			"native",
		];
		args.push(...this.buildExtractorArgs());
		args.push(...this.getPluginDirsArgs(), ...this.getCookiesArgs());

		const child = spawn(
			ytDlp,
			[...args, `https://youtube.com/watch?v=${videoId}`],
			{
				stdio: ["ignore", "pipe", "pipe"],
				env: this.getEnvWithPlugins(),
			},
		);

		child.stderr.on("data", () => {});
		child.on("error", () => {});
		child.on("close", () => endSession());

		return child;
	}

	private async fetchStreamViaYtDlp(
		videoId: string,
		format: YtDlpFormat,
	): Promise<Readable> {
		const child = await this.spawnYtDlpDownload(videoId, format.format_id);
		return child.stdout;
	}

	private async fetchPartViaYtDlp(
		videoId: string,
		format: YtDlpFormat,
		start: number,
		end: number,
	): Promise<Readable> {
		const child = await this.spawnYtDlpDownload(videoId, format.format_id);
		return streamRange(child.stdout, start, end - start + 1);
	}

	private isExpiredStatus(e: unknown): boolean {
		if (!(e instanceof AxiosError)) {
			return false;
		}
		const status = e.response?.status;
		return status === 403 || status === 410 || status === 404;
	}

	async createStreamAudioProducer(
		format: YtDlpFormat,
		videoId: string,
		duration: number | null,
	): Promise<StreamAudioProducer> {
		let currentFormat = format;
		let currentDuration = duration;

		const computeMetadata = () => {
			const mimeType = getMimeType(currentFormat);
			const size = currentFormat.filesize ?? currentFormat.filesize_approx;
			if (!size || isNaN(size)) {
				throw new Error("Invalid or unknown content-length");
			}
			return { mimeType, size };
		};

		// Validate the initial format up-front so an invalid format fails at
		// session creation rather than mid-stream.
		computeMetadata();

		return {
			type: "stream",
			cacheable: true,
			getDuration: async () => {
				if (currentDuration !== null && currentDuration !== undefined) {
					return currentDuration;
				}
				return await new Promise<number>((resolve, reject) => {
					const child = spawn("ffprobe", [
						"-v",
						"error",
						"-show_entries",
						"format=duration",
						"-of",
						"default=noprint_wrappers=1:nokey=1",
						currentFormat.url,
					]);

					const timer = setTimeout(() => {
						child.kill("SIGKILL");
						reject(new Error("FFprobe timed out"));
					}, 15_000);

					child.stderr.on("data", () => {});

					let output = "";
					child.stdout.on("data", (chunk: Buffer) => {
						output += chunk.toString();
					});

					child.on("error", (e) => {
						clearTimeout(timer);
						reject(e);
					});

					child.on("close", (code) => {
						clearTimeout(timer);
						if (code) {
							reject(new Error(`Exited with code ${code}`));
						} else {
							const computedDuration = parseFloat(output.trim());
							if (isNaN(computedDuration)) {
								reject(new Error(`Invalid duration`));
							} else {
								currentDuration = computedDuration;
								resolve(computedDuration);
							}
						}
					});
				});
			},
			getMetadata: async () => computeMetadata(),
			getStream: async () => {
				try {
					const { data } = await Axios.get<Readable>(currentFormat.url, {
						responseType: "stream",
						timeout: 30_000,
						httpsAgent: this.httpsAgent,
						decompress: false,
						headers: {
							...currentFormat.http_headers,
							"Accept-Encoding": "identity",
						},
					});
					return data;
				} catch (e) {
					// Signature challenge / bot protection: let yt-dlp fetch it.
					return this.fetchStreamViaYtDlp(videoId, currentFormat);
				}
			},
			getPart: async (start, end) => {
				try {
					return await this.fetchPart(currentFormat, start, end);
				} catch (e) {
					// The googlevideo URL may have expired. Re-resolve once and
					// retry the direct HTTP fetch.
					if (this.isExpiredStatus(e)) {
						try {
							await this.cache.deleteAudioFormat(videoId);
							const resolved = await this.resolveBestFormat(
								videoId,
								true,
							);
							currentFormat = resolved.format;
							if (resolved.duration !== null) {
								currentDuration = resolved.duration;
							}
							return await this.fetchPart(currentFormat, start, end);
						} catch {}
					}

					// Fall back to yt-dlp, which solves the signature (`n`)
					// challenge that plain HTTP clients can't.
					return this.fetchPartViaYtDlp(videoId, currentFormat, start, end);
				}
			},
		};
	}

	async getAudioProducer(
		trackId: string,
		type: AudioProducerType | null,
	): Promise<AudioProducer | null> {
		if (type && type != "stream") {
			return null;
		}

		const resolved = await this.resolveBestFormat(trackId);
		return this.createStreamAudioProducer(
			resolved.format,
			trackId,
			resolved.duration,
		);
	}

	async scan(_taskRunContext: TaskRunContext): Promise<void> {}

	async doTracksExist(trackIds: string[]): Promise<string[]> {
		const tracks = await this.cache.getTracks(trackIds);
		return tracks.map((track) => track.id);
	}
}
