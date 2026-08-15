const {
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    StreamType
} = require("@discordjs/voice");

const { spawn, execFile } = require("child_process");
const { getOrCreateQueue } = require("./queue");

const players = new Map();
// Keep track of active processes per guild so we can kill them on skip/stop
const activeProcesses = new Map();

function cleanupProcesses(guildId) {
    const processes = activeProcesses.get(guildId);
    if (processes) {
        if (processes.ytDlp) {
            try { processes.ytDlp.kill("SIGKILL"); } catch (e) { }
        }
        if (processes.ffmpeg) {
            try { processes.ffmpeg.kill("SIGKILL"); } catch (e) { }
        }
        activeProcesses.delete(guildId);
    }
}

function getPlayer(guildId) {
    let audioPlayer = players.get(guildId);

    if (!audioPlayer) {
        audioPlayer = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Pause
            }
        });

        players.set(guildId, audioPlayer);

        audioPlayer.on(AudioPlayerStatus.Idle, () => {
            const queue = getOrCreateQueue(guildId, audioPlayer);
            queue.loading = false;
            queue.current = null;
            cleanupProcesses(guildId);
            playNext(guildId);
        });

        audioPlayer.on("error", error => {
            console.error("❌ Audio player error:", error);
            const queue = getOrCreateQueue(guildId, audioPlayer);
            queue.loading = false;
            queue.current = null;
            cleanupProcesses(guildId);
            playNext(guildId);
        });
    }

    return audioPlayer;
}

function findYouTubeMatch(song) {
    const search = `ytsearch1:${song.title} ${song.artist} official audio`;

    return new Promise(resolve => {
        execFile("yt-dlp", [
            "--print", "%(webpage_url)s",
            "--no-playlist",
            "--extractor-args", "youtube:player_client=android",
            search
        ], { maxBuffer: 1024 * 1024 }, (error, stdout) => {
            const url = !error && stdout.trim().split(/\r?\n/).find(Boolean);
            resolve(url || null);
        });
    });
}

function prefetchQueueURLs(queue, limit = 5, onFirstReady = null) {
    // Prefetch YouTube URLs for Spotify songs in queue.
    // Start all searches in parallel and fire the callback once the first
    // Spotify song actually resolves to a URL.
    let firstSongReady = false;

    for (let i = 0; i < Math.min(limit, queue.songs.length); i++) {
        const song = queue.songs[i];
        if (song && song.spotifySearch && !song.url) {
            findYouTubeMatch(song).then(url => {
                if (url && !song.url) {
                    song.url = url;

                    if (!firstSongReady && onFirstReady) {
                        firstSongReady = true;
                        onFirstReady();
                    }
                }
            }).catch(() => { });
        }
    }
}

function fetchDuration(url) {
    return new Promise(resolve => {
        execFile("yt-dlp", [
            "--print", "%(duration)s",
            url
        ], { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
            if (error || !stdout) {
                resolve(0);
                return;
            }
            const durationSec = parseFloat(stdout.trim());
            if (durationSec > 0) {
                resolve(durationSec * 1000); // Convert to milliseconds
            } else {
                resolve(0);
            }
        });
    });
}

