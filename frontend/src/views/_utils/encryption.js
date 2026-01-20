import CryptoJS from 'crypto-js';

const HANDSHAKE_KEY = 'e0ed19e2df64db0f26f4d744ac244c84';

export function encrypt(text) {
  return CryptoJS.AES.encrypt(text, HANDSHAKE_KEY).toString();
}

export function decrypt(encryptedText) {
  const bytes = CryptoJS.AES.decrypt(encryptedText, HANDSHAKE_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}
