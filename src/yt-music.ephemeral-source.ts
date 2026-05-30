import {
	AlbumMetadata,
	ArtistMetadata,
	EphemeralAlbumContent,
	EphemeralArtistContent,
	EphemeralSource,
	EphemeralSourceApiContext,
	EphemeralSourceSearchOptions,
	EphemeralSourceSearchResults,
	EphemeralTrack,
	IdentifiableAlbumMetadata,
	IdentifiableArtistMetadata,
	LibraryHandler,
} from "@sdk";
import { YTMusicLibraryHandler } from "./yt-music.library-handler.js";
import YTMusic from "atexovi-ytmusic-api";
import { YTMusicAttributeSource } from "./yt-music.attribute-source.js";

export class YTMusicEphemeralSource implements EphemeralSource {
	readonly id = "youtube-music";
	private api!: EphemeralSourceApiContext;

	constructor(
		private readonly libraryHandler: YTMusicLibraryHandler,
		private readonly attributeSource: YTMusicAttributeSource,
		private readonly ytMusic: YTMusic.default,
	) {}

	enable(
		ephemeralSourceApiContext: EphemeralSourceApiContext,
	): void | Promise<void> {
		this.api = ephemeralSourceApiContext;

		this.api.useAttributeSource(this.attributeSource);

		this.api.resolveArtistIdentifier("youtube_music_artist_id");
	}

	getName(): string {
		return "YouTube Music";
	}

	getLibraryHandler(): LibraryHandler {
		return this.libraryHandler;
	}

	async search(
		options: EphemeralSourceSearchOptions,
	): Promise<EphemeralSourceSearchResults> {
		const results = await this.ytMusic.search(options.query);

		const tracks: EphemeralTrack[] = [];
		const albums: IdentifiableAlbumMetadata[] = [];
		const artists: IdentifiableArtistMetadata[] = [];
		for (const result of results) {
			if (result.type == "SONG") {
				tracks.push({
					...this.attributeSource.toTrackMetadata(result),
					id: result.videoId,
					title: result.name,
					identityId: "youtube_music_track_id",
					identity: result.videoId,
				});
			}
			if (result.type == "ALBUM") {
				albums.push({
					...this.attributeSource.toAlbumMetadata(result),
					pluginId: "youtube-music",
					identityId: "youtube_music_album_id",
					identity: result.albumId,
				});
			}
			if (result.type == "ARTIST") {
				artists.push({
					...this.attributeSource.toMinimalArtistMetadata(
						result,
						result.thumbnails,
					),
					pluginId: "youtube-music",
					identityId: "youtube_music_artist_id",
					identity: result.artistId,
				});
			}
		}

		return {
			tracks,
			artists,
			albums,
		};
	}

	async resolveArtist(
		identityId: string,
		identity: string,
	): Promise<ArtistMetadata | null> {
		if (identityId != "youtube_music_artist_id") {
			return null;
		}

		const artist = await this.ytMusic.getArtist(identity);
		return this.attributeSource.toArtistMetadata(artist);
	}

	async resolveArtistContent(
		identifierId: string,
		identity: string,
	): Promise<EphemeralArtistContent | null> {
		if (identifierId != "youtube_music_artist_id") {
			return null;
		}

		const ytSongs = await this.ytMusic.getArtistSongs(identity);
		const tracks: EphemeralTrack[] = ytSongs.map((song) => ({
			...this.attributeSource.toTrackMetadata(song),
			id: song.videoId,
			title: song.name,
			identityId: "youtube_music_track_id",
			identity: song.videoId,
		}));

		const ytAlbums = await this.ytMusic.getArtistAlbums(identity);
		const albums: IdentifiableAlbumMetadata[] = ytAlbums.map((album) => ({
			...this.attributeSource.toAlbumMetadata(album),
			pluginId: "youtube_music",
			identityId: "youtube_music_album_id",
			identity: album.albumId,
		}));

		return { tracks, albums };
	}

	resolveAlbum(
		identityId: string,
		identity: string,
	): Promise<AlbumMetadata | null> {
		throw new Error("Method not implemented.");
	}

	resolveAlbumContent(
		identityId: string,
		identity: string,
	): Promise<EphemeralAlbumContent | null> {
		throw new Error("Method not implemented.");
	}

	resolveTracks(trackIds: string[]): Promise<EphemeralTrack[]> {
		throw new Error("Method not implemented.");
	}
}