async function playNext(guildId) {
    cleanupProcesses(guildId);

    const audioPlayer = getPlayer(guildId);
    const queue = getOrCreateQueue(guildId, audioPlayer);

    if (queue.loading) {
        return;
    }

    if (!queue || queue.songs.length === 0) {
        if (queue) {
            queue.current = null;
        }
        return;
    }

    queue.loading = true;

    // Prefetch Spotify URLs for upcoming songs in the background.
    prefetchQueueURLs(queue, 5);

    let song = null;
    let songIndex = -1;
    let hasPendingSpotify = false;

    for (let i = 0; i < queue.songs.length; i++) {
        const candidate = queue.songs[i];

        if (candidate.spotifySearch && !candidate.url) {
            hasPendingSpotify = true;
            continue;
        }

        song = candidate;
        songIndex = i;
        break;
    }

    if (!song) {
        queue.current = null;
        queue.loading = false;

        if (hasPendingSpotify && !queue.spotifyRetryScheduled) {
            queue.spotifyRetryScheduled = true;
            console.warn("Spotify track still resolving; retrying once in a moment...");
            setTimeout(() => {
                queue.spotifyRetryScheduled = false;
                if (!queue.current && !queue.loading) {
                    playNext(guildId);
                }
            }, 700);
        }

        return;
    }

    queue.songs.splice(songIndex, 1);
    queue.current = song;
    // Keep loading true while the current song is actively streaming.
    // This prevents playNext() from starting a second stream on top of the first.
    console.log(`🎵 Playing: ${song.title}`);

    // Start fetching duration immediately (non-blocking promise)
    let durationPromise = Promise.resolve(song.durationMs || 0);
    if (song.durationMs && song.durationMs > 0) {
        durationPromise = Promise.resolve(song.durationMs);
    } else if (song.url) {
        durationPromise = fetchDuration(song.url).then(duration => {
            song.durationMs = duration;
            return duration;
        }).catch(() => 0);
    }

    // Send message with duration once it's available (but keep it quick)
    durationPromise.then(duration => {
        if (queue.textChannel && !queue.suppressNowPlayingMessage) {
            let durationText = "Unknown duration";
            if (duration > 0) {
                const totalSeconds = Math.floor(duration / 1000);
                const minutes = Math.floor(totalSeconds / 60);
                const seconds = totalSeconds % 60;
                durationText = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
            }

            queue.textChannel.send({
                content: `🎵 **Now pouncing:** ${song.title}${song.artist ? ` — *${song.artist}*` : ""}\n⏱️ Duration: **${durationText}**`
            }).catch(() => { });
        }

        queue.suppressNowPlayingMessage = false;
    }).catch(() => { });

    const ytDlp = spawn(
        "yt-dlp",
        [
            "--no-playlist",
            "-f",
            "bestaudio/best",
            "-o",
            "-",
            "--quiet",
            "--no-warnings",
            "--extractor-args",
            "youtube:player_client=android",
            song.url
        ],
        {
            windowsHide: true
        }
    );

    const ffmpeg = spawn(
        "ffmpeg",
        [
            "-hide_banner",
            "-loglevel", "error",
            "-i", "pipe:0",
            "-f", "s16le",
            "-ar", "48000",
            "-ac", "2",
            "pipe:1"
        ],
        { windowsHide: true }
    );

    activeProcesses.set(guildId, { ytDlp, ffmpeg });

    let started = false;

    // Safely pipe and catch EPIPE errors if streams close abruptly
    ytDlp.stdout.pipe(ffmpeg.stdin);

    ytDlp.stdout.on("error", err => {
        if (err.code !== "EPIPE") console.error("ytDlp stdout error:", err);
    });

    ffmpeg.stdin.on("error", err => {
        if (err.code !== "EPIPE") console.error("FFmpeg stdin error:", err);
    });

    ffmpeg.stdout.on("data", () => {
        started = true;
    });

    ytDlp.stderr.on("data", data => {
        const text = data.toString().trim();
        if (text && text.includes("ERROR")) {
            console.error("❌ yt-dlp:", text);
        }
    });

    ytDlp.on("error", error => {
        console.error("❌ yt-dlp process error:", error);
        if (!started) {
            queue.current = null;
            queue.loading = false;
            playNext(guildId);
        }
    });

    ytDlp.on("close", code => {
        if (code !== 0 && !started) {
            console.error(`yt-dlp exited with code ${code}`);
            queue.current = null;
            queue.loading = false;
            playNext(guildId);
        }
    });

    ffmpeg.on("error", error => {
        console.error("FFmpeg process error:", error);
        if (!started) {
            queue.current = null;
            queue.loading = false;
            playNext(guildId);
        }
    });

    const resource = createAudioResource(
        ffmpeg.stdout,
        {
            inputType: StreamType.Raw
        }
    );

    started = true;
    audioPlayer.play(resource);
}

function stopPlayback(guildId) {
    cleanupProcesses(guildId);

    const audioPlayer = players.get(guildId);

    if (audioPlayer) {
        audioPlayer.stop();
    }

    const queue = getOrCreateQueue(guildId, audioPlayer);

    queue.songs = [];
    queue.current = null;
    queue.loading = false;
}

module.exports = {
    getPlayer,
    playNext,
    stopPlayback,
    prefetchQueueURLs,
    fetchDuration
};