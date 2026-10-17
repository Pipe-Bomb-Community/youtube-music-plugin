# Commands

Prereqs: Node 24 (volta pin in `package.json`), `yt-dlp` in PATH (or auto-downloaded by
the plugin), `ffmpeg` (for `ffprobe` duration probing).

| Action | Command |
| ------ | ------- |
| Install | `npm ci` |
| Build (server runs `dist/`, always rebuild after `src/` edits) | `npm run build` |
| Watch + rebuild | `npm run dev` |
| Live metadata test | `npm run test:metadata` |
| Manual audio test | `npm run test:audio <videoId>` |
| Dev shell (bleeding-edge yt-dlp master + ffmpeg) | `nix develop` |

## Testing

There is no unit suite. Two integration scripts (run via `tsx`) hit the **live**
YouTube Music API and stream real audio:

- `test/metadata.test.ts` (`npm run test:metadata`) — searches, then resolves a track,
  album, artist, and playlist through `YTMusicCache`, asserting the metadata is
  YTM-derived and complete (clean track title matching the YTM search title, album
  artists, album `year`, artist name, playlist tracks). Exits non-zero on any failure.
- `test/audio.test.ts` (`npm run test:audio <videoId>`) — fetches the track's formats
  via yt-dlp, then verifies `getPart` (first + middle byte ranges) and `getStream`
  (the yt-dlp pipe used for playback).

`test/audio.test.ts` hardcodes config at `test/audio.test.ts:76`: extractor args pointing
at a local POT provider (`http://127.0.0.1:4416`) and a machine-specific `plugin-dirs`
path. Start the POT provider and adjust those before running on another machine.
`test/metadata.test.ts` needs no POT provider (metadata only).

## Gotchas

- No linter/formatter is configured; `tsc` strict mode is the gate — `npm run build`
  doubles as the typecheck.
- `dist/` is gitignored but is what the Pipe Bomb server actually loads; it must be
  built on the machine that runs the server.
- `tsc` also compiles `test/` into `dist/test/` (tsconfig `include` covers both).
- `nix develop` builds yt-dlp from `master` source on first run; slow but gives the
  newest extractor.
