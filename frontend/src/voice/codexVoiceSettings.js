import { reactive, watch } from 'vue';
import { CODEX_VOICE_DEFAULTS, validatedCodexProfile } from './codexVoiceConfig.js';

// This is a browser-local preference, NOT a credential or cross-device setting.
// v1 has no owner: intentionally do not migrate it to whichever user logs in first.
function scopeKey(scope) {
  if (!scope || typeof scope.userId !== 'string' || !scope.userId.trim() || scope.userId.length > 256) return null;
  if (typeof scope.installation !== 'string' || scope.installation.length > 2048) return null;
  try {
    const url = new URL(scope.installation, globalThis.location?.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    const installation = url.origin + url.pathname.replace(/\/+$/, '');
    return 'agnt.voice.profile.v2:' + encodeURIComponent(JSON.stringify([installation, scope.userId]));
  } catch { return null; }
}

export function createCodexVoiceProfiles({ storage } = {}) {
  const settings = reactive({ ...CODEX_VOICE_DEFAULTS });
  const identity = reactive({ ready: false, revision: 0, userId: null });
  const listeners = new Set();
  let key = null;
  const getStorage = () => storage ?? globalThis.localStorage;
  function setScope(scope) {
    const next = scopeKey(scope);
    if (next === key) return Boolean(key);
    // Invalidate sessions BEFORE loading a different user's preference, even if
    // both users chose identical voices. This never cancels accepted chat tasks.
    key = next;
    identity.ready = false;
    identity.userId = null;
    identity.revision++;
    for (const listener of listeners) listener();
    for (const field of Object.keys(settings)) delete settings[field];
    Object.assign(settings, CODEX_VOICE_DEFAULTS);
    if (key) {
      try {
        const raw = getStorage()?.getItem(key);
        const saved = typeof raw === 'string' && raw.length <= 1024 ? validatedCodexProfile(JSON.parse(raw)) : null;
        if (saved) Object.assign(settings, saved);
      } catch { /* Storage may be denied; defaults remain visible, never another user's profile. */ }
      identity.userId = scope.userId;
      identity.ready = true;
    }
    return Boolean(key);
  }
  function save() {
    const profile = validatedCodexProfile(settings);
    if (!key || !identity.ready || !profile) return false;
    try { getStorage().setItem(key, JSON.stringify(profile)); return true; } catch { return false; }
  }
  function onScopeChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  return { settings, identity, setScope, save, onScopeChange };
}

export const codexVoiceProfiles = createCodexVoiceProfiles();
export const codexVoiceSettings = codexVoiceProfiles.settings;
export const saveCodexVoiceSettings = () => codexVoiceProfiles.save();

/** Bind once at App root to the existing verified session contract. No token parsing. */
export function bindCodexVoiceIdentity(store, installation, profiles = codexVoiceProfiles) {
  const unwatch = watch(
    () => [store.state.userAuth?.sessionState, store.state.userAuth?.user?.id],
    ([sessionState, userId]) => profiles.setScope(sessionState === 'valid' ? { userId, installation } : null),
    { immediate: true, flush: 'sync' }
  );
  return () => { unwatch(); profiles.setScope(null); };
}
