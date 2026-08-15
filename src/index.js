require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    Collection,
    REST,
    Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('FuzzBot is running completely free!');
});

app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
});


// ============================================================
// CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});


// ============================================================
// COMMAND HANDLER
// ============================================================

client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");

const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith(".js"));

const commands = [];

for (const file of commandFiles) {

    const filePath = path.join(commandsPath, file);

    const command = require(filePath);

    if ("data" in command && "execute" in command) {

        client.commands.set(
            command.data.name,
            command
        );

        commands.push(
            command.data.toJSON()
        );

        console.log(`🐾 Loaded command: /${command.data.name}`);

    } else {

        console.warn(
            `⚠️ ${file} is missing "data" or "execute".`
        );
    }
}


// ============================================================
// BOT READY
// ============================================================

client.once("clientReady", async () => {

    console.log(`🐾 ${client.user.tag} is awake!`);
    console.log("🎵 FuzzBot has entered the music den!");

    try {

        const rest = new REST({
            version: "10"
        }).setToken(process.env.DISCORD_TOKEN);

        const useGuildCommands =
            process.env.USE_GUILD_COMMANDS === "true" &&
            process.env.GUILD_ID;

        if (useGuildCommands) {
            await rest.put(
                Routes.applicationGuildCommands(
                    process.env.CLIENT_ID,
                    process.env.GUILD_ID
                ),
                {
                    body: commands
                }
            );

            console.log("🐾 Guild slash commands registered for local testing!");
        } else {
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                {
                    body: commands
                }
            );

            console.log("🐾 Global slash commands registered for all servers!");
        }

    } catch (error) {

        console.error(
            "❌ Failed to register commands:",
            error
        );
    }
});


// ============================================================
// SLASH COMMANDS
// ============================================================

client.on("interactionCreate", async interaction => {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    const command = client.commands.get(
        interaction.commandName
    );

    if (!command) {
        return;
    }

    try {

        await command.execute(interaction);

    } catch (error) {

        console.error(
            `❌ Error executing /${interaction.commandName}:`,
            error
        );

        const message =
            "💥 **FuzzBot tripped over its own tail and knocked over the treat jar!** 🐾\n" +
            "*The den is a little chaotic, but the whiskers are still wagging.*";

        if (interaction.replied || interaction.deferred) {

            await interaction.followUp({
                content: message,
                ephemeral: true
            });

        } else {

            await interaction.reply({
                content: message,
                ephemeral: true
            });
        }
    }
});


// ============================================================
// VOICE STATE (AUTO-LEAVE ON EMPTY / DISCONNECT)
// ============================================================

const { handleVoiceStateUpdate } = require("./music/player");

client.on("voiceStateUpdate", (oldState, newState) => {
    try {
        handleVoiceStateUpdate(oldState, newState);
    } catch (error) {
        console.error("❌ Error in voiceStateUpdate handler:", error);
    }
});


// ============================================================
// LOGIN
// ============================================================

client.login(process.env.DISCORD_TOKEN);