/**
 * CONTRACT: the Browser Agent is an ENGINE, not a tool, and its schema still
 * describes what the code actually reads.
 *
 * It used to be a registered tool whose schema was copied by hand into two
 * manifests, and it spent a long time advertising three dead providers because
 * the code changed and the copies did not. It is now reached only through the
 * `browser` tool's action="run", so the copies are gone — and the assertion
 * that replaced them is that they STAY gone, because a re-added manifest entry
 * would put a fourth browser tool back in the user's picker.
 *
 * What still matters, and is still tested below: the schema declares every
 * parameter the engine reads, and the browser-use version stays pinned.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The action drags in the auth stack and the database on import; none of that
// is involved in declaring a schema.
vi.mock('../../../services/auth/AuthManager.js', () => ({ default: { getValidAccessToken: vi.fn() } }));
vi.mock('../../../services/ai/CustomOpenAIProviderService.js', () => ({ default: { isCustomProvider: vi.fn(), getProviderCredentials: vi.fn() } }));
vi.mock('../../../utils/PathManager.js', () => ({ default: { getUserDataPath: () => '/tmp', getPath: (...p) => path.join('/tmp', ...p) } }));

const { default: action, BROWSER_USE_VERSION } = await import('./ai-browser-use.js');
const { browserUseProviderOptions } = await import('./browserUseProviders.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..');

const MANIFESTS = [
  'backend/src/tools/toolLibrary.json',
  'frontend/src/tools/_toolLibrary.json',
];

const manifest = (relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));

const { schema } = action.constructor;

describe('the engines are not tools', () => {
  // There is ONE browser tool. These three were registered alongside it as
  // back-compat aliases, which meant the picker listed four browser tools and
  // the model had three chances to choose the wrong one. The DB was checked
  // before they were removed -- 45 tables, every column, zero references.
  const LEGACY = ['ai-browser-use', 'ai-browser-control', 'ai-browser-act'];

  for (const relativePath of MANIFESTS) {
    it(`no legacy browser entry survives in ${relativePath}`, () => {
      const types = manifest(relativePath).actions.map((tool) => tool?.type);
      for (const legacy of LEGACY) {
        expect(types, `${legacy} is back in the manifest -- the picker will show it as a tool`).not.toContain(legacy);
      }
      // Absence is only meaningful if the list was actually built.
      expect(types).toContain('browser');
    });
  }

  it('lives outside every directory ToolRegistry scans', () => {
    // The enforcement is structural, not a denylist: ToolRegistry readdir-scans
    // a fixed set of category directories, and browserEngines/ is not one of
    // them. Move this file back under actions/ and it registers itself again,
    // however absent from the manifest it is.
    const SCANNED = ['actions', 'triggers', 'controls', 'utilities', 'widgets', 'custom', 'mcp'];
    const dir = path.basename(here);
    expect(dir).toBe('browserEngines');
    expect(SCANNED).not.toContain(dir);
  });
});

describe('schema declares what the code actually reads', () => {
  it('offers every routed provider in the dropdown', () => {
    expect(schema.parameters.provider.options).toEqual(browserUseProviderOptions());
    expect(schema.parameters.provider.options.length).toBeGreaterThan(15);
  });

  it('declares every parameter the node reads', () => {
    // `reuseBrowser` was the counter-example: documented, coded against, and
    // absent from this list, so it was permanently undefined — and would have
    // thrown if it had ever been reached, because it read a camelCase attribute
    // that browser-use does not have.
    const source = fs.readFileSync(path.join(here, 'ai-browser-use.js'), 'utf8');
    const read = [...source.matchAll(/params\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
    const declared = new Set(Object.keys(schema.parameters));

    for (const name of new Set(read)) {
      expect(declared.has(name), `params.${name} is read but not declared in the schema`).toBe(true);
    }
  });

  it('pins browser-use to an exact version', () => {
    // Installing from git main is what killed the Gemini option: upstream
    // deleted ChatGoogleGenerativeAI and nothing here named a version.
    expect(BROWSER_USE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);

    // The pin now lives with the code that installs it, so this asserts against
    // the installer rather than the tool that re-exports it. Reading the tool's
    // source here would have kept passing while the installer drifted.
    const installer = fs.readFileSync(path.join(here, 'browserUseEnvironment.js'), 'utf8');
    // Matches a string LITERAL, so the comment explaining the old behaviour
    // does not trip it. Installing from a VCS ref is the defect, whatever URL
    // it points at.
    expect(installer, 'the installer must not fetch from a VCS ref').not.toMatch(/['"]git\+/);
    expect(installer).toContain('browser-use==${BROWSER_USE_VERSION}');
    expect(installer).toContain(`BROWSER_USE_VERSION = '${BROWSER_USE_VERSION}'`);
  });
});
