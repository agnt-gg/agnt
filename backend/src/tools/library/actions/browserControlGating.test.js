/**
 * CONTRACT: Browser Control is registered as a tool, and is NOT a workflow node.
 *
 * Those two statements have to be true at the same time, in three files that
 * nothing relates to each other:
 *
 *   - both toolLibrary.json manifests must carry it, or the orchestrator cannot
 *     offer it in chat at all;
 *   - nodeTypeCatalog must NOT return it, or it appears in the node palette and
 *     in every catalogue an LLM builds workflows from;
 *   - the workflow-chat system prompt must not list it, or the workflow builder
 *     is taught to emit a node type the engine then refuses at run time.
 *
 * The `chatOnly` flag is what carries that intent across all three. This test
 * exists because a flag nothing reads is indistinguishable from a flag that
 * works, right up until a webhook executes a model-authored program.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// The catalogue initialises the plugin subsystem on import; none of that is
// involved in deciding whether a built-in tool is a workflow node.
vi.mock('../../../plugins/PluginManager.js', () => ({
  default: { initialized: true, initialize: vi.fn(), getAllPluginSchemas: () => [] },
}));

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..');

const manifest = (relativePath) => JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));

const MANIFESTS = [
  'backend/src/tools/toolLibrary.json',
  'frontend/src/tools/_toolLibrary.json',
];

describe('it is registered where chat can reach it', () => {
  for (const relativePath of MANIFESTS) {
    it(`appears in ${relativePath}`, () => {
      const entry = manifest(relativePath).actions.find((tool) => tool?.type === 'ai-browser-control');
      expect(entry, 'run node backend/scripts/sync-browser-tool-schemas.mjs').toBeTruthy();
      expect(entry.chatOnly).toBe(true);
      expect(entry.parameters.python).toBeTruthy();
    });
  }

  it('does not accidentally mark the Browser Agent chat-only', () => {
    // The Browser Agent is the workflow half of this pair. If it ever picked up
    // the flag, unattended browser automation would silently stop existing.
    for (const relativePath of MANIFESTS) {
      const entry = manifest(relativePath).actions.find((tool) => tool?.type === 'ai-browser-use');
      expect(entry.chatOnly).toBeUndefined();
    }
  });
});

describe('the manifests cannot drift from the class', () => {
  // The same protection ai-browser-use.schema.test.js gives the Browser Agent.
  // Nothing regenerates these manifests; the Browser Agent's provider dropdown
  // advertised two dead providers for months because no test related the copies.
  for (const relativePath of MANIFESTS) {
    it(`matches the class schema in ${relativePath}`, async () => {
      const { schema } = (await import('./ai-browser-control.js')).default.constructor;
      const entry = manifest(relativePath).actions.find((tool) => tool?.type === 'ai-browser-control');

      expect(entry.parameters).toEqual(JSON.parse(JSON.stringify(schema.parameters)));
      expect(entry.outputs).toEqual(JSON.parse(JSON.stringify(schema.outputs)));
      expect(entry.description).toBe(schema.description);
      expect(entry.title).toBe(schema.title);
    });
  }

  it('declares every parameter the action actually reads', async () => {
    // `reuseBrowser` was the counter-example on the other tool: documented,
    // coded against, absent from the schema, and therefore permanently
    // undefined.
    const { schema } = (await import('./ai-browser-control.js')).default.constructor;
    const source = fs.readFileSync(path.join(here, 'ai-browser-control.js'), 'utf8');
    const read = new Set([...source.matchAll(/params\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]));
    const declared = new Set(Object.keys(schema.parameters));

    for (const name of read) {
      expect(declared.has(name), `params.${name} is read but not declared`).toBe(true);
    }
  });
});

describe('it is not offered as a workflow node', () => {
  it('is absent from the node catalogue, while the Browser Agent is present', async () => {
    const { loadAllNodeTypes } = await import('../../../services/orchestrator/nodeTypeCatalog.js');
    const { flat } = await loadAllNodeTypes();
    const types = flat.map((tool) => tool.type);

    expect(types).not.toContain('ai-browser-control');
    // The other half of the assertion: the filter must not have eaten the
    // catalogue. A test that only checks for absence passes on an empty list.
    expect(types).toContain('ai-browser-use');
    expect(flat.length).toBeGreaterThan(20);
  });

  it('is absent from the workflow builder\'s system prompt', async () => {
    const { getWorkflowSystemContent } = await import(
      '../../../services/orchestrator/system-prompts/workflow-chat.js'
    );
    const text = String(await getWorkflowSystemContent(null, {}, null));

    expect(text).not.toContain('ai-browser-control');
    // Same reason as above: absence is only meaningful if the list was built.
    expect(text).toContain('ai-browser-use');
  });
});

describe('the two browser tools stay distinguishable', () => {
  it('point the model at each other for the case they do not cover', async () => {
    const control = (await import('./ai-browser-control.js')).default.constructor.schema;
    const agent = (await import('./ai-browser-use.js')).default.constructor.schema;

    // Each description has to name the other tool, because the wrong choice is
    // silent: the Browser Agent works in chat (just slower and blind to the
    // outer conversation), and Browser Control simply refuses in a workflow.
    expect(control.description).toMatch(/ai_browser_use/);
    expect(control.title).toBe('Browser Control');
    expect(agent.title).toBe('Browser Agent');
  });

  it('steers the model to goto_url instead of new_tab', async () => {
    // The single-webview surface refuses Target.createTarget, and upstream's own
    // skill text tells agents to open pages with new_tab() first. Without this
    // in the description, the model's FIRST navigation always fails.
    const { description } = (await import('./ai-browser-control.js')).default.constructor.schema;

    expect(description).toMatch(/NOT new_tab\(\)/);
    expect(description).toMatch(/goto_url\(url\)/);
    expect(description).toMatch(/wait_for_load\(\)/);
  });

  it('promises a browser, so the model never asks the user to open one', async () => {
    // The tool opens its own browser when no widget is there. A model that does
    // not know that will hand the work back to the user for no reason.
    const { description } = (await import('./ai-browser-control.js')).default.constructor.schema;

    expect(description).toMatch(/never ask the user to open one/i);
  });
});
