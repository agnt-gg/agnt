export class ChatWindow {
  constructor() {
    this.messages = new Map();
    this.threads = new Map();
  }

  receiveMessage(message) {
    this.messages.set(message.id, message);
  }

  createThread(originMessageId) {
    const thread = new Thread(originMessageId);
    this.threads.set(originMessageId, thread);
    return thread;
  }

  destroy() {
    // Clear all maps to prevent memory leaks
    this.messages.clear();
    this.threads.clear();
  }
}

export class Message {
  constructor(id, sender, content, timestamp) {
    this.id = id;
    this.sender = sender;
    this.content = content;
    this.timestamp = timestamp;
    this.threadId = null;
  }
}

class Thread {
  constructor(originMessageId) {
    this.originMessageId = originMessageId;
    this.messages = [];
  }

  addMessage(message) {
    this.messages.push(message);
  }
}
