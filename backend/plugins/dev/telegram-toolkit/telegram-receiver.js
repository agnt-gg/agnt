import crypto from 'crypto';
import EventEmitter from 'events';
import {
  getBotToken,
  normalizeApiBaseUrl,
  requestTelegram,
  toBoolean,
  toIntegerOrUndefined
} from './telegram-common.js';

const ALL_SUPPORTED_UPDATES = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'callback_query',
  'inline_query',
  'chosen_inline_result',
  'poll',
  'poll_answer',
  'my_chat_member',
  'chat_member',
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages'
];

const MESSAGE_PRESET_TYPES = new Set(['message', 'edited_message']);
const CHANNEL_PRESET_TYPES = new Set(['channel_post', 'edited_channel_post']);
const BUTTON_PRESET_TYPES = new Set(['message', 'edited_message', 'callback_query']);

let instance = null;

function sleep(ms, state) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => {
    state.sleepTimer = setTimeout(() => {
      state.sleepTimer = null;
      resolve();
    }, ms);
  });
}

function numberParam(value, fieldName, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error(`Parameter "${fieldName}" must be a number.`);
  return Math.max(min, Math.min(max, Math.trunc(num)));
}

function boolParam(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return toBoolean(value);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value ?? '').trim();
  if (!text) return [];
  return text.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function normalizeCommand(value) {
  return String(value || '').trim().replace(/^\//, '').split('@')[0].toLowerCase();
}

function extractCommand(text) {
  const value = String(text || '').trim();
  if (!value.startsWith('/')) return { command: null, args: null };

  const match = value.match(/^\/([^\s@]+)(?:@[^\s]+)?(?:\s+([\s\S]*))?$/);
  if (!match) return { command: null, args: null };

  return {
    command: String(match[1] || '').toLowerCase(),
    args: match[2] ? String(match[2]).trim() : ''
  };
}

function pickLargestPhoto(photos = []) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  return [...photos].sort((a, b) => (a.file_size || 0) - (b.file_size || 0)).at(-1);
}

function extractFile(message) {
  if (!message || typeof message !== 'object') return {};

  const candidates = [
    ['document', message.document],
    ['video', message.video],
    ['audio', message.audio],
    ['voice', message.voice],
    ['animation', message.animation],
    ['sticker', message.sticker],
    ['video_note', message.video_note]
  ];

  const photo = pickLargestPhoto(message.photo);
  if (photo) {
    return {
      fileType: 'photo',
      fileId: photo.file_id || null,
      fileUniqueId: photo.file_unique_id || null,
      fileName: null,
      mimeType: null,
      fileSize: photo.file_size ?? null
    };
  }

  for (const [fileType, file] of candidates) {
    if (!file) continue;
    return {
      fileType,
      fileId: file.file_id || null,
      fileUniqueId: file.file_unique_id || null,
      fileName: file.file_name || null,
      mimeType: file.mime_type || null,
      fileSize: file.file_size ?? null
    };
  }

  return {
    fileType: null,
    fileId: null,
    fileUniqueId: null,
    fileName: null,
    mimeType: null,
    fileSize: null
  };
}

function pickPayload(update = {}) {
  if (update.message) return { updateType: 'message', message: update.message, user: update.message.from || null };
  if (update.edited_message) return { updateType: 'edited_message', message: update.edited_message, user: update.edited_message.from || null };
  if (update.channel_post) return { updateType: 'channel_post', message: update.channel_post, user: update.channel_post.from || update.channel_post.sender_chat || null };
  if (update.edited_channel_post) return { updateType: 'edited_channel_post', message: update.edited_channel_post, user: update.edited_channel_post.from || update.edited_channel_post.sender_chat || null };
  if (update.callback_query) return { updateType: 'callback_query', callbackQuery: update.callback_query, message: update.callback_query.message || null, user: update.callback_query.from || null };
  if (update.inline_query) return { updateType: 'inline_query', inlineQuery: update.inline_query, message: null, user: update.inline_query.from || null };
  if (update.chosen_inline_result) return { updateType: 'chosen_inline_result', chosenInlineResult: update.chosen_inline_result, message: null, user: update.chosen_inline_result.from || null };
  if (update.poll) return { updateType: 'poll', poll: update.poll, message: null, user: null };
  if (update.poll_answer) return { updateType: 'poll_answer', pollAnswer: update.poll_answer, message: null, user: update.poll_answer.user || null };
  if (update.my_chat_member) return { updateType: 'my_chat_member', chatMember: update.my_chat_member, message: null, user: update.my_chat_member.from || null, chat: update.my_chat_member.chat || null };
  if (update.chat_member) return { updateType: 'chat_member', chatMember: update.chat_member, message: null, user: update.chat_member.from || null, chat: update.chat_member.chat || null };
  if (update.business_connection) return { updateType: 'business_connection', businessConnection: update.business_connection, message: null, user: update.business_connection.user || null };
  if (update.business_message) return { updateType: 'business_message', message: update.business_message, user: update.business_message.from || null };
  if (update.edited_business_message) return { updateType: 'edited_business_message', message: update.edited_business_message, user: update.edited_business_message.from || null };
  if (update.deleted_business_messages) return { updateType: 'deleted_business_messages', deletedBusinessMessages: update.deleted_business_messages, message: null, user: null, chat: update.deleted_business_messages.chat || null };

  return { updateType: 'unknown', message: null, user: null };
}

