const { SlashCommandBuilder } = require("discord.js");
const { joinVoiceChannel } = require("@discordjs/voice");

const { getPlayer } = require("../music/player");
const { getOrCreateQueue } = require("../music/queue");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("join")
        .setDescription("🐾 FuzzBot joins your voice channel"),

    async execute(interaction) {

        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
            await interaction.reply(
                "🐺 **You need to be in a voice channel first, floof!**\n" +
                "I can’t do a proper tail-swish dance from the void."
            );
            return;
        }

        try {

            const player = getPlayer(interaction.guild.id);

            const queue = getOrCreateQueue(
                interaction.guild.id,
                player,
                interaction.channel
            );
            queue.voiceChannelId = voiceChannel.id;

            // Already connected to this channel
            if (queue.connection) {
                await interaction.reply(
                    "🐾 **The den is already occupied, buddy!** 🎵\n" +
                    "No need to paws the room twice."
                );
                return;
            }

            queue.connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: interaction.guild.voiceAdapterCreator
            });

            queue.connection.subscribe(player);

            const { startIdleTimer } = require("../music/player");
            startIdleTimer(interaction.guild.id);

            await interaction.reply(
                `🐾 **FuzzBot has scampered into ${voiceChannel.name}!**\n` +
                `🎵 *Ears perked, tail swishing, music den officially open.*`
            );

        } catch (error) {

            console.error("❌ Failed to join voice channel:", error);

            await interaction.reply(
                "💥 **My floofy paws slipped!**\n" +
                "I couldn’t sneak into that channel without tripping over my whiskers."
            );
        }
    }
};