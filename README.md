<h1>
    <img src="https://raw.githubusercontent.com/Pipe-Bomb/.github/refs/heads/master/assets/logos/Pipe%20Bomb%20no%20background%20w%20outline.png" width="40" />
    YouTube Music Plugin
</h1>

Gives access to the entire YouTube Music library via an Ephemeral Source. Also generates identities and attributes for tracks, albums and artists.

**Requires the `yt-dlp` binary to be added to PATH.** This plugin uses an external binary for downloading content from YouTube because YT-DLP has a much larger team behind it and the YouTube API changes frequently.

## Installation

Clone the repo into your [Pipe Bomb server's](https://github.com/pipe-bomb/server) `plugins` directory. Then inside, run:

```bash
npm ci
npm run build
```

## Identities

### Track

| Identity                 | Dependencies                 | Link   | Description                                        |
| :----------------------- | ---------------------------- | ------ | -------------------------------------------------- |
| `youtube_music_track_id` |                              |        | The Video ID of the track.                         |
| `youtube_channel_id`     | `soundcloud_track_id` (hard) | Artist | The YouTube channel IDs associated with the track. |

### Artist

| Identity         | Dependencies                | Description                                                                        |
| :--------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| `youtube_handle` | `youtube_channel_id` (soft) | The (slug) for the channel, if it exists. Used to construct URLs to channel pages. |

## Attributes

### Track

| Attribute  | Type             | Multiple | Description                           |
| :--------- | ---------------- | -------- | ------------------------------------- |
| `title`    | `string`         | ❌       | The title of the track.               |
| `duration` | `decimal`        | ❌       | The duration of the track in seconds. |
| `front`    | `buffer` (image) | ❌       | The cover art of the track.           |
| `year`     | `integer`        | ❌       | The year that the track was released. |

### Artist

| Attribute    | Type             | Multiple | Description                                     |
| :----------- | ---------------- | -------- | ----------------------------------------------- |
| `name`       | `string`         | ❌       | The name of the artist.                         |
| `thumb`      | `buffer` (image) | ❌       | The profile picture of the channel.             |
| `background` | `buffer` (image) | ❌       | The background banner of the channel's profile. |

### Album

| Attribute | Type             | Multiple | Description                           |
| :-------- | ---------------- | -------- | ------------------------------------- |
| `title`   | `string`         | ❌       | The title of the album.               |
| `front`   | `buffer` (image) | ❌       | The cover art of the album.           |
| `year`    | `integer`        | ❌       | The year that the album was released. |

## Contributing

Contributions are welcome. The audio producer for this plugin is somewhat crude and inefficient. If you have ideas for how to speed it up, please PR!
