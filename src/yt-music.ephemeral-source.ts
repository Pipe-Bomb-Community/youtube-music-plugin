import {
	AlbumMetadata,
	ArtistMetadata,
	AttributeValue,
	BufferAttributeValue,
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

export class YTMusicEphemeralSource implements EphemeralSource {
	readonly id = "youtube-music";
	private api!: EphemeralSourceApiContext;

	constructor(
		private readonly libraryHandler: YTMusicLibraryHandler,
		private readonly attributeSource: YTMusicAttributeSource,
		private readonly innertube: Innertube,
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

	private listItemToTrack(
		item: YTNodes.MusicResponsiveListItem,
	): EphemeralTrack | null {
		if (!item.id || !item.title) {
			return null;
		}

		const attributes: AttributeValue[] = [
			{
				key: "title",
				value: item.title,
			},
		];
		if (item.thumbnail) {
			attributes.push({
				key: "front",
				value: this.attributeSource.toThumbnailAttribute(
					item.thumbnail.contents,
				),
			});
		}
		if (item.duration) {
			attributes.push({
				key: "duration",
				value: item.duration.seconds,
			});
		}

		const artists: IdentifiableTrackArtistMetadata[] = [];
		if (item.artists) {
			for (const resultArtist of item.artists) {
				if (resultArtist.channel_id) {
					artists.push({
						pluginId: "youtube-music",
						identityId: "youtube_music_artist_id",
						identity: resultArtist.channel_id,
						attributes: [
							{
								key: "name",
								value: resultArtist.name,
							},
						],
					});
				}
			}
		}

		return {
			id: item.id,
			title: item.title,
			attributes,
			artists,
			identityId: "youtube_music_track_id",
			identity: item.id,
		};
	}

	private listItemToAlbum(
		item: YTNodes.MusicResponsiveListItem,
	): IdentifiableAlbumMetadata | null {
		if (!item.id || !item.title) {
			return null;
		}

		const attributes: AttributeValue[] = [{ key: "title", value: item.title }];

		if (item.thumbnail) {
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
				identityId: "youtube_music_artist_id",
				identity: item.author.channel_id,
				attributes: [
					{
						key: "name",
						value: item.author.name,
					},
				],
			});
		}

		return {
			pluginId: "youtube-music",
			identityId: "youtube_music_album_id",
			identity: item.id,
			attributes,
			artists,
		};
	}

	private twoRowItemToAlbum(
		item: YTNodes.MusicTwoRowItem,
	): IdentifiableAlbumMetadata | null {
		if (!item.id || !item.title) {
			return null;
		}

		const attributes: AttributeValue[] = [
			{
				key: "title",
				value: item.title.toString(),
			},
		];

		if (item.thumbnail?.length) {
			attributes.push({
				key: "front",
				value: this.attributeSource.toThumbnailAttribute(item.thumbnail),
			});
		}

		const artists: IdentifiableTrackArtistMetadata[] = [];

		// MusicTwoRowItem already normalizes artists properly
		if (item.artists?.length) {
			for (const artist of item.artists) {
				if (!artist.channel_id) continue;

				artists.push({
					pluginId: "youtube-music",
					identityId: "youtube_music_artist_id",
					identity: artist.channel_id,
					attributes: [
						{
							key: "name",
							value: artist.name,
						},
					],
				});
			}
		}

		return {
			pluginId: "youtube-music",
			identityId: "youtube_music_album_id",
			identity: item.id,
			attributes,
			artists,
		};
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
			const track = this.listItemToTrack(item);
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

			if (item.thumbnail) {
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
			const album = this.listItemToAlbum(item);
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

			if (item.thumbnail) {
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

		return {
			tracks,
			albums,
			artists,
		};
	}

	private async resolveArtistAsArtist(
		artistId: string,
	): Promise<ArtistMetadata | null> {
		const result = await this.innertube.music.getArtist(artistId);

		const attributes: AttributeValue[] = [];

		if (result.header?.title) {
			attributes.push({
				key: "name",
				value: result.header.title.toString(),
			});
		}

		if (result.header instanceof YTNodes.MusicImmersiveHeader) {
			if (result.header.thumbnail) {
				attributes.push({
					key: "background",
					value: this.attributeSource.toThumbnailAttribute(
						result.header.thumbnail.contents,
					),
				});
			}
		}

		return { attributes };
	}

	private async resolveUserAsArtist(
		userId: string,
	): Promise<ArtistMetadata | null> {
		throw new Error("Not implemented");
	}

	async resolveArtist(
		identityId: string,
		identity: string,
	): Promise<ArtistMetadata | null> {
		if (identityId == "youtube_music_artist_id") {
			return this.resolveArtistAsArtist(identity);
		}

		if (identityId == "youtube_music_user_id") {
			return this.resolveUserAsArtist(identity);
		}

		return null;
	}

	async resolveArtistContent(
		identityId: string,
		identity: string,
	): Promise<EphemeralArtistContent | null> {
		if (identityId !== "youtube_music_artist_id") {
			return null;
		}

		const artist = await this.innertube.music.getArtist(identity);

		const tracks: EphemeralTrack[] = [];
		const albums: IdentifiableAlbumMetadata[] = [];

		for (const section of artist.sections ?? []) {
			const contents = section?.contents;

			if (!contents) continue;

			for (const item of contents) {
				if (
					item instanceof YTNodes.MusicResponsiveListItem &&
					item.item_type == "song"
				) {
					const track = this.listItemToTrack(item);
					if (track) tracks.push(track);
				}

				if (
					item instanceof YTNodes.MusicTwoRowItem &&
					item.item_type == "album"
				) {
					const album = this.twoRowItemToAlbum(item);
					if (album) {
						albums.push(album);
					}
				}
			}
		}

		return {
			tracks,
			albums,
		};
	}

	private toAlbumArtists(
		header: YTNodes.MusicResponsiveHeader | YTNodes.MusicDetailHeader,
	) {
		const artists: IdentifiableTrackArtistMetadata[] = [];

		if (header?.is(YTNodes.MusicResponsiveHeader)) {
			const strapline = header.strapline_text_one;
			const runs = strapline.runs;

			if (runs) {
				for (const [index, run] of runs.entries() ?? []) {
					const endpoint = (run as any).endpoint as
						| YTNodes.NavigationEndpoint
						| undefined;
					if (!endpoint) {
						continue;
					}

					const browseId = endpoint?.payload?.browseId as string | undefined;
					if (!browseId) {
						continue;
					}

					let joinPhrase: string | null = null;

					if (runs.length > index + 1) {
						const nextRun = runs[index + 1];
						if (nextRun && !(nextRun as any).endpoint) {
							joinPhrase = nextRun.text;
						}
					}

					artists.push({
						pluginId: "youtube-music",
						identityId: "youtube_music_artist_id",
						identity: browseId,
						joinPhrase,
						attributes: [
							{
								key: "name",
								value: run.text,
							},
						],
					});
				}
			}
		}

		return artists;
	}

	private async resolveAlbumAsAlbum(
		albumId: string,
	): Promise<AlbumMetadata | null> {
		const album = await this.innertube.music.getAlbum(albumId);
		const header = album.header;

		const attributes: AttributeValue[] = [];
		const artists: IdentifiableTrackArtistMetadata[] = [];

		if (header) {
			if (header.title.text) {
				attributes.push({
					key: "title",
					value: header.title.text,
				});
			}

			artists.push(...this.toAlbumArtists(header));

			if (header.is(YTNodes.MusicResponsiveHeader)) {
				if (header.thumbnail) {
					attributes.push({
						key: "front",
						value: this.attributeSource.toThumbnailAttribute(
							header.thumbnail.contents,
						),
					});
				}
			}
		}

		return {
			artists,
			attributes,
		};
	}

	private async resolvePlaylistAsAlbum(
		playlistId: string,
	): Promise<AlbumMetadata | null> {
		const playlist = await this.innertube.music.getPlaylist(playlistId);

		const header = playlist.header;

		const attributes: AttributeValue[] = [];
		const artists: IdentifiableTrackArtistMetadata[] = [];
		if (header?.is(YTNodes.MusicResponsiveHeader)) {
			if (header.title.text) {
				attributes.push({
					key: "title",
					value: header.title.text,
				});
			}

			if (header.is(YTNodes.MusicResponsiveHeader)) {
				if (header.thumbnail) {
					attributes.push({
						key: "front",
						value: this.attributeSource.toThumbnailAttribute(
							header.thumbnail.contents,
						),
					});
				}
			}
		}

		return {
			artists,
			attributes,
		};
	}

	async resolveAlbum(
		identityId: string,
		identity: string,
	): Promise<AlbumMetadata | null> {
		if (identityId == "youtube_music_album_id") {
			return this.resolveAlbumAsAlbum(identity);
		}
		if (identityId == "youtube_music_playlist_id") {
			return this.resolvePlaylistAsAlbum(identity);
		}

		return null;
	}

	private async resolveAlbumAsAlbumContent(
		albumId: string,
	): Promise<EphemeralAlbumContent | null> {
		const album = await this.innertube.music.getAlbum(albumId);
		const tracks: EphemeralTrack[] = [];

		let thumbnail: BufferAttributeValue | null = null;
		const albumArtists: IdentifiableTrackArtistMetadata[] = [];

		const header = album.header;
		if (header?.is(YTNodes.MusicResponsiveHeader)) {
			if (header.thumbnail) {
				thumbnail = this.attributeSource.toThumbnailAttribute(
					header.thumbnail.contents,
				);
			}
			albumArtists.push(...this.toAlbumArtists(header));
		}

		for (const item of album.contents) {
			if (item.item_type != "song" && item.item_type != "video") {
				continue;
			}

			const track = this.listItemToTrack(item);
			if (track) {
				if (
					thumbnail &&
					track.attributes &&
					!track.attributes.some((attribute) => attribute.key == "front")
				) {
					track.attributes.push({
						key: "front",
						value: thumbnail,
					});
				}
				if (!track.artists?.length) {
					track.artists = albumArtists;
				}

				tracks.push(track);
			}
		}

		return {
			tracks,
		};
	}

	private async resolvePlaylistAsAlbumContent(
		playlistId: string,
	): Promise<EphemeralAlbumContent | null> {
		let playlist = await this.innertube.music.getPlaylist(playlistId);
		const tracks: EphemeralTrack[] = [];

		while (playlist) {
			const items = playlist.contents ?? [];
			for (const item of items) {
				if (item.is(YTNodes.ContinuationItem)) {
					continue;
				}

				if (item.item_type != "song" && item.item_type != "video") {
					continue;
				}

				const track = this.listItemToTrack(item);
				if (track) {
					tracks.push(track);
				}
			}

			if (!playlist.has_continuation) {
				break;
			}
			playlist = await playlist.getContinuation();
		}

		return {
			tracks,
		};
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
		throw new Error("Method not implemented.");
	}
}
