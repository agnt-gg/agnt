/**
 * save_generated_image.js
 *
 * Two ways to get a generated image's BYTES onto disk:
 *
 *   1. fetchImageRefBytes(ref, outputPath)   ← PRIMARY (recommended)
 *      Pulls bytes for an `{{IMAGE_REF:<id>}}` produced by the chat-level
 *      `generate_image` tool. The ref system is fully wired — every ref
 *      is backed by real bytes at `GET /api/images/:id` on the local
 *      AGNT server (Bearer-auth with process.env.AGNT_AUTH_TOKEN).
 *
 *      Typical flow: caller invokes the `generate_image` tool in the
 *      conversation (e.g. provider='gemini', model='nano-banana-pro-preview',
 *      aspectRatio='16:9'), gets back `{{IMAGE_REF:img-...-0}}`, then
 *      passes `'img-...-0'` to this helper.
 *
 *   2. saveGeneratedImage({ prompt, outputPath, ... })   ← FALLBACK
 *      Hits image-gen REST APIs directly from Node (Pollinations →
 *      Gemini → OpenAI in priority order). Useful when you're running
 *      entirely inside execute_javascript_code with no chat-tool round
 *      trip, or when the local AGNT server is unavailable.
 *
 * Project-folder helpers (always exported — use at top of every run):
 *   createProjectDir(slug)       → makes timestamped folder under
 *                                   %APPDATA%\AGNT\projects\, with
 *                                   `scenes/` and `frames/` subdirs.
 *   writeProjectManifest(dir, o) → dumps `manifest.json` at run end.
 *
 * Usage (PRIMARY path):
 *   // After invoking the generate_image AGNT tool which returned
 *   //   {{IMAGE_REF:img-toolu_01ABC...-0}}
 *   const {
 *     fetchImageRefBytes, createProjectDir, writeProjectManifest,
 *   } = require('C:/Users/Studio/.agnt/skills/image-to-cinematic-video/scripts/save_generated_image.js');
 *
 *   const projectDir = createProjectDir('scifi_chain');
 *   const srcImg     = path.join(projectDir, 'source.jpg');
 *   await fetchImageRefBytes('img-toolu_01ABC...-0', srcImg);
 *   // srcImg now has real bytes on disk, ready to upload.
 *
 * Usage (FALLBACK path):
 *   const { saveGeneratedImage } = require('.../save_generated_image.js');
 *   await saveGeneratedImage({
 *     prompt: 'A lone astronaut at the threshold of an alien ship...',
 *     outputPath: srcImg,
 *     aspectRatio: '16:9',
 *   });
 */

const fs = require('fs');
const path = require('path');

const PROJECTS_ROOT = 'C:\\Users\\Studio\\AppData\\Roaming\\AGNT\\projects';
const AGNT_API_BASE = process.env.AGNT_API_BASE || 'http://localhost:3333/api';

function createProjectDir(slug = 'cinematic') {
  if (!fs.existsSync(PROJECTS_ROOT)) fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(PROJECTS_ROOT, `${stamp}_${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'scenes'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  return dir;
}

function writeProjectManifest(projectDir, manifest) {
  const p = path.join(projectDir, 'manifest.json');
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2));
  return p;
}

// --- PRIMARY: pull bytes for a chat-tool-generated image ref --------------

/**
 * Detect if a Buffer looks like a real image (JPEG/PNG/WebP/GIF magic bytes).
 * Used to reject HTML SPA fallbacks served when auth is missing.
 */
function looksLikeImage(buf) {
  if (!buf || buf.length < 12) return false;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // WEBP: RIFF....WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return true;
  return false;
}

/**
 * Pull the bytes for an `{{IMAGE_REF:<id>}}` from the local AGNT server
 * and write them to disk.
 *
 * @param {string} ref         The id portion (with or without the
 *                             `{{IMAGE_REF:...}}` wrapper). e.g.
 *                             `img-toolu_01ABC...-0` or the full
 *                             `{{IMAGE_REF:img-toolu_01ABC...-0}}`.
 * @param {string} outputPath  Absolute path; parent dirs are created.
 * @returns {Promise<{ path: string, sizeBytes: number, contentType: string }>}
 */
async function fetchImageRefBytes(ref, outputPath) {
  if (!ref) throw new Error('ref required');
  if (!outputPath) throw new Error('outputPath required');

  // Allow callers to paste the full placeholder string.
  const m = String(ref).match(/\{\{\s*IMAGE_REF\s*:\s*([^}]+?)\s*\}\}/);
  const id = m ? m[1] : String(ref).trim();

  const token = process.env.AGNT_AUTH_TOKEN;
  if (!token) throw new Error('AGNT_AUTH_TOKEN env var not set');

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const url = `${AGNT_API_BASE}/images/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`fetchImageRefBytes ${id}: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());

  // Reject HTML SPA fallbacks (server returns the index page when auth fails
  // or the ref doesn't exist) — they'd silently corrupt the pipeline.
  if (contentType.includes('text/html') || !looksLikeImage(buf)) {
    const preview = buf.slice(0, 80).toString('utf8').replace(/\s+/g, ' ');
    throw new Error(
      `fetchImageRefBytes ${id}: response is not image bytes ` +
      `(content-type='${contentType}', size=${buf.length}, preview='${preview}'). ` +
      `Check that AGNT_AUTH_TOKEN is valid and that the ref id is correct.`
    );
  }
  if (buf.length < 5000) {
    throw new Error(`fetchImageRefBytes ${id}: suspiciously small (${buf.length}B)`);
  }

  fs.writeFileSync(outputPath, buf);
  return { path: outputPath, sizeBytes: buf.length, contentType };
}

// --- FALLBACK: direct REST-API providers (no chat tool needed) ------------

/**
 * Pollinations: free, keyless, reliable. Good fallback when the chat
 * tool isn't reachable.
 */
async function generateViaPollinations({ prompt, outputPath, width, height }) {
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&nologo=true&enhance=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`Pollinations ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10000) throw new Error(`Pollinations tiny file (${buf.length}B)`);
  fs.writeFileSync(outputPath, buf);
  return outputPath;
}

