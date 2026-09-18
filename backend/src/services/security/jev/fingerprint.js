/**
 * Redacted command fingerprint for the Jev audit log.
 *
 * WHY
 * The soak log recorded a verdict but not WHAT was judged, so "what did it
 * almost block last Tuesday?" was unanswerable and lines had to be told apart
 * by scanned/allAbsent counts. A dry-run whose whole purpose is evidence needs
 * to name the call.
 *
 * THE CONSTRAINT
 * The log currently contains zero key material and must keep that property, so
 * the fingerprint is REDACT-FIRST: the text is scrubbed, then truncated, and
 * the hash is taken OVER THE REDACTED FORM.
 *
 * Hashing the raw text would be a quiet leak: a hash of a short or
 * low-entropy secret is brute-forceable offline, so an attacker with the log
 * could recover the very thing the redaction removed. The cost of hashing the
 * redacted form is that two calls differing ONLY by a secret value share a
 * hash. That is the correct trade for a local audit trail whose job is
 * grouping repeated call shapes, and it is asserted in the tests so nobody
 * "fixes" it later.
 */
import { createHash } from "node:crypto";

export const PREVIEW_CHARS = 120;
export const HASH_CHARS = 16;
export const REDACTED = "[REDACTED]";

/**
 * Ordered redactions. Specific before generic: the generic high-entropy rule
 * would otherwise swallow the context that makes a preview readable.
 */
const REDACTIONS = [
  // PEM / key blocks collapsed whole, never partially echoed.
  [/-{5}BEGIN[^-]*-{5}[\s\S]*?-{5}END[^-]*-{5}/g, "[REDACTED-KEY-BLOCK]"],
  [/-{5}BEGIN[^-]*-{5}/g, "[REDACTED-KEY-BLOCK]"],
  // Authorization headers and bearer tokens.
  [/\b(authorization\s*:\s*)(\S+\s+)?\S+/gi, `$1${REDACTED}`],
  [/\b(bearer|token|apikey|api[-_]?key)(\s+|=|:\s*)["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi, `$1$2${REDACTED}`],
  // Flag-carried credentials: --password x, -u user:pass, --token=x
  [/(--?(?:password|passwd|pass|token|secret|api[-_]?key|auth)[=\s]+)("[^"]*"|'[^']*'|\S+)/gi, `$1${REDACTED}`],
  [/(-u\s+\S+?:)(\S+)/g, `$1${REDACTED}`],
  // Secret-named assignments (env prefix, dotenv, export).
  [
    /\b((?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)[A-Z0-9_]*\s*=\s*)("[^"]*"|'[^']*'|\S+)/g,
    `$1${REDACTED}`,
  ],
  // Known token shapes, even bare.
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bghp_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{8,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, REDACTED],
  // Signed-URL query parameters.
  [/([?&](?:sig|signature|token|access[_-]?key|api[_-]?key|password|auth)=)[^&\s"']+/gi, `$1${REDACTED}`],
  // Generic high-entropy blob: long, no path separators, mixed classes.
  [
    /(^|[\s="':])([A-Za-z0-9+/_-]{40,}={0,2})(?=$|[\s"':,;)])/g,
    (m, pre, blob) => (/^[A-Za-z]+$/.test(blob) ? m : `${pre}${REDACTED}`),
  ],
];

/** Scrub credential-shaped text. Never returns the original on failure. */
export function redactText(text) {
  let out = String(text ?? "");
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

/**
 * One stable string per call, independent of key order.
 * Only fields that identify WHICH action this was — never payload bodies.
 */
export function summarizeArgs(toolName, args = {}) {
  const a = args && typeof args === "object" ? args : {};
  const parts = [String(toolName || "unknown")];

  if (typeof a.command === "string" && a.command) {
    parts.push(a.command);
  }
  if (typeof a.code === "string" && a.code) {
    // Code bodies are not previewed; only their size identifies the call.
    parts.push(`code:${a.code.length}b`);
  }
  for (const key of ["operation", "path", "destination", "dest", "to", "subject", "url", "file"]) {
    if (typeof a[key] === "string" && a[key]) parts.push(`${key}=${a[key]}`);
  }
  return parts.join(" ");
}

/**
 * @returns {{preview: string, hash: string, chars: number, truncated: boolean, redacted: boolean}}
 * `hash` is sha256 of the redacted summary, so identical call shapes group.
 */
export function fingerprintArgs({ toolName, args } = {}) {
  const summary = summarizeArgs(toolName, args);
  const scrubbed = redactText(summary);
  const hash = createHash("sha256").update(scrubbed).digest("hex").slice(0, HASH_CHARS);
  const truncated = scrubbed.length > PREVIEW_CHARS;
  return {
    preview: truncated ? `${scrubbed.slice(0, PREVIEW_CHARS)}…` : scrubbed,
    hash,
    chars: scrubbed.length,
    truncated,
    redacted: scrubbed !== summary,
  };
}
