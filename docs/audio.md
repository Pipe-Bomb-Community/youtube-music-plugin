# Audio production

Read when touching `src/yt-music.library-handler.ts`, `src/ytdlp.ts`, or the config
options in `src/yt-music.settings.ts`.

Pipeline: `getAudioProducer` → yt-dlp `--dump-json --format bestaudio` → format
selection → `createStreamAudioProducer`. The README notes the producer is "somewhat
crude" — PRs improving it are welcome.

## Format selection

`src/yt-music.library-handler.ts:333`. Filters out formats with video, missing audio
codec, `m3u8` protocol, or DRM. Sorts by: `abr` desc → `asr` desc → codec score
(opus > mp4a > other). Picks the first format with a direct `url` (no manifest).

## Producer

- `getStream`: direct HTTP GET to `format.url` with `format.http_headers` (axios, keep-alive
  agent). Previously this re-spawned yt-dlp (`-f <id> -o -`), which re-ran extraction and
  added ~3s before the first audio byte.
- `getPart`: direct HTTP range request to `format.url` with `format.http_headers`
  (axios, keep-alive agent, 15 s timeout). On a 403/410/404 (expired googlevideo URL) it
  deletes the cached format, re-resolves once via yt-dlp, and retries.
- `getDuration`: returns the `duration` from the yt-dlp JSON (memoized); the ffprobe probe
  is only a fallback for the rare case where yt-dlp reports no duration.
- `cacheable: true`, `type: "stream"`.

## Format resolution caching

`getAudioProducer` resolves the best format once and stores it in the plugin SQLite cache
(`audio-format:<videoId>`, 30 min TTL). Repeat plays skip the yt-dlp `--dump-json`
subprocess entirely. See `docs/caching.md`.

`prewarmFormats` (`src/yt-music.library-handler.ts`) resolves formats in the background
(bounded by `concurrent-producers`); the ephemeral source calls it for the top tracks of
search/album/artist results so the cache is warm before the user presses play.

## Binary resolution

`src/ytdlp.ts`: PATH first; otherwise download the latest GitHub release into the cache
dir and chmod 755 (managed). Only managed binaries get the `update-yt-dlp` task
(`yt-dlp -U`, registered in `src/main.ts:69`).

## Concurrency

`createDlpSession` (`src/yt-music.library-handler.ts`) caps concurrent yt-dlp invocations
at the `concurrent-producers` config value. It only gates format resolution
(`--dump-json`); `getStream`/`getPart` are plain HTTP and are not gated. A session frees
when the yt-dlp process closes.

## Config options

| Key | Maps to | Notes |
| --- | ------- | ----- |
| `extractor-args` | repeated `--extractor-args` | Space-split. For bot protection, e.g. `youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416` (bgutil-ytdlp-pot-provider). |
| `plugin-dirs` | `--plugin-dirs` + `PYTHONPATH` | Colon-separated. `PYTHONPATH` is set manually because Nix-installed yt-dlp ignores `--plugin-dirs` under `PYTHONNOUSERSITE=true` (`src/yt-music.library-handler.ts:54`). |
| `concurrent-producers` | — | Max parallel yt-dlp sessions (constructor default 1, config default 3). |
| `cookies-browser` | `--cookies-from-browser` | Authentication. |
| `cookies-file` | `--cookies` | Authentication. |
