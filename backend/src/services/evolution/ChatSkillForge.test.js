// Chat → skill forging.
//
// Skill evolution used to be reachable only from a completed Goal, because
// SkillEvolver needs a fitness number and a goal evaluation was the only one in
// the system. ~99% of real usage is chat, so in practice skills were never
// forged at all. This module substitutes RECURRENCE for that missing score: the
// third time a turn has the same tool-shape, it is a procedure worth writing
// down.
//
// The tests that matter here are the negative ones. A forge that fires too
// eagerly produces skill sprawl — unvalidated procedures extracted from one-off
// tasks — which looks like learning and rots silently.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const getExecutionDetails = vi.fn();
const getSettings = vi.fn();
const shouldExtract = vi.fn();
const broadcastToUser = vi.fn();
const analyzeChatTrace = vi.fn();
const evolveSkill = vi.fn();
const dbGet = vi.fn((sql, params, cb) => cb(null, null));

vi.mock('../../models/AgentExecutionModel.js', () => ({
  default: { getExecutionDetails: (...a) => getExecutionDetails(...a) },
}));
vi.mock('../../models/EvolutionSettingsModel.js', () => ({
  default: { get: (...a) => getSettings(...a) },
}));
vi.mock('../../models/database/index.js', () => ({
  default: { get: (...a) => dbGet(...a) },
}));
vi.mock('../../utils/realtimeSync.js', () => ({
  broadcastToUser: (...a) => broadcastToUser(...a),
}));
vi.mock('../goal/TraceAnalyzer.js', () => ({
  default: { analyzeChatTrace: (...a) => analyzeChatTrace(...a) },
}));
vi.mock('../goal/SkillEvolver.js', () => ({
  default: { evolveSkill: (...a) => evolveSkill(...a) },
}));

// Only shouldExtract is faked. chatSignature stays REAL, so the signature tests
// below exercise the same hash the forge actually runs on — a mocked signature
// would let the two drift apart silently.
vi.mock('./ExtractionGate.js', async (importOriginal) => ({
  ...(await importOriginal()),
  shouldExtract: (...a) => shouldExtract(...a),
}));

const { chatSignature } = await import('./ExtractionGate.js');
const { default: ChatSkillForge, MIN_OCCURRENCES, MIN_TOOL_CALLS } =
  await import('./ChatSkillForge.js');

const tools = (...names) => names.map((toolName, i) => ({ toolName, status: 'completed', id: `t${i}` }));

const execution = (over = {}) => ({
  id: 'exec-1',
  agentId: null,
  conversationId: 'conv-1',
  status: 'completed',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  toolExecutions: tools('read_file', 'edit_file', 'execute_shell_command'),
  ...over,
});

const CANDIDATE = {
  traceQuality: 'high',
  patterns: [],
  skillCandidate: {
    shouldGenerate: true,
    name: 'Homelab Operations',
    category: 'general',
    instructions: '# Homelab\n1. do the thing',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getSettings.mockResolvedValue({ chatSkillForge: true });
  getExecutionDetails.mockResolvedValue(execution());
  dbGet.mockImplementation((sql, params, cb) => cb(null, { full_history: '[]' }));
  analyzeChatTrace.mockResolvedValue(CANDIDATE);
  evolveSkill.mockResolvedValue({
    action: 'kept', skillId: 's1', skillName: 'Homelab Operations', version: 1,
  });
  shouldExtract.mockResolvedValue({ extract: false, reason: 'repeat-suppressed', occurrences: MIN_OCCURRENCES });
});

describe('chatSignature', () => {
  const exec = { agentId: 'agent-7' };

  it('is stable across identical turns', () => {
    expect(chatSignature(exec, tools('a', 'b'))).toBe(chatSignature(exec, tools('a', 'b')));
  });

  it('ignores tool call ORDER', () => {
    // The model reorders independent calls between runs. That is the same
    // procedure, and treating it as novel would mean recurrence never accrues.
    expect(chatSignature(exec, tools('b', 'a'))).toBe(chatSignature(exec, tools('a', 'b')));
  });

  it('CHANGES when the tool set changes', () => {
    expect(chatSignature(exec, tools('a', 'b', 'c'))).not.toBe(chatSignature(exec, tools('a', 'b')));
  });

  it('preserves REPEATED tool names — count is part of the procedure', () => {
    // "read three files then edit one" is a different procedure from "read one
    // then edit one". De-duplicating would merge them.
    expect(chatSignature(exec, tools('a', 'a', 'b'))).not.toBe(chatSignature(exec, tools('a', 'b')));
  });

  it('CHANGES when the agent changes', () => {
    expect(chatSignature({ agentId: 'other' }, tools('a', 'b')))
      .not.toBe(chatSignature(exec, tools('a', 'b')));
  });

  it('does NOT vary with tool arguments', () => {
    // Arguments carry the specifics — this repo, that host, yesterday's date.
    // Including them would make every turn novel by construction and the gate
    // would never fire. Excluding them is what lets three homelab sessions
    // against three different machines collapse into one procedure.
    const a = tools('read_file').map((t) => ({ ...t, input: { path: '/one' } }));
    const b = tools('read_file').map((t) => ({ ...t, input: { path: '/two' } }));
    expect(chatSignature(exec, a)).toBe(chatSignature(exec, b));
  });

  it('accepts snake_case rows and malformed input without throwing', () => {
    expect(chatSignature(exec, [{ tool_name: 'x' }])).toBe(chatSignature(exec, [{ toolName: 'x' }]));
    expect(typeof chatSignature(null, [])).toBe('string');
    expect(typeof chatSignature(exec, [{}])).toBe('string');
  });
});

