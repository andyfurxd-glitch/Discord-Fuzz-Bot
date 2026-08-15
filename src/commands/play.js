const { SlashCommandBuilder } = require("discord.js");
const { joinVoiceChannel } = require("@discordjs/voice");
const path = require("path");

const { getOrCreateQueue } = require("../music/queue");
const { getPlayer, playNext, prefetchQueueURLs, fetchDuration } = require("../music/player");
const { fetch: fetchSpotifyData } = require("../music/spotify_bridge");

// ---------------------------------------------------------
// SHUFFLE
// ---------------------------------------------------------

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [array[i], array[j]] =
            [array[j], array[i]];
    }

    return array;
}

function formatDuration(durationMs) {
    if (!durationMs || durationMs <= 0) {
        return "Unknown duration";
    }

    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}


// ---------------------------------------------------------
// GET SPOTIFY TRACK INFO
// ---------------------------------------------------------

async function getScrapedSpotifyTracks(url) {
    try {
        const result = await fetchSpotifyData(url);

        if (result.error) {
            throw new Error(result.error);
        }

        const tracks = (result.tracks || []).map(track => ({
            title: track.title,
            artist: track.artist,
            durationMs: track.duration_ms || track.durationMs || 0,
            spotifySearch: true
        }));

        return tracks;
    } catch (error) {
        console.error("Spotify playlist helper:", error.message);
        throw new Error("🐾 **Awoo...** I couldn't read that Spotify playlist.");
    }
}


// ---------------------------------------------------------
// RESOLVE TRACKS
// ---------------------------------------------------------

async function resolveTracks(query) {

    const isSpotify =
        query.toLowerCase().includes("spotify.com");


    // =====================================================
    // SPOTIFY
    // =====================================================

    if (isSpotify) {

        const isPlaylistOrAlbum =
            query.includes("/playlist/") ||
            query.includes("/album/");

        if (query.includes("/playlist/")) {
            const tracks = await getScrapedSpotifyTracks(query);

            if (!tracks.length) {
                throw new Error("Spotify playlist has no playable tracks");
            }

            return tracks;
        }


        // -------------------------------------------------
        // PLAYLIST / ALBUM
        // -------------------------------------------------

        if (isPlaylistOrAlbum) {

            throw (
                "🐺 **ARF!** Spotify playlists aren't ready yet!\n\n" +
                "🎵 Try a single Spotify song link for now."
            );
        }


        // -------------------------------------------------
        // SINGLE SPOTIFY TRACK
        // -------------------------------------------------

        try {

            const scrapedTracks = await getScrapedSpotifyTracks(query);

            if (!scrapedTracks.length) {
                throw new Error("Spotify track could not be scraped");
            }

            return scrapedTracks;

        } catch (error) {

            console.error(
                "❌ Spotify error:",
                error
            );

            throw (
                "😿 **Awoo...** I couldn't identify that Spotify song.\n" +
                "Try searching the song name directly for now."
            );
        }
    }


    // =====================================================
    // YOUTUBE / NORMAL SEARCH
    // =====================================================

    const isUrl =
        query.startsWith("http://") ||
        query.startsWith("https://");


    const searchArg =
        isUrl
            ? query
            : `ytsearch1:${query}`;


    return await resolveYouTube(
        searchArg
    );
}


// ---------------------------------------------------------
// RESOLVE YOUTUBE
// ---------------------------------------------------------

function resolveYouTube(searchArg) {

    return new Promise((resolve, reject) => {

        execFile(
            "yt-dlp",

            [
                "--flat-playlist",
                "--print",
                "%(title)s---%(webpage_url)s",
                "--no-playlist",
                "--extractor-args",
                "youtube:player_client=android",
                searchArg
            ],

            {
                timeout: 8000,
                maxBuffer: 1024 * 1024 * 5
            },

            (error, stdout, stderr) => {

                if (error) {
                    return reject("🐺 **ARF!** YouTube took too long to sniff out that track!");
                }

                if (!stdout || !stdout.trim()) {
                    return reject("🐾 **Hmm...** I couldn't find that song in the music den.");
                }

                const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
                const songs = [];

                for (const line of lines) {
                    const parts = line.split("---"); // Split by ---

                    if (parts.length < 2) {
                        continue;
                    }

                    const title = parts[0].trim();
                    const url = parts[1].trim();

                    if (!url) {
                        continue;
                    }

                    songs.push({
                        title: title || "Cozy Track 🎶",
                        url,
                        durationMs: 0 // Will be fetched on playback
                    });
                }

                if (songs.length === 0) {
                    return reject("🐺 **ARF!** I couldn't find a playable track.");
                }

                resolve(songs);
            }
        );
    });
}


// ---------------------------------------------------------
// DISCORD COMMAND
// ---------------------------------------------------------

