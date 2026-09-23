import { workstationImageConnection } from './workstationImage.js';
import { codexConnection } from './codexImageConnection.js';
import db, { dbReady } from '../../models/database/index.js';
import AuthManager from '../auth/AuthManager.js';
import { getImageGenProviders } from '../ai/ProviderRegistry.js';
import { createImageSettingsStore } from './imageSettingsStore.js';
import { createImageSettingsService } from './imageSettingsService.js';

export const imageSettingsStore = createImageSettingsStore(db);
// Adapter extensions register nonsecret connection descriptors, never credentials.
const extensions = new Map([['openai-codex', codexConnection],['workstation-image',workstationImageConnection]]);
export function registerImageConnection(provider, resolve) { extensions.set(provider, resolve); }
export async function listImageConnections(userId, authToken) {
  const apps = await AuthManager.getConnectedApps(userId, authToken?.replace(/^Bearer /,''));
  const connected = new Set((apps || []).filter(a=>a.connected!==false).map(a=>typeof a==='string'?a:a.providerId||a.provider_id));
  const rows=[];
  for (const item of getImageGenProviders()) {
    if (extensions.has(item.provider)) { const row=await extensions.get(item.provider)(userId);if(row)rows.push(row);continue; }
    if (!['openai','gemini','grokai'].includes(item.provider)) continue;
    rows.push({id:item.provider,provider:item.provider,ownerId:userId,binding:`api-slot:${userId}:${item.provider}`,connected:connected.has(item.provider),requiresConsent:false,
      operations:item.operations,models:item.models,label:({openai:'OpenAI Images API',gemini:'Google Gemini',grokai:'Grok Images'})[item.provider],billing:'API usage — billed separately'});
  }
  return rows;
}
const core = createImageSettingsService({store:imageSettingsStore,listConnections:listImageConnections});
export const imageSettingsService = Object.fromEntries(['read','update','prepare'].map(method=>[method,async(...args)=>{await dbReady;return core[method](...args);} ]));
