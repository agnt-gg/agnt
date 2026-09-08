/** Codex realtime capability (#108), not a separate provider or auth system.
 * Wire reference: Howaboua pi-gippity-control 94eb6c0745e2f516bf19603f912f7b6478b43355.
 * See docs/codex-voice-THIRD-PARTY-NOTICES.md. No cross-account/API-key fallback.
 */
export const CODEX_VOICE_MODEL = 'gpt-live-1-codex';
export const CODEX_VOICES = Object.freeze(['juniper','maple','spruce','ember','vale','breeze','arbor','sol','cove']);
export const CODEX_VOICE_LIMIT = 256 * 1024;
const ENDPOINT = 'https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas';
const accounts = new Set(['openai-codex','openai-codex-2']);
const INSTRUCTIONS = `You are Annie's spoken interface. Annie's AGNT conversation owns reasoning, tools, approvals and task history.
Delegate each user request to the client. Do not claim actions or tool results before receiving authoritative client output.
Treat received speakable content as Annie's authored speech; preserve facts, numbers and negations. Do not invent progress.
A delegation is an interpretation, not a guaranteed verbatim transcript. Do not run tools independently.
No filler or unsolicited opening greeting. Wait for user speech. Stop speaking when interrupted.`;

export class CodexVoiceError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
function validProvider(provider) {
  if (!accounts.has(provider)) throw new CodexVoiceError('unknown_voice_provider',400);
}
function validateSdp(sdp) {
  if (typeof sdp !== 'string' || !/^v=0\r?\n/.test(sdp) || !/^m=audio /m.test(sdp)) throw new CodexVoiceError('invalid_sdp',400);
  if (Buffer.byteLength(sdp) > CODEX_VOICE_LIMIT) throw new CodexVoiceError('oversized_sdp',413);
}
export function buildCodexVoiceCall({sdp,voice='cove'}) {
  validateSdp(sdp);
  if (!CODEX_VOICES.includes(voice)) throw new CodexVoiceError('invalid_codex_voice',400);
  return {sdp,session:{model:CODEX_VOICE_MODEL,instructions:INSTRUCTIONS,audio:{output:{voice}},delegation:{type:'client',ack_filler:false}}};
}
async function existingEntry(provider, deps) {
  validProvider(provider);
  const getEntry = deps.getEntry ?? (await import('./auth/AuthDispatcher.js')).getAuthEntry;
  const entry = getEntry(provider);
  if (!entry || entry.config?.key !== provider || !/^codex(?:-\d+)?$/.test(entry.config.authScheme || '') || typeof entry.manager?.ensureValidOAuthToken !== 'function') {
    throw new CodexVoiceError('voice_provider_not_registered',409);
  }
  return entry;
}
/** Catalog status deliberately does not open a provider call or inspect credentials. */
export async function getCodexVoiceStatus(provider='openai-codex',deps={}) {
  try {
    await existingEntry(provider,deps);
    return {provider,registered:true,entitlement:'unverified',model:CODEX_VOICE_MODEL,voices:[...CODEX_VOICES],defaultVoice:'cove',fallback:'none'};
  } catch (error) {
    if (!(error instanceof CodexVoiceError)) throw new CodexVoiceError('voice_status_failed');
    return {provider,registered:false,entitlement:'unverified',code:error.code,fallback:'none'};
  }
}
async function readBounded(response, signal) {
  const size = Number(response.headers.get('content-length'));
  if (Number.isFinite(size) && size > CODEX_VOICE_LIMIT) { await response.body?.cancel(); throw new CodexVoiceError('oversized_voice_response'); }
  if (!response.body) throw new CodexVoiceError('empty_voice_response');
  const reader = response.body.getReader();
  let length=0;const chunks=[];
  const onAbort=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',onAbort,{once:true});
  try {
    for (;;) {
      signal.throwIfAborted();
      const {done,value}=await reader.read();
      signal.throwIfAborted();
      if(done)break;
      length+=value.byteLength;
      if(length>CODEX_VOICE_LIMIT)throw new CodexVoiceError('oversized_voice_response');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks,length).toString('utf8');
  } catch(error) {await reader.cancel().catch(()=>{});throw error;}
  finally {signal.removeEventListener('abort',onAbort);reader.releaseLock();}
}
/** Runtime consumes the selected provider's existing manager; never returns credentials. */
export async function createCodexVoiceCall({provider='openai-codex',sdp,voice='cove',signal},deps={}) {
  const body=buildCodexVoiceCall({sdp,voice});
  const entry=await existingEntry(provider,deps);
  const timeoutMs=deps.timeoutMs ?? 20000;
  const deadline=AbortSignal.timeout(timeoutMs);
  const combined=signal ? AbortSignal.any([signal,deadline]) : deadline;
  try {
    combined.throwIfAborted();
    const token=await entry.manager.ensureValidOAuthToken();
    combined.throwIfAborted();
    if(typeof token!=='string'||!token.trim()||token.startsWith('sk-'))throw new CodexVoiceError('codex_oauth_required',401);
    const accountId=entry.manager.getChatGptAccountId?.();
    const headers={'Content-Type':'application/json',Authorization:`Bearer ${token}`,'openai-alpha':'quicksilver=v2',originator:'codex_cli_rs',...(accountId?{'chatgpt-account-id':accountId}:{})};
    const response=await (deps.fetchImpl??fetch)(ENDPOINT,{method:'POST',headers,body:JSON.stringify(body),signal:combined,redirect:'error'});
    if(response.status!==201){
      await response.body?.cancel();
      const code=response.status===401||response.status===403?'voice_entitlement_denied':response.status===429?'voice_rate_limited':response.status===404?'voice_protocol_unavailable':'voice_upstream_failed';
      throw new CodexVoiceError(code,response.status===429?429:response.status===401||response.status===403?403:502);
    }
    const answer=await readBounded(response,combined);
    try {validateSdp(answer);} catch {throw new CodexVoiceError('invalid_voice_answer');}
    return {sdp:answer,provider,model:CODEX_VOICE_MODEL};
  } catch(error) {
    if(signal?.aborted)throw new CodexVoiceError('voice_setup_cancelled',499);
    if(deadline.aborted)throw new CodexVoiceError('voice_setup_timeout',504);
    if(error instanceof CodexVoiceError)throw error;
    throw new CodexVoiceError('voice_setup_failed');
  }
}
