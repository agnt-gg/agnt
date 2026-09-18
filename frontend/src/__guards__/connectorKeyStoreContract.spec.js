/**
 * CONTRACT: every api-key save path must route connector-only providers to the
 * LOCAL key store before it POSTs to the remote one.
 *
 * WHY THIS EXISTS
 * ---------------
 * A connector-catalogue provider (store/auth/connectorCatalog.js) is injected
 * into the provider list client-side. The remote key store at
 * `{REMOTE_URL}/auth/apikeys/:id` has no row for it, so a key posted there is
 * attached to nothing and the provider never connects.
 *
 * This was a *class* of bug rather than one mistake, for the same reason as
 * oauthMessageOriginContract.spec.js in this directory: no single module owned
 * the rule. Two save paths existed — Connectors.vue and
 * composables/useProviderConnection.js, the latter reached from Tools.vue,
 * ToolsPanel.vue and the WorkflowForge editor panel. Fixing the first left the
 * second posting connector keys to the remote store, so the same key saved
 * from one screen worked and from another silently did not.
 *
 * The remedy is the same: one shared helper, enforced mechanically at every
 * call site. `services/connectorApiKey.js` has real unit tests, and the
 * composable path has behavioural tests — but Connectors.vue's saveApiKey is a
 * private closure inside a 3,000-line SFC with no unit spec, so without this
 * guard the branch could be deleted from it and nothing would fail.
 *
 * Call sites are DISCOVERED from source rather than listed, so a third save
 * path added tomorrow is covered without anyone remembering this file.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.resolve(HERE, '..');

/** The dangerous operation: writing a key to a store that may not know this provider. */
const REMOTE_KEY_STORE = '/auth/apikeys/';
/** The one predicate allowed to answer "does this key belong somewhere else?". */
const GUARD = 'usesLocalKeyStore';
/** The one function allowed to perform the local save. */
const LOCAL_SAVE = 'saveConnectorApiKey';

/** Where the helper is defined. */
const NOT_CALL_SITES = ['services/connectorApiKey.js'];

/**
 * An ORPHAN, and the only exception. It is imported by nothing (asserted
 * below, so this exception cannot rot) and it fetches its provider list
 * straight from the remote catalogue rather than reading the store, so the
 * client-side connector rows never reach it. Wiring a connector branch into a
 * component nobody mounts would be dead code defended by a test.
 */
const ORPHANED = 'views/Terminal/CenterPanel/screens/Settings/components/_OauthManager/OauthManager.vue';

/**
 * Screens that never SEE a connector row, because they render their provider
 * list through ProviderLanes, which filters connectorOnly out upstream.
 *
 * Their save paths were briefly given the branch anyway, as defence in depth.
 * That was wrong twice over: the code is unreachable, and
 * store/app/providerGridParity.spec.js exists specifically to keep these two
 * files free of provider logic that ProviderLanes already owns — a rule this
 * PR should follow rather than quietly erode.
 *
 * The delegation is asserted below, so if either stops rendering through
 * ProviderLanes the exemption fails instead of silently covering for it.
 */
const DELEGATED_TO_LANES = [
  'components/OnboardingModal.vue',
  'views/Terminal/CenterPanel/screens/Chat/components/ProviderSetup.vue',
];

/**
 * A call site is an occurrence that WRITES a key, not any mention of the URL.
 *
 * services/localKeyBackfill.js READS the same endpoint (`axios.get`) to copy
 * remote keys into the local store. Matching the URL alone flagged it, which
 * would have meant either a false failure or a named exception — both worse
 * than asking the question properly.
 */
