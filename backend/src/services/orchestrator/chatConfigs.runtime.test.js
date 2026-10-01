/**
 * runtime.prompt and runtime.tools shape what a saved agent is actually sent.
 *
 * The defect this pins (2026-10-01): a game-commander agent whose whole job
 * was to emit four JSON lines was sent a 12,161-token prompt — the chat app's
 * rendering rules, chart cheat-sheet, skills catalog, memory digest and the
 * user's own custom instructions. These tests drive the REAL prompt builder
 * and assert both halves: the text that is sent, and the lookups that run.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => 'WORKSPACE_SECTION_MARKER'),
}));
vi.mock('../../models/AgentModel.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn() } }));
vi.mock('../../models/AgentMemoryModel.js', () => ({
  default: { searchRelevant: vi.fn(), findByAgentId: vi.fn(async () => []), findByUserId: vi.fn(async () => []) },
}));
vi.mock('../../models/SkillModel.js', () => ({ default: { findAll: vi.fn(), findByIds: vi.fn(async () => []) } }));

import { getChatConfig } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import { resolveRuntimeOptions } from './runtimeOptions.js';
import { loadWorkspaceContextSection } from './workspaceContext.js';
import AgentModel from '../../models/AgentModel.js';
import UserModel from '../../models/UserModel.js';
import AgentMemoryModel from '../../models/AgentMemoryModel.js';
import SkillModel from '../../models/SkillModel.js';
import {
  CHART_CHEATSHEET,
  HTML_INLINE_RENDERING,
  CRITICAL_TOOL_CALL_REQUIREMENTS,
} from './system-prompts/orchestrator-chat.js';

const AGENT_ID = 'agent-red-commander';
const PERSONA = 'You set capture-the-flag orders for the red robot team.';
const CONTRACT = 'Reply ONLY with JSON Lines.';
const CUSTOM = 'NATHAN_CUSTOM_INSTRUCTIONS_MARKER';

const schema = (name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });
const namesOf = (schemas) => schemas.map((s) => s.function.name);
const config = getChatConfig('agent');

/** A fresh context per build: the section loaders freeze their result onto it. */
const contextFor = (runtime) => ({
  agentId: AGENT_ID,
  userId: 'user-1',
  latestUserMessage: 'STATE t=42s',
  normalizedProvider: 'groq',
  ...(runtime === undefined ? {} : { runtime: resolveRuntimeOptions(runtime) }),
});

beforeEach(() => {
  vi.clearAllMocks();
  AgentModel.findOne.mockResolvedValue({
    id: AGENT_ID,
    name: 'Red Commander',
    description: 'Commands the red team.',
    systemPrompt: PERSONA,
    assignedTools: ['web_search', 'recall'],
    assignedSkills: [],
    toolAccessMode: 'restricted',
  });
  UserModel.getUserSettings.mockResolvedValue({ customInstructions: CUSTOM, asyncToolsEnabled: false });
  AgentMemoryModel.searchRelevant.mockResolvedValue([{ id: 'm1', memory_type: 'fact', content: 'MEMORY_MARKER fact.' }]);
  SkillModel.findAll.mockResolvedValue([{ slug: 'skill-marker', name: 'skill-marker', description: 'A skill.' }]);
  getAvailableToolSchemas.mockResolvedValue(['web_search', 'recall', 'execute_javascript_code'].map(schema));
});

// The first build lazy-imports skill services and models: pay it once, untimed.
beforeAll(() => config.buildSystemPrompt(contextFor(undefined)), 60000);