function normalizeUpdate(update = {}) {
  const payload = pickPayload(update);
  const message = payload.message || null;
  const callbackQuery = payload.callbackQuery || null;
  const chat = message?.chat || payload.chat || callbackQuery?.message?.chat || null;
  const user = payload.user || null;
  const text = message?.text ?? null;
  const caption = message?.caption ?? null;
  const commandInfo = extractCommand(text);
  const file = extractFile(message);

  return {
    updateId: update.update_id ?? null,
    updateType: payload.updateType,
    chatId: chat?.id !== undefined && chat?.id !== null ? String(chat.id) : null,
    chatType: chat?.type || null,
    chatTitle: chat?.title || null,
    chatUsername: chat?.username ? `@${String(chat.username).replace(/^@/, '')}` : null,
    messageId: message?.message_id ?? callbackQuery?.message?.message_id ?? null,
    messageThreadId: message?.message_thread_id ?? null,
    fromId: user?.id !== undefined && user?.id !== null ? String(user.id) : null,
    fromUsername: user?.username ? `@${String(user.username).replace(/^@/, '')}` : null,
    fromFirstName: user?.first_name || null,
    fromLastName: user?.last_name || null,
    fromIsBot: user?.is_bot ?? null,
    text,
    command: commandInfo.command,
    args: commandInfo.args,
    caption,
    callbackQueryId: callbackQuery?.id || null,
    callbackData: callbackQuery?.data || null,
    callbackInlineMessageId: callbackQuery?.inline_message_id || null,
    date: message?.date ?? null,
    entities: message?.entities || [],
    captionEntities: message?.caption_entities || [],
    pollId: payload.poll?.id || payload.pollAnswer?.poll_id || null,
    businessConnectionId: message?.business_connection_id || payload.businessConnection?.id || null,
    ...file
  };
}

function matchesPreset(update, preset) {
  switch (preset) {
    case 'messages_only':
      return MESSAGE_PRESET_TYPES.has(update.updateType);
    case 'commands_only':
      return MESSAGE_PRESET_TYPES.has(update.updateType) && !!update.command;
    case 'callbacks_only':
      return update.updateType === 'callback_query';
    case 'channels':
      return CHANNEL_PRESET_TYPES.has(update.updateType);
    case 'all_supported':
      return true;
    case 'messages_and_buttons':
    default:
      return BUTTON_PRESET_TYPES.has(update.updateType);
  }
}

function matchesChat(update, chatFilters) {
  if (!chatFilters.length) return true;
  const chatId = update.chatId ? String(update.chatId) : '';
  const chatUsername = update.chatUsername ? String(update.chatUsername).toLowerCase() : '';

  return chatFilters.some((filter) => {
    const value = String(filter).trim();
    if (!value) return true;
    if (value.startsWith('@')) return chatUsername === value.toLowerCase();
    return chatId === value;
  });
}

function matchesCommand(update, commandFilters) {
  if (!commandFilters.length) return true;
  if (!update.command) return false;
  return commandFilters.some((filter) => normalizeCommand(filter) === update.command);
}

class TelegramReceiver extends EventEmitter {
  constructor() {
    super();
    this.name = 'receive-telegram-update';
    this.pollers = new Map();
    this.subscriptions = new Map();
  }

