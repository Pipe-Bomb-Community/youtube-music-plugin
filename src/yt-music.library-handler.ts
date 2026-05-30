import {
	AudioProducer,
	AudioProducerType,
	LibraryHandler,
	LibraryHandlerApiContext,
	TaskRunContext,
} from "@sdk";
import YTMusic from "atexovi-ytmusic-api";
import PlayDL from "play-dl";
import { ClientType, Innertube, Platform } from "youtubei.js";
import Axios from "axios";
import { Readable } from "stream";

Platform.shim.eval = async (data) => {
	// This executes the obfuscated YouTube cipher code securely
	return new Function(data.output)();
};

export class YTMusicLibraryHandler implements LibraryHandler {
	readonly id = "youtube-music";
	private api!: LibraryHandlerApiContext;

	constructor(private readonly ytMusic: YTMusic.default) {}

	getName(): string {
		return "YouTube Music";
	}

	enable(libraryHandlerApiContext: LibraryHandlerApiContext) {
		this.api = libraryHandlerApiContext;
	}

	async getAudioProducer(
		trackId: string,
		type: AudioProducerType | null,
	): Promise<AudioProducer | null> {
		if (type && type != "stream") {
			return null;
		}

		console.log("Creating innertube...");
		const yt = await Innertube.create({
			client_type: ClientType.TV_EMBEDDED,
			enable_session_cache: true,
		}); // todo: setup on enable

		console.log("Getting video info...");
		const videoInfo = await yt.music.getInfo(trackId);
		console.log("Video Info:", videoInfo);

		const format = videoInfo.chooseFormat({
			type: "audio",
			quality: "best",
		});

		console.log("Format:", format);

		if (!format) {
			throw new Error(`No suitable audio format found for video "${trackId}"`);
		}

		return {
			cacheable: true,
			type: "stream",
			getDuration: async () => format.approx_duration_ms / 1000,
			getMetadata: async () => {
				if (!format.content_length) {
					throw new Error("No content length");
				}
				return {
					size: format.content_length,
					mimeType: format.mime_type,
				};
			},
			getStream: async () => {
				console.log(format);
				const stream = await videoInfo.download({
					type: "audio",
					quality: "best",
				});
				return Readable.fromWeb(stream);
			},
			getPart: async (start, end) => {
				const stream = await videoInfo.download({
					type: "audio",
					quality: "best",
					range: {
						start,
						end,
					},
				});
				return Readable.fromWeb(stream);
			},
		};
	}

	async scan(taskRunContext: TaskRunContext): Promise<void> {}
}
