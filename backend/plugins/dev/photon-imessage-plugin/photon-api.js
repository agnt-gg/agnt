// photon-api.js
// AGNT action tool: send iMessages + manage Photon Spectrum conversations.
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_API_BASE_URL,
  failure,
  getPhotonCredentials,
  normalizePhone,
  parseJsonParameter,
  requestSpectrum,
  requiredString,
  toBoolean,
  toIntegerOrDefault
} from './photon-common.js';

const ACTIONS = new Set([
  'GET_STATUS',
  'SEND_MESSAGE',
  'SEND_ATTACHMENT',
  'LIST_SPACES',
  'LIST_MESSAGES',
  'REGISTER_USER',
  'GET_ASSIGNED_LINE',
  'RAW_SPECTRUM_CALL'
]);

function normalizeAction(value) {
  const action = String(value || 'SEND_MESSAGE').trim().toUpperCase();
  if (!ACTIONS.has(action)) {
    throw new Error(`Unsupported Photon action: ${action}. Use one of: ${Array.from(ACTIONS).join(', ')}.`);
  }
  return action;
}

/**
 * Resolve the destination for an outbound message. Photon Spectrum addresses
 * conversations by spaceId; for a brand new conversation you address a
 * recipient phone number and Photon opens/looks up the space.
 */
function resolveTarget(params) {
  const spaceId = String(params.spaceId || '').trim();
  const recipient = normalizePhone(params.recipient);
  if (!spaceId && !recipient) {
    throw new Error('Provide either spaceId (existing conversation) or recipient (E.164 phone number) to send a message.');
  }
  return { spaceId: spaceId || null, recipient: recipient || null };
}

class PhotonAPI {
  constructor() {
    this.name = 'photon-imessage-api';
  }

  async execute(params = {}, inputData, workflowEngine) {
    let action = 'UNKNOWN';
    try {
      action = normalizeAction(params.action);
      const creds = getPhotonCredentials(params);
      const apiBaseUrl = String(params.apiBaseUrl || DEFAULT_API_BASE_URL).trim();
      const ctx = { ...creds, apiBaseUrl };

      switch (action) {
        case 'GET_STATUS':
          return await this.getStatus(ctx, params, action);
        case 'GET_ASSIGNED_LINE':
          return await this.getAssignedLine(ctx, params, action);
        case 'SEND_MESSAGE':
          return await this.sendMessage(ctx, params, action);
        case 'SEND_ATTACHMENT':
          return await this.sendAttachment(ctx, params, action);
        case 'LIST_SPACES':
          return await this.listSpaces(ctx, params, action);
        case 'LIST_MESSAGES':
          return await this.listMessages(ctx, params, action);
        case 'REGISTER_USER':
          return await this.registerUser(ctx, params, action);
        case 'RAW_SPECTRUM_CALL':
          return await this.rawCall(ctx, params, action);
        default:
          throw new Error(`Unsupported Photon action: ${action}`);
      }
    } catch (error) {
      console.error(`[PhotonPlugin] ${action} error:`, error?.message || error);
      return failure(error, {
        action,
        messageId: null,
        spaceId: null,
        assignedLine: null,
        spaces: null,
        messages: null,
        result: null,
        raw: null
      });
    }
  }

