import {
	AlbumMetadata,
	ArtistMetadata,
	AttributeValue,
	EphemeralAlbumContent,
	EphemeralArtistContent,
	EphemeralSource,
	EphemeralSourceApiContext,
	EphemeralSourceSearchOptions,
	EphemeralSourceSearchResults,
	EphemeralTrack,
	IdentifiableAlbumMetadata,
	IdentifiableArtistMetadata,
	IdentifiableTrackArtistMetadata,
	LibraryHandler,
} from "@sdk";
import { YTMusicLibraryHandler } from "./yt-music.library-handler.js";
import { YTMusicAttributeSource } from "./yt-music.attribute-source.js";
import Innertube, { YTNodes } from "youtubei.js";
import { YTMusicCache } from "./cache/ytmusic-cache.js";
import {
	deserializeAllThumbnails,
	listItemToAlbum,
	listItemToTrack,
} from "./utils.js";

export class YTMusicEphemeralSource implements EphemeralSource {
	readonly id = "youtube-music";
	private api!: EphemeralSourceApiContext;

	constructor(
		private readonly libraryHandler: YTMusicLibraryHandler,
		private readonly attributeSource: YTMusicAttributeSource,
		private readonly innertube: Innertube,
		private readonly cache: YTMusicCache,
	) {}

	enable(
		ephemeralSourceApiContext: EphemeralSourceApiContext,
	): void | Promise<void> {
		this.api = ephemeralSourceApiContext;

		this.api.useAttributeSource(this.attributeSource);

		this.api.resolveArtistIdentifier("youtube_music_artist_id");
		this.api.resolveAlbumIdentifier("youtube_music_album_id");

		this.api.resolveArtistIdentifier("youtube_music_user_id");
		this.api.resolveAlbumIdentifier("youtube_music_playlist_id");

		this.api.useTrackIdentifier("youtube_music_track_id");
	}

	getName(): string {
		return "YouTube Music";
	}

	getLibraryHandler(): LibraryHandler {
		return this.libraryHandler;
	}

	private forSearchResults(
		results:
			| (YTNodes.MusicShelf | YTNodes.MusicCardShelf | YTNodes.ItemSection)[]
			| undefined,
		callback: (item: YTNodes.MusicResponsiveListItem) => void,
	) {
		for (const shelf of results ?? []) {
			if (shelf instanceof YTNodes.MusicShelf) {
				for (const item of shelf.contents) {
					if (item instanceof YTNodes.MusicResponsiveListItem) {
						callback(item);
					}
				}
			}
		}
	}

	async search(
		options: EphemeralSourceSearchOptions,
	): Promise<EphemeralSourceSearchResults> {
		const [songResults, artistResults, albumResults, playlistResults] =
			await Promise.all([
				this.innertube.music.search(options.query, {
					type: "song",
				}),
				this.innertube.music.search(options.query, {
					type: "artist",
				}),
				this.innertube.music.search(options.query, {
					type: "album",
				}),
				this.innertube.music.search(options.query, {
					type: "playlist",
				}),
			]);

		const tracks: EphemeralTrack[] = [];
		const albums: IdentifiableAlbumMetadata[] = [];
		const artists: IdentifiableArtistMetadata[] = [];

		this.forSearchResults(songResults.contents, (item) => {
			const track = listItemToTrack(item);
			if (track) {
				tracks.push(track);
			}
		});

		this.forSearchResults(artistResults.contents, (item) => {
			if (!item.id || !item.name) {
				return;
			}

			const attributes: AttributeValue[] = [
				{
					key: "name",
					value: item.name,
				},
			];

			if (item.thumbnail?.contents.length) {
				attributes.push({
					key: "thumb",
					value: this.attributeSource.toThumbnailAttribute(
						item.thumbnail.contents,
					),
				});
			}

			artists.push({
				pluginId: "youtube-music",
				identityId: "youtube_music_artist_id",
				identity: item.id,
				attributes,
			});
		});

		this.forSearchResults(albumResults.contents, (item) => {
			const album = listItemToAlbum(item);
			if (album) {
				albums.push(album);
			}
		});

		this.forSearchResults(playlistResults.contents, (item) => {
			if (!item.id || !item.title) {
				return;
			}

			const attributes: AttributeValue[] = [
				{
					key: "title",
					value: item.title,
				},
			];

			if (item.thumbnail?.contents.length) {
				attributes.push({
					key: "front",
					value: this.attributeSource.toThumbnailAttribute(
						item.thumbnail.contents,
					),
				});
			}

			const artists: IdentifiableTrackArtistMetadata[] = [];

			if (item.author?.channel_id) {
				artists.push({
					pluginId: "youtube-music",
					identityId: "youtube_music_user_id",
					identity: item.author.channel_id,
					attributes: [
						{
							key: "name",
							value: item.author.name,
						},
					],
				});
			}

			albums.push({
				pluginId: "youtube-music",
				identityId: "youtube_music_playlist_id",
				identity: item.id,
				artists,
				attributes,
			});
		});

		const response: EphemeralSourceSearchResults = {
			tracks,
			albums,
			artists,
		};
		deserializeAllThumbnails(response);
		return response;
	}

	async resolveArtist(
		identityId: string,
		identity: string,
	): Promise<ArtistMetadata | null> {
		if (identityId == "youtube_music_artist_id") {
			return this.cache.getArtistMetadata(identity);
		}

		if (identityId == "youtube_music_user_id") {
			return this.cache.getUserMetadata(identity);
		}

		return null;
	}

	private async resolveArtistAsArtistContent(
		artistId: string,
	): Promise<EphemeralArtistContent | null> {
		return this.cache.getArtistContent(artistId);
	}

	private async resolveUserAsArtistContent(
		userId: string,
	): Promise<EphemeralArtistContent | null> {
		const { albums, tracks } = await this.cache.getUserContent(userId);

		return {
			albums,
			tracks,
		};
	}

	async resolveArtistContent(
		identityId: string,
		identity: string,
	): Promise<EphemeralArtistContent | null> {
		if (identityId == "youtube_music_artist_id") {
			return this.resolveArtistAsArtistContent(identity);
		}

		if (identityId == "youtube_music_user_id") {
			return this.resolveUserAsArtistContent(identity);
		}

		return null;
	}

	async resolveAlbum(
		identityId: string,
		identity: string,
	): Promise<AlbumMetadata | null> {
		if (identityId == "youtube_music_album_id") {
			return this.cache.getAlbumMetadata(identity);
		}
		if (identityId == "youtube_music_playlist_id") {
			const meta = await this.cache.getPlaylistMetadata(identity);
			return meta;
		}

		return null;
	}

	private async resolveAlbumAsAlbumContent(
		albumId: string,
	): Promise<EphemeralAlbumContent | null> {
		const tracks = await this.cache.getAlbumTracks(albumId);
		return { tracks };
	}

	private async resolvePlaylistAsAlbumContent(
		playlistId: string,
	): Promise<EphemeralAlbumContent | null> {
		const tracks = await this.cache.getPlaylistTracks(playlistId);
		return { tracks };
	}

	async resolveAlbumContent(
		identityId: string,
		identity: string,
	): Promise<EphemeralAlbumContent | null> {
		if (identityId == "youtube_music_album_id") {
			return this.resolveAlbumAsAlbumContent(identity);
		}

		if (identityId == "youtube_music_playlist_id") {
			return this.resolvePlaylistAsAlbumContent(identity);
		}

		return null;
	}

	resolveTracks(trackIds: string[]): Promise<EphemeralTrack[]> {
		return this.cache.getTracks(trackIds);
	}
}
