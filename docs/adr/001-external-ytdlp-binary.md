# 001. External yt-dlp binary for audio

Status: accepted

Context: Downloading audio requires working YouTube extraction, and YouTube changes its
front-end frequently.

Decision: Shell out to the `yt-dlp` binary instead of implementing extraction in JS —
yt-dlp has a much larger maintenance team and tracks YouTube changes faster (README).
The binary is located in PATH or auto-downloaded to the plugin cache dir
(`src/ytdlp.ts`).

Consequences: host needs a binary or network access to GitHub for first run; the plugin
does not need a re-release when YouTube extraction breaks; the `update-yt-dlp` task
keeps managed binaries current.
