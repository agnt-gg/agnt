import { WebClient } from '@slack/web-api';
import AuthManager from '../../services/auth/AuthManager.js';
import fetch from 'node-fetch';

let instance = null;

class SlackReceiver {
  constructor() {
    if (instance) {
      return instance;
    }
    // this.app = null;
    this.client = null; // Rename from app to client
    this.channelSubscriptions = new Map();
    this.initialized = false;
    this.pollingIntervals = new Map(); // Track polling for each channel
    this.lastMessageTimestamps = new Map(); // Track last message timestamp for each channel

    instance = this;
  }
  async initialize(userId) {
    // ALWAYS re-initialize to ensure we have fresh, valid credentials
    // Reset initialization state to force fresh token fetch
    this.initialized = false;
    this.initializationPromise = null;

    this.initializationPromise = new Promise(async (resolve, reject) => {
      try {
        console.log(`Initializing Slack receiver for user ${userId}`);
        const token = await AuthManager.getValidAccessToken(userId, 'slack');
        console.log(`Retrieved Slack token for user ${userId}`);

        if (!token) {
          throw new Error(`No valid Slack token found for user ${userId}`);
        }

        this.client = new WebClient(token);
        this.initialized = true;
        resolve();
      } catch (error) {
        console.error('Error initializing Slack client:', error);
        this.initialized = false;
        reject(error);
      }
    });

    return this.initializationPromise;
  }
  async subscribeToChannel(channelId, callback) {
    if (!this.channelSubscriptions.has(channelId)) {
      this.channelSubscriptions.set(channelId, new Set());
      this.lastMessageTimestamps.set(channelId, Date.now() / 1000); // Current time in seconds
      this.startPolling(channelId);
    }
    this.channelSubscriptions.get(channelId).add(callback);
    console.log(`Subscribed to channel ${channelId}`);
  }
  async unsubscribeFromChannel(channelId, callback) {
    if (this.channelSubscriptions.has(channelId)) {
      const subscribers = this.channelSubscriptions.get(channelId);
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.channelSubscriptions.delete(channelId);
        this.stopPolling(channelId);
      }
      console.log(`Unsubscribed from channel ${channelId}`);
    }
  }
  async sendMessage(userId, channel, text) {
    try {
      // No need to get token again, the client already has it
      const result = await this.client.chat.postMessage({
        channel: channel,
        text: text,
      });
      console.log('Message sent successfully');
      return result;
    } catch (error) {
      console.error('Error sending message:', error);
      if (error.data && error.data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please check the channel ID.');
      }
      throw error;
    }
  }
  async getImageData(slackMessage, token) {
    if (!slackMessage.files || slackMessage.files.length === 0) {
      return null;
    }

    const file = slackMessage.files[0];
    const fileUrl = file.url_private_download;

    if (!fileUrl) {
      return null;
    }

    try {
      const response = await fetch(fileUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log('IMAGE Response:', response);

      const arrayBuffer = await response.arrayBuffer();
      const base64Data = this.arrayBufferToBase64(arrayBuffer);

      return {
        type: file.mimetype,
        data: base64Data,
      };
    } catch (error) {
      console.error('Error fetching file:', error);
      return null;
    }
  }
  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return Buffer.from(binary, 'binary').toString('base64');
  }
  startPolling(channelId) {
    if (this.pollingIntervals.has(channelId)) return;

    const pollInterval = setInterval(async () => {
      try {
        const currentTimestamp = Date.now() / 1000;
        const result = await this.client.conversations.history({
          channel: channelId,
          oldest: this.lastMessageTimestamps.get(channelId),
          limit: 100,
        });

        if (result.messages && result.messages.length > 0) {
          // Update the timestamp BEFORE processing messages
          this.lastMessageTimestamps.set(channelId, currentTimestamp);

          // Process messages in chronological order (oldest first)
          // Filter out bot messages and messages from the same user
          const messages = result.messages
            .filter((msg) => !msg.bot_id && !msg.subtype) // Ignore bot messages and system messages
            .reverse();

          const subscribers = this.channelSubscriptions.get(channelId);
          for (const message of messages) {
            for (const callback of subscribers) {
              callback(message);
            }
          }
        }
      } catch (error) {
        console.error(`Error polling channel ${channelId}:`, error);
      }
    }, 5000); // Poll every 5 seconds

    this.pollingIntervals.set(channelId, pollInterval);
  }
  stopPolling(channelId) {
    const interval = this.pollingIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(channelId);
      this.lastMessageTimestamps.delete(channelId);
    }
  }
}

export default function slackReceiver() {
  if (!instance) {
    instance = new SlackReceiver();
  }
  return instance;
}
