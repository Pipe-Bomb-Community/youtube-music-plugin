# 002. Store thumbnails as URL lists

Status: accepted

Context: Pipe Bomb `BufferAttributeValue` values wrap an async fetch function;
functions cannot be persisted in SQLite.

Decision: Persist thumbnails as a `serialized-thumbnails` marker object holding the URL
list (largest first), and lazily re-fetch the first working URL when the value is
deserialized (`src/utils.ts:24`, `src/utils.ts:40`).

Consequences: cover art is re-downloaded on each use instead of cached as bytes; the
fetch has a built-in fallback chain (try the next smaller URL on failure); every code
path that reads cached metadata must run `deserializeAllThumbnails` before returning it
to the SDK.
