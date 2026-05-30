export interface YTMSong {
	type: "SONG";
	videoId: string;
	name?: string;
	// title?: string;
	artist?: YTMArtistStub;
	duration: number | null;
	album: YTMAlbum | null;
	thumbnails: YTMThumbnail[];
}

export interface YTMThumbnail {
	width: number;
	height: number;
	url: string;
}

export interface YTMArtistStub {
	artistId: string | null;
	name: string;
}

export interface YTMAlbum {
	id?: string;
	name?: string;
	title?: string;
	year?: number;
	artists?: Array<{ id: string | null; name: string }>;
}
