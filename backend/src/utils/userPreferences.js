/**
 * User preferences — schema, validation and merge semantics for
 * GET/PUT /api/users/preferences.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Before this, exactly two things followed a user across browsers: workspace
 * tabs (/api/workspaces) and custom-page widget layouts (/api/layouts).
 * Everything else the user tunes — theme, font, UI scale, panel widths —
 * lived only in that browser's localStorage. Set a theme on the desktop, open
 * the laptop, get the default. Nothing was broken; there was simply no store.
 *
 * ---------------------------------------------------------------------------
 * THE THING THAT MAKES THIS NON-TRIVIAL: NOT ALL PREFERENCES ARE GLOBAL
 * ---------------------------------------------------------------------------
 * It is tempting to sync every key in one bag. That produces a WORSE product
 * than not syncing at all, because pixel geometry is a function of the screen
 * it was measured on:
 *
 *   leftPanelWidth = 384   on a 27" desktop  → a comfortable sidebar
 *   leftPanelWidth = 384   on a 13" laptop   → half the usable width
 *
 * Sync that globally and every resize on one machine vandalises the other, in
 * a way the user cannot attribute to anything they did. So preferences carry a
 * SCOPE:
 *
 *   global  — taste. Theme, font, background treatment. The user means these
 *             to be true everywhere, and they are resolution-independent.
 *   device  — fit. Panel widths, collapse state, UI scale. Same human, same
 *             intent, different answer per screen.
 *
 * Device scope is keyed by an opaque client-minted deviceId. Two browsers on
 * the same machine are two devices; that is correct, because two browsers can
 * be sized differently.
 *
 * ---------------------------------------------------------------------------
 * MERGE, NOT REPLACE
 * ---------------------------------------------------------------------------
 * PUT merges. A client sends only the keys it changed, so a browser running an
 * older build cannot erase a key it has never heard of, and adding a key later
 * needs no coordination. Explicit `null` deletes a key — that is the only way
 * to unset one, since absence means "no opinion".
 *
 * Conflict handling differs per scope, deliberately:
 *   - device scope is uncontended by construction (only one device writes its
 *     own bucket), so writes always apply.
 *   - global scope is contended, so it is last-write-wins on `updatedAt`, the
 *     same rule /api/workspaces already uses. `updatedAt` must be the moment
 *     the USER acted, not the moment the request was built — otherwise a tab
 *     that has been open for a week can replay a stale theme over a fresh one
 *     simply by being noisy.
 *
 * ---------------------------------------------------------------------------
 * ALLOWLIST, NOT PASSTHROUGH
 * ---------------------------------------------------------------------------
 * Every key is declared below with a type and a range. Unknown keys are
 * dropped rather than stored. This endpoint is a preferences store, not a
 * general-purpose per-user KV — without an allowlist it becomes one within a
 * release or two, and then it is a place to smuggle unvalidated JSON that
 * something downstream will eventually trust.
 */

// ---------------------------------------------------------------------------
// Value validators. Each returns { ok: true, value } or { ok: false, reason }.
// Coercion is deliberate but narrow: numbers arrive as numbers or numeric
// strings (localStorage round-trips everything through strings), booleans as
// booleans or the exact strings 'true'/'false'. Anything else is a rejection,
// not a silent cast — `Number('') === 0` is exactly the sort of coercion that
// writes 0 into a width and makes a panel vanish.
// ---------------------------------------------------------------------------

const bool = () => (raw) => {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  if (raw === 'true') return { ok: true, value: true };
  if (raw === 'false') return { ok: true, value: false };
  return { ok: false, reason: 'expected boolean' };
};

const int = (min, max) => (raw) => {
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
  if (!Number.isFinite(n)) return { ok: false, reason: 'expected number' };
  const rounded = Math.round(n);
  // Clamp rather than reject. A width arriving slightly out of range is a UI
  // rounding artefact, not an attack, and refusing it would strand the user's
  // layout. A value that is not a number at all is still a rejection.
  return { ok: true, value: Math.max(min, Math.min(max, rounded)) };
};

