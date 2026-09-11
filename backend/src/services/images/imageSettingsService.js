import { reviseSettings, bindImageRequest, revalidateImageRequest } from './imageSettingsContract.js';

/** Application boundary: callers supply authenticated user context, never LLM grants. */
export function createImageSettingsService({ store, listConnections }) {
  const connections = async (userId, authToken) => {
    const rows = await listConnections(userId, authToken);
    return { rows, resolveConnection: id => rows.find(row => row.id === id) };
  };
  return {
    async read(userId, authToken) {
      const [settings, { rows }] = await Promise.all([store.read(userId), connections(userId, authToken)]);
      return { settings: { ...settings, authorizations: Object.fromEntries(Object.entries(settings.authorizations).map(([id,g])=>[id,{allowed:g.allowed,revision:g.revision}])) }, connections: rows.map(row => Object.fromEntries(['id','provider','connected','requiresConsent','operations','models','label','billing'].map(key=>[key,row[key]]))) };
    },
    async update(userId, patch, authToken) {
      const state = await store.read(userId);
      const revocationOnly = patch && patch.consent?.allow === false && Object.keys(patch).every(k=>['expectedRevision','consent'].includes(k));
      const { resolveConnection } = revocationOnly ? {resolveConnection:()=>null} : await connections(userId, authToken);
      const next = reviseSettings(state, patch, { userId, resolveConnection });
      return store.compareAndSwap(userId, patch.expectedRevision, next);
    },
    async prepare(userId, { operation, provider, model }, authToken, signal) {
      if (signal?.aborted) throw new Error('Image request cancelled.');
      const state = await store.read(userId);
      const { resolveConnection } = await connections(userId, authToken);
      const request = bindImageRequest(state, {userId,source:'interactive',operation,resolveConnection});
      if (provider != null && provider.toLowerCase() !== request.provider) throw new Error('Configured image provider cannot be overridden by a tool call. Change image settings explicitly.');
      if (model != null && model !== request.model) throw new Error('Configured image model cannot be overridden by a tool call. Change image settings explicitly.');
      let dispatched = false;
      return {
        request,
        async beforeDispatch() {
          if (dispatched) throw new Error('Duplicate image dispatch prohibited.');
          if (signal?.aborted) throw new Error('Image request cancelled.');
          const { resolveConnection: fresh } = await connections(userId, authToken);
          const current = await store.read(userId);
          revalidateImageRequest(request, current, {userId,resolveConnection:fresh});
          if (signal?.aborted) throw new Error('Image request cancelled.');
          if (dispatched) throw new Error('Duplicate image dispatch prohibited.');
          dispatched = true;
        },
      };
    },
  };
}
