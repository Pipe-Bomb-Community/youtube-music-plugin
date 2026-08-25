import {
	AudioProducer,
	AudioProducerType,
	LibraryHandler,
	LibraryHandlerApiContext,
	StreamAudioProducer,
	TaskRunContext,
} from "@sdk";
import Axios, { AxiosError } from "axios";
import { Readable, PassThrough } from "stream";
import { spawn } from "child_process";
import { YtDlpFormat, YtDlpResponse } from "./types/yt-dlp.js";
import { YTMusicConfigManager } from "./yt-music.settings.js";
import { YTMusicCache } from "./cache/ytmusic-cache.js";
import { getMimeType } from "./utils.js";

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

	async createStreamAudioProducer(
		format: YtDlpFormat,
		videoId: string,
	): Promise<StreamAudioProducer> {
		try {
			console.log(format);
			const mimeType = getMimeType(format);
			const size = format.filesize;
			if (!size || isNaN(size)) {
				throw new Error("Invalid or unknown content-length");
			}

			let duration: number | null = null;

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
								const computedDuration = parseFloat(output.trim());
								if (isNaN(computedDuration)) {
									reject(new Error(`Invalid duration`));
								} else {
									duration = computedDuration;
									resolve(computedDuration);
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
					const args = [
						"-f",
						format.format_id,
						"-o",
						"-",
						"--http-chunk-size",
						"10M",
						"--downloader",
						"native",
						"--no-update",
					];

					const extractorArgs = this.config.getExtractorArgs();
					if (extractorArgs) {
						const parts = extractorArgs.split(" ");
						for (const part of parts) {
							args.push("--extractor-args", part);
						}
					}

					const endSession = await this.createDlpSession();
					const child = spawn(
						"yt-dlp",
						[...args, `https://youtube.com/watch?v=${videoId}`],
						{
							stdio: [null, "pipe", null],
						},
					);

					child.stderr.on("data", (chunk: Buffer) => {
						console.log(`[yt-dlp] ${chunk.toString().trim()}`);
					});

					child.on("close", (code) => {
						endSession();
						if (code !== 0) {
							console.error(`yt-dlp exited with code ${code}`);
						}
					});

					const speedo = new PassThrough();

					let lastReportTime = Date.now();
					let totalBytes = 0;
					let lastReportBytes = 0;

					speedo.once("data", () => endSession()); // once yt-dlp starts sending data we know it's finished with youtube frontend

					speedo.on("data", (chunk: Buffer) => {
						totalBytes += chunk.length;
						const now = Date.now();
						const duration = now - lastReportTime;
						if (duration >= 1000) {
							lastReportTime = now;
							const bytesSinceLast = totalBytes - lastReportBytes;

							const speedMBps =
								bytesSinceLast / (duration / 1000) / (1024 * 1024);
							const totalMB = totalBytes / (1024 * 1024);

							console.log(
								`[Download Progress] Speed: ${speedMBps.toFixed(2)} MB/s | Total Downloaded: ${totalMB.toFixed(2)} MB`,
							);

							lastReportTime = now;
							lastReportBytes = totalBytes;
						}
					});

					return child.stdout.pipe(speedo);
				},
				getPart: async (start, end) => {
					try {
						console.log(`Getting part ${start} - ${end}`);
						const { data } = await Axios.get<Readable>(format.url, {
							responseType: "stream",
							timeout: 15_000,
							headers: {
								...format.http_headers,
								range: `bytes=${start}-${end}`,
							},
						});
						console.log(`Got part ${start} - ${end}`);
						return data;
					} catch (e) {
						if (e instanceof AxiosError) {
							throw new Error(
								`HTTP request to YouTube for part of stream resulted in status code "${e.response?.status ?? "UNKNOWN"}"`,
							);
						}
						throw e;
					}
				},
			};
		} catch (e) {
			if (e instanceof AxiosError) {
				throw new Error(
					`HTTP request to YouTube for stream HEAD resulted in status code "${e.response?.status ?? "UNKNOWN"}"`,
				);
			}
			throw e;
		}
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
				const args = ["--dump-json", "--format", "bestaudio", "--no-update"];

				const extractorArgs = this.config.getExtractorArgs();
				if (extractorArgs) {
					const parts = extractorArgs.split(" ");
					for (const part of parts) {
						args.push("--extractor-args", part);
					}
				}
				args.push(...this.getPluginDirsArgs(), ...this.getCookiesArgs());

				const child = spawn(
					"yt-dlp",
					[...args, `https://youtube.com/watch?v=${trackId}`],
					{ env: this.getEnvWithPlugins() },
				);

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
