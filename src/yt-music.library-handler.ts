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
import { Readable } from "stream";
import { spawn } from "child_process";
import { YtDlpFormat, YtDlpResponse } from "./types/yt-dlp.js";

export class YTMusicLibraryHandler implements LibraryHandler {
	readonly id = "youtube-music";
	private api!: LibraryHandlerApiContext;

	constructor(private readonly innertube: Innertube) {}

	getName(): string {
		return "YouTube Music";
	}

	enable(libraryHandlerApiContext: LibraryHandlerApiContext) {
		this.api = libraryHandlerApiContext;
	}

	async createStreamAudioProducer(
		format: YtDlpFormat,
	): Promise<StreamAudioProducer> {
		const { headers } = await Axios.head(format.url);

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

					child.stderr.on("data", (chunk: Buffer) => {
						console.error(`[FFprobe] ${chunk.toString()}`);
					});

					let output = "";

					child.stdout.on("data", (chunk: Buffer) => {
						output += chunk.toString();
					});

					child.on("close", (code) => {
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
				const { data } = await Axios.get<Readable>(format.url, {
					responseType: "stream",
				});
				return data;
			},
			getPart: async (start, end) => {
				const { data } = await Axios.get<Readable>(format.url, {
					responseType: "stream",
					headers: {
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

		const response = await new Promise<YtDlpResponse>((resolve, reject) => {
			const child = spawn(
				`yt-dlp`,
				[
					"--dump-json",
					"--format",
					"bestaudio",
					`https://youtube.com/watch?v=${trackId}`,
				],
				{},
			);

			child.stderr.on("data", (chunk: Buffer) =>
				console.log(`[YT-DLP]:`, chunk.toString()),
			);

			let output = "";
			child.stdout.on("data", (chunk: Buffer) => {
				output += chunk.toString();
			});

			child.on("close", (code) => {
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
		});

		console.log(`Found ${response.formats.length} formats`);
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

		console.log(`Found ${supportedFormats.length} supported formats`);
		// console.log(supportedFormats);

		for (const [index, format] of supportedFormats.entries()) {
			try {
				if (format.url) {
					return await this.createStreamAudioProducer(format);
				}
			} catch (e) {
				if (index == supportedFormats.length - 1) {
					throw e;
				}
			}
		}

		throw new Error("No supported formats");
	}

	async scan(taskRunContext: TaskRunContext): Promise<void> {}
}
