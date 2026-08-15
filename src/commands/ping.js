const { SlashCommandBuilder } = require("discord.js");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("🐾 Check if FuzzBot is awake"),

    async execute(interaction) {

        const ping = interaction.client.ws.ping;

        await interaction.reply(
            `🐾 **Purr! FuzzBot is awake and whiskers are twitching.**\n` +
            `💓 Ping: **${ping}ms**\n` +
            `*The den is still in good floofing condition.*`
        );
    }
};