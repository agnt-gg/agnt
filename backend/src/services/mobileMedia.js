/**
 * mobileMedia — photos, voice notes and files on texts to and from Annie.
 *
 * IN: mobile.agnt.gg hands each text's files over as short-lived URLs. They
 * become ordinary chat uploads, so Annie handles them exactly as if they were
 * dropped into the chat window (vision for images, text extraction for PDFs
 * and documents, a saved path for everything). Two conversions first:
 *   - HEIC/HEIF (every iPhone photo) -> JPEG, because no vision API takes HEIC;
 *   - voice notes -> a transcript, made HERE with the local Whisper model, so
 *     Annie gets the words and nobody pays for transcription.
 *
 * OUT: files Annie's answer points at (a file:/// link or a generated image) are
 * uploaded and sent back as attachments. Only regular files with an allowed
 * extension, at most 25 MB and 4 per reply, and only to the account's own
 * phone. Anything that fails stays a mention in the text: nothing is dropped.
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_OUTBOUND = 4;

const MIME_BY_EXT = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', mov: 'video/quicktime', zip: 'application/zip',
});

export const mimeForName = (name) => MIME_BY_EXT[String(name).toLowerCase().split('.').pop()] || null;

// A file:/// link in prose. Sentence punctuation after it is not part of the
// path: "...see file:///C:/x/report.pdf." names report.pdf.
export const FILE_LINK = /file:\/\/\/[^\s)"'<>\]]+/g;
export const trimLink = (link) => link.replace(/[.,;:!?]+$/, '');
const isHeic = (file) => /^image\/hei[cf]/i.test(file.mime) || /\.(heic|heif)$/i.test(file.name);
const isAudio = (file) => /^audio\//i.test(file.mime) || /\.(m4a|caf|amr|mp3|wav|ogg|opus)$/i.test(file.name);

/** Default converters; tests pass their own. Both are lazy so a plain text never loads them. */
export const defaultConverters = {
  /**
   * The prebuilt sharp/libvips this app ships cannot decode HEVC (the codec
   * inside every iPhone HEIC) for licensing reasons. heic-decode is libheif
   * compiled to WASM, so it works on every platform with no native build;
   * sharp then encodes the raw pixels as JPEG.
   */
  async heicToJpeg(buffer) {
    const [{ default: decode }, { default: sharp }] = await Promise.all([import('heic-decode'), import('sharp')]);
    const { width, height, data } = await decode({ buffer });
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } }).jpeg({ quality: 85 }).toBuffer();
  },
  async transcribe(buffer, name) {
    const { whisperService } = await import('./whisperService.js');
    const tmp = path.join(os.tmpdir(), `agnt-voice-${crypto.randomUUID()}${path.extname(name) || '.m4a'}`);
    await fs.writeFile(tmp, buffer);
    try {
      return (await whisperService.transcribe(tmp)) || '';
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  },
};

/**
 * Download a text's files and turn them into chat uploads.
 * @returns {{ files: Array<{originalname, mimetype, buffer}>, notes: string[] }}
 */
export async function receiveMedia(media = [], { fetchImpl = fetch, converters = defaultConverters } = {}) {
  const files = [];
  const notes = [];
  for (const item of media) {
    let buffer;
    try {
      const response = await fetchImpl(item.url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`download ${response.status}`);
      buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_BYTES) throw new Error('too large');
    } catch (error) {
      notes.push(`[The file "${item.name}" could not be downloaded: ${error.message}.]`);
      continue;
    }
    let file = { name: item.name, mime: item.mime, buffer };
    if (isHeic(file)) {
      try {
        file = { name: file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', mime: 'image/jpeg', buffer: await converters.heicToJpeg(buffer) };
      } catch (error) {
        console.warn('[mobileMedia] HEIC conversion failed:', error.message);
      }
    }
    if (isAudio(file)) {
      try {
        const words = String(await converters.transcribe(buffer, file.name)).trim();
        notes.push(words ? `[Voice note: "${words}"]` : '[Voice note: (no speech recognised)]');
      } catch (error) {
        notes.push('[Voice note attached; it could not be transcribed.]');
        console.warn('[mobileMedia] transcription failed:', error.message);
      }
    }
    files.push({ originalname: file.name, mimetype: file.mime, buffer: file.buffer });
  }
  return { files, notes };
}

/**
 * Files an answer points at: {{IMAGE_REF:id}} tokens (and image_generated
 * ids), and file:/// links. Resolved, checked and de-duplicated.
 */
export async function findOutboundFiles(answer, { imageIds = [], resolveImage = async () => null, stat = fs.stat } = {}) {
  const text = String(answer || '');
  const candidates = [];
  const seen = new Set();
  const add = (filePath, token) => { if (filePath && !seen.has(filePath)) { seen.add(filePath); candidates.push({ path: filePath, token }); } };
  for (const id of [...imageIds, ...[...text.matchAll(/\{\{IMAGE_REF:([^}]+)\}\}/g)].map((m) => m[1])]) add(await resolveImage(id), `{{IMAGE_REF:${id}}}`);
  for (const match of text.matchAll(FILE_LINK)) {
    const link = trimLink(match[0]);
    let filePath;
    try { filePath = fileURLToPath(link); } catch { continue; }
    add(filePath, link);
  }
  const files = [];
  for (const candidate of candidates) {
    if (files.length >= MAX_OUTBOUND) break;
    const name = path.basename(candidate.path);
    const mime = mimeForName(name);
    // No hidden files or folders (keys, configs), and only known types.
    if (!mime || candidate.path.split(/[\\/]/).some((part) => part.startsWith('.') && part.length > 1)) continue;
    try {
      const info = await stat(candidate.path);
      if (!info.isFile() || info.size < 1 || info.size > MAX_BYTES) continue;
      files.push({ ...candidate, name, mime, bytes: info.size });
    } catch {
      continue;
    }
  }
  return files;
}

/** Upload outbound files for one text; returns the media ids that made it. */
export async function sendMedia(messageId, files, { callService, fetchImpl = fetch, readFile = fs.readFile }) {
  const sent = [];
  for (const file of files) {
    try {
      const buffer = await readFile(file.path);
      const reserved = await callService('mobile', `/messages/${encodeURIComponent(messageId)}/media`, { method: 'POST', body: { name: file.name, mime: file.mime, bytes: buffer.length }, timeoutMs: 20_000, planGate: false });
      const response = await fetchImpl(reserved.uploadUrl, { method: 'PUT', body: buffer, headers: { 'Content-Type': 'application/octet-stream' }, signal: AbortSignal.timeout(120_000) });
      if (response.status !== 201 && response.status !== 409) throw new Error(`upload ${response.status}`);
      sent.push({ ...file, mediaId: reserved.mediaId });
    } catch (error) {
      console.warn(`[mobileMedia] could not send ${file.name}:`, error.message);
    }
  }
  return sent;
}
