// Utility for storing large media files (images, videos) in IndexedDB.
// Values are stored natively as Blobs — never as base64 data URL strings —
// so the browser can stream the data and we can hand out object URLs that
// are revocable. Legacy entries written as data URL strings are migrated
// transparently on first read.
const DB_NAME = 'ThemeMediaDB';
const STORE_NAME = 'backgrounds';
const DB_VERSION = 1;

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const payload = match[3];
  if (isBase64) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

class MediaStorage {
  constructor() {
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }

  async setItem(key, value) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Returns a Blob (or null if the key is missing). If the stored value is
  // a legacy base64 data URL string, it is converted to a Blob and written
  // back so subsequent reads are cheap.
  async getItem(key) {
    if (!this.db) await this.init();

    const value = await new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (value == null) return null;
    if (value instanceof Blob) return value;

    if (typeof value === 'string' && value.startsWith('data:')) {
      const blob = dataUrlToBlob(value);
      if (blob) {
        try {
          await this.setItem(key, blob);
        } catch {
          // Migration write failure is non-fatal — we still return the Blob.
        }
        return blob;
      }
    }
    return null;
  }

  async removeItem(key) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllKeys() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAllKeys();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

export const mediaStorage = new MediaStorage();
