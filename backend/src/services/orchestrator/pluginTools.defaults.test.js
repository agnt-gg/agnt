/**
 * A plugin tool called from the chat gets the defaults its manifest declares.
 *
 * Reported 2026-10-20 from AGNT One: atlas_chat's manifest declares `model`
 * with a default, so its schema left `model` out of `required`; the model
 * omitted it and the plugin answered "Parameter \"model\" is required". A
 * workflow never hits this: the designer fills declared defaults into the
 * node. The chat path now does the same before the plugin runs.
 *
 * Runs the REAL executeTool with a registry tool shaped like atlas_chat.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => { process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true'; });
vi.mock('node-fetch', () => ({ default: vi.fn(() => { throw new Error('Unexpected network call'); }) }));
vi.mock('../MCPToolService.js', () => ({ default: { getSchemas: vi.fn(async () => []) } }));
vi.mock('../../models/CustomToolModel.js', () => ({ default: { findAllByUserId: vi.fn(async () => []), findOne: vi.fn(async () => null) } }));

import { executeTool } from './tools.js';
import toolRegistry from './toolRegistry.js';
import { applyDeclaredDefaults } from '../../utils/argumentCoercion.js';

// atlas_chat's manifest, as the registry converts it.
const MANIFEST = {
  type: 'atlas-chat',
  description: 'OpenAI-compatible chat completions on Atlas Cloud.',
  parameters: {
    model: { type: 'string', default: 'zai-org/glm-5.1', required: true },
    userMessage: { type: 'string', required: true },
    temperature: { type: 'number', default: 0.7 },
    maxTokens: { type: 'number' , required: false },
  },
};
const received = [];
const fakeTool = () => ({
  type: 'atlas-chat',
  isPlugin: true,
  pluginName: 'atlas-cloud',
  authConfig: { authRequired: false, authProvider: null },
  openApiSchema: toolRegistry._pluginSchemaToOpenApi(MANIFEST),
  implementation: { execute: async (params) => { received.push(params); return { content: 'ok' }; } },
});

beforeEach(() => {
  received.length = 0;
  vi.spyOn(toolRegistry, 'ensureInitialized').mockResolvedValue();
  vi.spyOn(toolRegistry, 'getTool').mockImplementation((name) => (name === 'atlas-chat' ? fakeTool() : null));
});

describe('plugin tools called from the chat', () => {
  it('the schema lets the model omit a defaulted parameter (anti-vacuity)', () => {
    const { required } = fakeTool().openApiSchema.function.parameters;
    expect(required).toEqual(['userMessage']);
  });

  it('THE REPORTED BUG: an omitted parameter arrives with its declared default', async () => {
    const out = JSON.parse(await executeTool('atlas_chat', { userMessage: 'hi' }, null, { userId: 'user-1' }));
    expect(out).toEqual({ content: 'ok' });
    expect(received[0]).toMatchObject({ model: 'zai-org/glm-5.1', temperature: 0.7, userMessage: 'hi' });
  });

  it('a value the model sent wins over the default', async () => {
    await executeTool('atlas_chat', { userMessage: 'hi', model: 'moonshotai/kimi-k2.6', temperature: 0 }, null, { userId: 'user-1' });
    expect(received[0]).toMatchObject({ model: 'moonshotai/kimi-k2.6', temperature: 0 });
  });

  it('a parameter with no default stays absent', async () => {
    await executeTool('atlas_chat', { userMessage: 'hi' }, null, { userId: 'user-1' });
    expect('maxTokens' in received[0]).toBe(false);
  });
});

describe('applyDeclaredDefaults (pure)', () => {
  const schema = (properties) => ({ function: { parameters: { properties } } });

  it('treats null like absent, as the workflow designer does; keeps falsy values the caller chose', () => {
    const out = applyDeclaredDefaults({ a: null, b: 0, c: false, d: '' }, schema({ a: { default: 1 }, b: { default: 2 }, c: { default: true }, d: { default: 'x' } }));
    expect(out).toEqual({ a: 1, b: 0, c: false, d: '' });
  });

  it('returns the same object when there is nothing to fill', () => {
    const args = { a: 5 };
    expect(applyDeclaredDefaults(args, schema({ a: { default: 1 }, b: {} }))).toBe(args);
  });

  it('never hands out the schema\u2019s own object default', () => {
    const s = schema({ opts: { default: { depth: 1 } } });
    const out = applyDeclaredDefaults({}, s);
    out.opts.depth = 99;
    expect(s.function.parameters.properties.opts.default).toEqual({ depth: 1 });
  });

  it('tolerates missing args and missing schema', () => {
    expect(applyDeclaredDefaults(undefined, schema({ a: { default: 1 } }))).toEqual({ a: 1 });
    const args = { a: 1 };
    expect(applyDeclaredDefaults(args, undefined)).toBe(args);
  });
});
