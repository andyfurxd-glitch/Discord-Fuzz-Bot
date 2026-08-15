import json
import sys

from spotify_scraper import SpotifyClient


def track_data(track):
    title = getattr(track, "name", "").strip()
    artists = [
        artist.name
        for artist in getattr(track, "artists", [])
        if getattr(artist, "name", "")
    ]
    if not title or not artists:
        return None

    duration_ms = getattr(track, "duration_ms", 0) or getattr(track, "durationMs", 0) or 0

    return {
        "title": title,
        "artist": ", ".join(artists),
        "duration_ms": duration_ms,
    }


def fetch(url):
    with SpotifyClient() as client:
        if "/track/" in url:
            track = track_data(client.get_track(url))
            return {"tracks": [track] if track else []}

        if "/playlist/" in url:
            playlist = client.get_playlist(url, max_tracks=None)
            tracks = []
            for item in playlist.tracks:
                track = track_data(getattr(item, "track", item))
                if track:
                    tracks.append(track)
            return {"name": getattr(playlist, "name", "Spotify playlist"), "tracks": tracks}

    raise ValueError("Only Spotify track and playlist links are supported")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: spotify_bridge.py <Spotify URL>"}))
        sys.exit(2)

    try:
        print(json.dumps(fetch(sys.argv[1]), ensure_ascii=True))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
