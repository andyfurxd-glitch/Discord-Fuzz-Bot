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
        voiceChannelId: null,
        spotifyRetryScheduled: false,
        suppressNowPlayingMessage: false,
        idleTimeout: null,
        emptyTimeout: null
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

function clearQueueTimeouts(queue) {
    if (!queue) return;
    if (queue.idleTimeout) {
        clearTimeout(queue.idleTimeout);
        queue.idleTimeout = null;
    }
    if (queue.emptyTimeout) {
        clearTimeout(queue.emptyTimeout);
        queue.emptyTimeout = null;
    }
}

function deleteQueue(guildId) {
    const queue = queues.get(guildId);
    if (queue) {
        clearQueueTimeouts(queue);
    }
    queues.delete(guildId);
}

module.exports = {
    createQueue,
    getQueue,
    getOrCreateQueue,
    clearQueueTimeouts,
    deleteQueue
};