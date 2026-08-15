const { SlashCommandBuilder } = require("discord.js");
const { getQueue } = require("../music/queue");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("queue")
        .setDescription("📋 Show the current music queue"),

    async execute(interaction) {
        const queue = getQueue(interaction.guild.id);

        if (!queue || (!queue.current && queue.songs.length === 0)) {
            await interaction.reply(
                "🐾 **The den is quiet as a sleepy cat.**\n" +
                "No tunes, no paws, no chaos."
            );
            return;
        }

        const formatSong = (song) => {
            if (!song) return "Mystery meow mix";
            return `${song.title}${song.artist ? ` — ${song.artist}` : ""}`;
        };

        let response = "";

        // If a song is playing or actively loading the first track, display it as current
        const currentSong = queue.current || (queue.loading && queue.songs.length > 0 ? queue.songs[0] : null);

        if (currentSong) {
            response += `🎵 **Now pouncing:** ${formatSong(currentSong)}\n\n`;
        }

        // Adjust upcoming list depending on whether queue.current is populated yet
        const upcomingSongs = queue.current ? queue.songs : queue.songs.slice(1);

        if (upcomingSongs.length > 0) {
            const songList = upcomingSongs
                .slice(0, 10)
                .map((song, index) => `${index + 1}. ${formatSong(song)}`)
                .join("\n");

            response += `📋 **Next in line for the den:**\n\n${songList}`;
        } else {
            response += `🐾 *No more tracks in the queue — the den is all tuckered out.*`;
        }

        await interaction.reply(response);
    }
};