  async getStatus(ctx, params, action) {
    const data = await requestSpectrum('app.status', {
      ...ctx,
      query: {},
      timeoutMs: 15000
    });
    return {
      success: true,
      action,
      assignedLine: data.assignedLine || data.line || data.number || null,
      result: data,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async getAssignedLine(ctx, params, action) {
    const data = await requestSpectrum('app.status', { ...ctx, query: {}, timeoutMs: 15000 });
    const assignedLine = data.assignedLine || data.line || data.number || null;
    return {
      success: true,
      action,
      assignedLine,
      result: { assignedLine },
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async sendMessage(ctx, params, action) {
    const { spaceId, recipient } = resolveTarget(params);
    const text = requiredString(params.message, 'message');

    const payload = { text };
    if (spaceId) payload.spaceId = spaceId;
    if (recipient) payload.recipient = recipient;

    const data = await requestSpectrum('space.send', { ...ctx, payload, timeoutMs: 30000 });
    const sent = data.message || data;

    return {
      success: true,
      action,
      messageId: sent.id || sent.messageId || null,
      spaceId: sent.spaceId || sent.space_id || spaceId || null,
      result: data,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async sendAttachment(ctx, params, action) {
    const { spaceId, recipient } = resolveTarget(params);
    const filePath = requiredString(params.filePath, 'filePath');
    const absPath = path.resolve(filePath);
    const stats = await fs.promises.stat(absPath).catch(() => null);
    if (!stats || !stats.isFile()) {
      throw new Error(`filePath does not exist or is not a file: ${absPath}`);
    }
    const buffer = await fs.promises.readFile(absPath);
    const fileName = String(params.fileName || path.basename(absPath)).trim();

    // Photon supports outbound attachments (images, voice notes, video, docs).
    // Captions arrive as a separate iMessage bubble, matching the documented behavior.
    const payload = {
      filename: fileName,
      // base64 keeps this transport-agnostic; swap to multipart if the real
      // Spectrum endpoint prefers it.
      data: buffer.toString('base64')
    };
    if (params.message) payload.caption = String(params.message);
    if (spaceId) payload.spaceId = spaceId;
    if (recipient) payload.recipient = recipient;

    const data = await requestSpectrum('space.sendAttachment', { ...ctx, payload, timeoutMs: 120000 });
    const sent = data.message || data;

    return {
      success: true,
      action,
      messageId: sent.id || sent.messageId || null,
      spaceId: sent.spaceId || sent.space_id || spaceId || null,
      fileName,
      fileSize: stats.size,
      result: data,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async listSpaces(ctx, params, action) {
    const data = await requestSpectrum('app.spaces.list', {
      ...ctx,
      query: { limit: toIntegerOrDefault(params.limit, 50, 1, 200) },
      timeoutMs: 20000
    });
    const spaces = data.spaces || data.results || data.items || [];
    return {
      success: true,
      action,
      spaces,
      result: data,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async listMessages(ctx, params, action) {
    const spaceId = requiredString(params.spaceId, 'spaceId');
    const data = await requestSpectrum('app.messages.list', {
      ...ctx,
      query: { spaceId, limit: toIntegerOrDefault(params.limit, 50, 1, 200) },
      timeoutMs: 20000
    });
    const messages = data.messages || data.results || data.items || [];
    return {
      success: true,
      action,
      spaceId,
      messages,
      result: data,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async registerUser(ctx, params, action) {
    const phone = normalizePhone(requiredString(params.recipient || params.phoneNumber, 'recipient/phoneNumber'));
    const data = await requestSpectrum('app.users.register', {
      ...ctx,
      payload: { phone },
      timeoutMs: 20000
    });
    return {
      success: true,
      action,
      phone,
      assignedLine: data.assignedLine || data.line || data.number || null,
      result: data,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }

  async rawCall(ctx, params, action) {
    const method = requiredString(params.method, 'method');
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/i.test(method)) {
      throw new Error('method must be a dotted Spectrum method name, e.g. "space.send" or "app.status".');
    }
    const payload = parseJsonParameter(params.payloadJson, 'payloadJson', {});
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payloadJson must be a JSON object.');
    }
    const httpMethod = params.httpMethod ? String(params.httpMethod).trim().toUpperCase() : undefined;
    const data = await requestSpectrum(method, {
      ...ctx,
      payload,
      query: httpMethod === 'GET' ? payload : null,
      httpMethod,
      timeoutMs: 30000
    });
    return {
      success: true,
      action,
      result: data,
      raw: toBoolean(params.includeRaw) ? data : null,
      error: null
    };
  }
}

export default new PhotonAPI();