describe('ChatSkillForge — when it declines', () => {
  it('does nothing below the recurrence threshold', async () => {
    shouldExtract.mockResolvedValue({ extract: true, reason: 'novel', occurrences: 1 });
    expect(await ChatSkillForge.onChatCompleted('exec-1', 'u1')).toBeNull();
    expect(analyzeChatTrace).not.toHaveBeenCalled();
  });

  it('does not forge on the SECOND sighting', async () => {
    // Two is a coincidence often enough to matter.
    shouldExtract.mockResolvedValue({ extract: false, occurrences: 2 });
    expect(await ChatSkillForge.onChatCompleted('exec-1', 'u1')).toBeNull();
    expect(evolveSkill).not.toHaveBeenCalled();
  });

  it('ignores turns that did not complete', async () => {
    // A failed run's tool shape is evidence of a dead end. Counting it would let
    // repeatedly failing the same way forge a skill that teaches the failure.
    getExecutionDetails.mockResolvedValue(execution({ status: 'failed' }));
    expect(await ChatSkillForge.onChatCompleted('exec-1', 'u1')).toBeNull();
    expect(shouldExtract).not.toHaveBeenCalled();
  });

  it('ignores conversation-shaped turns below the tool floor', async () => {
    // A pure-prose answer has nothing mechanical to write down.
    getExecutionDetails.mockResolvedValue(execution({ toolExecutions: tools('web_search') }));
    expect(MIN_TOOL_CALLS).toBe(2);
    expect(await ChatSkillForge.onChatCompleted('exec-1', 'u1')).toBeNull();
    expect(shouldExtract).not.toHaveBeenCalled();
  });

  it('respects the chatSkillForge opt-out', async () => {
    getSettings.mockResolvedValue({ chatSkillForge: false });
    expect(await ChatSkillForge.onChatCompleted('exec-1', 'u1')).toBeNull();
    expect(getExecutionDetails).not.toHaveBeenCalled();
  });

  it('does not write a skill when the judge declines', async () => {
    analyzeChatTrace.mockResolvedValue({ skillCandidate: { shouldGenerate: false } });
    expect(await ChatSkillForge.onChatCompleted('exec-1', 'u1')).toBeNull();
    expect(evolveSkill).not.toHaveBeenCalled();
  });

  it('never throws — chat execution must not be affected', async () => {
    getExecutionDetails.mockRejectedValue(new Error('db is on fire'));
    await expect(ChatSkillForge.onChatCompleted('exec-1', 'u1')).resolves.toBeNull();
  });
});

