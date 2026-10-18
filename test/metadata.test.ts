import path from "path";
import fs from "fs";
import Innertube, { UniversalCache, YTNodes } from "youtubei.js";
import { YTMusicCache } from "@/cache/ytmusic-cache.js";
import {
	cleanArtistName,
	deserializeAllThumbnails,
	listItemToAlbum,
	mostCommonDate,
} from "@/utils.js";
import { EphemeralTrack } from "@pipe-bomb/plugin-sdk";

/**
 * Live integration test: exercises the real YouTube Music (Innertube) API through
 * the plugin's YTMusicCache and asserts the returned metadata is YTM-derived and
 * complete (artists + album year, etc.).
 *
 * Run: npm run test:metadata
 * Exits non-zero if any assertion fails.
 */

let passed = 0;
let failed = 0;

function assert(condition: unknown, label: string): boolean {
	if (condition) {
		passed++;
		console.log(`  PASS  ${label}`);
		return true;
	}
	failed++;
	console.error(`  FAIL  ${label}`);
	return false;
}

function attributeValue(
	track: { attributes?: { key: string; value: unknown }[] | null } | null,
	key: string,
): unknown {
	return track?.attributes?.find((a) => a.key === key)?.value;
}

async function firstSearchItem(
	innertube: Innertube,
	query: string,
	type: "song" | "album" | "artist" | "playlist",
): Promise<YTNodes.MusicResponsiveListItem | null> {
	const results = await innertube.music.search(query, { type });
	for (const shelf of results.contents ?? []) {
		if (shelf.is(YTNodes.MusicShelf)) {
			const item = shelf.contents.find((i) =>
				i.is(YTNodes.MusicResponsiveListItem),
			);
			if (item?.is(YTNodes.MusicResponsiveListItem)) {
				return item;
			}
		}
	}
	return null;
}

