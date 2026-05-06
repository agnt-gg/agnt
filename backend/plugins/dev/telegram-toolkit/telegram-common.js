import fs from 'fs';
import path from 'path';

export const DEFAULT_API_BASE_URL = 'https://api.telegram.org';

export function getBotToken(params = {}) {
  // AGNT injects connected provider credentials into params.__auth.token when the
  // manifest declares authRequired/authProvider. Keep botToken as an optional
  // per-node fallback for dev/testing or instances without a native provider yet.
  const injectedToken = params.__auth?.token ?? params.__auth?.accessToken ?? params.__auth?.apiKey;
  const token = String(injectedToken ?? params.botToken ?? '').trim();
  if (!token) {
    throw new Error('Not connected to Telegram. Connect Telegram in Settings → Connections, or provide a BotFather token in the optional botToken fallback field.');
  }
  if (token.includes('/')) {
    throw new Error('Invalid Telegram bot token format. Tokens must not contain slashes.');
  }
  return token;
}

export function normalizeApiBaseUrl(apiBaseUrl) {
  const base = String(apiBaseUrl || DEFAULT_API_BASE_URL).trim() || DEFAULT_API_BASE_URL;
  return base.replace(/\/+$/, '');
}

export function validateMethodName(method) {
  const value = String(method || '').trim();
  if (!value) throw new Error('Telegram Bot API method is required.');
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error('Invalid Telegram Bot API method name. Use names like sendMessage, getChat, or createChatInviteLink.');
  }
  return value;
}

export function buildBotApiUrl(botToken, method, apiBaseUrl) {
  return `${normalizeApiBaseUrl(apiBaseUrl)}/bot${botToken}/${validateMethodName(method)}`;
}

export function buildFileApiUrl(botToken, filePath, apiBaseUrl) {
  const encodedPath = String(filePath || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${normalizeApiBaseUrl(apiBaseUrl)}/file/bot${botToken}/${encodedPath}`;
}

export function maskToken(value, token) {
  if (!value) return value;
  const safeToken = String(token || '');
  return safeToken ? String(value).replaceAll(safeToken, '<telegram-bot-token>') : String(value);
}

export function requiredString(value, fieldName) {
  const out = String(value ?? '').trim();
  if (!out) throw new Error(`Parameter "${fieldName}" is required.`);
  return out;
}

export function parseJsonParameter(value, fieldName, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  const text = String(value).trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Parameter "${fieldName}" must be valid JSON: ${error.message}`);
  }
}

export function toBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null || value === '') return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export function toIntegerOrUndefined(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isInteger(num)) throw new Error(`Parameter "${fieldName}" must be an integer.`);
  return num;
}

export function normalizeParseMode(parseMode) {
  const value = String(parseMode || 'none').trim();
  if (!value || value.toLowerCase() === 'none') return undefined;
  const allowed = new Set(['HTML', 'MarkdownV2', 'Markdown']);
  if (!allowed.has(value)) {
    throw new Error('Invalid parseMode. Use one of: none, HTML, MarkdownV2, Markdown.');
  }
  return value;
}

export function addOptional(payload, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    payload[key] = value;
  }
}

export function addCommonMessageOptions(payload, params = {}) {
  const messageThreadId = toIntegerOrUndefined(params.messageThreadId, 'messageThreadId');
  if (messageThreadId !== undefined) payload.message_thread_id = messageThreadId;

  if (toBoolean(params.disableNotification)) payload.disable_notification = true;
  if (toBoolean(params.protectContent)) payload.protect_content = true;

  const replyToMessageId = toIntegerOrUndefined(params.replyToMessageId, 'replyToMessageId');
  if (replyToMessageId !== undefined) payload.reply_parameters = { message_id: replyToMessageId };

  addOptional(payload, 'business_connection_id', params.businessConnectionId ? String(params.businessConnectionId).trim() : undefined);

  const replyMarkup = parseJsonParameter(params.replyMarkupJson, 'replyMarkupJson', null);
  if (replyMarkup) payload.reply_markup = replyMarkup;
}

