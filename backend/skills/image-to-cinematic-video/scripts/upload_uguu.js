/**
 * upload_uguu.js
 *
 * Upload a local file to uguu.se and return its public URL.
 *
 * ⚠ WHY ONLY UGUU:
 *   We tried catbox.moe, litterbox.catbox.moe, 0x0.st, tmpfiles.org,
 *   transfer.sh, and file.io in the production run of this skill.
 *   Catbox served truncated 4 KB stubs (its CDN hash-dedup misbehaving),
 *   litterbox returned 403 on GET after a successful POST, and the rest
 *   timed out from this environment.
 *
 *   uguu.se was the only host that accepted both small JPGs (~70 KB)
 *   AND large MP4s (8+ MB) and served them back over HTTPS reliably.
 *   Seedance's worker can also reach uguu URLs (verified end-to-end).
 *
 *   Files are hosted for ~3 hours on uguu, which is plenty for a
 *   cinematic run (typical total wall-clock is ~15 minutes).
 *
 * Endpoint:
 *   POST https://uguu.se/upload
 *   multipart/form-data, field name:  files[]
 *   Response: {"success":true,"files":[{"url":"https://o.uguu.se/..."}]}
 *
 * Usage:
 *   const { uploadUguu } = require(
 *     'C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/upload_uguu.js'
 *   );
 *   const url = await uploadUguu('C:/path/to/source.jpg');
 *   // or pass a Buffer directly:
 *   const url = await uploadUguu(buffer, { filename: 'foo.jpg',
 *                                           contentType: 'image/jpeg' });
 */

const fs = require('fs');
const path = require('path');

const MIME = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
};

function buildMultipart(fields, file) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2, 18);
  const CRLF = '\r\n';
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}${CRLF}Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`
    ));
  }
  chunks.push(Buffer.from(
    `--${boundary}${CRLF}Content-Disposition: form-data; name="${file.name}"; ` +
    `filename="${file.filename}"${CRLF}Content-Type: ${file.contentType}${CRLF}${CRLF}`
  ));
  chunks.push(file.buffer);
  chunks.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));
  return { body: Buffer.concat(chunks), boundary };
}

/**
 * Upload bytes to uguu and return the resulting public URL.
 *
 * @param {string|Buffer} source  absolute file path or a raw Buffer
 * @param {Object} [opts]
 * @param {string} [opts.filename]       override filename (helps skip
 *                                        server-side dedup caching);
 *                                        default is basename(source)
 *                                        with a timestamp suffix.
 * @param {string} [opts.contentType]    override MIME; inferred from
 *                                        extension if source is a path.
 * @param {number} [opts.timeoutMs=180000]
 * @param {number} [opts.retries=2]      retries on network error.
 * @returns {Promise<string>}  public https URL, e.g. https://o.uguu.se/XYZ.jpg
 */
async function uploadUguu(source, opts = {}) {
  let buffer, filename, contentType;

  if (Buffer.isBuffer(source)) {
    buffer = source;
    filename = opts.filename || `upload_${Date.now()}.bin`;
    contentType = opts.contentType || 'application/octet-stream';
  } else {
    if (!fs.existsSync(source)) throw new Error(`File not found: ${source}`);
    buffer = fs.readFileSync(source);
    const ext = path.extname(source).toLowerCase();
    const base = path.basename(source, ext);
    filename = opts.filename || `${base}_${Date.now()}${ext}`;
    contentType = opts.contentType || MIME[ext] || 'application/octet-stream';
  }

  const timeoutMs = opts.timeoutMs ?? 180000;
  const retries = opts.retries ?? 2;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { body, boundary } = buildMultipart(
        {},
        { name: 'files[]', filename, contentType, buffer }
      );
      const res = await fetch('https://uguu.se/upload', {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'User-Agent': 'Mozilla/5.0',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`uguu HTTP ${res.status}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text);
      const url = json?.files?.[0]?.url;
      if (!url || !url.startsWith('http')) {
        throw new Error(`uguu bad response: ${text.slice(0, 200)}`);
      }
      return url;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`uguu upload failed after ${retries + 1} attempts: ${lastErr?.message}`);
}

module.exports = { uploadUguu };
