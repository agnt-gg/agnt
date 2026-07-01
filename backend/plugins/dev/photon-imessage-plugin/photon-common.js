// photon-common.js
// Shared helpers for the AGNT Photon iMessage plugin.
//
// Photon's official transport is the `spectrum-ts` SDK over a long-lived gRPC
// stream. That SDK is TypeScript-only and (as of this writing) does not publish
// stable, documented REST equivalents. To keep this plugin self-contained inside
// AGNT's Node plugin runtime — and avoid bundling an unverified gRPC client — we
// talk to Photon's Spectrum service over a configurable REST/JSON base URL.
//
// The exact request/response shapes for `space.send` and `app.messages` are
// abstracted behind the functions in this file. When you confirm the real
// Spectrum endpoints, you only need to adjust the URL builders and the
// normalize* functions here — the action/trigger modules stay unchanged.

export const DEFAULT_API_BASE_URL = 'https://spectrum.photon.codes';

/**
 * Resolve the Photon Spectrum credentials.
 *
 * AGNT injects connected-provider credentials into params.__auth when the
 * manifest declares authRequired/authProvider. Photon needs a project id +
 * project secret pair. We support both an AGNT auth provider (preferred) and
 * direct per-node fallback fields (good for the prototype phase before a
 * first-class `photon` provider exists in Settings → Connections).
 */
export function getPhotonCredentials(params = {}) {
  const auth = params.__auth || {};

  // An AGNT apiKey provider stores its value in token/apiKey/accessToken.
  // We allow the secret to be either a raw project secret, or a JSON blob
  // like {"projectId":"...","projectSecret":"..."} for convenience.
  let providerProjectId = auth.projectId || auth.project_id || null;
  let providerProjectSecret =
    auth.token ?? auth.apiKey ?? auth.accessToken ?? auth.projectSecret ?? auth.project_secret ?? null;

  if (typeof providerProjectSecret === 'string' && providerProjectSecret.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(providerProjectSecret);
      providerProjectId = providerProjectId || parsed.projectId || parsed.project_id || null;
      providerProjectSecret = parsed.projectSecret || parsed.project_secret || parsed.secret || providerProjectSecret;
    } catch (_) {
      /* not JSON, treat as raw secret */
    }
  }

  const projectId = String(params.projectId ?? providerProjectId ?? '').trim();
  const projectSecret = String(params.projectSecret ?? providerProjectSecret ?? '').trim();

  if (!projectId || !projectSecret) {
    throw new Error(
      'Not connected to Photon. Connect Photon in Settings → Connections, or provide projectId + projectSecret in the node fallback fields. ' +
        'Get these from app.photon.codes → your AGNT project → Spectrum.'
    );
  }

  return { projectId, projectSecret };
}

export function normalizeApiBaseUrl(apiBaseUrl) {
  const base = String(apiBaseUrl || DEFAULT_API_BASE_URL).trim() || DEFAULT_API_BASE_URL;
  return base.replace(/\/+$/, '');
}

export function requiredString(value, fieldName) {
  const out = String(value ?? '').trim();
  if (!out) throw new Error(`Parameter "${fieldName}" is required.`);
  return out;
}

export function toBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null || value === '') return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export function toIntegerOrDefault(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const truncated = Math.trunc(num);
  if (min !== undefined && truncated < min) return min;
  if (max !== undefined && truncated > max) return max;
  return truncated;
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

/**
 * Parse a comma/newline separated list of phone numbers or arbitrary strings.
 */
export function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value ?? '').trim();
  if (!text) return [];
  return text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Best-effort normalization of a phone number to a comparable E.164-ish key.
 * Strips spaces, dashes, parens; keeps a leading +. This is for allowlist
 * matching only — it does not validate that a number is real.
 */
export function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/[^0-9]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Mask a secret inside a string for safe logging.
 */
export function maskSecret(value, secret) {
  if (!value) return value;
  const safe = String(secret || '');
  return safe ? String(value).replaceAll(safe, '<photon-project-secret>') : String(value);
}

/**
 * Core Spectrum request helper.
 *
 * @param {string} method   Logical Spectrum method, e.g. 'space.send', 'app.messages', 'app.users.register', 'app.status'.
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.projectSecret
 * @param {string} opts.apiBaseUrl
 * @param {object} opts.payload     JSON body
 * @param {string} opts.httpMethod  Override HTTP verb (defaults to POST, GET for *.list/*.status)
 * @param {number} opts.timeoutMs
 */
