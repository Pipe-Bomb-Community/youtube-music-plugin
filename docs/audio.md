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

- `getStream`: yt-dlp `-f <format_id> -o - --http-chunk-size 10M --downloader native
  --no-update`. Note: unlike `getAudioProducer`, it does **not** pass cookies or
  plugin-dir args.
- `getPart`: direct HTTP range request to `format.url` with `format.http_headers`
  (axios, 15 s timeout).
- `getDuration`: `ffprobe` on `format.url` (15 s timeout, result memoized).
- `cacheable: true`, `type: "stream"`.

## Binary resolution

`src/ytdlp.ts`: PATH first; otherwise download the latest GitHub release into the cache
dir and chmod 755 (managed). Only managed binaries get the `update-yt-dlp` task
(`yt-dlp -U`, registered in `src/main.ts:69`).

## Concurrency

`createDlpSession` (`src/yt-music.library-handler.ts:69`) caps concurrent yt-dlp
invocations at the `concurrent-producers` config value. A session frees when the first
stream chunk arrives (or the process closes) plus a 1 s grace period.

## Config options

| Key | Maps to | Notes |
| --- | ------- | ----- |
| `extractor-args` | repeated `--extractor-args` | Space-split. For bot protection, e.g. `youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416` (bgutil-ytdlp-pot-provider). |
| `plugin-dirs` | `--plugin-dirs` + `PYTHONPATH` | Colon-separated. `PYTHONPATH` is set manually because Nix-installed yt-dlp ignores `--plugin-dirs` under `PYTHONNOUSERSITE=true` (`src/yt-music.library-handler.ts:54`). |
| `concurrent-producers` | — | Max parallel yt-dlp sessions (constructor default 1, config default 3). |
| `cookies-browser` | `--cookies-from-browser` | Authentication. |
| `cookies-file` | `--cookies` | Authentication. |
