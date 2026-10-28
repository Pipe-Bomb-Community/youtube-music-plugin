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
  agent, `Accept-Encoding: identity` so byte ranges aren't transparently compressed).
  Previously this re-spawned yt-dlp (`-f <id> -o -`), which re-ran extraction and added ~3s
  before the first audio byte.
- `getPart`: direct HTTP range request to `format.url` with `format.http_headers`
  (axios, keep-alive agent, 15 s timeout, `Accept-Encoding: identity`). On a 403/410/404
  (expired googlevideo URL) it deletes the cached format, re-resolves once via yt-dlp, and
  retries. Response streams are wrapped with an inactivity guard so a stalled body always
  terminates instead of leaving `finished()` pending server-side.
- **Signature-challenge fallback**: if the direct HTTP fetch is refused (403) or fails even
  after re-resolving, `getStream`/`getPart` fall back to `yt-dlp -f <id> -o -`. High-quality
  audio formats are served from googlevideo URLs that carry an `n=` (nsig) parameter which
  YouTube's player JS must transform; a plain HTTP client can't do that transform (or the
  required throttle), so the request returns 403. yt-dlp's own downloader solves the
  challenge, so the fallback succeeds. This is slower (subprocess + possible throttle) but
  only kicks in when the fast path fails.
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
(`yt-dlp -U`, registered in `src/main.ts:69`). Downloads have a 30 s inactivity timeout,
a 10 min total timeout, and a redirect cap; `yt-dlp -U` is capped at 2 min.

## Concurrency

`createDlpSession` (`src/yt-music.library-handler.ts`) caps concurrent yt-dlp invocations
at the `concurrent-producers` config value (clamped to at least 1). It gates format
resolution (`--dump-json`) and the signature-challenge fallback (`-f <id> -o -`); the
direct-HTTP `getStream`/`getPart` fast path is not gated. A session frees when the yt-dlp
process closes.

The signature-challenge fallback has a 60 s inactivity watchdog and a 30 min total cap;
on either, yt-dlp is killed and the returned stream is closed so the caller never waits
forever. A queued session acquisition also fails after 2 min rather than waiting
indefinitely.

## Config options

| Key | Maps to | Notes |
| --- | ------- | ----- |
| `extractor-args` | repeated `--extractor-args` | Space-split. For bot protection, e.g. `youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416` (bgutil-ytdlp-pot-provider). |
| `plugin-dirs` | `--plugin-dirs` + `PYTHONPATH` | Colon-separated. `PYTHONPATH` is set manually because Nix-installed yt-dlp ignores `--plugin-dirs` under `PYTHONNOUSERSITE=true` (`src/yt-music.library-handler.ts:54`). |
| `concurrent-producers` | — | Max parallel yt-dlp sessions (constructor default 1, config default 3). |
| `cookies-browser` | `--cookies-from-browser` | Authentication. |
| `cookies-file` | `--cookies` | Authentication. |