function writeOccurrences(code) {
  const hits = [];
  let from = 0;
  for (;;) {
    const idx = code.indexOf(REMOTE_KEY_STORE, from);
    if (idx === -1) break;
    const before = code.slice(Math.max(0, idx - 60), idx);
    const after = code.slice(idx, idx + 240);
    const isWrite = /method:\s*'POST'/.test(after) || /\.post\s*\(\s*$/.test(before.trimEnd());
    if (isWrite) hits.push(idx);
    from = idx + REMOTE_KEY_STORE.length;
  }
  return hits;
}

/**
 * Remove comments so prose discussing these identifiers cannot vouch for a
 * file that never calls them — and so a commented-out guard reads as absent.
 * This matters here specifically: the module docstring and the specs both
 * mention the remote path and the guard by name.
 *
 * String- and template-aware on purpose, following the same reasoning as
 * oauthMessageOriginContract.spec.js: a naive `//.*$` sweep truncates any line
 * containing a URL, deleting real code from the scanned text and turning this
 * guard into a source of false passes.
 */
function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Index of a CALL to `name`, or -1.
 *
 * Not `includes(name)`: that is satisfied by the surviving
 * `import { usesLocalKeyStore } from ...` line after the branch itself is
 * deleted, so the guard passed on a reverted fix. Mutation testing caught it —
 * the same false-pass class as a comment vouching for a file, one line up.
 */
function callIndex(code, name) {
  const m = new RegExp(`\\b${name}\\s*\\(`).exec(code);
  return m ? m.index : -1;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '__guards__']);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (/\.(js|vue)$/.test(entry.name) && !/\.(spec|test)\.js$/.test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

/** Files whose CODE posts to the remote key store. */
function findCallSites() {
  const sites = [];
  for (const file of walk(FRONTEND_SRC)) {
    const rel = path.relative(FRONTEND_SRC, file).split(path.sep).join('/');
    if (NOT_CALL_SITES.includes(rel) || rel === ORPHANED) continue;
    if (DELEGATED_TO_LANES.includes(rel)) continue;
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    const writes = writeOccurrences(code);
    if (writes.length) sites.push({ rel, code, firstWrite: writes[0] });
  }
  return sites;
}

describe('CONTRACT: connector keys never go to the remote key store', () => {
  const sites = findCallSites();

  it('finds the save paths at all', () => {
    // A discovery bug that matched nothing would make every assertion below
    // vacuously true. Both known paths must be present.
    expect(sites.length, 'no api-key save path found — the discovery is broken').toBeGreaterThan(0);
    const names = sites.map((s) => s.rel);
    expect(names).toContain('views/Terminal/CenterPanel/screens/Connectors/Connectors.vue');
    expect(names).toContain('composables/useProviderConnection.js');
  });

  it('every save path consults the shared guard', () => {
    for (const { rel, code } of sites) {
      expect(callIndex(code, GUARD), `${rel} posts to the remote key store without calling ${GUARD}()`).toBeGreaterThan(-1);
      expect(callIndex(code, LOCAL_SAVE), `${rel} does not call ${LOCAL_SAVE}()`).toBeGreaterThan(-1);
    }
  });

  it('consults it BEFORE posting, not after', () => {
    // A guard that runs after the POST protects nothing.
    for (const { rel, code, firstWrite } of sites) {
      expect(
        callIndex(code, GUARD),
        `${rel} checks ${GUARD}() only after posting to the remote store`,
      ).toBeLessThan(firstWrite);
    }
  });

  it('the one exempt file is still an orphan', () => {
    // The exemption above is only safe while nothing mounts it. If a future
    // change imports this component, it becomes reachable, its unguarded save
    // path goes live, and this test fails rather than the exemption silently
    // covering for it.
    const importers = [];
    for (const file of walk(FRONTEND_SRC)) {
      const rel = path.relative(FRONTEND_SRC, file).split(path.sep).join('/');
      if (rel === ORPHANED) continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      if (code.includes('OauthManager')) importers.push(rel);
    }
    expect(importers, `${ORPHANED} is now referenced — give it the connector branch`).toEqual([]);
  });

  it('an import alone does not vouch for a file', () => {
    // The defect mutation testing found: deleting the branch leaves the import
    // behind, and a bare `includes()` went on passing.
    const importedButUnused = `import { usesLocalKeyStore, saveConnectorApiKey } from '@/services/connectorApiKey.js';\nawait fetch(url, { method: 'POST' });`;
    expect(importedButUnused).toContain(GUARD);
    expect(callIndex(importedButUnused, GUARD)).toBe(-1);

    const actuallyCalled = `if (usesLocalKeyStore(app.id)) { await saveConnectorApiKey(app.id, key); }`;
    expect(callIndex(actuallyCalled, GUARD)).toBeGreaterThan(-1);
    expect(callIndex(actuallyCalled, LOCAL_SAVE)).toBeGreaterThan(-1);
  });

  it('the lane-delegated screens still delegate', () => {
    // Their protection is entirely upstream: ProviderLanes drops connectorOnly
    // rows before these screens ever render one. If a screen stops rendering
    // through it, that protection is gone and the exemption must be revisited.
    for (const rel of DELEGATED_TO_LANES) {
      const code = stripComments(fs.readFileSync(path.join(FRONTEND_SRC, rel), 'utf8'));
      expect(code, `${rel} no longer renders through ProviderLanes`).toContain('ProviderLanes');
    }
  });

  it('tells a read of the key store from a write', () => {
    // The matcher itself, proven on both shapes — otherwise narrowing it to
    // writes could silently stop discovering anything at all.
    const read = `await axios.get(\`\${API_CONFIG.REMOTE_URL}/auth/apikeys/\${id}\`, { headers, timeout: 8000 });`;
    const write = `await fetch(\`\${API_CONFIG.REMOTE_URL}/auth/apikeys/\${id}\`, {\n  method: 'POST',\n  headers,\n});`;
    expect(writeOccurrences(read)).toEqual([]);
    expect(writeOccurrences(write)).toHaveLength(1);
  });

  it('the comment stripper catches the defect it exists to prevent', () => {
    // Without this, prose naming the guard would vouch for a file that never
    // calls it — and this whole guard would pass on a reverted fix.
    const vouchedForByAComment = `
      // usesLocalKeyStore is handled elsewhere, honest
      /* saveConnectorApiKey */
      await fetch(\`\${API_CONFIG.REMOTE_URL}/auth/apikeys/\${id}\`);
    `;
    const stripped = stripComments(vouchedForByAComment);
    expect(stripped).not.toContain(GUARD);
    expect(stripped).not.toContain(LOCAL_SAVE);
    // The URL inside the template literal must survive, or discovery breaks.
    expect(stripped).toContain(REMOTE_KEY_STORE);
  });
});