async function main() {
	const cacheDir = path.join("temp", `metadata-${Date.now()}`);
	const innertube = await Innertube.create({
		cache: new UniversalCache(true, path.join(cacheDir, "innertube")),
	});
	const cache = new YTMusicCache(
		path.join(cacheDir, "cache.sqlite"),
		innertube,
	);

	console.log("\n[1] Song search returns YTM tracks");
	const songItem = await firstSearchItem(innertube, "Blinding Lights The Weeknd", "song");
	assert(!!songItem, "found a song search result");
	const videoId = songItem?.id ?? null;
	const searchTitle = songItem?.title ?? null;
	assert(!!videoId && !!searchTitle, `result has id+title (${videoId} / ${searchTitle})`);
	assert(!!songItem?.artists?.length, "result has artists");

	console.log("\n[2] getTrack returns YTM metadata for the searched track");
	const track: EphemeralTrack | null = videoId ? await cache.getTrack(videoId) : null;
	assert(!!track, "track resolved");
	if (track) {
		assert(track.identityId === "youtube_music_track_id", "identityId is youtube_music_track_id");
		assert(track.identity === videoId, "identity matches video id");
		assert(!!track.title && track.title.length > 0, `title present ("${track.title}")`);
		// The YTM track title should equal the YTM search title (not a YouTube
		// video title such as "…(Official Video)").
		assert(track.title === searchTitle, `title matches YTM search title (both "${track.title}")`);
		assert(!!track.artists?.length, "has artists");
		const firstArtist = track.artists?.[0];
		assert(!!firstArtist?.identity && firstArtist.identityId === "youtube_channel_id", "artist has channel id");
		assert(typeof attributeValue(track, "duration") === "number", "has numeric duration");
	}

	console.log("\n[3] getTrackAlbumId resolves an album for a catalog track");
	const albumId = videoId ? await cache.getTrackAlbumId(videoId) : null;
	assert(!!albumId, `album id resolved (${albumId})`);

	console.log("\n[4] getAlbumMetadata returns artists + year + title");
	let albumId2 = albumId;
	if (!albumId2) {
		const albumItem = await firstSearchItem(innertube, "After Hours The Weeknd", "album");
		albumId2 = albumItem?.id ?? null;
	}
	assert(!!albumId2, "album id available");
	if (albumId2) {
		const meta = await cache.getAlbumMetadata(albumId2);
		const keys = meta.attributes?.map((a) => a.key) ?? [];
		assert(!!meta.artists?.length, `album has artists (${meta.artists?.map((a) => a.attributes?.find((x) => x.key === "name")?.value).join(", ")})`);
		assert(keys.includes("title"), "album has title attribute");
		assert(keys.includes("year"), "album has year attribute");
		const year = attributeValue({ attributes: meta.attributes }, "year");
		assert(typeof year === "number" && year >= 1900 && year <= 2100, `album year is a sane number (${year})`);
	}

	console.log("\n[5] getAlbumTracks returns the album's tracks");
	if (albumId2) {
		const tracks = await cache.getAlbumTracks(albumId2);
		assert(!!tracks && tracks.length > 0, `album has ${tracks?.length} tracks`);
		if (tracks?.length) {
			const t0 = tracks[0]!;
			assert(!!t0.id && !!t0.title, `first track has id+title (${t0.id} / ${t0.title})`);
		}
	}

	console.log("\n[6] getArtistContent returns artist tracks/albums");
	const artistId = track?.artists?.[0]?.identity;
	assert(!!artistId, "artist id available");
	if (artistId) {
		const content = await cache.getArtistContent(artistId);
		const trackCount = content.tracks?.length ?? 0;
		const albumCount = content.albums?.length ?? 0;
		assert(trackCount + albumCount > 0, `artist content has ${trackCount} tracks, ${albumCount} albums`);
	}

	console.log("\n[7] getChannelMetadata returns the artist name");
	if (artistId) {
		const meta = await cache.getChannelMetadata(artistId);
		const name = attributeValue({ attributes: meta.attributes }, "name");
		assert(!!name, `artist name present ("${name}")`);
	}

	console.log("\n[8] Playlist metadata + tracks");
	const playlistItem = await firstSearchItem(innertube, "lofi hip hop", "playlist");
	assert(!!playlistItem, "found a playlist search result");
	if (playlistItem?.id) {
		const meta = await cache.getPlaylistMetadata(playlistItem.id);
		const title = attributeValue({ attributes: meta.attributes }, "title");
		assert(!!title, `playlist title present ("${title}")`);
		const tracks = await cache.getPlaylistTracks(playlistItem.id);
		assert(!!tracks && tracks.length > 0, `playlist has ${tracks?.length} tracks`);
	}

	console.log("\n[9] Album search results carry a year (listItemToAlbum)");
	const albumSearch = await innertube.music.search("After Hours The Weeknd", {
		type: "album",
	});
	let albumItem: YTNodes.MusicResponsiveListItem | null = null;
	for (const shelf of albumSearch.contents ?? []) {
		if (shelf.is(YTNodes.MusicShelf)) {
			const found = shelf.contents.find(
				(i) =>
					i.is(YTNodes.MusicResponsiveListItem) &&
					i.item_type === "album" &&
					!!i.year,
			);
			if (found?.is(YTNodes.MusicResponsiveListItem)) {
				albumItem = found;
				break;
			}
		}
	}
	assert(!!albumItem, "found an album search result with a raw year");
	if (albumItem) {
		const album = listItemToAlbum(albumItem);
		assert(!!album, "listItemToAlbum returned metadata");
		const year = album ? attributeValue(album, "year") : null;
		assert(
			typeof year === "number" && year >= 1900 && year <= 2100,
			`album search result has a year attribute (${year}, raw "${albumItem.year}")`,
		);
	}

	console.log("\n[10] cleanArtistName strips the auto-generated ' - Topic' suffix");
	assert(cleanArtistName("Foo Bar - Topic") === "Foo Bar", "strips ' - Topic'");
	assert(cleanArtistName("Foo Bar - topic") === "Foo Bar", "is case-insensitive");
	assert(cleanArtistName("Foo - Topic Band") === "Foo - Topic Band", "keeps mid-name dashes");
	assert(cleanArtistName("  Foo Bar  ") === "Foo Bar", "trims whitespace");
	assert(cleanArtistName("Foo Bar") === "Foo Bar", "passes through clean names");

	console.log("\n[11] Resolved track has enriched YTM attributes");
	if (videoId && track) {
		assert(
			!!attributeValue(track, "artist"),
			`track has artist attribute ("${attributeValue(track, "artist")}")`,
		);
		const releaseDate = attributeValue(track, "release_date");
		assert(
			releaseDate === undefined ||
				(typeof releaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)),
			`track release_date is YYYY-MM-DD when present (${releaseDate ?? "absent"})`,
		);
		assert(
			typeof attributeValue(track, "views") === "number" ||
				attributeValue(track, "views") === undefined,
			"track views is numeric when present",
		);
		const lyrics = await cache.getLyrics(videoId);
		assert(!!lyrics && lyrics.length > 0, "track lyrics resolved");
	}

	console.log("\n[12] Album has release_type / track_count / duration / release_date");
	if (albumId2) {
		const meta = await cache.getAlbumMetadata(albumId2);
		const releaseType = attributeValue({ attributes: meta.attributes }, "release_type");
		assert(!!releaseType, `album release_type present ("${releaseType}")`);
		const trackCount = attributeValue({ attributes: meta.attributes }, "track_count");
		assert(
			typeof trackCount === "number" && trackCount > 0,
			`album track_count present (${trackCount})`,
		);
		const duration = attributeValue({ attributes: meta.attributes }, "duration");
		assert(
			typeof duration === "number" && duration > 0,
			`album duration present (${duration}s)`,
		);
		const releaseDate = attributeValue({ attributes: meta.attributes }, "release_date");
		assert(
			typeof releaseDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate),
			`album release_date is YYYY-MM-DD (${releaseDate})`,
		);
	}

	console.log("\n[13] Album tracks are canonical YTM songs (ATV), not OMV uploads");
	if (albumId2) {
		const tracks = await cache.getAlbumTracks(albumId2);
		if (tracks.length) {
			const t0 = tracks[0]!;
			assert(
				!!t0.title && !/\(Official/i.test(t0.title),
				`first album track has a clean title ("${t0.title}")`,
			);
			assert(
				!!attributeValue(t0, "album"),
				`first album track has an album attribute ("${attributeValue(t0, "album")}")`,
			);
			assert(
				!!attributeValue(t0, "artist"),
				`first album track has an artist attribute ("${attributeValue(t0, "artist")}")`,
			);
			assert(
				typeof attributeValue(t0, "track_number") === "number",
				`first album track has a track_number (${attributeValue(t0, "track_number")})`,
			);
			const front = t0.attributes?.find((a) => a.key === "front")?.value as
				| { extension?: string; buffer?: unknown }
				| undefined;
			assert(
				!!front &&
					typeof front.extension === "string" &&
					(typeof front.buffer === "function" || Buffer.isBuffer(front.buffer)),
				"album track front is a valid buffer attribute (not a raw serialized marker)",
			);
		}
	}

	console.log("\n[14] Resolved artist has a description");
	if (artistId) {
		const meta = await cache.getChannelMetadata(artistId);
		const name = attributeValue({ attributes: meta.attributes }, "name");
		assert(
			typeof name === "string" && !name.toLowerCase().endsWith(" - topic"),
			`artist name has no ' - Topic' suffix ("${name}")`,
		);
		const description = attributeValue({ attributes: meta.attributes }, "description");
		assert(!!description, "artist description present");
	}

	console.log("\n[15] deserializeAllThumbnails flags corrupt buffer attributes");
	const corruptNode = {
		attributes: [{ key: "front", value: { extension: "jpg" } }],
	};
	assert(
		deserializeAllThumbnails(corruptNode) === true,
		"flags a buffer attribute with no callable buffer",
	);
	const validBufferNode = {
		attributes: [
			{
				key: "front",
				value: { extension: "jpg", buffer: async () => Buffer.from("") },
			},
		],
	};
	assert(
		deserializeAllThumbnails(validBufferNode) === false,
		"accepts a deserialized buffer attribute",
	);
	const serializedNode = {
		attributes: [
			{
				key: "front",
				value: {
					type: "serialized-thumbnails",
					extension: "jpg",
					thumbnails: [],
				},
			},
		],
	};
	assert(
		deserializeAllThumbnails(serializedNode) === false,
		"accepts and converts a serialized thumbnail marker",
	);

	console.log("\n[16] Album release_date falls back to the video publish date (SOMA)");
	const somaId = "MPREb_Zw3AloBrysn";
	const somaMeta = await cache.getAlbumMetadata(somaId);
	const somaDate = attributeValue({ attributes: somaMeta.attributes }, "release_date");
	assert(
		typeof somaDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(somaDate),
		`SOMA album release_date present (${somaDate})`,
	);
	const somaTracks = await cache.getAlbumTracks(somaId);
	assert(somaTracks.length > 0, `SOMA has ${somaTracks.length} tracks`);
	assert(
		somaTracks.every(
			(t) =>
				typeof attributeValue(t, "release_date") === "string" &&
				/^\d{4}-\d{2}-\d{2}$/.test(String(attributeValue(t, "release_date"))),
		),
		"every SOMA track has a release_date",
	);
	if (somaTracks[0]) {
		const standalone = await cache.getTrack(somaTracks[0].id);
		assert(
			typeof attributeValue(standalone, "release_date") === "string",
			`standalone SOMA track has release_date (${attributeValue(standalone, "release_date")})`,
		);
	}

	console.log("\n[17] mostCommonDate ignores an older single outlier");
	assert(
		mostCommonDate([
			"2019-11-29",
			"2020-03-20",
			"2020-03-20",
			"2020-03-20",
		]) === "2020-03-20",
		"picks the album date over an earlier single",
	);
	assert(
		mostCommonDate(["2019-11-29", "2020-03-20"]) === "2020-03-20",
		"breaks ties toward the later date",
	);
	assert(mostCommonDate([]) === null, "returns null for no dates");

	console.log(`\n==== ${passed} passed, ${failed} failed ====`);

	try {
		fs.rmSync(cacheDir, { recursive: true, force: true });
	} catch {}

	process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error("FATAL", e);
	process.exit(1);
});
