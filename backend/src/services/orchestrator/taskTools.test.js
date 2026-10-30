// task_checkpoint: the executor's contract, and that the model can actually
// reach it (schema → group → trigger → residency → dispatch → turn ends).
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTaskToolSchemas, executeTaskTool, resolveTeamspace } from './taskTools.js';
import { TOOL_GROUPS, GROUP_TRIGGERS, GROUP_DESCRIPTIONS, selectTools, getToolsForCategories, getAllCategoryNames, DEFAULT_TOOLS } from './toolSelector.js';
import { ORCHESTRATOR_RESIDENT_GROUPS } from './system-prompts/promptElements.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAMES = getTaskToolSchemas().map((s) => s.function.name);

describe('executor', () => {
  const card = { kind: 'plan', title: 'The plan', content: '1. Draft\n2. Send', task_title: 'Thank Globex' };

  it('posts the card, tells the person\u2019s windows, and tells the model to stop', async () => {
    const create = vi.fn(async () => ({ checkpoint: { id: 'cp1', kind: 'plan', title: 'The plan', state: 'pending', task: null } }));
    const notify = vi.fn();
    const result = await executeTaskTool('task_checkpoint', card, 'tok', { userId: 'ann', conversationId: 'conv' }, { checkpoints: { create }, notify });
    expect(result).toMatchObject({ success: true, status: 'awaiting_decision', checkpoint: { id: 'cp1' } });
    expect(result.message).toMatch(/wait/i);
    expect(create).toHaveBeenCalledWith('ann', 'conv', card, { authToken: 'tok', team: null });
    expect(notify).toHaveBeenCalledWith('ann', 'checkpoint:changed', { id: 'cp1', conversationId: 'conv', state: 'pending' });
  });

  it('needs a person and a conversation', async () => {
    expect(await executeTaskTool('task_checkpoint', card, 'tok', { userId: 'ann' })).toMatchObject({ success: false });
    expect(await executeTaskTool('task_checkpoint', card, 'tok', {})).toMatchObject({ success: false });
  });

  it('an unknown teamspace keeps the task private and says so', async () => {
    const create = vi.fn(async () => ({ checkpoint: { id: 'cp1', state: 'pending', task: null } }));
    const result = await executeTaskTool('task_checkpoint', { ...card, teamspace: 'Nope' }, 'tok', { userId: 'ann', conversationId: 'c' }, { checkpoints: { create }, notify: () => {}, resolveTeamspace: async () => null });
    expect(result.success).toBe(true);
    expect(result.note).toMatch(/stays private/);
    expect(create.mock.calls[0][3].team).toBeNull();
  });

  it('a validation error comes back as a tool error, not a throw', async () => {
    const create = vi.fn(async () => { throw Object.assign(new Error('Invalid content'), { status: 400 }); });
    expect(await executeTaskTool('task_checkpoint', card, 'tok', { userId: 'a', conversationId: 'c' }, { checkpoints: { create }, notify: () => {} })).toEqual({ success: false, error: 'Invalid content' });
  });
});

describe('resolveTeamspace', () => {
  it('finds the named teamspace of the caller\u2019s team on this instance, through the team routes', async () => {
    const cloud = { request: vi.fn(async () => [{ id: 'other', tenantSlug: 'x' }, { id: 'acme', tenantSlug: 'acme' }]) };
    const fetchImpl = vi.fn(async (url, options) => ({ ok: true, json: async () => [{ id: 'ws-sales', name: 'Sales' }], url, options }));
    expect(await resolveTeamspace('tok', 'sales', { cloud, fetchImpl, slug: 'acme' })).toEqual({ teamId: 'acme', workspaceId: 'ws-sales', name: 'Sales' });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/api\/teams\/acme\/workspaces$/);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });
  it('is null off a team instance, or for a teamspace the caller cannot see', async () => {
    const cloud = { request: vi.fn(async () => [{ id: 'acme', tenantSlug: 'acme' }]) };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => [] }));
    expect(await resolveTeamspace('tok', 'Sales', { cloud, fetchImpl, slug: undefined })).toBeNull();
    expect(await resolveTeamspace('tok', 'Sales', { cloud, fetchImpl, slug: 'acme' })).toBeNull();
  });
});

describe('reachability', () => {
  const schema = (name) => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } });
  const registry = [...[...DEFAULT_TOOLS].map(schema), ...NAMES.map(schema), schema('generate_image')];

  it('the group holds exactly the schemas, and is documented', () => {
    expect(NAMES).toEqual(['task_checkpoint']);
    expect([...TOOL_GROUPS.tasks].sort()).toEqual([...NAMES].sort());
    expect(GROUP_DESCRIPTIONS.tasks).toBeTruthy();
    expect(getAllCategoryNames()).toContain('tasks');
  });
  it('arrives when someone asks for real work, and not for an image', () => {
    expect(selectTools(registry, 'can you email all our customers about the new prices').matchedGroups.has('tasks')).toBe(true);
    expect(selectTools(registry, 'chase the unpaid invoices every monday').matchedGroups.has('tasks')).toBe(true);
    expect(selectTools(registry, 'generate an image of a sunset').filteredSchemas.map((s) => s.function.name)).not.toContain('task_checkpoint');
    expect(GROUP_TRIGGERS.tasks).toBeTruthy();
  });
  it('is loadable on demand and resident on the orchestrator', () => {
    expect(getToolsForCategories(registry, ['tasks']).map((s) => s.function.name)).toEqual(['task_checkpoint']);
    expect(ORCHESTRATOR_RESIDENT_GROUPS).toContain('tasks');
  });
  it('tools.js aggregates and dispatches it from the schema list', () => {
    const src = fs.readFileSync(path.join(HERE, 'tools.js'), 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*executeTaskTool[^}]*\}\s*from\s*'\.\/taskTools\.js'/);
    expect(src).toContain('...taskToolSchemas,');
    expect(src).toContain('new Set(getTaskToolSchemas().map(s => s.function.name))');
    expect(src).toContain('await executeTaskTool(toolName, resolvedArgs, authToken, context)');
  });
});

describe('the turn ends at a checkpoint', () => {
  const code = fs.readFileSync(path.join(HERE, '..', 'OrchestratorService.js'), 'utf8');
  it('breaks the tool loop after the checkpoint\u2019s results streamed, before the next model call', () => {
    const live = "if (toolCalls.some((tc) => tc.function?.name === 'task_checkpoint')) {";
    const at = code.indexOf(live);
    expect(at).toBeGreaterThan(-1);
    const block = code.slice(at, at + 500);
    expect(block).toContain('floorPassed = true;');
    expect(block).toContain('break;');
    // Waiting for the person is a normal end: durable segments accept only response_ended / segment_budget.
    expect(block).not.toContain('segmentStopReason');
    expect(at).toBeGreaterThan(code.indexOf("sendEvent('tool_executions'"));
    expect(at).toBeLessThan(code.indexOf('const { result: nextResponse } = await streamAcrossChain('));
  });
});
