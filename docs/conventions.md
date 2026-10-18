# Conventions

What to imitate when adding code.

- **ESM only** (`"type": "module"`, NodeNext): relative imports must include the `.js`
  extension, even when editing a `.ts` file.
- **File names**: `src/<area>.<role>.ts` (e.g. `yt-music.ephemeral-source.ts`);
  identifiers in `src/identity/<identity>.<target>-identifier.ts`.
- **New SDK component pattern**: class implements the SDK interface, is constructed and
  registered in `src/main.ts` `enable()`. The registration order in `main.ts` is the
  wiring source of truth — read it before adding a component.
- **IDs**: `pluginId` is the literal `"youtube-music"` (hyphen); identity IDs are
  snake_case (`youtube_music_track_id`).
- **New attribute**: register it in `src/yt-music.attribute-source.ts` `enable()` and add
  a row to the matching table in `README.md`. Reuse cross-plugin key names (`artist`,
  `album`, `genre`, `release_type`) so values merge with other sources.
- **Artist names**: always pass raw channel/artist names through `cleanArtistName`
  (`src/utils.ts`) before emitting them, to strip the ` - Topic` suffix.
- **New identity**: new class in `src/identity/`, register in `main.ts`, and update the
  identity tables in `README.md`.
- **Identifier classes**: hard deps via `getDependencies()`, optional ones via
  `getSoftDependencies()`; `identify()` returns `string[] | null` where `null` means
  "not applicable for this entity".
- **Errors**: plain `Error` with a descriptive message; wrap third-party errors at the
  boundary (see `getPart` in `src/yt-music.library-handler.ts:240`). No custom error
  classes.
- **Logging**: a plugin logger exists (`getLogger`, `src/main.ts:85`) but most runtime
  logging in the library handler is `console.log` — match the surrounding code.
- **Strict TS**: `noUncheckedIndexedAccess` is on; guard array index access.