  async setup(engine, node) {
    console.log('[TelegramPlugin] Setting up Telegram update receiver trigger');

    const params = node?.parameters || {};
    const botToken = getBotToken(params);
    const apiBaseUrl = normalizeApiBaseUrl(params.apiBaseUrl);
    const tokenHash = hashToken(botToken);
    const pollerKey = `${apiBaseUrl}:${tokenHash}`;
    const subscriptionId = `${engine?.workflowId || engine?.id || engine?.userId || 'workflow'}:${node?.id || node?.nodeId || Date.now()}:${Math.random().toString(36).slice(2)}`;

    const subscription = {
      id: subscriptionId,
      engine,
      node,
      tokenHash,
      updateTypes: String(params.updateTypes || 'messages_and_buttons').trim(),
      chatFilters: parseList(params.chatFilter),
      commandFilters: parseList(params.commandFilter).map(normalizeCommand).filter(Boolean),
      ignoreBotMessages: boolParam(params.ignoreBotMessages, true),
      includeRaw: boolParam(params.includeRaw, false),
      callback: (updateData) => engine.processWorkflowTrigger(updateData)
    };

    if (!this.pollers.has(pollerKey)) {
      await this.createPoller(pollerKey, {
        botToken,
        apiBaseUrl,
        tokenHash,
        dropPendingUpdatesOnStart: boolParam(params.dropPendingUpdatesOnStart, true),
        deleteWebhookOnStart: boolParam(params.deleteWebhookOnStart, false),
        pollTimeoutSeconds: numberParam(params.pollTimeoutSeconds, 'pollTimeoutSeconds', 25, 1, 50),
        pollIntervalMs: numberParam(params.pollIntervalMs, 'pollIntervalMs', 1000, 0, 60000),
        limit: numberParam(params.limit, 'limit', 100, 1, 100)
      });
    }

    this.subscriptions.set(subscriptionId, subscription);
    this.pollers.get(pollerKey).subscriptions.add(subscriptionId);

    if (engine) {
      engine.receivers = engine.receivers || {};
      engine.receivers.telegram = this;
    }

    console.log(`[TelegramPlugin] Subscribed to Telegram updates for token ${tokenHash}`);
  }

  async createPoller(key, config) {
    const state = {
      key,
      ...config,
      offset: undefined,
      running: true,
      subscriptions: new Set(),
      consecutiveErrors: 0,
      sleepTimer: null
    };

    this.pollers.set(key, state);

    if (state.deleteWebhookOnStart) {
      await requestTelegram('deleteWebhook', {
        botToken: state.botToken,
        apiBaseUrl: state.apiBaseUrl,
        payload: { drop_pending_updates: state.dropPendingUpdatesOnStart },
        timeoutMs: 15000
      });
      console.log(`[TelegramPlugin] Deleted webhook for token ${state.tokenHash}`);
    } else if (state.dropPendingUpdatesOnStart) {
      await this.dropPendingUpdates(state);
    }

    this.pollLoop(state).catch((error) => {
      console.error(`[TelegramPlugin] Poll loop crashed for token ${state.tokenHash}:`, error);
    });

    return state;
  }

  async dropPendingUpdates(state) {
    try {
      const data = await requestTelegram('getUpdates', {
        botToken: state.botToken,
        apiBaseUrl: state.apiBaseUrl,
        payload: {
          offset: -1,
          limit: 1,
          timeout: 0,
          allowed_updates: ALL_SUPPORTED_UPDATES
        },
        timeoutMs: 15000
      });

      const latest = Array.isArray(data.result) && data.result.length ? data.result.at(-1) : null;
      if (latest?.update_id !== undefined) {
        state.offset = latest.update_id + 1;
      }
      console.log(`[TelegramPlugin] Dropped pending updates for token ${state.tokenHash}`);
    } catch (error) {
      console.error(`[TelegramPlugin] Failed to drop pending updates for token ${state.tokenHash}:`, error);
      throw error;
    }
  }

