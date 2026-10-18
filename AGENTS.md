# YouTube Music Plugin — agent guide

Pipe Bomb server plugin exposing YouTube Music as an Ephemeral Source. Metadata (tracks,
artists, albums, playlists) comes from `youtubei.js` (Innertube); audio is fetched by
shelling out to an external `yt-dlp` binary. TypeScript, ESM, Node 24.

The server loads the **built** output (`pipebombEntry` → `dist/src/main.js`).
Run `npm run build` after any `src/` change or the server keeps running stale code.

| You are working on… | Read |
| ------------------- | ---- |
| System layout, component wiring, identity graph | `./docs/architecture.md` |
| Build, dev watch, audio test, nix dev shell | `./docs/commands.md` |
| Code style, file naming, SDK registration patterns | `./docs/conventions.md` |
| SQLite cache, key names, TTLs, thumbnail storage | `./docs/caching.md` |
| Audio pipeline (yt-dlp, format selection, streaming, POT args) | `./docs/audio.md` |
| Why an external yt-dlp binary for audio | `./docs/adr/001-external-ytdlp-binary.md` |
| Why thumbnails are stored as URL lists | `./docs/adr/002-serialized-thumbnails.md` |
| External projects to use as inspiration for edits | `./docs/inspiration.md` |

Always:

- ESM only — relative imports must end in `.js` (tsconfig `module: NodeNext`).
- `pluginId` is the literal `"youtube-music"` (hyphen); identity IDs are snake_case
  (`youtube_music_track_id`). Never mix the styles.
- `youtube_music_track_id` is the video ID. Playlists are surfaced as albums under
  `youtube_music_playlist_id`.
- New identities/attributes must keep the `README.md` tables in sync.
- Strict TypeScript incl. `noUncheckedIndexedAccess` — handle undefined index access.
