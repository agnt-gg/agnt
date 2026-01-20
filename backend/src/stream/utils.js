// import crypto from 'crypto';
import CryptoJS from 'crypto-js';
import mammoth from 'mammoth';
import { PdfReader } from 'pdfreader';

// export function computeFileHash(buffer) {
//   const hash = crypto.createHash('sha256');
//   hash.update(buffer);
//   return hash.digest('hex');
// }
export function computeFileHash(buffer) {
  const wordArray = CryptoJS.lib.WordArray.create(buffer);
  return CryptoJS.SHA256(wordArray).toString();
}
export function generateUniqueId() {
  return Math.random().toString(36).substr(2, 16);
}
export async function getRawTextFromDocxBuffer(docxBuffer) {
  try {
    const result = await mammoth.extractRawText({ buffer: docxBuffer });
    return result.value;
  } catch (error) {
    console.error('Error reading docx file:', error);
    throw error;
  }
}
export async function getRawTextFromPDFBuffer(pdfBuffer) {
  try {
    return new Promise((resolve, reject) => {
      let textContent = '';
      new PdfReader().parseBuffer(pdfBuffer, (err, item) => {
        if (err) {
          reject(err);
        } else if (item && item.text) {
          textContent += item.text + ' ';
        } else if (!item) {
          // End of PDF file
          resolve(textContent);
        }
      });
    });
  } catch (error) {
    console.error('Error reading PDF file:', error);
    throw error;
  }
}
export function isJSONObject(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}
export function trimToWordLimit(str, limit) {
  const words = str.split(/\s+/);
  if (words.length <= limit) {
    return str;
  }
  return words.slice(0, limit).join(' ');
}