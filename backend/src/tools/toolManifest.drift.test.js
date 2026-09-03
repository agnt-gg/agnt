/**
 * THE MANIFEST IS NOT A FALLBACK — it is what the MODEL reads.
 *
 * ToolRegistry prefers a tool file's static schema, which is why a stale
 * toolLibrary.json entry looks harmless. It is not: orchestrator/toolRegistry.js
 * and orchestrator/nodeTypeCatalog.js load toolLibrary.json DIRECTLY to build
 * the tool list handed to the LLM and the workflow node catalog. So a verb that
 * exists in the code and not in the manifest does not exist to the agent.
 *
 * That is exactly what happened here: the browser grew eleven verbs and the
 * manifest still advertised eight, and the built-in computer-* tools were
 * invisible. This test makes the manifest a derived artefact in practice —
 * if the schemas move and the manifest does not, this goes red.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import browser from './library/actions/browser.js';
import browserAct from './library/actions/ai-browser-act.js';
import computerInput from './library/actions/computer-input.js';
import computerSetup from './library/utilities/computer-setup.js';
import computerSession from './library/utilities/computer-session.js';
import computerWindows from './library/utilities/computer-windows.js';
import computerObserve from './library/utilities/computer-observe.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const MANIFEST_PATHS = [
  path.join(HERE, 'toolLibrary.json'),
  path.join(REPO_ROOT, 'frontend/src/tools/_toolLibrary.json'),
];
const manifests = MANIFEST_PATHS.map((manifestPath) => ({
  manifestPath,
  manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
}));
const entriesOf = (manifest) => Object.values(manifest).flat().filter((entry) => entry?.type);
const entryFor = (manifest, type) => entriesOf(manifest).find((entry) => entry.type === type);

const TOOLS = [browser, browserAct, computerInput, computerSetup, computerSession, computerWindows, computerObserve];

describe('the manifests match the code the model will actually run', () => {
  it.each(manifests.flatMap(({ manifestPath, manifest }) => TOOLS.map((tool) => [
    path.relative(REPO_ROOT, manifestPath), tool.constructor.schema.type, tool, manifest,
  ])))('%s: %s is present and byte-identical to its static schema', (_path, type, tool, manifest) => {
    const entry = entryFor(manifest, type);
    expect(entry, `${type} is missing — the model cannot see it`).toBeTruthy();
    expect(entry).toEqual(JSON.parse(JSON.stringify(tool.constructor.schema)));
  });

  it('lands each tool in the manifest bucket its category names', () => {
    for (const { manifest } of manifests) {
      const bucketOf = (type) => Object.entries(manifest).find(([, list]) => Array.isArray(list) && list.some((e) => e?.type === type))?.[0];
      expect(bucketOf('browser')).toBe('actions');
      expect(bucketOf('ai-browser-act')).toBe('actions');
      expect(bucketOf('computer-input')).toBe('actions');
      for (const t of ['computer-setup', 'computer-session', 'computer-windows', 'computer-observe']) {
        expect(bucketOf(t), t).toBe('utilities');
      }
    }
  });

  it('advertises every browser verb, not the eight it used to have', () => {
    const advertised = entryFor(manifests[0].manifest, 'ai-browser-act').parameters.action.description;
    for (const verb of ['wait', 'select', 'hover', 'dialog', 'tabs', 'open', 'focus', 'close', 'console', 'errors', 'requests']) {
      expect(advertised, `manifest never mentions "${verb}"`).toContain(verb);
    }
  });

  it('no manifest entry still names the plugin the computer tools came from', () => {
    for (const t of ['computer-input', 'computer-setup', 'computer-session', 'computer-windows', 'computer-observe']) {
      for (const { manifest } of manifests) {
        expect(JSON.stringify(entryFor(manifest, t)), t).not.toMatch(/cua-(setup|session|windows|observe|input|act)\b/);
      }
    }
  });

  it('every entry is shaped the way the catalog expects', () => {
    for (const tool of TOOLS) {
      const entry = entryFor(manifests[0].manifest, tool.constructor.schema.type);
      expect(entry.title, entry.type).toBeTruthy();
      expect(entry.description, entry.type).toBeTruthy();
      expect(entry.category, entry.type).toBeTruthy();
      expect(typeof entry.parameters, entry.type).toBe('object');
    }
  });
});
