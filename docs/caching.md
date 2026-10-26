# Caching

Read when touching `src/cache/`, adding cached data, or adding thumbnail attributes.

Store: keyv + `@keyv/sqlite` → `<cacheDir>/cache.sqlite`. The cache dir is provided by
the Pipe Bomb server via `api.requestCacheDirectory()` (`src/main.ts:31`). Innertube has
its own `UniversalCache` under `<cacheDir>/innertube`.

## Key names and TTLs

From `src/cache/ytmusic-cache.ts`:

| Key | Data | TTL |
| --- | ---- | --- |
| `song-upnext:<videoId>` | track (with `views`, `description`, `release_date`) + albumId | 30 days |
| `audio-format:<videoId>` | resolved audio format (`format` + `duration`) for playback | 30 min |
| `lyrics:<videoId>` | plain-text lyrics, or `""` when none | 90 days |
| `album:<albumId>` | album metadata (artists, attributes incl. `release_date`) | 30 days |
| `album-tracks:<albumId>` | album track list | 7 days |
| `playlist:VL<id>` | playlist-as-album metadata | 1 hour |
| `playlist-tracks:VL<id>` | playlist track list | 1 day |
| `channel-handle:<channelId>` | `@handle` or `""` | default (90 days) |
| `channel-type:<channelId>` | `"artist" \| "user"` | 30 days |
| `handle-channel:<handle>` | handle → channel ID | 30 days |
| `channel-content:<channelId>` | artist/user content (tracks, albums) | 1 day |

- Track metadata is YTM-native (`music.getUpNext`) for title/album/artists, then
  augmented with one WEB `getBasicInfo(videoId)` call for `views`, `description` and a
  `release_date` (preferring the `Released on: YYYY-MM-DD` description line, else the
  player microformat's `publish_date`/`upload_date`).
  (`getBasicInfo` is used instead of `getInfo` because it skips the watch-next payload
  that makes youtubei.js log parser mismatches.)
- `audio-format:<videoId>` stores the selected yt-dlp format (direct `url`, `http_headers`,
  `filesize`) plus the video `duration`, so repeat plays skip the yt-dlp `--dump-json`
  subprocess. TTL is 30 min (googlevideo URLs are short-lived); `getPart` self-heals by
  deleting the entry and re-resolving when the URL returns 403/410/404. The entry is also
  dropped whenever `getStream`/`getPart` surface an expired URL.
- Album `release_date` is derived from its tracks: each track's own date is resolved
  (description `Released on:`, else player-microformat upload date) and cached under
  `track-date:<videoId>`; the album date is the **most common** track date, so a single
  released years before the album does not drag the album date backwards. Each track is
  stamped with its own date (tracks with none fall back to the album date). Up to
  `RELEASE_DATE_SAMPLE` (30) tracks are sampled, `RELEASE_DATE_CONCURRENCY` (5) at a time.
- `getLyrics` caches negative results as `""` so a track without lyrics is only fetched
  once.

- Playlist IDs are stored with a `VL` prefix; `getPlaylistMetadata` adds it if missing
  (`src/cache/ytmusic-cache.ts:154`).
- `getOrFind` (`src/cache/persistent-cache.ts:31`) deserializes thumbnails on read.
- Reads are self-healing: `deserializeAllThumbnails` reports any buffer attribute stored
  without a callable `buffer` (e.g. a stale entry written before the serialization fix),
  and `PersistentCache.get` evicts that entry so `getOrFind` refetches it.
- `getChannelMetadata` deliberately bypasses the cache — every call hits Innertube and
  side-stamps `channel-handle:`/`channel-type:` (`src/cache/ytmusic-cache.ts:305`).

## Thumbnails

`BufferAttributeValue` wraps an async fetch function, which can't be stored in SQLite.
So thumbnails are persisted as `serialized-thumbnails` marker objects holding the URL
list (largest first) and lazily re-fetched on read. See
`docs/adr/002-serialized-thumbnails.md`.

- Write path: `serializeThumbnailAttribute` (`src/utils.ts:24`).
- Read path: `deserializeAllThumbnails` (`src/utils.ts:59`), called by
  `PersistentCache.get` and at each resolve/search boundary.
- Any new code that caches thumbnail attributes must go through the serializer, and any
  cached object returned to the SDK must pass through deserialization first.
