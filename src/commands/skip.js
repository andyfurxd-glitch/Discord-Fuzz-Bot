const { SlashCommandBuilder } = require("discord.js");
const { getQueue } = require("../music/queue");
const { playNext } = require("../music/player");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("skip")
        .setDescription("⏭️ Skip the current floof jam"),

    async execute(interaction) {

        const queue = getQueue(interaction.guild.id);

        if (!queue || (!queue.current && queue.songs.length === 0)) {
            await interaction.reply(
                "🐾 **The den is empty, no tune to pounce on.**"
            );
            return;
        }

        const skippedSong = queue.current ? queue.current.title : "Current track";

        // Clear current so it doesn't hold onto the old track info during the async search
        queue.current = null;

        // Stopping the current player makes it go Idle,
        // which triggers playNext() automatically.
        if (queue.player) {
            queue.player.stop();
        } else {
            playNext(interaction.guild.id);
        }

        await interaction.reply(
            `⏭️ **Skipped:** ${skippedSong}\n` +
            `🐾 *The next floof jam is already stalking in.*`
        );
    }
};