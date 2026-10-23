import { Buffer } from 'buffer';
import { randomBytes } from 'crypto';

/**
 * RFC 5322 message construction for the Gmail plugin.
 *
 * Every outgoing path (send, reply, draft, reply draft, draft update) builds its
 * message here so they cannot drift apart. Kept dependency-free so it can be
 * unit-tested without googleapis.
 */

const CRLF = '\r\n';
const LINE_BREAK = /[\r\n]/;

/**
 * Reject caller-supplied header values containing a line break. A CR/LF in
 * "to" or "subject" would let the value start a new header (e.g. a hidden Bcc),
 * and the values here are often written by a model reading untrusted email.
 * Rejecting is deliberate: silently stripping could change who receives mail.
 */
export function assertSingleLineHeader(name, value) {
  if (value == null) return '';
  const text = String(value);
  if (LINE_BREAK.test(text)) {
    throw new Error(`'${name}' must be a single line (line breaks are not allowed in email headers).`);
  }
  return text.trim();
}

/** Unfold a header value read back from Gmail (folding is CRLF + whitespace). */
export function unfoldHeader(value) {
  return value ? String(value).replace(/\r?\n[ \t]*/g, ' ').trim() : '';
}

/** RFC 2047 encoded-word for non-ASCII header text (subjects, filenames). */
export function encodeHeaderText(text) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/** Base64 wrapped at 76 columns (RFC 2045 §6.8). */
function base64Lines(content) {
  return content.match(/.{1,76}/g)?.join(CRLF) ?? '';
}

/** A body containing an HTML tag is HTML; anything else is plain text. */
export function isHtmlBody(body) {
  return /<\s*[a-z][a-z0-9]*(\s[^>]*)?\/?>/i.test(body);
}

export function parseAttachments(attachments) {
  if (!attachments) return [];
  let parsed = attachments;
  if (typeof attachments === 'string') {
    if (!attachments.trim()) return [];
    try {
      parsed = JSON.parse(attachments);
    } catch {
      throw new Error("'attachments' must be a JSON array of { filename, mimetype, content } objects.");
    }
  }
  if (!Array.isArray(parsed)) throw new Error("'attachments' must be an array.");
  return parsed.map((attachment, index) => {
    if (!attachment?.filename || !attachment?.content) {
      throw new Error(`Attachment ${index + 1} needs 'filename' and base64 'content'.`);
    }
    return {
      filename: assertSingleLineHeader(`attachments[${index}].filename`, attachment.filename).replace(/"/g, ''),
      mimetype: assertSingleLineHeader(`attachments[${index}].mimetype`, attachment.mimetype || 'application/octet-stream'),
      content: String(attachment.content).replace(/\s+/g, ''),
    };
  });
}

/**
 * Build a complete RFC 5322 message.
 * @returns {string} the message with CRLF line endings
 */
export function buildMimeMessage({ to, cc, bcc, subject, body, inReplyTo, references, attachments }) {
  const headers = [];
  const addHeader = (name, value) => {
    if (value) headers.push(`${name}: ${value}`);
  };

  addHeader('To', assertSingleLineHeader('to', to));
  addHeader('Cc', assertSingleLineHeader('cc', cc));
  addHeader('Bcc', assertSingleLineHeader('bcc', bcc));
  headers.push(`Subject: ${encodeHeaderText(assertSingleLineHeader('subject', subject))}`);
  addHeader('In-Reply-To', unfoldHeader(inReplyTo));
  addHeader('References', unfoldHeader(references));
  headers.push('MIME-Version: 1.0');

  const text = body == null ? '' : String(body);
  const bodyPart = [
    `Content-Type: ${isHtmlBody(text) ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(Buffer.from(text, 'utf8').toString('base64')),
  ];

  const parsedAttachments = parseAttachments(attachments);
  if (parsedAttachments.length === 0) {
    return [...headers, ...bodyPart].join(CRLF);
  }

  const boundary = `agnt-${randomBytes(12).toString('hex')}`;
  const lines = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, ...bodyPart];
  for (const attachment of parsedAttachments) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimetype}; name="${encodeHeaderText(attachment.filename)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encodeHeaderText(attachment.filename)}"`,
      '',
      base64Lines(attachment.content)
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join(CRLF);
}

/** Gmail's `raw` field: the message as base64url. */
export function toRaw(message) {
  return Buffer.from(message, 'utf8').toString('base64url');
}

/** Parse an address list ("A <a@x.com>, b@y.com") into bare lowercase emails. */
export function addressesOf(headerValue) {
  if (!headerValue) return [];
  return [...String(headerValue).matchAll(/[^\s<>,;"]+@[^\s<>,;"]+/g)].map((match) => match[0].toLowerCase());
}

/**
 * Split an address-list header into its individual entries, keeping display
 * names. Commas inside quoted display names do not split.
 */
export function splitAddressList(headerValue) {
  if (!headerValue) return [];
  const entries = [];
  let current = '';
  let inQuotes = false;
  for (const character of String(headerValue)) {
    if (character === '"') inQuotes = !inQuotes;
    if (character === ',' && !inQuotes) {
      if (current.trim()) entries.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim()) entries.push(current.trim());
  return entries;
}