export function addParseModeOrEntities(payload, params = {}, entitiesField = 'entitiesJson', telegramEntitiesKey = 'entities') {
  const entities = parseJsonParameter(params[entitiesField], entitiesField, null);
  if (entities) {
    if (!Array.isArray(entities)) throw new Error(`Parameter "${entitiesField}" must be a JSON array.`);
    payload[telegramEntitiesKey] = entities;
    return;
  }
  const parseMode = normalizeParseMode(params.parseMode);
  if (parseMode) payload.parse_mode = parseMode;
}

export async function requestTelegram(method, { botToken, apiBaseUrl, payload = {}, formData = null, timeoutMs = 30000 } = {}) {
  const url = buildBotApiUrl(botToken, method, apiBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const options = {
    method: 'POST',
    headers: { Accept: 'application/json' },
    signal: controller.signal
  };

  if (formData) {
    options.body = formData;
  } else {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(payload || {});
  }

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { ok: false, description: text || response.statusText || 'Non-JSON response from Telegram API.' };
    }

    if (!response.ok || !data?.ok) {
      const code = data?.error_code || response.status || 'unknown';
      const description = data?.description || response.statusText || 'Telegram API request failed.';
      const retryAfter = data?.parameters?.retry_after;
      const migrationTarget = data?.parameters?.migrate_to_chat_id;
      let message = `Telegram API error ${code}: ${description}`;
      if (retryAfter) message += ` Retry after ${retryAfter} seconds.`;
      if (migrationTarget) message += ` Chat migrated to ${migrationTarget}.`;
      const error = new Error(message);
      error.telegram = data;
      throw error;
    }

    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Telegram API request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function appendPayloadToFormData(form, payload = {}) {
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'object') {
      form.append(key, JSON.stringify(value));
    } else {
      form.append(key, String(value));
    }
  }
}

export function guessMimeType(fileName = '') {
  const ext = path.extname(String(fileName).toLowerCase());
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.zip': 'application/zip'
  };
  return map[ext] || 'application/octet-stream';
}

export async function appendFileSource(form, fieldName, params = {}) {
  const sourceType = String(params.mediaSourceType || '').trim();
  const providedMimeType = params.mimeType ? String(params.mimeType).trim() : '';

  if (sourceType === 'local_file_path') {
    const requestedPath = requiredString(params.filePath, 'filePath');
    const absolutePath = path.resolve(requestedPath);
    const stats = await fs.promises.stat(absolutePath).catch(() => null);
    if (!stats) throw new Error(`filePath does not exist: ${absolutePath}`);
    if (!stats.isFile()) throw new Error(`filePath is not a file: ${absolutePath}`);

    const resolvedName = params.fileName ? String(params.fileName).trim() : path.basename(absolutePath);
    const buffer = await fs.promises.readFile(absolutePath);
    const blob = new Blob([buffer], { type: providedMimeType || guessMimeType(resolvedName) });
    form.append(fieldName, blob, resolvedName);
    return {
      sourceType,
      fileName: resolvedName,
      fileSize: stats.size,
      mimeType: blob.type,
      filePath: absolutePath
    };
  }

  if (sourceType === 'base64') {
    const raw = requiredString(params.fileData, 'fileData');
    const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.*)$/s);
    const mimeType = providedMimeType || (dataUrlMatch ? dataUrlMatch[1] : 'application/octet-stream');
    const base64 = dataUrlMatch ? dataUrlMatch[2] : raw;
    const resolvedName = requiredString(params.fileName, 'fileName');
    const buffer = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
    if (!buffer.length) throw new Error('fileData decoded to an empty file.');
    const blob = new Blob([buffer], { type: mimeType || guessMimeType(resolvedName) });
    form.append(fieldName, blob, resolvedName);
    return {
      sourceType,
      fileName: resolvedName,
      fileSize: buffer.length,
      mimeType: blob.type,
      filePath: null
    };
  }

  throw new Error('mediaSourceType must be local_file_path or base64 for file uploads.');
}

export function normalizeMessageResult(result) {
  if (!result || typeof result !== 'object') {
    return { messageId: null, chatId: null, date: null };
  }
  return {
    messageId: result.message_id ?? null,
    chatId: result.chat?.id !== undefined && result.chat?.id !== null ? String(result.chat.id) : null,
    date: result.date ?? null
  };
}

export function failure(error, extra = {}) {
  return {
    success: false,
    ...extra,
    error: error?.message ? String(error.message) : 'Unknown error occurred.'
  };
}
