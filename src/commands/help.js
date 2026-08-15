const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("📖 Show FuzzBot's command list"),

    async execute(interaction) {

        await interaction.reply({
            content:
                "🐾 **FuzzBot’s Cozy Den**\n\n" +
                "🎵 **Purrfect Playlist Controls**\n" +
                "▶️ `/play` — Pounce on a tune and throw it in the den\n" +
                "📋 `/queue` — Peek at the next fluffy tracks\n" +
                "⏭️ `/skip` — Skip this jam and let the next one pounce\n" +
                "💤 `/stop` — Close the den and curl up for a nap\n\n" +

                "🐾 **Voice Den Commands**\n" +
                "🎤 `/join` — Scamper into your voice channel\n\n" +

                "🦊 **FuzzBot Status**\n" +
                "💓 `/ping` — Check whether the floof is awake\n" +
                "📖 `/help` — Reopen the fluffy command guide\n\n" +

                "*Tail wagging and whiskers twitching, one meow at a time.* 🐺✨"
        });
    }
};