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
import computerUse from './library/actions/computer-use.js';
import triggerTimer from './library/triggers/trigger-timer.js';

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

// trigger-timer: its time-zone parameter and fire-on-start meaning changed
// with durable timers; the editor and the model read the manifest, not the file.
const TOOLS = [browser, computerUse, triggerTimer];

// De-registered 2026-09: `browser` is the one browser tool, and these three are
// engines behind it, living outside every scanned directory. A manifest entry
// is what makes a tool visible in the picker, so their absence is the contract.
const DE_REGISTERED = [
  'ai-browser-use', 'ai-browser-control', 'ai-browser-act',
  // Same demotion, same reason: five stages of one capability, whose split
  // leaked into titles like "Computer Input (Click / Type / Menu / Keys /
  // Clipboard)". They are actions on computer-use now.
  'computer-input', 'computer-observe', 'computer-windows', 'computer-session', 'computer-setup',
];

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
      // Computer Use is an ACTION, not a utility. The four utilities it
      // absorbed were only utilities because looking at the screen had been
      // split away from acting on it; one tool that does both acts.
      expect(bucketOf('computer-use')).toBe('actions');
    }
  });

  it('no de-registered browser engine is back in a manifest', () => {
    for (const { manifestPath, manifest } of manifests) {
      const types = entriesOf(manifest).map((entry) => entry.type);
      for (const type of DE_REGISTERED) {
        expect(types, `${path.relative(REPO_ROOT, manifestPath)} re-registered ${type}`).not.toContain(type);
      }
      expect(types, 'the one browser tool must still be there').toContain('browser');
    }
  });

  it('advertises every browser verb, not the eight it used to have', () => {
    const advertised = entryFor(manifests[0].manifest, 'browser').parameters.action.description;
    for (const verb of ['wait', 'select', 'hover', 'dialog', 'tabs', 'open', 'focus', 'close', 'console', 'errors', 'requests']) {
      expect(advertised, `manifest never mentions "${verb}"`).toContain(verb);
    }
  });

  it('no manifest entry still names the plugin the computer tools came from', () => {
    for (const { manifest } of manifests) {
      expect(JSON.stringify(entryFor(manifest, 'computer-use')), 'computer-use')
        .not.toMatch(/cua-(setup|session|windows|observe|input|act)\b/);
    }
  });

  /**
   * FOUND BY CALLING THE TOOL, NOT BY READING IT.
   *
   * orchestrator/toolRegistry._createOpenApiSchema marks a parameter REQUIRED
   * unless it has a default, is conditional, or says `required: false`. Every
   * verb tool is one action plus a bag of per-verb parameters, so that rule
   * turned `browser` into 21-of-24 mandatory and the live call came back
   * "Missing required parameters: ref, selector, text, value, ms, tabId, ..."
   * — the tool could not be called AT ALL. Every unit test still passed,
   * because they all call the execute() function directly and never cross the
   * schema the model is handed.
   *
   * One verb selector is mandatory. Nothing else can be.
   */
  it('asks the model for nothing but the verb — anything else makes the tool uncallable', () => {
    for (const { manifestPath, manifest } of manifests) {
      for (const type of ['browser', 'computer-use']) {
        const params = entryFor(manifest, type).parameters;
        const mandatory = Object.entries(params)
          .filter(([, def]) => def.default === undefined && !def.conditional && def.required !== false)
          .map(([name]) => name);
        expect(mandatory, `${path.relative(REPO_ROOT, manifestPath)} ${type}`).toEqual(['action']);
      }
    }
  });

  /**
   * The union must not inherit a mandatory parameter from any engine.
   *
   * computer-session declared `session` required, because every driver call it
   * makes is scoped to a session id. Folded into a union that also serves
   * list_windows and doctor, that would make the WHOLE tool demand a session
   * id to list windows -- the same uncallable-tool failure as above, arriving
   * by inheritance instead of by authoring.
   */
  it('inherits no engine\'s mandatory parameter into the union', () => {
    for (const { manifestPath, manifest } of manifests) {
      const params = entryFor(manifest, 'computer-use').parameters;
      const mandatory = Object.entries(params)
        .filter(([, def]) => def.default === undefined && !def.conditional && def.required !== false)
        .map(([name]) => name);
      expect(mandatory, `${path.relative(REPO_ROOT, manifestPath)} computer-use`).toEqual(['action']);
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
