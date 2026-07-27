/**
 * Redaction — always on, applied at serialization time, never opt-in.
 *
 * This machine holds nostr nsec secrets, Codex/Claude OAuth tokens, and a
 * dozen provider API keys in the backend env. A crash handler that naively
 * serialized an error's `config.headers` or `process.env` would write all of
 * them to a plaintext file that a user might well attach to a GitHub issue.
 *
 * Two independent defenses, because either alone has a blind spot:
 *   1. KEY names   — catches `{ authorization: '<anything>' }` even when the
 *                    value looks like nothing in particular.
 *   2. VALUE shapes — catches a key pasted into a free-text message or a URL,
 *                    where there is no key name to inspect.
 *
 * Replacement preserves SHAPE and KIND, never content:
 *     "sk-proj-abc...xyz"  ->  "[REDACTED:openai-key:51chars:sha256=a3f2b1c8]"
 * The digest lets you prove two calls used the same credential without ever
 * seeing it, which is most of the diagnostic value of the original string.
 *
 * Deliberately NOT echoing a leading prefix: for `AIzaSy…`/`sk-ant-…` the first
 * six characters are the vendor tag, so a prefix adds nothing a kind label does
 * not — and for formats without a tag those same six characters are live secret
 * material. Naming the credential type is more useful AND leaks zero bytes.
 */
import { createHash } from 'crypto';

/** Exact key names that are always secret regardless of value. */
const DENY_KEYS_EXACT = new Set([
  'auth',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'jwt',
  'key',
  'nsec',
  'pass',
  'passwd',
  'password',
  'pwd',
  'secret',
  'seed',
  'session',
  'sessionid',
  'signature',
  'token',
]);

/** Substrings that mark a key as secret (case-insensitive). */
const DENY_KEY_PATTERN =
  /(?:pass(?:word|wd)|secret|api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|id[-_]?token|bearer|client[-_]?secret|private[-_]?key|privatekey|mnemonic|seed[-_]?phrase|credential|authoriz|_nsec|nsec_)/i;

/**
 * Value shapes worth catching even with an innocuous key name.
 * All global so `String.replace` can scrub every occurrence in one pass.
 * The `kind` is what survives into the log — it tells you WHICH credential
 * was involved, which is the part you actually need while debugging.
 */
const VALUE_PATTERNS = [
  { kind: 'pem-private-key', re: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { kind: 'openai-project-key', re: /\bsk-proj-[A-Za-z0-9_-]{16,}/g },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}/g },
  { kind: 'github-token', re: /\bghp_[A-Za-z0-9]{16,}/g },
  { kind: 'github-oauth-token', re: /\bgho_[A-Za-z0-9]{16,}/g },
  { kind: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'nostr-nsec', re: /\bnsec1[a-z0-9]{20,}/g },
  { kind: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { kind: 'groq-key', re: /\bgsk_[A-Za-z0-9]{20,}/g },
  { kind: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g },
];

const MAX_DEPTH = 8;
const MAX_ARRAY = 64;
const MAX_STRING = 8192;
const MAX_KEYS = 128;

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

/**
 * Shape-preserving replacement token. Emits the credential KIND and a stable
 * digest, never any byte of the original value.
 */
export function redactToken(value, kind = 'value') {
  const s = String(value);
  return `[REDACTED:${kind}:${s.length}chars:sha256=${digest(s)}]`;
}

/** True if this key name should have its value replaced wholesale. */
export function isSecretKey(key) {
  if (typeof key !== 'string') return false;
  const k = key.toLowerCase();
  if (DENY_KEYS_EXACT.has(k)) return true;
  return DENY_KEY_PATTERN.test(k);
}

/** Scrub secret-shaped substrings out of a free-text string. */
export function redactString(str) {
  if (typeof str !== 'string' || str.length === 0) return str;
  let out = str;
  for (const { kind, re } of VALUE_PATTERNS) {
    // `replace` with a /g regex resets lastIndex on completion, so these
    // module-level regexes stay stateless between calls.
    out = out.replace(re, (m) => redactToken(m, kind));
  }
  return out;
}

function serializeErrorLike(err, depth, seen) {
  const out = {
    name: err.name,
    msg: redactString(String(err.message || '')),
  };
  if (err.code !== undefined) out.code = String(err.code);
  if (err.errno !== undefined) out.errno = err.errno;
  if (err.syscall !== undefined) out.syscall = String(err.syscall);
  if (err.status !== undefined) out.status = err.status;
  if (typeof err.stack === 'string') out.stack = redactString(err.stack).slice(0, MAX_STRING);

  // undici reports a failed connect as an AggregateError; the useful code is
  // always in a child, never on the outer error.
  if (Array.isArray(err.errors) && depth < MAX_DEPTH) {
    out.errors = err.errors.slice(0, 8).map((e) => redact(e, depth + 1, seen));
  }
  if (err.cause && depth < MAX_DEPTH) {
    out.cause = redact(err.cause, depth + 1, seen);
  }
  return out;
}

/**
 * Deep-redact any value into something JSON-safe and secret-free.
 * Never throws: a logger that throws is strictly worse than no logger.
 */
export function redact(value, depth = 0, seen = new WeakSet()) {
  try {
    if (value === null || value === undefined) return value;

    const t = typeof value;
    if (t === 'string') {
      const s = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}\u2026[+${value.length - MAX_STRING}]` : value;
      return redactString(s);
    }
    if (t === 'number' || t === 'boolean') return value;
    if (t === 'bigint') return `${value}n`;
    if (t === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (t === 'symbol') return String(value);

    if (depth >= MAX_DEPTH) return '[MaxDepth]';
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    if (value instanceof Error) return serializeErrorLike(value, depth, seen);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return String(value);
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return `[Buffer ${value.length}B sha256=${digest(value.toString('base64'))}]`;
    }
    if (value instanceof Map) {
      return redact(Object.fromEntries([...value.entries()].slice(0, MAX_KEYS)), depth, seen);
    }
    if (value instanceof Set) {
      return redact([...value].slice(0, MAX_ARRAY), depth, seen);
    }

    if (Array.isArray(value)) {
      const arr = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1, seen));
      if (value.length > MAX_ARRAY) arr.push(`[+${value.length - MAX_ARRAY} more]`);
      return arr;
    }

    // Error-shaped duck typing (structured-cloned errors lose their prototype
    // when they cross an IPC boundary, which is exactly how workflow-child
    // errors reach the parent).
    if (typeof value.stack === 'string' && typeof value.message === 'string') {
      return serializeErrorLike(value, depth, seen);
    }

    const out = {};
    let n = 0;
    for (const key of Object.keys(value)) {
      if (n++ >= MAX_KEYS) {
        out['[truncated]'] = `+${Object.keys(value).length - MAX_KEYS} keys`;
        break;
      }
      const v = value[key];
      if (isSecretKey(key)) {
        out[key] =
          v === null || v === undefined || v === ''
            ? v
            : redactToken(typeof v === 'string' ? v : JSON.stringify(v), 'secret-key');
        continue;
      }
      out[key] = redact(v, depth + 1, seen);
    }
    return out;
  } catch (err) {
    return `[Unserializable: ${err?.message || 'unknown'}]`;
  }
}

export default redact;