describe('realtime: persona only', () => {
  it('sends the identity, the persona and the caller contract, and nothing else', async () => {
    const prompt = await config.buildSystemPrompt(contextFor({ profile: 'realtime', prompt: { append: CONTRACT } }));
    expect(prompt).toBe(`You are Red Commander — Commands the red team.\n\n${PERSONA}\n\n${CONTRACT}`);
  });

  it('runs none of the per-call section lookups', async () => {
    await config.buildSystemPrompt(contextFor({ profile: 'realtime' }));
    expect(AgentMemoryModel.searchRelevant).not.toHaveBeenCalled();
    expect(SkillModel.findAll).not.toHaveBeenCalled();
    expect(UserModel.getUserSettings).not.toHaveBeenCalled();
    expect(loadWorkspaceContextSection).not.toHaveBeenCalled();
  });

  it('adds back exactly the sections asked for', async () => {
    const prompt = await config.buildSystemPrompt(contextFor({ profile: 'realtime', prompt: { memory: true } }));
    expect(prompt).toContain('MEMORY_MARKER');
    expect(prompt).not.toContain(CUSTOM);
    expect(prompt).not.toContain('WORKSPACE_SECTION_MARKER');
    expect(SkillModel.findAll).not.toHaveBeenCalled();
  });

  it('accounts for what it sent, so the context panel stays honest', async () => {
    const ctx = contextFor({ profile: 'realtime', prompt: { append: CONTRACT } });
    await config.buildSystemPrompt(ctx);
    expect(ctx._promptSections.map((s) => s.id)).toEqual(['agent', 'append']);
  });

  it('is a small fraction of the full prompt', async () => {
    const full = await config.buildSystemPrompt(contextFor(undefined));
    const lean = await config.buildSystemPrompt(contextFor({ profile: 'realtime', prompt: { append: CONTRACT } }));
    expect(lean.length * 20).toBeLessThan(full.length);
  });
});

describe('ui: unchanged', () => {
  it('an explicit ui profile builds the identical prompt to no runtime at all', async () => {
    const absent = await config.buildSystemPrompt(contextFor(undefined));
    const named = await config.buildSystemPrompt(contextFor({ profile: 'ui' }));
    expect(named).toBe(absent);
  });

  it('still carries every section and the chat-UI blocks', async () => {
    const prompt = await config.buildSystemPrompt(contextFor(undefined));
    for (const marker of [PERSONA, CUSTOM, 'MEMORY_MARKER', 'WORKSPACE_SECTION_MARKER', CHART_CHEATSHEET, HTML_INLINE_RENDERING]) {
      expect(prompt).toContain(marker);
    }
  });
});

describe('lean: platform rules without the chat window', () => {
  it('keeps the tool-call rules, drops the rendering blocks', async () => {
    const prompt = await config.buildSystemPrompt(contextFor({ profile: 'api' }));
    expect(prompt).toContain(PERSONA);
    expect(prompt).toContain(CRITICAL_TOOL_CALL_REQUIREMENTS);
    expect(prompt).not.toContain(CHART_CHEATSHEET);
    expect(prompt).not.toContain(HTML_INLINE_RENDERING);
  });

  it('honours the per-section switches of the api profile', async () => {
    const prompt = await config.buildSystemPrompt(contextFor({ profile: 'api' }));
    expect(prompt).not.toContain(CUSTOM);
    expect(prompt).not.toContain('MEMORY_MARKER');
    expect(AgentMemoryModel.searchRelevant).not.toHaveBeenCalled();
  });

  it('appends the caller contract at the very end', async () => {
    const prompt = await config.buildSystemPrompt(contextFor({ profile: 'api', prompt: { append: CONTRACT } }));
    expect(prompt.endsWith(CONTRACT)).toBe(true);
  });
});

describe('runtime.tools', () => {
  it('"none" sends no tools and never loads the registry', async () => {
    expect(await config.getToolSchemas(contextFor({ profile: 'realtime' }))).toEqual([]);
    expect(getAvailableToolSchemas).not.toHaveBeenCalled();
  });

  it('absent keeps the agent surface', async () => {
    const names = namesOf(await config.getToolSchemas(contextFor(undefined)));
    expect(names).toEqual(expect.arrayContaining(['web_search', 'recall']));
  });

  it('a named list narrows the agent surface and can never widen it', async () => {
    // execute_javascript_code is in the registry but NOT assigned to this
    // restricted agent: naming it must not grant it.
    const names = namesOf(await config.getToolSchemas(contextFor({ profile: 'api', tools: ['recall', 'execute_javascript_code'] })));
    expect(names).toEqual(['recall']);
  });
});
