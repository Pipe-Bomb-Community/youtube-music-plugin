# Architecture

Read this when touching component wiring, adding a new SDK component, or debugging
identity/attribute resolution.

The plugin is a Pipe Bomb SDK `Plugin`. `main.ts:enable()` is the only entry point and
is where every component is constructed and registered. Metadata flows from Pipe Bomb →
`EphemeralSource` → `YTMusicCache` → Innertube. Audio flows from Pipe Bomb →
`LibraryHandler` → the `yt-dlp` binary.

## Components

| File | Role | Notes |
| ---- | ---- | ----- |
| `src/main.ts` | `Plugin` entry | Wires everything in `enable()`; registers the `update-yt-dlp` task only when the binary is auto-downloaded (managed). |
| `src/yt-music.ephemeral-source.ts` | `EphemeralSource` | `search()` fires 4 parallel Innertube searches (song/artist/album/playlist); `resolveArtist*`/`resolveAlbum*`/`resolveTracks` read from the cache. |
| `src/yt-music.library-handler.ts` | `LibraryHandler` | Audio: `getAudioProducer` (yt-dlp JSON) + `createStreamAudioProducer` (stream/part/duration). See `docs/audio.md`. |
| `src/yt-music.attribute-source.ts` | `AttributeSource` | Registers attribute keys and serves values from the cache. |
| `src/yt-music.settings.ts` | `ConfigManager` | Config options: extractor args, producers, cookies, plugin dirs. |
| `src/ytmusic.url-source.ts` | `ExternalUrlSource` | Artist → `music.youtube.com/@handle` or `/channel/<id>`. |
| `src/ytdlp.ts` | yt-dlp binary | `resolveYtDlp` (PATH → auto-download) and `updateYtDlp` (`yt-dlp -U`). |
| `src/youtubei-log.ts` | Log bridge | Reroutes youtubei.js `console.*` output into the plugin logger; installed in `enable()`, removed in `disable()`. |
| `src/cache/ytmusic-cache.ts` | Metadata cache | `getOrFind` wrappers over Innertube with per-key TTLs. See `docs/caching.md`. |
| `src/cache/persistent-cache.ts` | Persistent store | keyv + `@keyv/sqlite` → `cache.sqlite`; deserializes thumbnails on read. |
| `src/identity/*.ts` | Identifiers | One file per identity, see graph below. |
| `src/utils.ts` | Mapping + thumbnails | youtubei.js nodes → Pipe Bomb track/album/artist; thumbnail (de)serialization. |
| `src/constants.ts` | `USER_AGENT` | Currently only the UA string. |
| `src/types.d.ts`, `src/types/yt-dlp.d.ts` | Local types | YT node stubs and yt-dlp JSON output. |
| `language/en_US.json`, `icons/` | i18n + icon | Registered in `main.ts` via `registerLanguageDirectory`/`registerIconDirectory`. |

## Identity graph

`youtube_music_track_id` (video ID) is the root track identity.

```
youtube_music_track_id (track)
├──→ youtube_channel_id   (artist)   via ChannelIdTrackIdentifier
└──→ youtube_music_album_id (album)  via AlbumIdTrackIdentifier

youtube_music_album_id (album)
└──→ youtube_channel_id   (artist)   via ArtistIdAlbumIdentifier

youtube_channel_id (artist)
└──→ youtube_handle       (soft)     via HandleArtistIdentifier
```

Album identities: `youtube_music_album_id` (real albums) and `youtube_music_playlist_id`
(playlists surfaced as albums). Both are resolved in `ephemeral-source.ts`.

## Metadata source

All metadata (search, track, album, artist, playlist, channel browse) is fetched through
the **YTMUSIC** Innertube client — either the `.music.*` methods or explicit
`actions.execute(..., { client: "YTMUSIC" })`. The default-client (WEB) calls are
`resolveURL` in `handleToChannelId` (`src/cache/ytmusic-cache.ts:260`), which only maps a
channel URL to a browseId and returns no titles, and `getBasicInfo` in
`enrichTrackMetadata`/`deriveReleaseDate`, used to pull `views`, `description` and a
`release_date` (parsed from the `Released on: YYYY-MM-DD` description line) that the YTM
song endpoint does not expose.

Artist names pass through `cleanArtistName` (`src/utils.ts`), which strips the
auto-generated ` - Topic` suffix so resolved artist entities match YTM's display names.

Album track lists returned by `music.getAlbum` are official-video (OMV) uploads — YouTube
titles with no album association. `resolveAlbumTracks` (`src/cache/ytmusic-cache.ts`)
extracts the `OLAK5uy_…` audio playlist id from `album.url` and re-fetches the album as a
YTM playlist, yielding the canonical "song" (ATV) tracks with clean titles, album and
artist metadata; sequential `track_number`s are assigned when the playlist omits them.

Title nuance: a track's watch-page title depends on the **video ID**, not the client. The
canonical YTM video ID (what search returns) yields a clean title + album on the upnext
panel; an "Official Video" upload ID — the one YTM's own album/playlist track lists
reference — yields the YouTube video title (e.g. "…(Official Video)") and no album. Both
IDs are genuinely different uploads. So a track reached via an album listing can carry a
different title than the same track reached via search. `test/metadata.test.ts` asserts the
search → `getTrack` path returns the clean YTM title.

## Logging

youtubei.js writes parser warnings straight to `console.warn`, which floods the server
log with harmless parser-mismatch noise. `captureYouTubeiLogs` (`src/youtubei-log.ts`,
called from `enable()`) patches `console.warn/error/info/debug` to intercept messages
prefixed with `[YOUTUBEJS]` and re-emit them through the plugin logger:

- `[YOUTUBEJS][Parser]` warnings → `logger.debug` (quiet unless debug logging is on)
- other youtubei.js warnings → `logger.warn`
- youtubei.js errors → `logger.error`

Non-youtubei.js console output passes through untouched. `Log.setLevel(ERROR, WARNING)`
keeps both severities flowing to the bridge. `releaseYouTubeiLogs()` (called from
`disable()`) restores the original console methods. The bridge is a singleton — only this
plugin uses youtubei.js, so there is no contention.

## Where to look

- Registration order / wiring: `src/main.ts:21`
- Format selection: `src/yt-music.library-handler.ts:333`
- Thumbnail round-trip: `src/utils.ts:24` (serialize), `src/utils.ts:59` (deserialize)
- `getChannelMetadata` bypasses the cache and hits Innertube every call (side-stamps
  `channel-handle:`/`channel-type:`): `src/cache/ytmusic-cache.ts:305`
