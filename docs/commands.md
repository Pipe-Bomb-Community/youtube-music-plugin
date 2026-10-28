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
| Format-selection unit test (deterministic, no network) | `npm run test:unit` |
| Stream-guard unit test (deterministic, no network) | `npm run test:guards` |
| Format-shape invariant test (live, guards against YouTube changes) | `npm run test:invariants <videoId>` |
| Audio timing benchmark | `npm run bench:audio <videoId>` |
| Dev shell (bleeding-edge yt-dlp master + ffmpeg) | `nix develop` |

## Testing

Integration scripts (run via `tsx`) hit the **live** YouTube Music API; the
unit test is deterministic and network-free:

- `test/format-selection.test.ts` (`npm run test:unit`) — pure unit test of
  `selectBestAudioFormat` against synthetic fixtures (opus vs mp4a, abr/asr
  ordering, m3u8/DRM/video exclusion, missing-URL handling).
- `test/hang-guards.test.ts` (`npm run test:guards`) — pure unit test asserting
  stalled/erroring streams terminate and consumer aborts destroy their source.
- `test/format-invariants.test.ts` (`npm run test:invariants`) — runs `yt-dlp
  --dump-json` on a real video and asserts the fields the producer depends on
  (`acodec`/`vcodec`/`protocol`/`ext`/`http_headers`/`filesize`/`duration`) are
  still present and that the selected format streams. This is the primary guard
  against YouTube changing its format/URL/header shape.
- `test/metadata.test.ts` (`npm run test:metadata`) — searches, then resolves a track,
  album, artist, and playlist through `YTMusicCache`, asserting the metadata is
  YTM-derived and complete (clean track title matching the YTM search title, album
  artists, album `year`, artist name, playlist tracks). Exits non-zero on any failure.
- `test/audio.test.ts` (`npm run test:audio <videoId>`) — exercises the full audio
  pipeline: `getPart` (first + middle byte ranges), `getStream` (direct HTTP),
  `getDuration`, format caching, and the expired-URL self-heal path (a corrupted
  `sig` forces a 403 → re-resolve → retry). Exits non-zero on any failure.
- `test/audio-bench.ts` (`npm run bench:audio <videoId>`) — reports cold/warm
  `getAudioProducer` and `getPart`/`getStream` latency for time-to-audio tuning.

`test/audio.test.ts` hardcodes no POT config (it runs clean); `test/audio.test.ts`'s
old POT/plugin-dir defaults were removed. If you run on a network that requires bot
protection, set the `extractor-args` config in the test to point at a local POT
provider. `test/metadata.test.ts` needs no POT provider (metadata only).

## Gotchas

- No linter/formatter is configured; `tsc` strict mode is the gate — `npm run build`
  doubles as the typecheck.
- `dist/` is gitignored but is what the Pipe Bomb server actually loads; it must be
  built on the machine that runs the server.
- `tsc` also compiles `test/` into `dist/test/` (tsconfig `include` covers both).
- `nix develop` builds yt-dlp from `master` source on first run; slow but gives the
  newest extractor.