describe('ChatSkillForge — when it forges', () => {
  it('FIRES on the third sighting even though the gate says suppressed', async () => {
    // THE TRAP. shouldExtract stamps last_extracted_at on the FIRST sighting, so
    // by the third the cooldown has not elapsed and `extract` is false. Reading
    // `extract` alone would recognise a procedure on occurrence 1 — when there
    // is no evidence — and then never again.
    shouldExtract.mockResolvedValue({ extract: false, reason: 'repeat-suppressed', occurrences: 3 });
    const result = await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    expect(result.action).toBe('kept');
    expect(evolveSkill).toHaveBeenCalledOnce();
  });

  it('goes quiet on the fourth sighting inside the cooldown', async () => {
    shouldExtract.mockResolvedValue({ extract: false, occurrences: 4 });
    expect(await ChatSkillForge.onChatCompleted('exec-1', 'u1')).toBeNull();
  });

  it('re-forges once the cooldown elapses, routing to refinement', async () => {
    shouldExtract.mockResolvedValue({ extract: true, reason: 'cooldown-elapsed', occurrences: 9 });
    evolveSkill.mockResolvedValue({ action: 'kept', skillId: 's1', skillName: 'Homelab Operations', version: 2 });
    const result = await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    expect(result.version).toBe(2);
    expect(broadcastToUser.mock.calls[0][2].isRefinement).toBe(true);
  });

  it('scopes the gate to the agent, never the execution', async () => {
    // Keying on executionId would make every turn novel by construction and the
    // counter could never reach the threshold.
    await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    const arg = shouldExtract.mock.calls[0][0];
    expect(arg.scopeId).toBe('orchestrator');
    expect(arg.sourceType).toBe('chat_procedure');
    expect(arg.signature).not.toContain('exec-1');
  });

  it('uses a source_type distinct from chat insight extraction', async () => {
    // Both paths key the same table. Sharing a source_type would make each one
    // advance the other's counter and cooldown.
    await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    expect(shouldExtract.mock.calls[0][0].sourceType).not.toBe('agent_chat');
  });

  it('hands SkillEvolver a chat: source ref, not a goal id', async () => {
    // This is what lets SkillEvolver stay untouched: GoalModel.findOne returns
    // nothing for it, so the goal-only A/B test declines through its own
    // existing guard and the skill lands as a draft — the path already written
    // for "could not measure this". The ref is still real provenance.
    await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    const [, sourceRef, userId] = evolveSkill.mock.calls[0];
    expect(sourceRef).toBe('chat:exec-1');
    expect(userId).toBe('u1');
  });

  it('passes the recurrence count to the judge as evidence', async () => {
    shouldExtract.mockResolvedValue({ extract: false, occurrences: MIN_OCCURRENCES });
    await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    expect(analyzeChatTrace.mock.calls[0][2].occurrences).toBe(MIN_OCCURRENCES);
  });

  it('loads the conversation so the judge sees what the procedure was FOR', async () => {
    // Without user messages the judge sees a bare tool list and writes a skill
    // about reading files.
    await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    expect(dbGet.mock.calls[0][1]).toEqual(['conv-1']);
    expect(analyzeChatTrace.mock.calls[0][2].conversationLog).toBeTruthy();
  });

  it('survives a missing conversation log', async () => {
    dbGet.mockImplementation((sql, params, cb) => cb(new Error('no table'), null));
    const result = await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    expect(result.action).toBe('kept');
  });

  it('announces the forged skill', async () => {
    await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    const [userId, event, payload] = broadcastToUser.mock.calls[0];
    expect(userId).toBe('u1');
    expect(event).toBe('evolution:skill_forged');
    expect(payload).toMatchObject({ skillName: 'Homelab Operations', conversationId: 'conv-1' });
  });

  it('does NOT announce a discarded candidate', async () => {
    evolveSkill.mockResolvedValue({ action: 'discarded', skillName: 'Nope' });
    await ChatSkillForge.onChatCompleted('exec-1', 'u1');
    expect(broadcastToUser).not.toHaveBeenCalled();
  });
});

describe('wiring contract', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const read = (...p) => fs.readFileSync(path.join(HERE, ...p), 'utf8');
  const TRIGGERS = read('InsightTriggers.js');
  const EVOLVER = read('..', 'goal', 'SkillEvolver.js');

  it('forges OUTSIDE the insightsEnabled guard', () => {
    // Insight extraction pays an LLM call per turn, which is why it is opt-in
    // and default-off. Forging only fires on the third repetition. Putting it
    // behind the same switch would reproduce the complaint it exists to fix:
    // chat that visibly never learns.
    const fn = TRIGGERS.slice(
      TRIGGERS.indexOf('static async onChatCompleted'),
      TRIGGERS.indexOf('static async onGoalCompleted'),
    );
    const forgeIdx = fn.indexOf('ChatSkillForge.onChatCompleted');
    const guardIdx = fn.indexOf("isSourceEnabled(userId, 'agent_chat')");
    expect(forgeIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(forgeIdx).toBeLessThan(guardIdx);
  });

  it('forging is fire-and-forget and cannot reject into the chat path', () => {
    const fn = TRIGGERS.slice(TRIGGERS.indexOf('static async onChatCompleted'), TRIGGERS.indexOf('static async onGoalCompleted'));
    const call = fn.slice(fn.indexOf('ChatSkillForge.onChatCompleted'));
    expect(call).toMatch(/\.catch\(/);
  });

  it('SkillEvolver still declines the A/B test when the goal does not exist', () => {
    // The whole reason SkillEvolver needed no changes. If this guard is ever
    // removed, a chat-forged skill would be measured against a goal that is not
    // there instead of landing as a draft.
    const fn = EVOLVER.slice(EVOLVER.indexOf('static async _runABTest'));
    const body = fn.slice(0, fn.indexOf('static async _measureGoalPerformance'));
    expect(body).toMatch(/GoalModel\.findOne\(sourceGoalId\)/);
    expect(body).toMatch(/if \(!goal\) return null/);
  });

  it('a null A/B result keeps the skill as a draft rather than discarding it', () => {
    const idx = EVOLVER.indexOf('if (!abResult)');
    expect(idx).toBeGreaterThan(-1);
    expect(EVOLVER.slice(idx, idx + 400)).toMatch(/action: 'kept'/);
  });
});
