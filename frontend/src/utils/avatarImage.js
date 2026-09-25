/**
 * Turn a picked image file into a small avatar data URL: scaled to fit a
 * square, PNG when that is small enough, otherwise JPEG. Avatars are stored
 * inline on the record, so the size cap is what keeps records small.
 */

/** Largest size within max×max that keeps the aspect ratio; never upscales. */
export function fitWithin(width, height, max) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

const dataUrlKB = (dataUrl) => ((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4 / 1024;

export function readAvatarFile(file, { max = 256, maxKB = 200 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type).startsWith('image/')) {
      reject(new Error('Choose an image file.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        const { width, height } = fitWithin(img.width, img.height, max);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        let url = canvas.toDataURL('image/png');
        if (dataUrlKB(url) > maxKB) url = canvas.toDataURL('image/jpeg', 0.9);
        if (dataUrlKB(url) > maxKB) reject(new Error(`Image is still over ${maxKB}KB after resizing.`));
        else resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
