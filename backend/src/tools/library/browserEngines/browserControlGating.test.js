/**
 * CONTRACT: running a model-authored PROGRAM stays chat-only, now that Browser
 * Control is an engine behind `browser` action="script" rather than a tool.
 *
 * A workflow node's parameters are templated from trigger data — text arriving
 * from Discord, email or a webhook. A parameter that IS a program therefore
 * must never be reachable from a node. That used to be carried by a `chatOnly`
 * flag on a registered tool; the tool is gone, so what has to hold now is:
 *
 *   - `browser` IS a workflow node (the verbs and action="run" are the whole
 *     point of unattended browser automation);
 *   - the refusal inside the engine still fires, because that is the half that
 *     actually holds — a workflow JSON can name anything;
 *   - the legacy types appear in no catalogue and no system prompt, or the
 *     workflow builder is taught to emit a node type that no longer exists.
 *
 * This test exists because a gate nothing reads is indistinguishable from a
 * gate that works, right up until a webhook executes a model-authored program.
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

describe('chat reaches the program engine through the one browser tool', () => {
  for (const relativePath of MANIFESTS) {
    it(`${relativePath} carries browser, and none of the engines`, () => {
      const entries = manifest(relativePath).actions;
      const browserEntry = entries.find((tool) => tool?.type === 'browser');

      expect(browserEntry, 'the one browser tool must be registered').toBeTruthy();
      expect(browserEntry.parameters.python, 'action="script" needs its parameter').toBeTruthy();

      for (const legacy of ['ai-browser-control', 'ai-browser-use', 'ai-browser-act']) {
        expect(entries.map((t) => t?.type), legacy).not.toContain(legacy);
      }
    });
  }

  it('does not mark the one browser tool chat-only', () => {
    // `browser` is the workflow half too. If it ever picked up the flag,
    // unattended browser automation would silently stop existing.
    for (const relativePath of MANIFESTS) {
      const entry = manifest(relativePath).actions.find((tool) => tool?.type === 'browser');
      expect(entry.chatOnly).toBeUndefined();
    }
  });
});

describe('the engine still declares what it reads', () => {
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

// The first import of the catalogue loads every tool module, cold: about 2s alone and past
// vitest's 5s default under a parallel run (timed out in 1 of 3 local runs, 2026-10-09).
describe('it is not offered as a workflow node', { timeout: 60000 }, () => {
  it('is absent from the node catalogue, while the Browser Agent is present', async () => {
    const { loadAllNodeTypes } = await import('../../../services/orchestrator/nodeTypeCatalog.js');
    const { flat } = await loadAllNodeTypes();
    const types = flat.map((tool) => tool.type);

    expect(types).not.toContain('ai-browser-control');
    expect(types).not.toContain('ai-browser-use');
    expect(types).not.toContain('ai-browser-act');
    // The other half of the assertion: the filter must not have eaten the
    // catalogue. A test that only checks for absence passes on an empty list.
    expect(types).toContain('browser');
    expect(flat.length).toBeGreaterThan(20);
  });

  it('is absent from the workflow builder\'s system prompt', async () => {
    const { getWorkflowSystemContent } = await import(
      '../../../services/orchestrator/system-prompts/workflow-chat.js'
    );
    const text = String(await getWorkflowSystemContent(null, {}, null));

    expect(text).not.toContain('ai-browser-control');
    expect(text).not.toContain('ai-browser-use');
    expect(text).not.toContain('ai-browser-act');
    // Same reason as above: absence is only meaningful if the list was built.
    expect(text).toContain('browser');
  });
});

describe('no engine still advertises itself as a tool the model can pick', () => {
  it('names no dead tool, because there is nothing left to choose between', async () => {
    // These descriptions used to point the model at each other, because picking
    // the wrong one of three was silent and costly. The model is now handed one
    // schema, so a reference to `ai_browser_use` is not guidance any more -- it
    // is an instruction to call a tool that does not exist.
    const control = (await import('./ai-browser-control.js')).default.constructor.schema;
    const agent = (await import('./ai-browser-use.js')).default.constructor.schema;

    for (const { type, description } of [control, agent]) {
      expect(description, type).not.toMatch(/ai_browser_(use|act|control)/);
      expect(description, type).not.toMatch(/ai-browser-(use|act|control)/);
    }
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