module.exports = {

    data: new SlashCommandBuilder()

        .setName("play")

        .setDescription(
            "🎵 Play music from YouTube or Spotify!"
        )

        .addStringOption(option =>

            option

                .setName("query")

                .setDescription(
                    "🐾 Song name, YouTube link, or Spotify track/playlist link"
                )

                .setRequired(true)
        ),


    // -----------------------------------------------------
    // EXECUTE
    // -----------------------------------------------------

    async execute(interaction) {

        const query =
            interaction.options.getString("query");


        const voiceChannel =
            interaction.member.voice.channel;


        // -------------------------------------------------
        // VOICE CHANNEL CHECK
        // -------------------------------------------------

        if (!voiceChannel) {

            await interaction.reply(
                "🦊 **Hop into a voice channel first, floof!**\n" +
                "I can't jam all alone in the den~ 🎵"
            );

            return;
        }


        // -------------------------------------------------
        // RESPOND IMMEDIATELY
        // -------------------------------------------------

        await interaction.deferReply();

        await interaction.editReply(
            "🐾 **Sniffing out your music...** 🎵\n" +
            "*FuzzBot is fetching the floofiest tunes!*"
        );


        try {

            // -------------------------------------------------
            // FIND TRACK
            // -------------------------------------------------

            // Begin the voice handshake now. joinVoiceChannel returns right away,
            // allowing Discord connection and YouTube lookup to overlap.
            const preloadPlayer = getPlayer(interaction.guild.id);
            const preloadQueue = getOrCreateQueue(interaction.guild.id, preloadPlayer, interaction.channel);

            if (!preloadQueue.connection) {
                preloadQueue.connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: interaction.guild.id,
                    adapterCreator: interaction.guild.voiceAdapterCreator
                });
                preloadQueue.connection.subscribe(preloadQueue.player);
            }

            const songs =
                await resolveTracks(query);


            if (!songs || songs.length === 0) {

                await interaction.editReply(
                    "🐺 **ARF!** My paws couldn't find any tracks!"
                );

                return;
            }


            // -------------------------------------------------
            // GET PLAYER
            // -------------------------------------------------

            const musicPlayer =
                getPlayer(
                    interaction.guild.id
                );


            // -------------------------------------------------
            // GET QUEUE
            // -------------------------------------------------

            const queue =
                getOrCreateQueue(
                    interaction.guild.id,
                    musicPlayer,
                    interaction.channel
                );


            // -------------------------------------------------
            // JOIN VOICE
            // -------------------------------------------------

            if (!queue.connection) {

                queue.connection =
                    joinVoiceChannel({

                        channelId:
                            voiceChannel.id,

                        guildId:
                            interaction.guild.id,

                        adapterCreator:
                            interaction.guild.voiceAdapterCreator
                    });


                queue.connection.subscribe(
                    queue.player
                );
            }


            // -------------------------------------------------
            // ADD SONGS
            // -------------------------------------------------

            if (songs.length > 1) {
                shuffleArray(songs);
            }

            queue.songs.push(
                ...songs
            );

            // Start prefetching Spotify track URLs immediately (don't wait)
            prefetchQueueURLs(queue, 10, () => {
                // Once first song is ready, trigger playback if not already playing
                if (!queue.loading && !queue.current) {
                    playNext(interaction.guild.id);
                }
            });

            // -------------------------------------------------
            // RESPONSE
            // -------------------------------------------------

            const startsImmediately = !queue.current && !queue.loading;

            if (songs.length === 1) {

                if (startsImmediately) {
                    queue.suppressNowPlayingMessage = true;

                    let durationMs = songs[0].durationMs || 0;
                    if ((!durationMs || durationMs <= 0) && songs[0].url) {
                        durationMs = await fetchDuration(songs[0].url);
                    }

                    const durationText = formatDuration(durationMs);
                    await interaction.editReply(
                        `🎵 **Now pouncing:** ${songs[0].title}${songs[0].artist ? ` — *${songs[0].artist}*` : ""}\n\n` +
                        `⏱️ Duration: **${durationText}**`
                    );
                } else {
                    await interaction.editReply(
                        `🐾 **Added to the cuddle queue!**\n\n` +
                        `🎵 **${songs[0].title}**\n` +
                        `📋 Position in den: **${queue.songs.length}**`
                    );
                }

            } else {

                await interaction.editReply(

                    `🐾 **Ooh, a whole playlist!** ✨\n` +

                    `🎵 Loaded **${songs.length}** cozy tracks into the den!`
                );
            }


            // -------------------------------------------------
            // START PLAYBACK
            // -------------------------------------------------

            if (!queue.current && !queue.loading) {
                // Fire off playNext right away so it resolves the first song
                playNext(interaction.guild.id);
            }

        } catch (error) {

            console.error(
                "❌ Music error:",
                error
            );


            const message =
                typeof error === "string"

                    ? error

                    : "😿 **Oh noes!** Something went wrong in the music den!";


            await interaction.editReply(
                message
            );
        }
    }
};