async function generateViaGemini({ prompt, outputPath, aspectRatio }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_NO_KEY');
  const model = 'gemini-2.5-flash-image-preview';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: { aspectRatio },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new Error('Gemini returned no image bytes');
  fs.writeFileSync(outputPath, Buffer.from(img.inlineData.data, 'base64'));
  return outputPath;
}

async function generateViaOpenAI({ prompt, outputPath, sizeOpenAI }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_NO_KEY');
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'dall-e-3', prompt, size: sizeOpenAI, quality: 'hd',
      response_format: 'b64_json', n: 1,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no b64');
  fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));
  return outputPath;
}

const ASPECT = {
  '16:9': { w: 1280, h: 720,  openai: '1792x1024' },
  '9:16': { w: 720,  h: 1280, openai: '1024x1792' },
  '1:1':  { w: 1024, h: 1024, openai: '1024x1024' },
  '4:3':  { w: 1280, h: 960,  openai: '1024x1024' },
};

/**
 * FALLBACK: try direct REST providers in priority order until one
 * writes a valid file. Prefer `fetchImageRefBytes()` + the chat-level
 * `generate_image` tool for the best quality/agentic flow.
 *
 * @param {Object} opts
 * @param {string} opts.prompt
 * @param {string} opts.outputPath  absolute path; dirs are created
 * @param {'16:9'|'9:16'|'1:1'|'4:3'} [opts.aspectRatio='16:9']
 * @param {Array<'pollinations'|'gemini'|'openai'>} [opts.providerPriority]
 *        Default: ['pollinations','gemini','openai'] — Pollinations
 *        first because it needs no key.
 * @returns {Promise<{path:string, provider:string, sizeBytes:number}>}
 */
async function saveGeneratedImage(opts) {
  const {
    prompt,
    outputPath,
    aspectRatio = '16:9',
    providerPriority = ['pollinations', 'gemini', 'openai'],
  } = opts;
  if (!prompt) throw new Error('prompt required');
  if (!outputPath) throw new Error('outputPath required');

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const dim = ASPECT[aspectRatio] || ASPECT['16:9'];
  const errors = [];

  for (const provider of providerPriority) {
    try {
      if (provider === 'pollinations') {
        await generateViaPollinations({ prompt, outputPath, width: dim.w, height: dim.h });
      } else if (provider === 'gemini') {
        await generateViaGemini({ prompt, outputPath, aspectRatio });
      } else if (provider === 'openai') {
        await generateViaOpenAI({ prompt, outputPath, sizeOpenAI: dim.openai });
      }
      const stat = fs.statSync(outputPath);
      if (stat.size < 5000) throw new Error(`${provider} tiny file (${stat.size}B)`);
      return { path: outputPath, provider, sizeBytes: stat.size };
    } catch (e) {
      errors.push(`${provider}: ${e.message.slice(0, 160)}`);
    }
  }
  throw new Error('All image providers failed:\n  - ' + errors.join('\n  - '));
}

module.exports = {
  // PRIMARY
  fetchImageRefBytes,
  // FALLBACK
  saveGeneratedImage,
  // Project helpers
  createProjectDir,
  writeProjectManifest,
  PROJECTS_ROOT,
  AGNT_API_BASE,
};
