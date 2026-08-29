/**
 * CONTRACT: the Browser Agent's schema is identical in all three places it
 * lives — the action class, the backend manifest, and the frontend manifest.
 *
 * Nothing generates the manifests; they are hand-maintained copies. The node
 * spent a long time advertising three providers because the code changed and
 * the copies did not, and no test related them. Run
 * `node backend/scripts/sync-browser-tool-schemas.mjs` when this fails.
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

const manifestEntry = (relativePath) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
  const entry = manifest.actions.find((tool) => tool?.type === 'ai-browser-use');
  expect(entry, `ai-browser-use missing from ${relativePath}`).toBeTruthy();
  return entry;
};

const { schema } = action.constructor;

describe('schema is the same everywhere', () => {
  for (const relativePath of [
    'backend/src/tools/toolLibrary.json',
    'frontend/src/tools/_toolLibrary.json',
  ]) {
    it(`matches ${relativePath}`, () => {
      const entry = manifestEntry(relativePath);
      expect(entry.parameters).toEqual(JSON.parse(JSON.stringify(schema.parameters)));
      expect(entry.outputs).toEqual(JSON.parse(JSON.stringify(schema.outputs)));
      expect(entry.description).toBe(schema.description);
    });
  }
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
