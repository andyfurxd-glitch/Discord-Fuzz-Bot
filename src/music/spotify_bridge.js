const axios = require("axios");
const cheerio = require("cheerio");

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Bootstrap an anonymous session token from Spotify's web player embed
 * @returns {Promise<string>}
 */
async function getAnonymousToken() {
    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt - 60000) {
        return cachedToken;
    }

    const res = await axios.get("https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC", {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: 10000
    });

    const $ = cheerio.load(res.data);
    const nextData = $('script#__NEXT_DATA__').html();
    if (!nextData) {
        throw new Error("Could not load Spotify embed session");
    }

    const json = JSON.parse(nextData);
    const session =
        json.props?.pageProps?.state?.settings?.session ||
        json.props?.pageProps?.state?.data?.session ||
        json.props?.pageProps?.session;

    const token = session?.accessToken || nextData.match(/"accessToken":"([^"]+)"/)?.[1];
    const expires = session?.accessTokenExpirationTimestampMs || (Date.now() + 3600000);

    if (!token) {
        throw new Error("Failed to extract Spotify session token");
    }

    cachedToken = token;
    tokenExpiresAt = expires;
    return cachedToken;
}

/**
 * Parse entity type and id from URL or URI
 * @param {string} urlOrUri 
 */
function parseSpotifyUrl(urlOrUri) {
    const clean = urlOrUri.trim();
    if (clean.startsWith("spotify:")) {
        const parts = clean.split(":");
        if (parts.length >= 3) {
            return { type: parts[1], id: parts[2] };
        }
    }

    const match = clean.match(/open\.spotify\.com\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/);
    if (match) {
        return { type: match[1], id: match[2] };
    }

    return { type: null, id: null };
}

/**
 * Extract normalized track information
 * @param {object} item 
 */
function extractTrack(item) {
    if (!item) return null;
    const data = item.itemV2?.data || item.data || item.track || item;
    const title = data.name || data.title || "";
    if (!title) return null;

    const artists = [];
    const items = data.artists?.items || data.artists || [];
    if (Array.isArray(items)) {
        for (const a of items) {
            const name = a?.profile?.name || a?.name;
            if (name) artists.push(name);
        }
    } else if (typeof items === "string") {
        artists.push(items);
    }

    const duration_ms =
        data.trackDuration?.totalMilliseconds ||
        data.duration?.totalMilliseconds ||
        data.duration_ms ||
        item.duration_ms ||
        item.duration ||
        0;

    return {
        title: title.trim(),
        artist: artists.length > 0 ? artists.join(", ") : "Unknown Artist",
        duration_ms
    };
}

/**
 * Paginate and fetch all tracks for a playlist via Spotify Pathfinder GraphQL
 * @param {string} playlistId 
 */
async function fetchPlaylistAll(playlistId) {
    let token = await getAnonymousToken();
    let offset = 0;
    const allTracks = [];
    let playlistName = "Spotify Playlist";

    while (true) {
        const params = {
            operationName: "fetchPlaylist",
            variables: JSON.stringify({
                uri: `spotify:playlist:${playlistId}`,
                offset: offset,
                limit: 100,
                enableWatchFeedEntrypoint: false
            }),
            extensions: JSON.stringify({
                persistedQuery: {
                    version: 1,
                    sha256Hash: "a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4"
                }
            })
        };

        let res;
        try {
            res = await axios.get("https://api-partner.spotify.com/pathfinder/v1/query", {
                params,
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "app-platform": "WebPlayer",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                },
                timeout: 15000
            });
        } catch (err) {
            // If token expired, refresh once and retry
            if (err.response?.status === 401) {
                cachedToken = null;
                token = await getAnonymousToken();
                res = await axios.get("https://api-partner.spotify.com/pathfinder/v1/query", {
                    params,
                    headers: {
                        "Authorization": `Bearer ${token}`,
                        "app-platform": "WebPlayer",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    },
                    timeout: 15000
                });
            } else {
                break;
            }
        }

        const union = res?.data?.data?.playlistV2;
        if (!union) break;

        if (offset === 0 && union.name) {
            playlistName = union.name;
        }

        const content = union.content;
        const totalCount = content?.totalCount || 0;
        const items = content?.items || [];

        if (!items.length) break;

        for (const item of items) {
            const t = extractTrack(item);
            if (t) allTracks.push(t);
        }

        offset += items.length;

        if (totalCount && offset >= totalCount) {
            break;
        }
    }

    if (allTracks.length > 0) {
        return { name: playlistName, tracks: allTracks };
    }

    // Fallback to embed if Pathfinder failed
    return await fetchFromEmbed("playlist", playlistId);
}

/**
 * Extract track or album from Spotify public embed page
 * @param {string} type 
 * @param {string} id 
 */
async function fetchFromEmbed(type, id) {
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
    const res = await axios.get(embedUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: 10000
    });

    const $ = cheerio.load(res.data);
    const nextData = $('script#__NEXT_DATA__').html();
    if (!nextData) throw new Error("Could not find Spotify page data");

    const json = JSON.parse(nextData);
    const entity = json.props?.pageProps?.state?.data?.entity;
    if (!entity) throw new Error("Spotify entity not found");

    if (type === "track") {
        const title = entity.title || entity.name || "";
        const artist = entity.subtitle || (Array.isArray(entity.artists) ? entity.artists.map(a => a.name).join(", ") : "");
        return {
            name: title,
            tracks: [{
                title: title.trim(),
                artist: (artist || "").trim(),
                duration_ms: entity.duration || 0
            }]
        };
    }

    const tracks = [];
    for (const item of (entity.trackList || [])) {
        const title = item.title || item.name || "";
        const artist = item.subtitle || (Array.isArray(item.artists) ? item.artists.map(a => a.name).join(", ") : "") || entity.subtitle || "";
        if (title) {
            tracks.push({
                title: title.trim(),
                artist: (artist || "").trim(),
                duration_ms: item.duration || 0
            });
        }
    }

    return {
        name: entity.title || entity.name || "Spotify Collection",
        tracks
    };
}

/**
 * Main fetch function in pure JavaScript
 * @param {string} url - Spotify URL or URI
 * @returns {Promise<{ name?: string, tracks: Array<{ title: string, artist: string, duration_ms: number }> }>}
 */
async function fetchSpotifyData(url) {
    if (!url || typeof url !== "string") {
        throw new Error("Invalid Spotify URL provided");
    }

    const { type, id } = parseSpotifyUrl(url);

    if (type === "playlist") {
        return await fetchPlaylistAll(id);
    }

    if (type === "track") {
        return await fetchFromEmbed("track", id);
    }

    if (type === "album") {
        return await fetchFromEmbed("album", id);
    }

    // Default fallback
    return await fetchFromEmbed("playlist", id || url);
}

async function getTrackData(url) {
    const res = await fetchSpotifyData(url);
    return res.tracks[0] || null;
}

async function getPlaylistData(url) {
    return await fetchSpotifyData(url);
}

module.exports = {
    fetch: fetchSpotifyData,
    fetchSpotifyData,
    getTrackData,
    getPlaylistData
};
