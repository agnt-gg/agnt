import fs from 'fs';
import path from 'path';
import {
  addCommonMessageOptions,
  addOptional,
  addParseModeOrEntities,
  appendFileSource,
  appendPayloadToFormData,
  buildFileApiUrl,
  failure,
  getBotToken,
  maskToken,
  normalizeMessageResult,
  parseJsonParameter,
  requiredString,
  requestTelegram,
  toBoolean,
  toIntegerOrUndefined,
  validateMethodName
} from './telegram-common.js';

const ACTIONS = new Set([
  'GET_ME',
  'SEND_MESSAGE',
  'SEND_MEDIA',
  'EDIT_MESSAGE',
  'DELETE_MESSAGE',
  'DOWNLOAD_FILE',
  'RAW_METHOD'
]);

const MEDIA_METHODS = {
  photo: { method: 'sendPhoto', field: 'photo', supportsSpoiler: true },
  video: { method: 'sendVideo', field: 'video', supportsSpoiler: true },
  document: { method: 'sendDocument', field: 'document', supportsSpoiler: false },
  audio: { method: 'sendAudio', field: 'audio', supportsSpoiler: false },
  voice: { method: 'sendVoice', field: 'voice', supportsSpoiler: false },
  animation: { method: 'sendAnimation', field: 'animation', supportsSpoiler: true }
};

function normalizeAction(value) {
  const action = String(value || 'SEND_MESSAGE').trim().toUpperCase();
  if (!ACTIONS.has(action)) {
    throw new Error(`Unsupported Telegram action: ${action}. Use one of: ${Array.from(ACTIONS).join(', ')}.`);
  }
  return action;
}

function addMessageTarget(payload, params) {
  const inlineMessageId = String(params.inlineMessageId || '').trim();
  if (inlineMessageId) {
    payload.inline_message_id = inlineMessageId;
    return;
  }

  payload.chat_id = requiredString(params.chatId, 'chatId');
  payload.message_id = toIntegerOrUndefined(params.messageId, 'messageId');
  if (payload.message_id === undefined) {
    throw new Error('Parameter "messageId" is required when inlineMessageId is not set.');
  }
}

function parseMessageIds(params = {}) {
  if (params.messageIds !== undefined && params.messageIds !== null && String(params.messageIds).trim()) {
    return String(params.messageIds)
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const num = Number(part);
        if (!Number.isInteger(num)) throw new Error(`Invalid message ID in messageIds: ${part}`);
        return num;
      });
  }

  const single = toIntegerOrUndefined(params.messageId, 'messageId');
  return single === undefined ? [] : [single];
}

class TelegramAPI {
  constructor() {
    this.name = 'telegram-api';
  }

  async execute(params = {}, inputData, workflowEngine) {
    let action = 'UNKNOWN';

    try {
      action = normalizeAction(params.action);

      switch (action) {
        case 'GET_ME':
          return await this.getMe(params, action);
        case 'SEND_MESSAGE':
          return await this.sendMessage(params, action);
        case 'SEND_MEDIA':
          return await this.sendMedia(params, action);
        case 'EDIT_MESSAGE':
          return await this.editMessage(params, action);
        case 'DELETE_MESSAGE':
          return await this.deleteMessage(params, action);
        case 'DOWNLOAD_FILE':
          return await this.downloadFile(params, action);
        case 'RAW_METHOD':
          return await this.rawMethod(params, action);
        default:
          throw new Error(`Unsupported Telegram action: ${action}`);
      }
    } catch (error) {
      console.error(`[telegram-api] ${action} error:`, error);
      return failure(error, {
        action,
        bot: null,
        messageId: null,
        chatId: null,
        date: null,
        upload: null,
        deletedCount: null,
        results: null,
        file: null,
        filePath: null,
        fileSize: null,
        downloadUrl: null,
        downloadUrlMasked: null,
        savedPath: null,
        result: null,
        raw: null
      });
    }
  }

