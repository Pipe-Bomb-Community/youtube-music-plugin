export interface YtDlpResponse {
	id: string;
	title: string;
	formats: YtDlpFormat[];
}

export interface YtDlpFormat {
	format_id: string;
	format_note?: string | null;
	format_index?: number | null;

	ext: string;
	protocol: string;

	url: string;
	manifest_url?: string;

	acodec: string;
	vcodec: string;

	audio_ext: string;
	video_ext: string;

	container?: string;

	width: number | null;
	height: number | null;
	resolution: string;

	fps: number | null;
	asr?: number | null;
	audio_channels?: number | null;

	tbr: number | null;
	vbr: number | null;
	abr: number | null;

	filesize?: number | null;
	filesize_approx?: number | null;

	quality?: number | null;
	preference?: number | null;
	source_preference?: number | null;
	language_preference?: number | null;

	language?: string | null;

	dynamic_range?: string | null;
	aspect_ratio?: number | null;

	has_drm?: boolean;
	available_at?: number;

	rows?: number;
	columns?: number;

	fragments?: YtDlpFragment[];

	downloader_options?: YtDlpDownloaderOptions;

	http_headers: YtDlpHttpHeaders;

	format: string;
}

export interface YtDlpFragment {
	url: string;
	duration: number;
}

export interface YtDlpDownloaderOptions {
	http_chunk_size?: number;
}

export interface YtDlpHttpHeaders {
	"User-Agent": string;
	Accept: string;
	"Accept-Language": string;
	"Sec-Fetch-Mode": string;
}
