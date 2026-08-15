require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    NoSubscriberBehavior,
    StreamType
} = require("@discordjs/voice");

const { execa } = require("execa");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const queues = new Map();

const commands = [
    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("🐾 Check if FuzzBot is awake"),

    new SlashCommandBuilder()
        .setName("join")
        .setDescription("🐾 Make FuzzBot enter your voice channel"),

    new SlashCommandBuilder()
        .setName("play")
        .setDescription("🎵 Play a YouTube song")
        .addStringOption(option =>
            option
                .setName("url")
                .setDescription("🐾 YouTube video URL")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("stop")
        .setDescription("🐾 Stop the music and leave the den")
].map(command => command.toJSON());


function getQueue(guildId) {

    if (!queues.has(guildId)) {

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Pause
            }
        });

        const queue = {
            player,
            connection: null,
            songs: [],
            current: null,
            ytdlp: null
        };

        player.on(AudioPlayerStatus.Idle, () => {

            queue.current = null;

            if (queue.ytdlp) {
                queue.ytdlp.kill("SIGTERM");
                queue.ytdlp = null;
            }

            if (queue.songs.length > 0) {
                playNext(guildId);
            }
        });

        player.on("error", error => {
            console.error("❌ Audio player error:", error);
        });

        queues.set(guildId, queue);
    }

    return queues.get(guildId);
}


async function getYouTubeTitle(url) {

    const { stdout } = await execa("yt-dlp", [
        "--print",
        "title",
        "--no-playlist",
        url
    ]);

    return stdout.trim();
}


async function playNext(guildId) {

    const queue = queues.get(guildId);

    if (!queue || queue.songs.length === 0) {
        return;
    }

    const song = queue.songs.shift();

    queue.current = song;

    console.log(`🎵 Playing: ${song.title}`);

    try {

        /*
         * yt-dlp sends the best available audio to stdout.
         *
         * FFmpeg converts it into raw Opus audio that Discord
         * can play directly.
         */

        const ytdlp = execa(
            "yt-dlp",
            [
                "--no-playlist",
                "-f",
                "bestaudio/best",
                "-o",
                "-",
                song.url
            ],
            {
                stdout: "pipe",
                stderr: "pipe"
            }
        );

        queue.ytdlp = ytdlp;

        ytdlp.stderr.on("data", data => {
            console.log(`yt-dlp: ${data.toString().trim()}`);
        });

        const resource = createAudioResource(ytdlp.stdout, {
            inputType: StreamType.WebmOpus
        });

        queue.player.play(resource);

        ytdlp.catch(error => {

            if (error.isCanceled) {
                return;
            }

            console.error("❌ yt-dlp error:", error);
        });

    } catch (error) {

        console.error("❌ Playback error:", error);

        queue.current = null;
        queue.ytdlp = null;

        playNext(guildId);
    }
}


client.once("clientReady", async () => {

    console.log(`🐾 ${client.user.tag} is awake!`);
    console.log("🎵 FuzzBot has entered the music den!");

    const rest = new REST({ version: "10" })
        .setToken(process.env.DISCORD_TOKEN);

    try {

        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            {
                body: commands
            }
        );

        console.log("🐾 Slash commands registered!");

    } catch (error) {

        console.error("❌ Failed to register commands:", error);
    }
});


client.on("interactionCreate", async interaction => {

    if (!interaction.isChatInputCommand()) return;


    // ================================
    // /ping
    // ================================

    if (interaction.commandName === "ping") {

        await interaction.reply(
            "🐾 **PONG!** FuzzBot is awake and ready to vibe! 🎵"
        );

        return;
    }


    // ================================
    // /join
    // ================================

    if (interaction.commandName === "join") {

        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {

            await interaction.reply(
                "🦊 **Nope!** You need to be in a voice channel first, silly floof!"
            );

            return;
        }

        try {

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator
            });

            const queue = getQueue(interaction.guild.id);

            queue.connection = connection;

            connection.subscribe(queue.player);

            await interaction.reply(
                `🐾 **FuzzBot has scampered into ${voiceChannel.name}!**\n\n🎵 *Ears up! The music den is open.*`
            );

        } catch (error) {

            console.error(error);

            await interaction.reply(
                "💥 **ARF!** I couldn't get into the voice channel!"
            );
        }

        return;
    }


    // ================================
    // /play
    // ================================

    if (interaction.commandName === "play") {

        const url = interaction.options.getString("url");

        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {

            await interaction.reply(
                "🦊 **Hop into a voice channel first, floof!**"
            );

            return;
        }

        await interaction.deferReply();

        try {

            /*
             * Make sure it's a YouTube URL.
             */

            if (!url.includes("youtube.com") && !url.includes("youtu.be")) {

                await interaction.editReply(
                    "🐾 **FuzzBot only accepts YouTube URLs right now!**\n\n🎵 *Spotify support comes later.*"
                );

                return;
            }

            const title = await getYouTubeTitle(url);

            const song = {
                title,
                url
            };

            const queue = getQueue(interaction.guild.id);

            /*
             * Join the user's voice channel automatically.
             */

            if (!queue.connection) {

                queue.connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: interaction.guild.id,
                    adapterCreator: interaction.guild.voiceAdapterCreator
                });

                queue.connection.subscribe(queue.player);
            }

            queue.songs.push(song);

            const position = queue.songs.length;

            await interaction.editReply(
                `🐾 **Added to the music den!**\n\n` +
                `🎵 **${song.title}**\n` +
                `📋 Position in queue: **${position}**`
            );

            if (!queue.current) {
                playNext(interaction.guild.id);
            }

        } catch (error) {

            console.error("❌ YouTube error:", error);

            await interaction.editReply(
                "🐺 **ARF! Something went wrong fetching that YouTube video.**\n\n" +
                "Make sure you're using a normal YouTube video URL."
            );
        }

        return;
    }


    // ================================
    // /stop
    // ================================

    if (interaction.commandName === "stop") {

        const queue = getQueue(interaction.guild.id);

        queue.songs = [];
        queue.current = null;

        if (queue.ytdlp) {
            queue.ytdlp.kill("SIGTERM");
            queue.ytdlp = null;
        }

        queue.player.stop();

        if (queue.connection) {

            queue.connection.destroy();
            queue.connection = null;
        }

        await interaction.reply(
            "🦊 **Music den closed!**\n\n*FuzzBot curls up for a nap.* 💤"
        );

        return;
    }
});


client.login(process.env.DISCORD_TOKEN);