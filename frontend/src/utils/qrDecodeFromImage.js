/**
 * Decode a QR payload from a still image (file / blob).
 * Used when live getUserMedia is blocked (typical on http:// LAN in the app).
 */

let jsQR = null;

async function loadJsQR() {
  if (jsQR) return jsQR;
  const mod = await import('@/vendor/jsQR.mjs');
  jsQR = mod.default;
  return jsQR;
}

function loadImageBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

/**
 * @param {Blob|File} file
 * @returns {Promise<string|null>} QR text, or null if none found
 */
export async function decodeQrFromImageFile(file) {
  if (!file) return null;
  const decode = await loadJsQR();
  const bitmap = await loadImageBitmap(file);
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const code = decode(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
    const text = code?.data ? String(code.data).trim() : '';
    return text || null;
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}
