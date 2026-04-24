import fs from 'fs';
import path from 'path';

export const BASE_V1 = 'https://api.atlascloud.ai/v1';
export const BASE_API_V1 = 'https://api.atlascloud.ai/api/v1';

export function requireApiKey(params) {
  const apiKey = params?.__auth?.token;
  if (!apiKey) throw new Error('Not connected to Atlas Cloud. Connect in Settings → Connections.');
  return apiKey;
}

export function parseExtra(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function atlasFetch(url, { apiKey, method = 'POST', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text || `HTTP ${res.status}`;
    throw new Error(`Atlas ${method} ${url} → HTTP ${res.status}: ${msg}`);
  }
  return json;
}

export async function pollPrediction(predictionId, apiKey, timeoutSec = 180, intervalMs = 3000) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_API_V1}/model/prediction/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    const status = json?.data?.status;
    if (status === 'completed' || status === 'succeeded') return json.data;
    if (status === 'failed' || status === 'error') throw new Error(`Prediction failed: ${json?.data?.error || JSON.stringify(json)}`);
    if (!res.ok) throw new Error(`Poll failed HTTP ${res.status}: ${text}`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutSec}s polling ${predictionId}`);
}

export async function uploadMedia(filePath, apiKey) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'jpg';
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'mp4' ? 'video/mp4' : ext === 'mov' ? 'video/quicktime' : 'image/jpeg';
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: mime }), path.basename(filePath));
  const res = await fetch(`${BASE_API_V1}/model/uploadMedia`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`uploadMedia failed HTTP ${res.status}: ${text}`);
  const url = json?.url || json?.data?.url || json?.data?.fileUrl || json?.data?.download_url || json?.download_url;
  if (!url) throw new Error(`uploadMedia returned no URL: ${text}`);
  return { url, raw: json };
}

export async function downloadTo(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed HTTP ${res.status}: ${url}`);
  const ab = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(ab));
  return outPath;
}

export function firstOutputUrl(data) {
  const outs = data?.outputs || data?.output || data?.result || [];
  if (Array.isArray(outs) && outs.length) {
    const first = outs[0];
    if (typeof first === 'string') return first;
    if (first?.url) return first.url;
    if (first?.video_url) return first.video_url;
    if (first?.image_url) return first.image_url;
  }
  if (typeof outs === 'string') return outs;
  if (outs?.url) return outs.url;
  return null;
}

export function allOutputUrls(data) {
  const outs = data?.outputs || data?.output || data?.result || [];
  if (!Array.isArray(outs)) return [firstOutputUrl(data)].filter(Boolean);
  return outs.map(o => (typeof o === 'string' ? o : (o?.url || o?.video_url || o?.image_url))).filter(Boolean);
}
