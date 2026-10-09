import crypto from 'crypto';

export function contentHashOf(content) {
  if (typeof content !== 'string') return null;
  return crypto.createHash('sha256').update(content).digest('hex');
}

export default contentHashOf;