  async getMe(params, action) {
    const botToken = getBotToken(params);
    const data = await requestTelegram('getMe', {
      botToken,
      apiBaseUrl: params.apiBaseUrl,
      payload: {}
    });

    const result = data.result || {};
    const bot = {
      id: result.id ?? null,
      isBot: result.is_bot ?? null,
      firstName: result.first_name ?? null,
      lastName: result.last_name ?? null,
      username: result.username ?? null,
      canJoinGroups: result.can_join_groups ?? null,
      canReadAllGroupMessages: result.can_read_all_group_messages ?? null,
      supportsInlineQueries: result.supports_inline_queries ?? null,
      canConnectToBusiness: result.can_connect_to_business ?? null,
      hasMainWebApp: result.has_main_web_app ?? null
    };

    return {
      success: true,
      action,
      bot,
      result,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async sendMessage(params, action) {
    const botToken = getBotToken(params);
    const payload = {
      chat_id: requiredString(params.chatId, 'chatId'),
      text: requiredString(params.text, 'text')
    };

    addParseModeOrEntities(payload, params, 'entitiesJson', 'entities');
    addCommonMessageOptions(payload, params);

    const linkPreviewOptions = parseJsonParameter(params.linkPreviewOptionsJson, 'linkPreviewOptionsJson', null);
    if (linkPreviewOptions) {
      payload.link_preview_options = linkPreviewOptions;
    } else if (toBoolean(params.disableLinkPreview)) {
      payload.link_preview_options = { is_disabled: true };
    }

    const data = await requestTelegram('sendMessage', {
      botToken,
      apiBaseUrl: params.apiBaseUrl,
      payload
    });
    const normalized = normalizeMessageResult(data.result);

    return {
      success: true,
      action,
      ...normalized,
      result: data.result,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async sendMedia(params, action) {
    const botToken = getBotToken(params);
    const mediaType = String(params.mediaType || 'document').trim();
    const config = MEDIA_METHODS[mediaType];
    if (!config) {
      throw new Error(`Unsupported mediaType: ${mediaType}. Use one of: ${Object.keys(MEDIA_METHODS).join(', ')}.`);
    }

    const sourceType = String(params.mediaSourceType || 'url_or_file_id').trim();
    const payload = {
      chat_id: requiredString(params.chatId, 'chatId')
    };

    addOptional(payload, 'caption', params.caption);
    addParseModeOrEntities(payload, params, 'captionEntitiesJson', 'caption_entities');
    addCommonMessageOptions(payload, params);

    if (config.supportsSpoiler && toBoolean(params.hasSpoiler)) {
      payload.has_spoiler = true;
    }

    let data;
    let upload = null;

    if (sourceType === 'url_or_file_id') {
      payload[config.field] = requiredString(params.media, 'media');
      data = await requestTelegram(config.method, {
        botToken,
        apiBaseUrl: params.apiBaseUrl,
        payload
      });
    } else if (sourceType === 'local_file_path' || sourceType === 'base64') {
      const form = new FormData();
      appendPayloadToFormData(form, payload);
      upload = await appendFileSource(form, config.field, { ...params, mediaSourceType: sourceType });
      data = await requestTelegram(config.method, {
        botToken,
        apiBaseUrl: params.apiBaseUrl,
        formData: form,
        timeoutMs: 120000
      });
    } else {
      throw new Error('mediaSourceType must be one of: url_or_file_id, local_file_path, base64.');
    }

    const normalized = normalizeMessageResult(data.result);
    return {
      success: true,
      action,
      ...normalized,
      upload,
      result: data.result,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async editMessage(params, action) {
    const botToken = getBotToken(params);
    const editType = String(params.editType || 'text').trim();
    const payload = {};
    addMessageTarget(payload, params);
    addOptional(payload, 'business_connection_id', params.businessConnectionId ? String(params.businessConnectionId).trim() : undefined);

    let method;
    if (editType === 'text') {
      method = 'editMessageText';
      payload.text = requiredString(params.text, 'text');
      addParseModeOrEntities(payload, params, 'entitiesJson', 'entities');
      const linkPreviewOptions = parseJsonParameter(params.linkPreviewOptionsJson, 'linkPreviewOptionsJson', null);
      if (linkPreviewOptions) {
        payload.link_preview_options = linkPreviewOptions;
      } else if (toBoolean(params.disableLinkPreview)) {
        payload.link_preview_options = { is_disabled: true };
      }
    } else if (editType === 'caption') {
      method = 'editMessageCaption';
      payload.caption = params.caption === undefined || params.caption === null ? '' : String(params.caption);
      addParseModeOrEntities(payload, params, 'captionEntitiesJson', 'caption_entities');
    } else if (editType === 'reply_markup') {
      method = 'editMessageReplyMarkup';
    } else {
      throw new Error('editType must be one of: text, caption, reply_markup.');
    }

    const replyMarkup = parseJsonParameter(params.replyMarkupJson, 'replyMarkupJson', null);
    if (replyMarkup) payload.reply_markup = replyMarkup;
    if (editType === 'reply_markup' && !replyMarkup) {
      throw new Error('replyMarkupJson is required when editType=reply_markup.');
    }

    const data = await requestTelegram(method, {
      botToken,
      apiBaseUrl: params.apiBaseUrl,
      payload
    });
    const normalized = normalizeMessageResult(data.result);

    return {
      success: true,
      action,
      ...normalized,
      result: data.result,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async deleteMessage(params, action) {
    const botToken = getBotToken(params);
    const chatId = requiredString(params.chatId, 'chatId');
    const ids = [...new Set(parseMessageIds(params))];
    if (!ids.length) throw new Error('Provide either messageId or messageIds.');

    const results = [];
    for (const messageId of ids) {
      try {
        const data = await requestTelegram('deleteMessage', {
          botToken,
          apiBaseUrl: params.apiBaseUrl,
          payload: { chat_id: chatId, message_id: messageId }
        });
        results.push({
          messageId,
          success: true,
          result: data.result,
          raw: toBoolean(params.includeRaw) ? data : null,
          error: null
        });
      } catch (error) {
        results.push({
          messageId,
          success: false,
          result: null,
          raw: null,
          error: error?.message ? String(error.message) : 'Unknown delete error.'
        });
      }
    }

    const deletedCount = results.filter((item) => item.success).length;
    const success = deletedCount === results.length;
    return {
      success,
      action,
      deletedCount,
      results,
      result: { deletedCount, results },
      error: success ? null : `${results.length - deletedCount} of ${results.length} Telegram message deletion(s) failed.`
    };
  }

  async downloadFile(params, action) {
    const botToken = getBotToken(params);
    const fileId = requiredString(params.fileId, 'fileId');

    const data = await requestTelegram('getFile', {
      botToken,
      apiBaseUrl: params.apiBaseUrl,
      payload: { file_id: fileId }
    });

    const file = data.result || {};
    if (!file.file_path) {
      throw new Error('Telegram getFile response did not include file_path. The file may not be downloadable by this bot.');
    }

    const downloadUrl = buildFileApiUrl(botToken, file.file_path, params.apiBaseUrl);
    const savePath = String(params.savePath || '').trim();
    let savedPath = null;

    if (savePath) {
      const absoluteSavePath = path.resolve(savePath);
      await fs.promises.mkdir(path.dirname(absoluteSavePath), { recursive: true });
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download Telegram file: HTTP ${response.status} ${response.statusText}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.promises.writeFile(absoluteSavePath, buffer);
      savedPath = absoluteSavePath;
    }

    return {
      success: true,
      action,
      file,
      filePath: file.file_path || null,
      fileSize: file.file_size ?? null,
      downloadUrl: toBoolean(params.includeDownloadUrl) ? downloadUrl : null,
      downloadUrlMasked: maskToken(downloadUrl, botToken),
      savedPath,
      result: file,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async rawMethod(params, action) {
    const botToken = getBotToken(params);
    const method = validateMethodName(requiredString(params.method, 'method'));
    const payload = parseJsonParameter(params.payloadJson, 'payloadJson', {});
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payloadJson must be a JSON object.');
    }

    const data = await requestTelegram(method, {
      botToken,
      apiBaseUrl: params.apiBaseUrl,
      payload
    });

    return {
      success: true,
      action,
      result: data.result,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }
}

export default new TelegramAPI();
