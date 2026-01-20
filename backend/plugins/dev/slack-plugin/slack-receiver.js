import { WebClient } from '@slack/web-api';
import path from 'path';
import { fileURLToPath } from 'url';
import EventEmitter from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get app path for importing core modules
// APP_PATH is set by Electron, fallback for dev mode
const APP_PATH = process.env.APP_PATH || path.join(__dirname, '../../..');


/**
 * Slack Receiver Plugin Tool (Trigger)
 *
 * This is a trigger tool that listens for incoming Slack messages using polling.
 * It uses a singleton pattern to efficiently share one polling connection across
 * multiple workflows that subscribe to the same channel.
 */

let instance = null;

class SlackReceiver extends EventEmitter {
  constructor() {
    super();
    this.name = 'receive-slack-message';
    this.client = null;
    this.channelSubscriptions = new Map();
    this.initialized = false;
    this.pollingIntervals = new Map();
    this.lastMessageTimestamps = new Map();
    this.currentUserId = null;
  }

  /**
   * Initialize the Slack client with user credentials
   */
  async initialize(userId) {
    // Always re-initialize to ensure fresh, valid credentials
    this.initialized = false;

    try {
      console.log(`[SlackPlugin] Initializing Slack receiver for user ${userId}`);

      // Import AuthManager dynamically to avoid path issues
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;

      const token = await AuthManager.getValidAccessToken(userId, 'slack');
      if (!token) {
        throw new Error(`No valid Slack token found for user ${userId}`);
      }

      this.client = new WebClient(token);
      this.currentUserId = userId;
      this.initialized = true;

      console.log(`[SlackPlugin] Slack receiver initialized for user ${userId}`);
    } catch (error) {
      console.error('[SlackPlugin] Error initializing Slack client:', error);
      this.initialized = false;
      throw error;
    }
  }

  /**
   * Setup the trigger - called when workflow starts
   */
  async setup(engine, node) {
    console.log('[SlackPlugin] Setting up Slack receiver trigger');

    if (!node.parameters || !node.parameters.channelId) {
      throw new Error('Slack trigger node is missing required channelId parameter');
    }

    // Initialize the client
    await this.initialize(engine.userId);

    // Store in engine receivers for cleanup
    engine.receivers.slack = this;

    // Subscribe to the channel
    await this.subscribeToChannel(node.parameters.channelId, (messageData) => {
      engine.processWorkflowTrigger(messageData);
    });

    console.log(`[SlackPlugin] Subscribed to channel ${node.parameters.channelId}`);
  }

  /**
   * Subscribe to a Slack channel for messages
   */
  async subscribeToChannel(channelId, callback) {
    if (!this.channelSubscriptions.has(channelId)) {
      this.channelSubscriptions.set(channelId, new Set());
      this.lastMessageTimestamps.set(channelId, Date.now() / 1000);
      this.startPolling(channelId);
    }
    this.channelSubscriptions.get(channelId).add(callback);
    console.log(`[SlackPlugin] Subscribed to channel ${channelId}`);
  }

  /**
   * Unsubscribe from a Slack channel
   */
  async unsubscribeFromChannel(channelId, callback) {
    if (this.channelSubscriptions.has(channelId)) {
      const subscribers = this.channelSubscriptions.get(channelId);
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.channelSubscriptions.delete(channelId);
        this.stopPolling(channelId);
      }
      console.log(`[SlackPlugin] Unsubscribed from channel ${channelId}`);
    }
  }

  /**
   * Start polling for messages in a channel
   */
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
          // Filter out bot messages and system messages
          const messages = result.messages.filter((msg) => !msg.bot_id && !msg.subtype).reverse();

          const subscribers = this.channelSubscriptions.get(channelId);
          for (const message of messages) {
            for (const callback of subscribers) {
              callback(message);
            }
          }
        }
      } catch (error) {
        console.error(`[SlackPlugin] Error polling channel ${channelId}:`, error);
      }
    }, 5000); // Poll every 5 seconds

    this.pollingIntervals.set(channelId, pollInterval);
    console.log(`[SlackPlugin] Started polling for channel ${channelId}`);
  }

  /**
   * Stop polling for a channel
   */
  stopPolling(channelId) {
    const interval = this.pollingIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(channelId);
      this.lastMessageTimestamps.delete(channelId);
      console.log(`[SlackPlugin] Stopped polling for channel ${channelId}`);
    }
  }

  /**
   * Validate incoming trigger data
   */
  validate(triggerData) {
    return 'text' in triggerData && 'user' in triggerData;
  }

  /**
   * Process the trigger data into outputs
   */
  async process(inputData, engine) {
    // Get image data if there are file attachments
    const imageData = await this.getImageData(inputData, engine);

    return {
      user: inputData.user,
      text: inputData.text,
      timestamp: inputData.ts,
      channelId: inputData.channel,
      threadTs: inputData.thread_ts || null,
      image: imageData,
      response: { ...inputData },
    };
  }

  /**
   * Get image data from Slack message attachments
   */
  async getImageData(slackMessage, engine) {
    if (!slackMessage.files || slackMessage.files.length === 0) {
      return null;
    }

    const file = slackMessage.files[0];
    const fileUrl = file.url_private_download;

    if (!fileUrl) {
      return null;
    }

    try {
      // Import AuthManager to get fresh token
      const AuthManagerModule = await import(`file://${path.join(APP_PATH, 'backend/src/services/auth/AuthManager.js').replace(/\\/g, '/')}`);
      const AuthManager = AuthManagerModule.default;
      const token = await AuthManager.getValidAccessToken(engine.userId, 'slack');

      // Dynamic import of node-fetch
      const fetch = (await import('node-fetch')).default;

      const response = await fetch(fileUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64Data = this.arrayBufferToBase64(arrayBuffer);

      return {
        type: file.mimetype,
        data: base64Data,
      };
    } catch (error) {
      console.error('[SlackPlugin] Error fetching file:', error);
      return null;
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return Buffer.from(binary, 'binary').toString('base64');
  }

  /**
   * Send a message to a Slack channel (utility method)
   */
  async sendMessage(userId, channel, text) {
    try {
      const result = await this.client.chat.postMessage({
        channel: channel,
        text: text,
      });
      console.log('[SlackPlugin] Message sent successfully');
      return result;
    } catch (error) {
      console.error('[SlackPlugin] Error sending message:', error);
      if (error.data && error.data.error === 'channel_not_found') {
        throw new Error('Channel not found. Please check the channel ID.');
      }
      throw error;
    }
  }

  /**
   * Teardown - called when workflow stops
   */
  async teardown() {
    console.log('[SlackPlugin] Tearing down Slack receiver');

    // Stop all polling intervals
    for (const channelId of this.pollingIntervals.keys()) {
      this.stopPolling(channelId);
    }

    // Clear subscriptions
    this.channelSubscriptions.clear();
    this.lastMessageTimestamps.clear();

    // Note: We don't destroy the singleton instance here
    // as other workflows might still be using it
  }
}

/**
 * Singleton factory function
 * Returns the same instance across all calls
 */
function getSlackReceiver() {
  if (!instance) {
    instance = new SlackReceiver();
  }
  return instance;
}

// Export the singleton instance for plugin system
export default getSlackReceiver();
