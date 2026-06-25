import {
	AudioProducer,
	AudioProducerType,
	LibraryHandler,
	LibraryHandlerApiContext,
	StreamAudioProducer,
	TaskRunContext,
} from "@sdk";
import { Innertube } from "youtubei.js";
import Axios from "axios";
import { Readable, PassThrough } from "stream";
import { spawn } from "child_process";
import { YtDlpFormat, YtDlpResponse } from "./types/yt-dlp.js";
import { YTMusicConfigManager } from "./yt-music.settings.js";
import { YTMusicCache } from "./cache/ytmusic-cache.js";

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
		const { headers } = await Axios.head(format.url, {
			timeout: 10_000,
		});

		if (!headers["content-type"] || !headers["content-length"]) {
			throw new Error("Missing headers");
		}

		const mimeType = headers["content-type"].toString();
		const size = parseInt(headers["content-length"].toString());

		if (isNaN(size)) {
			throw new Error("Invalid content-length");
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
				const { data } = await Axios.get<Readable>(format.url, {
					responseType: "stream",
					timeout: 15_000,
					headers: {
						...format.http_headers,
						range: `bytes=${start}-${end}`,
					},
				});
				return data;
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
				const args = ["--dump-json", "--format", "bestaudio", "--no-update"];

				const extractorArgs = this.config.getExtractorArgs();
				if (extractorArgs) {
					const parts = extractorArgs.split(" ");
					for (const part of parts) {
						args.push("--extractor-args", part);
					}
				}

				const child = spawn("yt-dlp", [
					...args,
					`https://youtube.com/watch?v=${trackId}`,
				]);

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
					return false; // todo: support
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

		// console.log(`Found ${supportedFormats.length} supported formats`);

		for (const [index, format] of supportedFormats.entries()) {
			try {
				if (format.url) {
					return await this.createStreamAudioProducer(format, trackId);
				}
			} catch (e) {
				if (index == supportedFormats.length - 1) {
					throw e;
				}
			}
		}

		throw new Error("No supported formats");
	}

	async scan(_taskRunContext: TaskRunContext): Promise<void> {}

	async doTracksExist(trackIds: string[]): Promise<string[]> {
		const tracks = await this.cache.getTracks(trackIds);
		return tracks.map((track) => track.id);
	}
}
