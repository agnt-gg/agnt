import fs from 'fs';
import path from 'path';

// Resolve the data directory using the same cascade as models/database/index.js
const resolveDataDir = () => {
  if (process.env.NODE_ENV === 'production' && fs.existsSync('/app/data')) {
    return '/app/data';
  }
  if (process.env.USER_DATA_PATH) {
    return path.join(process.env.USER_DATA_PATH, 'Data');
  }
  const devPath = path.resolve(process.cwd(), 'data');
  if (process.env.NODE_ENV !== 'production' || process.cwd().includes('backend')) {
    return devPath;
  }
  return path.join(process.env.HOME || process.env.USERPROFILE, '.agnt', 'data');
};

const IMAGES_DIR = path.join(resolveDataDir(), 'images');

let dirReady = false;
const ensureDir = () => {
  if (dirReady) return;
  try {
    if (!fs.existsSync(IMAGES_DIR)) {
      fs.mkdirSync(IMAGES_DIR, { recursive: true });
    }
    dirReady = true;
  } catch (err) {
    console.error('[ImageStorage] Failed to create images dir:', IMAGES_DIR, err.message);
  }
};

const sanitizeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '_');

const extFromMime = (mimeSubtype) => {
  const s = (mimeSubtype || 'png').toLowerCase().replace('+xml', '');
  const cleaned = s.replace(/[^a-z0-9]/g, '');
  if (cleaned === 'jpeg') return 'jpg';
  return cleaned || 'png';
};

export const mimeFromExt = (ext) => {
  const e = (ext || '').toLowerCase();
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg';
  if (e === 'svg') return 'image/svg+xml';
  return `image/${e || 'png'}`;
};

export function saveBase64Image(id, dataUrl) {
  if (!id || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;

  ensureDir();
  const ext = extFromMime(match[1]);
  const safeId = sanitizeId(id);
  const filePath = path.join(IMAGES_DIR, `${safeId}.${ext}`);

  try {
    fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
    return filePath;
  } catch (err) {
    console.error(`[ImageStorage] Failed to save image ${id}:`, err.message);
    return null;
  }
}

export function findImageFile(id) {
  if (!id) return null;
  ensureDir();
  const safeId = sanitizeId(id);
  try {
    const files = fs.readdirSync(IMAGES_DIR);
    const match = files.find((f) => f === safeId || f.startsWith(`${safeId}.`));
    return match ? path.join(IMAGES_DIR, match) : null;
  } catch {
    return null;
  }
}

export function getImagesDir() {
  return IMAGES_DIR;
}
