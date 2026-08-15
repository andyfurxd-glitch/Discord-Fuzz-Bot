const {
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    StreamType
} = require("@discordjs/voice");

const { spawn, execFile } = require("child_process");
const { getOrCreateQueue, getQueue, clearQueueTimeouts, deleteQueue } = require("./queue");

const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes when queue is finished
const EMPTY_TIMEOUT_MS = 60 * 1000;    // 1 minute when channel is empty

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
            "--print", "%(webpage_url)s---%(duration)s",
            "--no-playlist",
            "--extractor-args", "youtube:player_client=web_embedded,android",
            "--socket-timeout", "15",
            "--retries", "3",
            search
        ], { timeout: 25000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
            if (error || !stdout) {
                resolve(null);
                return;
            }
            const firstLine = stdout.trim().split(/\r?\n/).find(Boolean);
            if (!firstLine) {
                resolve(null);
                return;
            }
            const parts = firstLine.split("---");
            const url = parts[0]?.trim();
            const durationSec = parseFloat(parts[1]);
            if (durationSec > 0 && (!song.durationMs || song.durationMs <= 0)) {
                song.durationMs = durationSec * 1000;
            }
            resolve(url || null);
        });
    });
}

function prefetchQueueURLs(queue, limit = 5, onFirstReady = null) {
    // Prefetch YouTube URLs for Spotify songs in queue.
    let firstSongReady = false;

    for (let i = 0; i < Math.min(limit, queue.songs.length); i++) {
        const song = queue.songs[i];
        if (song && song.spotifySearch && !song.url && !song.isResolving) {
            song.isResolving = true;
            findYouTubeMatch(song).then(url => {
                song.isResolving = false;
                if (url && !song.url) {
                    song.url = url;

                    if (!firstSongReady && onFirstReady) {
                        firstSongReady = true;
                        onFirstReady();
                    }

                    // If queue is idle waiting for the next song, trigger playback immediately
                    if (queue.guildId && !queue.current && !queue.loading) {
                        playNext(queue.guildId);
                    }
                }
            }).catch(() => {
                song.isResolving = false;
            });
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
            queue.loading = false;
            startIdleTimer(guildId);
        }
        return;
    }

    // A song is queued, cancel any idle/inactivity timer
    clearQueueTimeouts(queue);
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
            setTimeout(() => {
                queue.spotifyRetryScheduled = false;
                if (!queue.current && !queue.loading) {
                    playNext(guildId);
                }
            }, 500);
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
            "bestaudio[ext=webm]/bestaudio/best",
            "-o",
            "-",
            "--quiet",
            "--no-warnings",
            "--buffer-size",
            "16K",
            "--socket-timeout", "15",
            "--retries", "3",
            "--extractor-args",
            "youtube:player_client=web_embedded,android",
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
            "-analyzeduration", "0",
            "-probesize", "32k",
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
            inputType: StreamType.Raw,
            inlineVolume: false
        }
    );

    started = true;
    audioPlayer.play(resource);
}

function startIdleTimer(guildId) {
    const queue = getQueue(guildId);
    if (!queue || queue.idleTimeout) return;

    queue.idleTimeout = setTimeout(() => {
        const currentQueue = getQueue(guildId);
        if (currentQueue && !currentQueue.current && currentQueue.songs.length === 0) {
            console.log(`💤 [Inactivity] Queue finished in guild ${guildId}; leaving voice channel.`);
            leaveVoiceChannel(
                guildId,
                "💤 **The music den has been quiet for a while...** 🐾\n*FuzzBot curled up for a nap and left the voice channel to save energy.*"
            );
        }
    }, IDLE_TIMEOUT_MS);
}

function leaveVoiceChannel(guildId, reasonMessage = null) {
    cleanupProcesses(guildId);

    const queue = getQueue(guildId);
    if (queue) {
        clearQueueTimeouts(queue);

        if (reasonMessage && queue.textChannel) {
            queue.textChannel.send({ content: reasonMessage }).catch(() => { });
        }

        if (queue.connection) {
            try {
                queue.connection.destroy();
            } catch (e) { }
            queue.connection = null;
        }

        deleteQueue(guildId);
    }

    const audioPlayer = players.get(guildId);
    if (audioPlayer) {
        try { audioPlayer.stop(); } catch (e) { }
        players.delete(guildId);
    }
}

function handleVoiceStateUpdate(oldState, newState) {
    const guild = oldState.guild || newState.guild;
    if (!guild) return;
    const guildId = guild.id;

    const queue = getQueue(guildId);
    if (!queue || !queue.connection) return;

    const botMember = guild.members.me;
    if (!botMember) return;

    // Check if the bot itself was disconnected/kicked from the voice channel
    if (oldState.member?.id === botMember.id && !newState.channelId) {
        console.log(`🐾 [Voice] FuzzBot was disconnected from voice in guild ${guildId}.`);
        leaveVoiceChannel(guildId);
        return;
    }

    const botChannelId = botMember.voice?.channelId || queue.voiceChannelId;
    if (!botChannelId) return;

    const voiceChannel = guild.channels.cache.get(botChannelId);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

    const humanMembers = voiceChannel.members.filter(member => !member.user.bot);

    if (humanMembers.size === 0) {
        if (!queue.emptyTimeout) {
            console.log(`🐾 [Inactivity] Voice channel is empty in guild ${guildId}. Starting 1-minute exit timer.`);
            queue.emptyTimeout = setTimeout(() => {
                const currentChannel = guild.channels.cache.get(botChannelId);
                const currentHumans = currentChannel?.members?.filter(member => !member.user.bot);
                if (!currentHumans || currentHumans.size === 0) {
                    console.log(`🦊 [Inactivity] Voice channel remained empty in guild ${guildId}; leaving.`);
                    leaveVoiceChannel(
                        guildId,
                        "🦊 **Everyone left the den!** 🐾\n*FuzzBot tucked its tail and headed back to bed.*"
                    );
                }
            }, EMPTY_TIMEOUT_MS);
        }
    } else {
        if (queue.emptyTimeout) {
            console.log(`🐾 [Inactivity] A floof returned to voice in guild ${guildId}! Cancelling exit timer.`);
            clearTimeout(queue.emptyTimeout);
            queue.emptyTimeout = null;
        }
    }
}

function stopPlayback(guildId) {
    cleanupProcesses(guildId);

    const audioPlayer = players.get(guildId);

    if (audioPlayer) {
        audioPlayer.stop();
    }

    const queue = getQueue(guildId);
    if (queue) {
        clearQueueTimeouts(queue);
        queue.songs = [];
        queue.current = null;
        queue.loading = false;
    }
}

module.exports = {
    getPlayer,
    playNext,
    stopPlayback,
    leaveVoiceChannel,
    startIdleTimer,
    handleVoiceStateUpdate,
    prefetchQueueURLs,
    fetchDuration
};