export async function requestSpectrum(method, opts = {}) {
  const {
    projectId,
    projectSecret,
    apiBaseUrl,
    payload = {},
    httpMethod,
    timeoutMs = 30000,
    query = null
  } = opts;

  const base = normalizeApiBaseUrl(apiBaseUrl);
  // Map a dotted logical method to a REST path: space.send -> /v1/space/send
  const pathSegment = String(method || '')
    .trim()
    .split('.')
    .map((part) => encodeURIComponent(part))
    .join('/');
  let url = `${base}/v1/${pathSegment}`;

  const verb = httpMethod || (/(\.list|\.status|\.messages|\.get)$/.test(method) ? 'GET' : 'POST');

  if (verb === 'GET' && query && typeof query === 'object') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      qs.append(k, String(v));
    }
    const qsStr = qs.toString();
    if (qsStr) url += `?${qsStr}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const options = {
    method: verb,
    headers: {
      Accept: 'application/json',
      // Photon Spectrum auth: project id + project secret. We send both a
      // bearer-style secret and an explicit project header so this works
      // regardless of which scheme the deployment expects.
      Authorization: `Bearer ${projectSecret}`,
      'X-Photon-Project-Id': projectId,
      'X-Photon-Project-Secret': projectSecret
    },
    signal: controller.signal
  };

  if (verb !== 'GET') {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify({ projectId, ...payload });
  }

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = { ok: false, error: text || response.statusText || 'Non-JSON response from Photon Spectrum.' };
    }

    if (!response.ok || data?.ok === false || data?.error) {
      const code = data?.code || response.status || 'unknown';
      const description =
        data?.error || data?.message || response.statusText || 'Photon Spectrum request failed.';
      const error = new Error(`Photon Spectrum error ${code}: ${maskSecret(description, projectSecret)}`);
      error.photon = data;
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Photon Spectrum request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Normalize an inbound Spectrum message into AGNT's flat event shape.
 * Defensive against multiple possible field names since the exact wire
 * format is abstracted.
 */
export function normalizeInboundMessage(raw = {}) {
  const msg = raw.message || raw;
  const space = msg.space || msg.conversation || {};
  const sender = msg.sender || msg.from || msg.author || {};

  const spaceId =
    msg.spaceId || msg.space_id || space.id || msg.conversationId || msg.conversation_id || null;
  const senderPhone =
    sender.phone || sender.handle || sender.number || msg.senderPhone || msg.sender_phone || null;

  const attachments = Array.isArray(msg.attachments)
    ? msg.attachments.map((a) => ({
        id: a.id || a.attachmentId || null,
        filename: a.filename || a.name || null,
        mimeType: a.mimeType || a.mime_type || a.contentType || null,
        size: a.size ?? a.byteSize ?? null,
        // Inbound attachment bytes are metadata-only on Photon's free tier today.
        downloadUrl: a.url || a.downloadUrl || null
      }))
    : [];

  const participants = Array.isArray(space.participants || msg.participants)
    ? (space.participants || msg.participants).map((p) =>
        typeof p === 'string' ? p : p.phone || p.handle || p.number || null
      )
    : [];

  const isGroup =
    typeof (space.isGroup ?? msg.isGroup) === 'boolean'
      ? space.isGroup ?? msg.isGroup
      : participants.filter(Boolean).length > 2;

  return {
    platform: 'imessage',
    provider: 'photon',
    messageId: msg.id || msg.messageId || msg.message_id || null,
    spaceId: spaceId ? String(spaceId) : null,
    sender: senderPhone ? String(senderPhone) : null,
    senderName: sender.name || sender.displayName || sender.display_name || null,
    text: msg.text ?? msg.body ?? msg.content ?? null,
    isGroup: !!isGroup,
    participants: participants.filter(Boolean),
    attachments,
    timestamp: msg.timestamp || msg.createdAt || msg.created_at || msg.date || null,
    serviceLine: msg.serviceLine || msg.line || raw.assignedLine || null
  };
}

export function failure(error, extra = {}) {
  return {
    success: false,
    ...extra,
    error: error?.message ? String(error.message) : 'Unknown error occurred.'
  };
}
