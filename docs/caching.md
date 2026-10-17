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
  `release_date` parsed from the `Released on: YYYY-MM-DD` description line.
  (`getBasicInfo` is used instead of `getInfo` because it skips the watch-next payload
  that makes youtubei.js log parser mismatches.)
- Album `release_date` is derived from the album's tracks: the earliest cached track
  date, falling back to a single `getInfo` on the first track.
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
