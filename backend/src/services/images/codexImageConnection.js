import crypto from 'node:crypto';
import CodexAuthManager from '../auth/CodexAuthManager.js';
import { codexImagesEnabled } from '../ai/codexImageCapability.js';

// Existing manager supplies nonsecret identity; no credential-file reader here.
export function codexConnection(userId) {
  if (!codexImagesEnabled()) return null;
  const accountId = CodexAuthManager.getChatGptAccountId();
  return {id:'openai-codex',provider:'openai-codex',ownerId:userId,
    binding:accountId ? crypto.createHash('sha256').update('codex-account:'+accountId).digest('hex') : 'unavailable',
    connected:typeof accountId==='string' && accountId.length>0,requiresConsent:true,operations:['generate','edit'],models:['provider-default'],
    label:'Codex subscription',billing:'Uses your Codex subscription allowance. Model selected by Codex; no automatic API-key fallback.'};
}
export function assertCodexClientBinding(client, expectedBinding) {
  const accountId=client.defaultHeaders?.()['chatgpt-account-id'];
  const binding=typeof accountId==='string'?crypto.createHash('sha256').update('codex-account:'+accountId).digest('hex'):null;
  if (client.baseURL!=='https://chatgpt.com/backend-api/codex' || binding!==expectedBinding) throw new Error('Codex client account binding changed or is unavailable. Renew image consent for the current account.');
}