  async pollLoop(state) {
    console.log(`[TelegramPlugin] Started long polling for token ${state.tokenHash}`);

    while (state.running) {
      try {
        const payload = {
          timeout: state.pollTimeoutSeconds,
          limit: state.limit,
          allowed_updates: ALL_SUPPORTED_UPDATES
        };
        if (state.offset !== undefined && state.offset !== null) payload.offset = state.offset;

        const data = await requestTelegram('getUpdates', {
          botToken: state.botToken,
          apiBaseUrl: state.apiBaseUrl,
          payload,
          timeoutMs: (state.pollTimeoutSeconds + 15) * 1000
        });

        state.consecutiveErrors = 0;
        const updates = Array.isArray(data.result) ? data.result : [];
        for (const rawUpdate of updates) {
          if (rawUpdate?.update_id !== undefined) {
            state.offset = rawUpdate.update_id + 1;
          }

          const normalized = normalizeUpdate(rawUpdate);
          await this.dispatchUpdate(state, normalized, rawUpdate);
        }
      } catch (error) {
        state.consecutiveErrors += 1;
        const hint = String(error?.message || '').includes('webhook')
          ? ' Telegram reports a webhook conflict. Enable deleteWebhookOnStart on this trigger, or remove the webhook manually.'
          : '';
        console.error(`[TelegramPlugin] Error polling Telegram for token ${state.tokenHash}:${hint}`, error);
      }

      if (state.running) {
        const backoffMs = Math.min(state.pollIntervalMs * Math.max(1, state.consecutiveErrors), 30000);
        await sleep(backoffMs, state);
      }
    }

    console.log(`[TelegramPlugin] Stopped long polling for token ${state.tokenHash}`);
  }

  async dispatchUpdate(state, normalized, rawUpdate) {
    const subscriptionIds = [...state.subscriptions];
    for (const subscriptionId of subscriptionIds) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (!subscription) continue;
      if (!this.matchesSubscription(normalized, subscription)) continue;

      const updateData = {
        ...normalized,
        raw: subscription.includeRaw ? rawUpdate : null,
        response: subscription.includeRaw ? rawUpdate : { ...normalized, raw: null }
      };

      try {
        this.emit('update', updateData);
        await Promise.resolve(subscription.callback(updateData));
      } catch (error) {
        console.error('[TelegramPlugin] Error dispatching Telegram update to workflow:', error);
      }
    }
  }

  matchesSubscription(update, subscription) {
    if (subscription.ignoreBotMessages && update.fromIsBot) return false;
    if (!matchesPreset(update, subscription.updateTypes)) return false;
    if (!matchesChat(update, subscription.chatFilters)) return false;
    if (!matchesCommand(update, subscription.commandFilters)) return false;
    return true;
  }

  validate(triggerData) {
    return !!triggerData && triggerData.updateId !== undefined && !!triggerData.updateType;
  }

  async process(inputData, engine) {
    return {
      updateId: inputData.updateId,
      updateType: inputData.updateType,
      chatId: inputData.chatId,
      chatType: inputData.chatType,
      chatTitle: inputData.chatTitle,
      chatUsername: inputData.chatUsername,
      messageId: inputData.messageId,
      messageThreadId: inputData.messageThreadId,
      fromId: inputData.fromId,
      fromUsername: inputData.fromUsername,
      fromFirstName: inputData.fromFirstName,
      fromLastName: inputData.fromLastName,
      fromIsBot: inputData.fromIsBot,
      text: inputData.text,
      command: inputData.command,
      args: inputData.args,
      caption: inputData.caption,
      callbackQueryId: inputData.callbackQueryId,
      callbackData: inputData.callbackData,
      callbackInlineMessageId: inputData.callbackInlineMessageId,
      fileId: inputData.fileId,
      fileUniqueId: inputData.fileUniqueId,
      fileType: inputData.fileType,
      fileName: inputData.fileName,
      mimeType: inputData.mimeType,
      fileSize: inputData.fileSize,
      date: inputData.date,
      entities: inputData.entities || [],
      captionEntities: inputData.captionEntities || [],
      pollId: inputData.pollId,
      businessConnectionId: inputData.businessConnectionId,
      raw: inputData.raw || null,
      response: inputData.response || inputData
    };
  }

  async teardown() {
    console.log('[TelegramPlugin] Tearing down Telegram receiver');

    for (const state of this.pollers.values()) {
      state.running = false;
      if (state.sleepTimer) {
        clearTimeout(state.sleepTimer);
        state.sleepTimer = null;
      }
      state.subscriptions.clear();
    }

    this.pollers.clear();
    this.subscriptions.clear();
    this.removeAllListeners('update');
  }
}

function getTelegramReceiver() {
  if (!instance) instance = new TelegramReceiver();
  return instance;
}

export default getTelegramReceiver();
