// Two complaints, one cause. The model either (a) fires 20–100 tools in a
// row without a word to the user, or (b) writes prose claiming it searched,
// changed and tested things while calling nothing.
//
// The runtime has always supported the middle: OrchestratorService streams
// each round's text, runs that round's tools, feeds results back and asks
// again, and chatStreamReducer keeps text → tool → text in order. What the
// resident prompt said was the two extremes. Rule 4 of the call requirements
// said "call tools BEFORE your commentary" (→ a); the response block said
// "AFTER calling any tool you MUST respond" and its one worked example was a
// single tool followed by a stop-and-ask (→ never continuing). Five page
// surfaces then appended their own copy of that same example.
//
// The fix is one resident block that describes the interleaving — acknowledge,
// act, report, continue, finish — with a multi-round example, placed with the
// core tool rules instead of last, and the five per-surface copies removed.
// Every assertion below fails against the prompt as it stood before 2026-09-03.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildUnifiedSystemPrompt } from './buildUnifiedPrompt.js';
import {
  CRITICAL_TOOL_CALL_REQUIREMENTS,
  CRITICAL_TOOL_RESPONSE_RULES,
} from './orchestrator-chat.js';
import { estimateTokens } from '../../../utils/contextManager.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HEADER = 'WORK OUT LOUD';
const FROZEN = { skillsCatalogSection: '', memorySection: '', customInstructionsSection: '' };
const bareContext = (over = {}) => ({
  userId: 'u1',
  latestUserMessage: 'find out why the build is failing and fix it',
  normalizedProvider: 'anthropic',
  ...over,
});

const count = (haystack, needle) => haystack.split(needle).length - 1;

describe('the resident prompt no longer teaches either extreme', () => {
  it('does not tell the model to run tools before saying anything', () => {
    // The line that produced the silent wall of tools.
    expect(CRITICAL_TOOL_CALL_REQUIREMENTS).not.toMatch(/BEFORE your commentary/i);
    expect(CRITICAL_TOOL_CALL_REQUIREMENTS).not.toMatch(/RUN IT FIRST ALWAYS/);
    // What replaced it keeps the half that was right — no narrating unseen
    // results — and states the order explicitly.
    expect(CRITICAL_TOOL_CALL_REQUIREMENTS).toMatch(/NEVER describe a result you have not seen/);
    expect(CRITICAL_TOOL_CALL_REQUIREMENTS).toMatch(/Say what you will do, run the tool, then report/);
  });

  it('the worked example is no longer one tool then a stop-and-ask', () => {
    expect(CRITICAL_TOOL_RESPONSE_RULES).not.toContain('Would you like me to');
    expect(CRITICAL_TOOL_RESPONSE_RULES).not.toContain('WILL CAUSE INFINITE LOOP');
    expect(CRITICAL_TOOL_RESPONSE_RULES).not.toMatch(/AFTER CALLING ANY TOOL, YOU \*\*MUST\*\*/);
  });
});

