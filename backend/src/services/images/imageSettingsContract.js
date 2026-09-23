/** Internal, dependency-injected image settings contract. No credentials, DB or
 * HTTP ownership assumptions. Callers must supply server-authenticated identity
 * and connection descriptors. Never pass model/tool arguments as that context.
 */
const issuedRequests = new WeakSet();
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
function requireObject(value, label) {
  if (!object(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`Invalid ${label}.`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.get || descriptor.set) throw new Error(`Invalid ${label} accessor.`);
}
function keys(value, allowed) { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}`); }
function version(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid settings revision.'); }
function freeze(value) {
  if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function validateState(state) {
  requireObject(state, 'settings');
  keys(state,['schemaVersion','revision','selectedConnectionId','options','authorizations']);
  if (state.schemaVersion !== 1) throw new Error('Unsupported image settings schema.');
  version(state.revision);
  if (state.selectedConnectionId !== null && !string(state.selectedConnectionId)) throw new Error('Invalid selected connection.');
  requireObject(state.options, 'options'); requireObject(state.authorizations, 'authorizations');
  for (const [id,value] of Object.entries(state.options)) {
    if (!string(id)) throw new Error('Invalid connection key.');
    requireObject(value,'stored options'); keys(value,['model']);
    if (!own(value,'model') || (value.model !== null && !string(value.model))) throw new Error('Invalid stored model.');
  }
  for (const [id,grant] of Object.entries(state.authorizations)) {
    if (!string(id)) throw new Error('Invalid connection key.');
    requireObject(grant,'stored consent'); keys(grant,['allowed','binding','revision']);
    if (!own(grant,'allowed') || typeof grant.allowed !== 'boolean' || !own(grant,'binding') || (grant.allowed ? !string(grant.binding) : grant.binding !== null && !string(grant.binding))) throw new Error('Invalid stored consent.');
    version(grant.revision);
  }
}
function connectionFor(id, { userId, resolveConnection }) {
  if (!string(userId) || !string(id) || typeof resolveConnection !== 'function') throw new Error('Invalid image connection context.');
  const connection = resolveConnection(id);
  if (!object(connection) || connection.id !== id || connection.connected !== true) throw new Error('Image connection unavailable.');
  if (connection.ownerId !== userId) throw new Error('Image connection owner mismatch.');
  if (!string(connection.binding) || !string(connection.provider) || !Array.isArray(connection.operations) || typeof connection.requiresConsent !== 'boolean') throw new Error('Image connection binding unavailable.');
  return connection;
}
function normalizeOptions(value, connection, stored = false) {
  requireObject(value, 'image options'); keys(value, ['model']);
  if (own(value,'model') && value.model !== undefined && !(stored && value.model === null) && !string(value.model)) throw new Error('Invalid image model.');
  const model = value.model ?? (connection.provider.startsWith('openai-codex') ? 'provider-default' : connection.provider === 'openai' ? 'latest' : null);
  if (model !== null && !string(model)) throw new Error('Invalid image model.');
  if (connection.provider.startsWith('openai-codex') && model !== 'provider-default') throw new Error('Image model is selected by Codex.');
  return { model };
}
export function initialSettings() { return freeze({schemaVersion:1,revision:0,selectedConnectionId:null,options:{},authorizations:{}}); }

/** Computes a revisioned write. Persistence MUST CAS expectedRevision atomically;
 * this pure function alone does not serialize concurrent writes across processes.
 */
export function reviseSettings(state, patch, context) {
  validateState(state); requireObject(patch, 'settings patch');
  keys(patch, ['expectedRevision','selectedConnectionId','options','consent']);
  version(patch.expectedRevision);
  if (patch.expectedRevision !== state.revision || state.revision === Number.MAX_SAFE_INTEGER) throw new Error('Image settings revision conflict.');
  const next = structuredClone(state);
  if (own(patch, 'selectedConnectionId')) {
    if (patch.selectedConnectionId !== null) connectionFor(patch.selectedConnectionId, context);
    next.selectedConnectionId = patch.selectedConnectionId;
  }
  if (own(patch, 'options')) {
    requireObject(patch.options, 'option update'); keys(patch.options,['connectionId','value']);
    const connection = connectionFor(patch.options.connectionId, context);
    Object.defineProperty(next.options, connection.id, { value:normalizeOptions(patch.options.value,connection), enumerable:true, writable:true, configurable:true });
  }
  if (own(patch, 'consent')) {
    requireObject(patch.consent,'consent'); keys(patch.consent,['connectionId','allow']);
    if (typeof patch.consent.allow !== 'boolean') throw new Error('Consent must be an explicit boolean.');
    const id = patch.consent.connectionId;
    if (!string(id)) throw new Error('Invalid consent connection.');
    // Revocation remains possible after a connection goes offline or is removed.
    const connection = patch.consent.allow ? connectionFor(id, context) : null;
    const previous = own(next.authorizations,id) ? next.authorizations[id] : null;
    if (previous) version(previous.revision);
    if (previous?.revision === Number.MAX_SAFE_INTEGER) throw new Error('Authorization revision exhausted.');
    Object.defineProperty(next.authorizations,id,{value:{allowed:patch.consent.allow,binding:connection?.binding ?? previous?.binding ?? null,revision:(previous?.revision ?? 0)+1},enumerable:true,writable:true,configurable:true});
  }
  next.revision++;
  return freeze(next);
}
function authorization(state, connection) {
  if (!connection.requiresConsent) return null;
  const grant = own(state.authorizations,connection.id) ? state.authorizations[connection.id] : null;
  if (!grant || grant.allowed !== true || grant.binding !== connection.binding) throw new Error('Image connection requires current consent.');
  version(grant.revision);
  return grant.revision;
}
/** source is set by trusted entry-point code, never an LLM-supplied parameter. */
export function bindImageRequest(state, context) {
  validateState(state);
  if (!['interactive','explicit-workflow'].includes(context.source)) throw new Error('Invalid image request source.');
  const id = context.source === 'interactive' ? state.selectedConnectionId : context.connectionId;
  if (!id) throw new Error('Image provider is not configured.');
  const connection = connectionFor(id,context);
  if (!connection.operations.includes(context.operation)) throw new Error('Unsupported image operation.');
  const options = normalizeOptions(context.source === 'explicit-workflow' ? {model:context.model} : (own(state.options,id) ? state.options[id] : {}),connection,context.source === 'interactive');
  const request = freeze({ownerId:context.userId,source:context.source,settingsRevision:state.revision,connectionId:id,binding:connection.binding,provider:connection.provider,operation:context.operation,model:options.model,requiresConsent:connection.requiresConsent,authorizationRevision:authorization(state,connection)});
  issuedRequests.add(request);
  return request;
}
/** Call immediately before remote dispatch, AFTER async client initialization.
 * Connection/client affinity must also be established by the adapter boundary.
 */
export function revalidateImageRequest(request, latestState, context) {
  if (!issuedRequests.has(request)) throw new Error('Untrusted or deserialized image request; rebind through trusted entry point.');
  validateState(latestState);
  if (request.ownerId !== context.userId) throw new Error('Image request owner mismatch.');
  const current = connectionFor(request.connectionId,context);
  if (current.binding !== request.binding || current.provider !== request.provider || current.requiresConsent !== request.requiresConsent) throw new Error('Image connection binding changed.');
  if (!current.operations.includes(request.operation)) throw new Error('Image operation no longer available.');
  if (request.requiresConsent) {
    let revision;
    try { revision = authorization(latestState,current); } catch { throw new Error('Image consent revoked or replaced.'); }
    if (revision !== request.authorizationRevision) throw new Error('Image consent revoked or replaced.');
  }
  return request;
}
