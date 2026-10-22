/**
 * One registry for a chat turn: its own surface and discover_tools' mid-turn
 * loads (OrchestratorService) read chatConfigs.turnToolRegistry.
 *
 * Filed 2026-10-20 (triage/discovered-tools-async-setting): the mid-turn load
 * called getAvailableToolSchemas itself with no asyncEnabled, which defaults to
 * true, so a tool loaded by discover_tools carried the async-control
 * parameters even for a user with async tools off (the setting defaults off).
 * The same copy also skipped the Main-chat-only filter, so a sub-chat could
 * load start_chat by category.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => { process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true'; });
vi.mock('node-fetch', () => ({ default: vi.fn(() => { throw new Error('Unexpected network call'); }) }));
vi.mock('../MCPToolService.js', () => ({ default: { getSchemas: vi.fn(async () => []) } }));
vi.mock('../../models/CustomToolModel.js', () => ({ default: { findAllByUserId: vi.fn(async () => []) } }));
vi.mock('../../plugins/PluginAccountStore.js', () => ({ default: { names: vi.fn(async () => []), installs: vi.fn(async () => []) } }));

import { turnToolRegistry } from './chatConfigs.js';
import toolRegistry from './toolRegistry.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A context whose settings and conversation role are already resolved, so the
// test touches no database: async setting frozen, role cached per conversation.
const turn = ({ asyncOn, role }) => ({
  userId: 'user-1',
  conversationId: 'conv-1',
  _frozenAsyncToolsEnabled: asyncOn,
  _conversationRole: { conversationId: 'conv-1', role },
});
const asyncParamsIn = (schemas) => schemas.filter((s) => s.function?.parameters?.properties?._executeAsync);
const names = (schemas) => schemas.map((s) => s.function?.name);

beforeEach(() => {
  vi.spyOn(toolRegistry, 'ensureInitialized').mockResolvedValue();
  vi.spyOn(toolRegistry, 'getOpenApiSchemas').mockReturnValue([]);
  vi.spyOn(toolRegistry, 'getAllPluginTools').mockReturnValue([]);
});

describe('turnToolRegistry: the tools one chat turn may draw from', () => {
  it('async tools off: no tool carries the async-control parameters', async () => {
    const schemas = await turnToolRegistry(turn({ asyncOn: false, role: 'main' }));
    expect(schemas.length).toBeGreaterThan(10);
    expect(names(asyncParamsIn(schemas))).toEqual([]);
  });

  it('async tools on: tools carry them (positive control)', async () => {
    const schemas = await turnToolRegistry(turn({ asyncOn: true, role: 'main' }));
    expect(asyncParamsIn(schemas).length).toBeGreaterThan(10);
  });

  it('start_chat is offered in the Main chat and nowhere else', async () => {
    expect(names(await turnToolRegistry(turn({ asyncOn: false, role: 'main' })))).toContain('start_chat');
    expect(names(await turnToolRegistry(turn({ asyncOn: false, role: 'sub' })))).not.toContain('start_chat');
  });
});

describe('discover_tools loads read the same registry', () => {
  it('OrchestratorService builds its mid-turn load from turnToolRegistry, not its own registry read', () => {
    const source = fs.readFileSync(path.join(HERE, '..', 'OrchestratorService.js'), 'utf8');
    const block = source.slice(source.indexOf('Dynamic tool loading: check if discover_tools requested new categories'));
    const load = block.slice(0, block.indexOf('getToolsForCategories(allSchemas'));
    expect(load).toContain('turnToolRegistry(conversationContext)');
    expect(load).not.toContain('getAvailableToolSchemas(');
  });
});
