# FuzzBot

A furry-themed Discord music bot for cozy queueing, YouTube playback, and public Spotify link lookups.

## What it does

- `/play` — search for a song or play a YouTube URL
- `/play` with a public Spotify track/playlist link — resolve metadata and match to a YouTube source
- `/join` — join your voice channel
- `/queue` — view the current queue
- `/skip` — skip the current track
- `/stop` — stop playback and leave the voice channel
- `/ping` — check if the bot is awake
- `/help` — show the command list

## Requirements

Install the Node dependencies:

```bash
npm install
```

Make sure these are available on your system:

- `ffmpeg` on your PATH
- `yt-dlp` on your PATH
- `python` on your PATH
- `spotify_scraper` available in the Python environment used by the Spotify bridge

## Environment

Create a `.env` file with the Discord values only:

```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
```

Optional dev-only override for local testing:

```env
USE_GUILD_COMMANDS=true
GUILD_ID=your_discord_server_id
```

Do not set `GUILD_ID` in production if you want the bot to appear in all servers.
No Spotify app credentials are required for the current public-link workflow.
The bot uses the Python Spotify bridge to read public Spotify metadata and then
resolves the result to YouTube audio.

## Run it

```bash
npm start
```

## Notes

- This bot is intentionally lightweight and avoids the old Spotify Web API client setup.
- If a Spotify song cannot be scraped or matched, the simplest fallback is to search the track title directly with `/play`.
- Generated Python cache folders like `__pycache__` are not required and should be ignored or removed.