const str = (maxLen, allowed) => (raw) => {
  if (typeof raw !== 'string') return { ok: false, reason: 'expected string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'expected non-empty string' };
  if (trimmed.length > maxLen) return { ok: false, reason: `exceeds ${maxLen} chars` };
  if (allowed && !allowed.includes(trimmed)) return { ok: false, reason: `not one of ${allowed.join('|')}` };
  return { ok: true, value: trimmed };
};

// ---------------------------------------------------------------------------
// The schema. Key names match the localStorage keys the frontend already uses,
// so wiring is a rename-free mapping and a misspelling shows up as a dropped
// key in the response rather than as a silent no-op.
//
// NOTE ON BACKGROUNDS: `useCustomBackground`, `bgOpacity` and `bgBlur` sync,
// but the background MEDIA does not. theme.js keeps the image/video in
// IndexedDB per theme and only mirrors a boolean "exists" flag into
// localStorage. Syncing the flag without the bytes would leave a second
// browser believing it has a background it cannot render, so the flag is
// deliberately NOT in this allowlist — see hasCustomBackground in theme.js.
// ---------------------------------------------------------------------------

export const GLOBAL_PREFS = Object.freeze({
  currentTheme: str(64),
  fontFamily: str(32),
  darkMode: bool(),
  greyscaleMode: bool(),
  cyberpunkMode: bool(),
  useCustomBackground: bool(),
  bgOpacity: int(50, 100),
  bgBlur: int(0, 20),
  panelPosition: str(8, ['left', 'right']),
  assetPanelFullWidth: bool(),
});

export const DEVICE_PREFS = Object.freeze({
  uiScale: int(75, 150),
  leftPanelWidth: int(0, 2000),
  rightPanelWidth: int(0, 2000),
  actualLeftPanelWidth: int(0, 2000),
  mainContentWidth: int(0, 10000),
  showLeftPanel: bool(),
  showRightPanel: bool(),
  leftPanelCollapsed: bool(),
  rightPanelCollapsed: bool(),
  leftPanelUserSized: bool(),
  rightPanelUserSized: bool(),
  sidebarClosed: bool(),
  headerCollapsed: bool(),
});

// A user with more devices than this is almost certainly a client minting a
// fresh id every boot (a bug we would rather bound than discover from a
// 4 MB row). Least-recently-updated buckets are evicted first.
export const MAX_DEVICES = 20;

// Defence in depth. The allowlist already bounds the real size to well under
// 1 KB per device; this only catches a future key added without a length cap.
export const MAX_SERIALIZED_BYTES = 64 * 1024;

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidDeviceId(id) {
  return typeof id === 'string' && DEVICE_ID_RE.test(id);
}

export function emptyPreferences() {
  return { global: {}, devices: {}, updatedAt: 0 };
}

/**
 * Parse whatever is in the DB column into a well-formed structure.
 * Corrupt or legacy content degrades to empty rather than throwing: a user
 * whose preferences blob got mangled should see defaults and be able to fix
 * them by changing a setting, not a 500 on every page load.
 */
export function parsePreferences(rawColumn) {
  if (!rawColumn) return emptyPreferences();

  let parsed;
  if (typeof rawColumn === 'object') {
    parsed = rawColumn;
  } else {
    try {
      parsed = JSON.parse(rawColumn);
    } catch {
      return emptyPreferences();
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyPreferences();

  const out = emptyPreferences();

  // Re-validate on READ, not just on write. The column is the trust boundary:
  // rows predate the current allowlist, and a key that was legal two releases
  // ago should not resurface just because it is already stored.
  if (parsed.global && typeof parsed.global === 'object' && !Array.isArray(parsed.global)) {
    for (const [key, validate] of Object.entries(GLOBAL_PREFS)) {
      if (!(key in parsed.global)) continue;
      const r = validate(parsed.global[key]);
      if (r.ok) out.global[key] = r.value;
    }
  }

  if (parsed.devices && typeof parsed.devices === 'object' && !Array.isArray(parsed.devices)) {
    for (const [deviceId, bucket] of Object.entries(parsed.devices)) {
      if (!isValidDeviceId(deviceId)) continue;
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
      const prefs = {};
      const source = bucket.prefs && typeof bucket.prefs === 'object' ? bucket.prefs : {};
      for (const [key, validate] of Object.entries(DEVICE_PREFS)) {
        if (!(key in source)) continue;
        const r = validate(source[key]);
        if (r.ok) prefs[key] = r.value;
      }
      out.devices[deviceId] = {
        prefs,
        label: typeof bucket.label === 'string' ? bucket.label.slice(0, 64) : null,
        updatedAt: Number.isFinite(bucket.updatedAt) ? bucket.updatedAt : 0,
      };
    }
  }

  out.updatedAt = Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0;
  return out;
}

/**
 * Apply a patch of {key: value | null} against an allowlist.
 * Returns the keys actually written, deleted, and rejected — the caller
 * reports these back so a client with a typo or a stale build can SEE that its
 * write was dropped instead of assuming success.
 */
function applyPatch(target, patch, allowlist) {
  const applied = [];
  const deleted = [];
  const rejected = [];

  for (const [key, raw] of Object.entries(patch)) {
    const validate = allowlist[key];
    if (!validate) {
      rejected.push({ key, reason: 'unknown key' });
      continue;
    }
    // Explicit null/undefined is a deletion: absence means "no opinion", so
    // there has to be some way to say "forget this".
    if (raw === null || raw === undefined) {
      if (key in target) {
        delete target[key];
        deleted.push(key);
      }
      continue;
    }
    const r = validate(raw);
    if (!r.ok) {
      rejected.push({ key, reason: r.reason });
      continue;
    }
    target[key] = r.value;
    applied.push(key);
  }

  return { applied, deleted, rejected };
}

/**
 * Merge an incoming PUT body into the stored preferences.
 *
 * @param stored   result of parsePreferences()
 * @param incoming { global?, device?, deviceId?, deviceLabel?, updatedAt? }
 * @param now      injectable clock (tests)
 * @returns { next, result }
 */
export function mergePreferences(stored, incoming, now = Date.now()) {
  const next = parsePreferences(stored);
  const body = incoming && typeof incoming === 'object' ? incoming : {};

  const result = {
    global: { applied: [], deleted: [], rejected: [], staleIgnored: false },
    device: { applied: [], deleted: [], rejected: [], deviceId: null },
    evictedDevices: [],
  };

  const incomingAt = Number.isFinite(body.updatedAt) ? body.updatedAt : now;

  // ---- global scope: last-write-wins -------------------------------------
  if (body.global && typeof body.global === 'object' && !Array.isArray(body.global)) {
    // Strictly older loses. Equal timestamps apply: a same-millisecond
    // collision is far more likely to be one client sending two patches than
    // two clients racing, and dropping the second would lose a real edit.
    if (incomingAt < next.updatedAt) {
      result.global.staleIgnored = true;
    } else {
      const r = applyPatch(next.global, body.global, GLOBAL_PREFS);
      result.global.applied = r.applied;
      result.global.deleted = r.deleted;
      result.global.rejected = r.rejected;
      if (r.applied.length || r.deleted.length) next.updatedAt = incomingAt;
    }
  }

  // ---- device scope: always applies --------------------------------------
  if (body.device && typeof body.device === 'object' && !Array.isArray(body.device)) {
    if (!isValidDeviceId(body.deviceId)) {
      result.device.rejected.push({ key: '*', reason: 'missing or malformed deviceId' });
    } else {
      const id = body.deviceId;
      if (!next.devices[id]) next.devices[id] = { prefs: {}, label: null, updatedAt: 0 };
      const bucket = next.devices[id];

      const r = applyPatch(bucket.prefs, body.device, DEVICE_PREFS);
      result.device.deviceId = id;
      result.device.applied = r.applied;
      result.device.deleted = r.deleted;
      result.device.rejected = r.rejected;

      if (typeof body.deviceLabel === 'string' && body.deviceLabel.trim()) {
        bucket.label = body.deviceLabel.trim().slice(0, 64);
      }
      if (r.applied.length || r.deleted.length) bucket.updatedAt = incomingAt;

      // Evict least-recently-updated buckets, never the one just written.
      const ids = Object.keys(next.devices);
      if (ids.length > MAX_DEVICES) {
        const victims = ids
          .filter((d) => d !== id)
          .sort((a, b) => (next.devices[a].updatedAt || 0) - (next.devices[b].updatedAt || 0))
          .slice(0, ids.length - MAX_DEVICES);
        for (const v of victims) {
          delete next.devices[v];
          result.evictedDevices.push(v);
        }
      }
    }
  }

  return { next, result };
}

/**
 * Serialize for storage. Returns null when there is nothing to store, so an
 * emptied preferences set clears the column instead of leaving `{}` behind.
 */
export function serializePreferences(prefs) {
  const hasGlobal = prefs && prefs.global && Object.keys(prefs.global).length > 0;
  const hasDevices = prefs && prefs.devices && Object.keys(prefs.devices).length > 0;
  if (!hasGlobal && !hasDevices) return null;

  const json = JSON.stringify({
    global: prefs.global,
    devices: prefs.devices,
    updatedAt: prefs.updatedAt || 0,
  });

  if (Buffer.byteLength(json, 'utf8') > MAX_SERIALIZED_BYTES) {
    const err = new Error('Preferences payload too large');
    err.code = 'PREFS_TOO_LARGE';
    throw err;
  }
  return json;
}

/**
 * Shape returned to a client: global preferences plus THIS device's bucket
 * already resolved, so the frontend does not have to know the storage layout.
 * Other devices' buckets are returned separately for a future "copy layout
 * from…" affordance, but the client never has to look at them.
 */
export function projectForDevice(prefs, deviceId) {
  const bucket = (isValidDeviceId(deviceId) && prefs.devices[deviceId]) || null;
  return {
    global: { ...prefs.global },
    device: bucket ? { ...bucket.prefs } : {},
    deviceId: isValidDeviceId(deviceId) ? deviceId : null,
    updatedAt: prefs.updatedAt || 0,
    knownDevices: Object.entries(prefs.devices).map(([id, b]) => ({
      deviceId: id,
      label: b.label || null,
      updatedAt: b.updatedAt || 0,
      current: id === deviceId,
    })),
  };
}
