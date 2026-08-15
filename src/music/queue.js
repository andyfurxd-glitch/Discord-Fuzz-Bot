const queues = new Map();

function createQueue(guildId, player = null) {
    const queue = {
        guildId,
        player,
        connection: null,
        songs: [],
        current: null,
        loading: false,
        textChannel: null, // 🐾 Added to remember where to send messages
        spotifyRetryScheduled: false,
        suppressNowPlayingMessage: false
    };

    queues.set(guildId, queue);

    return queue;
}

function getQueue(guildId) {
    return queues.get(guildId);
}

function getOrCreateQueue(guildId, player = null, textChannel = null) {
    let queue = queues.get(guildId);

    if (!queue) {
        queue = createQueue(guildId, player);
    }

    if (player && !queue.player) {
        queue.player = player;
    }

    // 🐾 Update the text channel if provided
    if (textChannel) {
        queue.textChannel = textChannel;
    }

    return queue;
}

function deleteQueue(guildId) {
    queues.delete(guildId);
}

module.exports = {
    createQueue,
    getQueue,
    getOrCreateQueue,
    deleteQueue
};