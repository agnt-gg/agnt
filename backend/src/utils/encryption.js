import CryptoJS from 'crypto-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env file directly
const envConfig = fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8')
  .split('\n')
  .reduce((acc, line) => {
    const [key, value] = line.split('=');
    if (key && value) {
      acc[key.trim()] = value.trim();
    }
    return acc;
  }, {});

const SECRET_KEY = envConfig.ENCRYPTION_KEY;

if (!SECRET_KEY) {
  throw new Error('ENCRYPTION_KEY is not set in the environment variables');
}

export function encrypt(text) {
  return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
}

export function decrypt(encryptedText) {
  const bytes = CryptoJS.AES.decrypt(encryptedText, SECRET_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

// example
// const encrypted = encrypt('Hello, world!');
// console.log('Encrypted:', encrypted);

// const decrypted = decrypt(encrypted);
// console.log('Decrypted:', decrypted);
