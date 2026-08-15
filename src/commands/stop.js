const { SlashCommandBuilder } = require("discord.js");

const { getQueue } = require("../music/queue");
const { stopPlayback } = require("../music/player");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("stop")
        .setDescription("💤 Stop the music and close the music den"),

    async execute(interaction) {

        const queue = getQueue(interaction.guild.id);

        if (!queue) {
            await interaction.reply(
                "🐾 **The den is already snoozing.**\n" +
                "No music, no mess, no drama."
            );
            return;
        }

        stopPlayback(interaction.guild.id);

        if (queue.connection) {
            queue.connection.destroy();
            queue.connection = null;
        }

        await interaction.reply(
            "💤 **The music den has been closed for a nap.**\n" +
            "🐾 *FuzzBot curled up, tucked in, and turned off the speakers.*"
        );
    }
};