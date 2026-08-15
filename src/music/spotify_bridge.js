const axios = require("axios");
const cheerio = require("cheerio");

/**
 * Scrape Spotify track metadata from a public track URL
 * @param {string} url - Spotify track URL
 * @returns {object|null} Track data or null if invalid
 */
async function getTrackData(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        
        // Extract JSON-LD metadata from page
        const jsonLd = $('script[type="application/ld+json"]').html();
        if (!jsonLd) {
            return null;
        }

        const data = JSON.parse(jsonLd);
        
        const title = data.name || "";
        const artists = data.byArtist?.map(a => a.name).filter(Boolean) || [];
        const durationMs = parseDuration(data.duration) || 0;

        if (!title || artists.length === 0) {
            return null;
        }

        return {
            title: title.trim(),
            artist: artists.join(", "),
            duration_ms: durationMs
        };
    } catch (error) {
        console.error("Error fetching track data:", error.message);
        return null;
    }
}

/**
 * Convert ISO 8601 duration (PT5M30S) to milliseconds
 * @param {string} duration - ISO 8601 duration string
 * @returns {number} Duration in milliseconds
 */
function parseDuration(duration) {
    if (!duration || typeof duration !== "string") return 0;

    const regex = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
    const match = duration.match(regex);

    if (!match) return 0;

    const hours = parseInt(match[1] || 0, 10);
    const minutes = parseInt(match[2] || 0, 10);
    const seconds = parseInt(match[3] || 0, 10);

    return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Scrape Spotify playlist metadata
 * @param {string} url - Spotify playlist URL
 * @returns {object} Playlist data with tracks array
 */
async function getPlaylistData(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);
        
        // Extract playlist name
        const playlistName = $('h1, meta[property="og:title"]').first().attr("content") || "Spotify playlist";

        // Extract JSON-LD data which contains playlist items
        const jsonLd = $('script[type="application/ld+json"]').html();
        if (!jsonLd) {
            return { name: playlistName, tracks: [] };
        }

        const data = JSON.parse(jsonLd);
        
        // Handle different JSON-LD structures
        let tracks = [];
        
        if (data.tracks && Array.isArray(data.tracks)) {
            tracks = data.tracks;
        } else if (data.itemListElement && Array.isArray(data.itemListElement)) {
            tracks = data.itemListElement.map(item => item.item || item);
        }

        const result = {
            name: playlistName.trim(),
            tracks: []
        };

        for (const track of tracks) {
            if (track.name && track.byArtist) {
                const artists = Array.isArray(track.byArtist) 
                    ? track.byArtist.map(a => a.name || a).join(", ")
                    : track.byArtist.name || track.byArtist;

                const durationMs = parseDuration(track.duration) || 0;

                result.tracks.push({
                    title: track.name.trim(),
                    artist: artists.trim(),
                    duration_ms: durationMs
                });
            }
        }

        return result;
    } catch (error) {
        console.error("Error fetching playlist data:", error.message);
        return { name: "Spotify playlist", tracks: [] };
    }
}

/**
 * Main fetch function - handles both tracks and playlists
 * @param {string} url - Spotify URL
 * @returns {object} Track or playlist data
 */
async function fetch(url) {
    if (!url || typeof url !== "string") {
        throw new Error("Invalid Spotify URL provided");
    }

    if (url.includes("/track/")) {
        const track = await getTrackData(url);
        return { tracks: track ? [track] : [] };
    }

    if (url.includes("/playlist/")) {
        return await getPlaylistData(url);
    }

    throw new Error("Only Spotify track and playlist links are supported");
}

// CLI usage
if (require.main === module) {
    const url = process.argv[2];

    if (!url) {
        console.log(JSON.stringify({ error: "Usage: spotify_bridge.js <Spotify URL>" }));
        process.exit(2);
    }

    fetch(url)
        .then(result => {
            console.log(JSON.stringify(result, null, 0));
            process.exit(0);
        })
        .catch(error => {
            console.log(JSON.stringify({ error: error.message }, null, 0));
            process.exit(1);
        });
}

module.exports = { fetch, getTrackData, getPlaylistData };
