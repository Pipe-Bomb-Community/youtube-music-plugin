import {
	AudioProducer,
	AudioProducerType,
	LibraryHandler,
	LibraryHandlerApiContext,
	StreamAudioProducer,
	TaskRunContext,
} from "@sdk";
import { spawn } from "child_process";
import { YtDlpFormat, YtDlpResponse } from "./types/yt-dlp.js";
import { YTMusicConfigManager } from "./yt-music.settings.js";
import { YTMusicCache } from "./cache/ytmusic-cache.js";
import { DownloadCache } from "./cache/download-cache.js";
import { fetchUrl, getMimeType } from "./utils.js";

export class YTMusicLibraryHandler implements LibraryHandler {
	readonly id = "youtube-music";
	private api!: LibraryHandlerApiContext;
	private activeProducerCreations = 0;
	private readonly producerCreationQueue: (() => void)[] = [];

	constructor(
		private readonly cache: YTMusicCache,
		private readonly config: YTMusicConfigManager,
	) {}

	getName(): string {
		return "YouTube Music";
	}

	enable(libraryHandlerApiContext: LibraryHandlerApiContext) {
		this.api = libraryHandlerApiContext;
	}

	private getCookiesArgs(): string[] {
		const browser = this.config.getCookiesBrowser();
		return browser ? ["--cookies-from-browser", browser] : [];
	}

	private getPluginDirsArgs(): string[] {
		return this.config
			.getPluginDirs()
			.flatMap((dir) => ["--plugin-dirs", dir]);
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
				console.log("Waiting for DLP session to open up");
				this.producerCreationQueue.push(resolve);
			}
		});

		this.activeProducerCreations++;
		let completed = false;
		return () => {
			if (!completed) {
				console.log("DLP Session finished!");
				completed = true;
				setTimeout(() => {
					this.activeProducerCreations--;
					if (
						this.activeProducerCreations < this.config.getConcurrentProducers()
					) {
						const callback = this.producerCreationQueue.shift();
						callback?.();
					}
				}, 1_000);
			}
		};
	}

	private startDownload(format: YtDlpFormat, downloadCache: DownloadCache): void {
		fetchUrl(
			format.url,
			format.http_headers as unknown as Record<string, string>,
		).then(
			(res) => {
				if (res.statusCode !== 200 && res.statusCode !== 206) {
					res.resume();
					downloadCache.fail(
						new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`),
					);
					return;
				}
				res.on("data", (chunk: Buffer) => downloadCache.write(chunk));
				res.on("end", () => downloadCache.finish());
				res.on("error", (err) => downloadCache.fail(err));
			},
			(err) => downloadCache.fail(err),
		);
	}

	async createStreamAudioProducer(
		format: YtDlpFormat,
		videoId: string,
	): Promise<StreamAudioProducer> {
		const mimeType = getMimeType(format);
		const size = format.filesize ?? format.filesize_approx;
		if (!size || isNaN(size)) {
			throw new Error("Invalid or unknown content-length");
		}

		const downloadCache = new DownloadCache(size);
		let downloadStarted = false;
		let duration: number | null = null;

		const ensureDownload = () => {
			if (downloadStarted) return;
			downloadStarted = true;
			this.startDownload(format, downloadCache);
		};

		return {
			type: "stream",
			cacheable: true,
			getDuration: async () => {
				if (duration !== null) {
					return duration;
				}
				return await new Promise<number>((resolve, reject) => {
					const child = spawn("ffprobe", [
						"-v",
						"error",
						"-show_entries",
						"format=duration",
						"-of",
						"default=noprint_wrappers=1:nokey=1",
						format.url,
					]);

					const timer = setTimeout(() => {
						child.kill("SIGKILL");
						reject(new Error("FFprobe timed out"));
					}, 15_000);

					child.stderr.on("data", (chunk: Buffer) => {
						console.error(`[FFprobe] ${chunk.toString()}`);
					});

					let output = "";

					child.stdout.on("data", (chunk: Buffer) => {
						output += chunk.toString();
					});

					child.on("close", (code) => {
						clearTimeout(timer);
						if (code) {
							reject(new Error(`Exited with code ${code}`));
						} else {
							const d = parseFloat(output.trim());
							if (isNaN(d)) {
								reject(new Error("Invalid duration"));
							} else {
								duration = d;
								resolve(d);
							}
						}
					});
				});
			},
			getMetadata: async () => ({
				mimeType,
				size,
			}),
			getStream: async () => {
				ensureDownload();
				return downloadCache.toReadable();
			},
			getPart: async (start, end) => {
				console.log(`Getting part ${start} - ${end}`);
				ensureDownload();
				await downloadCache.waitFor(end + 1);
				return downloadCache.getSlice(start, end);
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

		const endSession = await this.createDlpSession();
		const response = await new Promise<YtDlpResponse>(
			async (resolve, reject) => {
				const args = [
					"--dump-json",
					"--format",
					"bestaudio",
					"--no-update",
				];

				const extractorArgs = this.config.getExtractorArgs();
				if (extractorArgs) {
					const parts = extractorArgs.split(" ");
					for (const part of parts) {
						args.push("--extractor-args", part);
					}
				}
				args.push(...this.getPluginDirsArgs(), ...this.getCookiesArgs());

				const child = spawn("yt-dlp", [
					...args,
					`https://youtube.com/watch?v=${trackId}`,
				], { env: this.getEnvWithPlugins() });

				const timer = setTimeout(() => {
					child.kill("SIGKILL");
					reject(new Error("yt-dlp timed out"));
				}, 25_000);

				child.stderr.on("data", (chunk: Buffer) =>
					console.log(`[YT-DLP]:`, chunk.toString()),
				);

				let output = "";
				child.stdout.on("data", (chunk: Buffer) => {
					output += chunk.toString();
				});

				child.on("close", (code) => {
					clearTimeout(timer);
					if (code) {
						reject(new Error(`Exited with code ${code}`));
					} else {
						try {
							resolve(JSON.parse(output));
						} catch {
							reject(new Error("Returned invalid JSON"));
						}
					}
				});
			},
		).finally(endSession);

		const supportedFormats = response.formats
			.filter((format) => {
				if (!format.acodec || format.acodec == "none") {
					return false;
				}

				if (format.vcodec && format.vcodec != "none") {
					return false;
				}

				if (format.protocol.includes("m3u8")) {
					return false;
				}

				if (format.has_drm) {
					return false;
				}

				return true;
			})
			.sort((a, b) => {
				const abrDiff = (b.abr ?? 0) - (a.abr ?? 0);
				if (abrDiff) {
					return abrDiff;
				}

				const asrDiff = (b.asr ?? 0) - (a.asr ?? 0);
				if (asrDiff) {
					return asrDiff;
				}

				const codecScore = (codec: string) => {
					if (codec.includes("opus")) {
						return 3;
					}
					if (codec.includes("mp4a")) {
						return 2;
					}
					return 1;
				};

				return codecScore(b.acodec) - codecScore(a.acodec);
			});

		const bestFormat = supportedFormats.find((f) => !!f.url);
		if (!bestFormat) throw new Error("No supported formats");
		return this.createStreamAudioProducer(bestFormat, trackId);
	}

	async scan(_taskRunContext: TaskRunContext): Promise<void> {}

	async doTracksExist(trackIds: string[]): Promise<string[]> {
		const tracks = await this.cache.getTracks(trackIds);
		return tracks.map((track) => track.id);
	}
}
