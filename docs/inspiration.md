# Inspiration — open-source YouTube Music projects

Survey of open-source, actively maintained projects that consume YouTube Music metadata
and/or audio (compiled 2026-09-29 via web search). These codebases are references for
edits to this plugin: when adding a feature, check how they solved the same problem.

## Libraries / APIs (metadata + stream URLs)

| Project | Stack | Look at it for… |
| ------- | ----- | --------------- |
| [youtubei.js](https://github.com/LuanRT/YouTube.js) (npm `@np-dev/youtubei-js`) | JS/TS | Our metadata backend; InnerTube API surface, context/session handling, error codes |
| [ytmusicapi](https://github.com/steeb/ytmusicapi) | Python | Most complete YTM metadata API: search facets, playlist/library/lyrics endpoints, auth modes (API key vs OAuth browser) |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Python | Our audio backend: extractor internals, format selection, `--extractor-args` POT plumbing |
| [ytmdl](https://github.com/hugovk/ytmdl) | JS (youtubei.js) | End-to-end metadata→audio pipeline on the same stack as this plugin |

## Self-hosted servers / music hubs

| Project | Stack | Look at it for… |
| ------- | ----- | --------------- |
| [Music Assistant](https://github.com/Music-Assistant/Music-Assistant) | Python | The closest analog to "YTM as an ephemeral source": official YouTube Music provider using yt-dlp + PO Token Server. Best reference for POT/auth handling and provider lifecycle |
| [Navidrome](https://github.com/navidrome/navidrome) + community YTM plugin / [navidrome_music_downloader](https://github.com/H0ag/navidrome_music_downloader) | Go / Pascal | Rip-and-store vs stream trade-offs; how a foreign source is mapped onto a local library model (our identity-graph problem) |

## Desktop / web YTM clients (metadata + audio via InnerTube)

| Project | Look at it for… |
| ------- | --------------- |
| [YTubic](https://github.com/NUber-dev/YTubic) (new, 2026) | Talking to InnerTube directly — fresh context on current API shape |
| [MusicBox](https://github.com/musicbox-community/MusicBox) (youtubei.js) | Same metadata lib as us: session persistence, watch/queue behavior |
| [Muffon](https://github.com/staniel359/muffon) | Cross-platform streaming UX, gapless-handling approaches |
| [Nuclear](https://github.com/nukeop/nuclear) | Multi-source (incl. YTM) provider abstraction |
| [yewtube](https://github.com/mps-youtube/yewtube) | Web client; lightweight metadata rendering |
| [Orchard](https://github.com/SFG5453/Orchard) | Power-user playback features |
| [Limusic](https://github.com/simohypers/Limusic) | Minimal desktop YTM player |

## Android YTM clients

| Project | Look at it for… |
| ------- | --------------- |
| [Metrolist](https://github.com/MetrolistGroup/Metrolist) | Most popular/active; own YTM API client — auth, POT, library sync |
| [Flow](https://github.com/A-EDev/Flow) | New; hits InnerTube directly |
| [AuraMusic](https://github.com/TeamAuraMusic/AuraMusic) | Android YTM UX |
| [Meld](https://github.com/FrancescoGrazioso/Meld) | YTM + Spotify cross-service identity matching (relevant to our identity graph) |
| [NewPipe](https://github.com/TeamNewPipe/NewPipe) | Music mode; robust extractor/streaming code |

## Spotify-UI-over-YouTube-audio (via YTM/Invidious/Piped)

- [Spotube](https://github.com/KRTirtho/Spotube) — Android/iOS/desktop; mapping Spotify metadata onto YTM audio
- [Musify](https://github.com/gokadzev/Musify) — Android, same pattern
- [Pano](https://panoapp.com/) — Spotify-like, YouTube backend

## Patterns that validate this plugin's design

1. **youtubei.js for metadata + yt-dlp for audio** is the dominant architecture
   (MusicBox, ytmdl, Music Assistant). Keep the split.
2. **PO Token handling** — Music Assistant's provider is the primary reference for
   the auth/POT plumbing our yt-dlp shell-out depends on.
3. **Cross-service identity matching** (Meld, Navidrome YTM plugin, Spotube) is the
   reference for how external track identity maps onto a canonical library model.
