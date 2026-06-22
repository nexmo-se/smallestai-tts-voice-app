// multiQueue.js
class MultiQueue {
  constructor() {
    // key = uuid, value = queue array
    this.queues = new Map();
    this.processing = new Map();
  }

  // Add a message to a specific queue
  enqueue(uuid, message) {
    if (!this.queues.has(uuid)) {
      this.queues.set(uuid, []);
      this.processing.set(uuid, false);
    }

    this.queues.get(uuid).push(message);
    // this.process(uuid); // optional automatic processing
  }

  // Remove the next message from a specific queue
  dequeue(uuid) {
    const queue = this.queues.get(uuid);
    if (!queue || queue.length === 0) return null;
    return queue.shift();
  }

  // Peek at the first element without dequeuing
  peek(uuid) {
    const queue = this.queues.get(uuid);
    if (!queue || queue.length === 0) return null;
    return queue[0]; // first element
  }

  // Delete queue
  deletequeue(uuid) {
    this.queues.delete(uuid);
  }

  // Check if a queue exists for the given UUID
  queueExists(uuid) {
    return this.queues.has(uuid);
  }

  // Return queues
  returnQueues() {
    return this.queues;
  }

}

module.exports = MultiQueue;