describe('the block describes interleaving, and shows it', () => {
  it('names all five beats in order', () => {
    const beats = ['ACKNOWLEDGE', 'ACT', 'REPORT', 'CONTINUE', 'FINISH'];
    let last = -1;
    for (const beat of beats) {
      const at = CRITICAL_TOOL_RESPONSE_RULES.indexOf(`${beats.indexOf(beat) + 1}. ${beat}`);
      expect(at, `${beat} missing`).toBeGreaterThan(last);
      last = at;
    }
  });

  it('says text and tools share one reply, and that text arrives between tools', () => {
    expect(CRITICAL_TOOL_RESPONSE_RULES).toMatch(/interleave in ONE reply/);
    expect(CRITICAL_TOOL_RESPONSE_RULES).toMatch(/before, between and after tools/);
  });

  it('names both losing behaviours', () => {
    expect(CRITICAL_TOOL_RESPONSE_RULES).toMatch(/a run of tools with no text between them/);
    expect(CRITICAL_TOOL_RESPONSE_RULES).toMatch(/claiming you did anything no tool actually did/);
    expect(CRITICAL_TOOL_RESPONSE_RULES).toMatch(/stopping while the request is still open/);
  });

  it('the example alternates prose and tool rounds, more than once', () => {
    // The whole point. One tool round with prose either side is what the old
    // example showed; the behaviour being taught needs at least two rounds
    // with a report BETWEEN them.
    const example = CRITICAL_TOOL_RESPONSE_RULES.slice(CRITICAL_TOOL_RESPONSE_RULES.indexOf('EXAMPLE'));
    const lines = example.split('\n').map((l) => l.trim()).filter(Boolean);
    const shape = lines
      .map((l) => (l.startsWith('You:') ? 'T' : l.startsWith('[') ? 'R' : ''))
      .join('');
    // T = text, R = tool round. Must start and end with text, and have ≥ 2
    // tool rounds each followed by text.
    expect(shape).toMatch(/^T(RT)+$/);
    expect(count(shape, 'R')).toBeGreaterThanOrEqual(2);
  });

  it('the example opens by acknowledging, not by acting', () => {
    const example = CRITICAL_TOOL_RESPONSE_RULES.slice(CRITICAL_TOOL_RESPONSE_RULES.indexOf('EXAMPLE'));
    const firstAssistantLine = example.split('\n').find((l) => l.startsWith('You:'));
    const firstToolRound = example.split('\n').find((l) => l.trim().startsWith('['));
    expect(example.indexOf(firstAssistantLine)).toBeLessThan(example.indexOf(firstToolRound));
  });

  it('the example never asks permission to take an obvious next step', () => {
    const example = CRITICAL_TOOL_RESPONSE_RULES.slice(CRITICAL_TOOL_RESPONSE_RULES.indexOf('EXAMPLE'));
    expect(example).not.toMatch(/\?"/);
    expect(example).not.toMatch(/would you like/i);
    expect(example).not.toMatch(/shall I/i);
  });

  it('stays policy-sized, not a manual', () => {
    // The per-block ceiling in promptBudget.test.js is 1,600; this is a
    // behavioural contract with one example and should stay well under half.
    expect(estimateTokens(CRITICAL_TOOL_RESPONSE_RULES)).toBeLessThan(600);
  });
});

describe('placement in the unified prompt', () => {
  it('is resident with no tools loaded, on every provider', async () => {
    for (const provider of ['anthropic', 'openai', 'claude-code', 'groq']) {
      const prompt = await buildUnifiedSystemPrompt(bareContext({ normalizedProvider: provider }), FROZEN);
      expect(prompt, `missing on ${provider}`).toContain(HEADER);
    }
  });

  it('sits directly after the tool-call rules, not last', async () => {
    const prompt = await buildUnifiedSystemPrompt(bareContext(), FROZEN);
    const rulesAt = prompt.indexOf('CRITICAL TOOL CALL REQUIREMENTS:');
    const cadenceAt = prompt.indexOf(HEADER);
    const artifactsAt = prompt.indexOf('ARTIFACTS vs WIDGETS');
    const chartsAt = prompt.indexOf('CHART.JS VISUALIZATION GUIDE');
    expect(rulesAt).toBeGreaterThan(-1);
    expect(cadenceAt).toBeGreaterThan(rulesAt);
    expect(cadenceAt).toBeLessThan(artifactsAt);
    expect(cadenceAt).toBeLessThan(chartsAt);
    // Nothing but the native-execution block between the two.
    const between = prompt.slice(rulesAt, cadenceAt);
    expect(between).not.toContain('TASK DELEGATION');
    expect(between).not.toContain('TOOL USAGE:');
  });

  it('appears exactly once on every page surface', async () => {
    // Each of these used to append its own copy of the old rules via the page
    // context block, so on the workflow page the model read the stop-and-ask
    // example twice.
    const surfaces = {
      bare: {},
      workflow: { workflowId: 'wf_1', workflowState: { id: 'wf_1', nodes: [], edges: [] } },
      agentBuilder: { agentId: 'agent-chat' },
      goal: { goalId: 'g_1', goalState: { id: 'g_1', title: 'x', tasks: [] } },
      toolForge: { toolId: 'tool-forge', toolState: { id: 'tool-forge' } },
      widgetForge: { widgetId: 'widget-forge', widgetState: { id: 'widget-forge', source_code: '<div/>' } },
    };
    for (const [name, over] of Object.entries(surfaces)) {
      const prompt = await buildUnifiedSystemPrompt(bareContext(over), FROZEN);
      expect(count(prompt, HEADER), `${name}: cadence block count`).toBe(1);
      expect(prompt, `${name} still carries the old rules`).not.toContain('CRITICAL TOOL RESPONSE RULES');
      expect(prompt, `${name} still carries the old example`).not.toContain('WILL CAUSE INFINITE LOOP');
    }
  });
});

describe('no surface module keeps a private copy', () => {
  it('the old header and example exist nowhere in system-prompts/', () => {
    // Source-level, so a future page module cannot reintroduce the duplicate
    // behind a context gate this test does not know how to open.
    const offenders = fs
      .readdirSync(HERE)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => {
        const src = fs.readFileSync(path.join(HERE, f), 'utf8');
        return src.includes('CRITICAL TOOL RESPONSE RULES') || src.includes('WILL CAUSE INFINITE LOOP');
      });
    expect(offenders).toEqual([]);
  });
});
