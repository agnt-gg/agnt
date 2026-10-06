import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  turnContextBlocks, carriedHistory, prependTurnContext, reassertTurnContext, latestBlock,
  PAGE_CONTEXT_OPEN, PAGE_CONTEXT_CLOSE, ACTIVE_SKILL_OPEN, ACTIVE_SKILL_CLOSE, NO_PAGE_TEXT, NO_SKILL_TEXT,
} from './turnContext.js';
import { rehydrateHistory } from './historyRehydration.js';
import { clientNextTurn } from './clientHistoryBuilder.testkit.js';
import { markTurnContent } from './turnRegister.js';
import { USER_STEER_HEADER, foldBlocksIntoLastToolResult } from './turnContinuity.js';
import { findLoadedSkills } from './skillsInventory.js';
import { AnthropicAdapter, OpenAIResponsesAdapter } from './llmAdapters.js';
import { BaseAdapter } from './transports/BaseAdapter.js';
import { VOICE_TURN_MARKER, TEXT_TURN_MARKER } from './turnRegister.js';
import {
  serverMessagesToUi, stripServerUserPrefixes, SERVER_USER_BLOCKS, SERVER_USER_MARKERS, SERVER_STEER_HEADER,
} from './chatStreamReducer.mirror.js';
import { deriveTitle } from './transcriptProjection.js';

const SYSTEM = { role: 'system', content: 'You are Annie.' };
const page = (body) => `${PAGE_CONTEXT_OPEN}\n${body}\n${PAGE_CONTEXT_CLOSE}`;
const skill = (body) => `${ACTIVE_SKILL_OPEN}\n${body}\n${ACTIVE_SKILL_CLOSE}`;
const SKILL_TEXT = 'ASSIGNED SKILLS:\n<skill name="code-review">\n  <instructions>Review it.</instructions>\n</skill>';

const anthropicWire = (messages) => new AnthropicAdapter({ messages: { create: async () => ({}) } }, 'claude-opus-5-5')
  ._normalizeHistoryMessages(structuredClone(messages.filter((m) => m.role !== 'system')));
const chatCompletionsWire = (messages) => BaseAdapter._sanitizeOutbound(structuredClone(messages), 'openai-like');
const responsesWire = (messages) => {
  const out = new OpenAIResponsesAdapter({}, 'gpt-6', { provider: 'openai-codex' })._transformMessagesToInput(structuredClone(messages));
  return (Array.isArray(out) ? out : out.input).flat();
};
const isPrefix = (previous, next) => JSON.stringify(next.slice(0, previous.length)) === JSON.stringify(previous);

// ── Unit: what goes on a turn's message ─────────────────────────────────────
describe('turnContextBlocks — a block only on the turn where it changes', () => {
  it('first sight of a page or skill: the block is sent', () => {
    expect(turnContextBlocks([], { pageText: 'P1', skillText: 'S1' })).toEqual([skill('S1'), page('P1')]);
  });

  it('unchanged and still carried: nothing is sent', () => {
    const history = [{ role: 'user', content: `${skill('S1')}\n\n${page('P1')}\n\nhi` }, { role: 'assistant', content: 'ok' }];
    expect(turnContextBlocks(history, { pageText: 'P1', skillText: 'S1' })).toEqual([]);
  });

  it('changed: the new block is sent, the unchanged one is not', () => {
    const history = [{ role: 'user', content: `${skill('S1')}\n\n${page('P1')}\n\nhi` }];
    expect(turnContextBlocks(history, { pageText: 'P2', skillText: 'S1' })).toEqual([page('P2')]);
  });

  it('gone: a fixed "None." block, once, so the old one no longer reads as current', () => {
    const history = [{ role: 'user', content: `${page('P1')}\n\nhi` }];
    expect(turnContextBlocks(history, {})).toEqual([page(NO_PAGE_TEXT)]);
    const after = [...history, { role: 'user', content: `${page(NO_PAGE_TEXT)}\n\nok` }];
    expect(turnContextBlocks(after, {})).toEqual([]);
    expect(turnContextBlocks([{ role: 'user', content: `${skill('S1')}\n\nx` }], {})).toEqual([skill(NO_SKILL_TEXT)]);
  });

  it('never: nothing at all for a plain chat', () => {
    expect(turnContextBlocks([{ role: 'user', content: 'hi' }], {})).toEqual([]);
  });

  it('a block evicted from the carried history is sent again', () => {
    const units = [
      { role: 'user', content: `${page('P1')}\n\nfirst` }, { role: 'assistant', content: 'a' },
      { role: 'user', content: 'second' }, { role: 'assistant', content: 'b' },
    ];
    expect(turnContextBlocks(carriedHistory(units, 0), { pageText: 'P1' })).toEqual([]);
    expect(turnContextBlocks(carriedHistory(units, 2), { pageText: 'P1' })).toEqual([page('P1')]);
  });

  it('prependTurnContext decorates non-empty strings only', () => {
    expect(prependTurnContext('hi', [page('P')])).toBe(`${page('P')}\n\nhi`);
    expect(prependTurnContext('hi', [])).toBe('hi');
    expect(prependTurnContext('', [page('P')])).toBe('');
    const blocks = [{ type: 'text', text: 'hi' }];
    expect(prependTurnContext(blocks, [page('P')])).toBe(blocks);
  });
});

describe('reassertTurnContext — eviction never silently drops the current page or skill', () => {
  const history = [
    { role: 'user', content: `${page('P1')}\n\nfirst` }, { role: 'assistant', content: 'a' },
    { role: 'user', content: 'second' }, { role: 'assistant', content: 'b' },
  ];

  it('puts the block back on the turn message when its carrier was evicted', () => {
    const messages = [SYSTEM, ...history, { role: 'user', content: 'third' }];
    const out = reassertTurnContext(messages, { pageText: 'P1' }, 2, 'third');
    expect(out).not.toBe(messages);
    expect(out.at(-1).content).toBe(`${page('P1')}\n\nthird`);
    expect(messages.at(-1).content).toBe('third'); // input untouched
  });

  it('returns the same array when nothing was lost', () => {
    const messages = [SYSTEM, ...history, { role: 'user', content: 'third' }];
    expect(reassertTurnContext(messages, { pageText: 'P1' }, 0, 'third')).toBe(messages);
    expect(reassertTurnContext(messages, {}, 2, 'third')).toBe(messages);
  });

  it('finds the turn message by its content even with tool rounds after it', () => {
    const messages = [SYSTEM, ...history, { role: 'user', content: 'third' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'r' }];
    const out = reassertTurnContext(messages, { pageText: 'P1' }, 2, 'third');
    expect(out[5].content).toBe(`${page('P1')}\n\nthird`);
    expect(out.slice(6)).toEqual(messages.slice(6));
  });

  it('does not duplicate a block the turn message already carries', () => {
    const messages = [SYSTEM, ...history, { role: 'user', content: `${page('P1')}\n\nthird` }];
    expect(reassertTurnContext(messages, { pageText: 'P1' }, 2, `${page('P1')}\n\nthird`)).toBe(messages);
  });
});

// ── End to end: many turns, every provider wire, byte-for-byte ──────────────
// One server "turn" exactly as OrchestratorService runs it: the client rebuilds
// history from its UI (the real frontend builder), the server rehydrates it
// against its stored transcript, marks the turn, then adds the page / skill
// blocks that changed. The request is stored as the transcript; the client's
// UI only keeps the user's own words.
function runConversation(provider, turns, { toolRounds = false } = {}) {
  let stored = [SYSTEM];
  let ui = [SYSTEM];
  const requests = [];
  turns.forEach((turn, n) => {
    const client = n === 0 ? [{ role: 'user', content: turn.text }] : clientNextTurn(ui, provider, turn.text);
    const { messages } = n === 0 ? { messages: client } : rehydrateHistory(client, stored);
    const userMessage = { ...messages.at(-1) };
    userMessage.content = markTurnContent(userMessage.content, turn);
    const carried = carriedHistory(messages.slice(0, -1), 0);
    userMessage.content = prependTurnContext(userMessage.content, turnContextBlocks(carried, turn));
    const request = [SYSTEM, ...messages.slice(0, -1).filter((m) => m.role !== 'system'), userMessage];
    requests.push(request);
    const reply = toolRounds ? toolReply(provider, n) : [{ role: 'assistant', content: `answer ${n}` }];
    stored = [...request, ...reply];
    ui = [...ui, { role: 'user', content: turn.text }, ...reply];
  });
  return requests;
}

function toolReply(provider, n) {
  if (provider === 'claude-code') {
    return [
      { role: 'assistant', content: [{ type: 'text', text: `working ${n}` }, { type: 'tool_use', id: `toolu_${n}`, name: 'read_file', input: { n } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: 'out\n'.repeat(700) }] },
      { role: 'assistant', content: [{ type: 'text', text: `answer ${n}` }] },
    ];
  }
  return [
    { role: 'assistant', content: `working ${n}`, tool_calls: [{ id: `call_${n}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ n }) } }] },
    { role: 'tool', tool_call_id: `call_${n}`, content: 'out\n'.repeat(700) },
    { role: 'assistant', content: `answer ${n}` },
  ];
}

const TURNS = [
  { text: 'hello' },                                             // plain
  { text: 'open the forge', pageText: 'WORKFLOW wf1: 2 nodes' },  // page appears
  { text: 'keep going', pageText: 'WORKFLOW wf1: 2 nodes' },      // unchanged: nothing sent
  { text: 'add a node', pageText: 'WORKFLOW wf1: 3 nodes', voiceMode: true }, // page changed, spoken
  { text: '/skill on', pageText: 'WORKFLOW wf1: 3 nodes', skillText: SKILL_TEXT },
  { text: 'review', pageText: 'WORKFLOW wf1: 3 nodes', skillText: SKILL_TEXT, textMode: true },
  { text: 'skill off', pageText: 'WORKFLOW wf1: 3 nodes' },      // skill released
  { text: 'back to chat' },                                      // page left
  { text: 'thanks', voiceMode: 'true' },
];

describe.each([
  ['anthropic', anthropicWire, 'claude-code'],
  ['chat completions', chatCompletionsWire, 'openai'],
  ['responses', responsesWire, 'openai-codex'],
])('%s: page, skill, voice and text across nine turns', (_name, wireOf, provider) => {
  for (const toolRounds of [false, true]) {
    it(`every request is a byte prefix of the next at the wire${toolRounds ? ' (with tool rounds)' : ''}`, () => {
      const requests = runConversation(provider, TURNS, { toolRounds });
      for (let n = 1; n < requests.length; n += 1) {
        expect(isPrefix(wireOf(requests[n - 1]), wireOf(requests[n])), `turn ${n}`).toBe(true);
      }
    });
  }

  it('the model always sees the CURRENT page and skill, never a stale one', () => {
    const requests = runConversation(provider, TURNS, { toolRounds: true });
    requests.forEach((request, n) => {
      const { pageText, skillText } = TURNS[n];
      const latestPage = latestBlock(request, PAGE_CONTEXT_OPEN, PAGE_CONTEXT_CLOSE);
      const latestSkill = latestBlock(request, ACTIVE_SKILL_OPEN, ACTIVE_SKILL_CLOSE);
      if (pageText) expect(latestPage, `turn ${n}`).toBe(page(pageText));
      else expect([null, page(NO_PAGE_TEXT)], `turn ${n}`).toContain(latestPage);
      if (skillText) expect(latestSkill, `turn ${n}`).toBe(skill(skillText));
      else expect([null, skill(NO_SKILL_TEXT)], `turn ${n}`).toContain(latestSkill);
    });
  });

  it('an unchanged page is not repeated: one copy per change', () => {
    const last = runConversation(provider, TURNS).at(-1);
    const text = JSON.stringify(last);
    expect(text.split('WORKFLOW wf1: 2 nodes').length - 1).toBe(1);
    expect(text.split('WORKFLOW wf1: 3 nodes').length - 1).toBe(1);
    expect(text.split('<skill name=\\"code-review\\">').length - 1).toBe(1);
  });
});

// ── Mid-run steers ───────────────────────────────────────────────────────────
describe('a mid-run steer replays exactly as it was sent, once', () => {
  const STEER = 'actually check Halo 3';
  const round = (id) => [
    { role: 'assistant', content: [{ type: 'text', text: 'Searching.' }, { type: 'tool_use', id, name: 'web_search', input: { q: id } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'results\n'.repeat(600) }] },
  ];

  it('Anthropic: the steer folded into the tool result is not sent a second time', () => {
    // In the run: the steer was folded into the round's result (no separate message).
    const r1 = round('toolu_1');
    r1[1] = foldBlocksIntoLastToolResult(r1[1], [{ type: 'text', text: `${USER_STEER_HEADER}\n${STEER}` }], { label: false });
    const stored = [SYSTEM, { role: 'user', content: 'find it' }, ...r1, { role: 'assistant', content: [{ type: 'text', text: 'Halo 3 it is.' }] }];
    // The client's UI shows the steer as its own message after the round.
    const ui = [SYSTEM, { role: 'user', content: 'find it' }, ...round('toolu_1'), { role: 'user', content: STEER },
      { role: 'assistant', content: [{ type: 'text', text: 'Halo 3 it is.' }] }];
    const { messages } = rehydrateHistory(clientNextTurn(ui, 'claude-code', 'next'), stored);
    expect(JSON.stringify(messages).split(STEER).length - 1).toBe(1);
    expect(isPrefix(anthropicWire(stored.slice(0, -1)), anthropicWire([SYSTEM, ...messages]))).toBe(true);
  });

  it('Anthropic: negative control — before this fix the client copy was kept and the prefix broke', () => {
    const r1 = round('toolu_1');
    r1[1] = foldBlocksIntoLastToolResult(r1[1], [{ type: 'text', text: `${USER_STEER_HEADER}\n${STEER}` }], { label: false });
    const stored = [SYSTEM, { role: 'user', content: 'find it' }, ...r1, { role: 'assistant', content: [{ type: 'text', text: 'Halo 3 it is.' }] }];
    const naive = [SYSTEM, { role: 'user', content: 'find it' }, ...r1, { role: 'user', content: STEER }, stored.at(-1), { role: 'user', content: 'next' }];
    expect(isPrefix(anthropicWire(stored.slice(0, -1)), anthropicWire(naive))).toBe(false);
  });

  it('Anthropic: when the transcript already carries both (an older turn), both are kept', () => {
    const r1 = round('toolu_1');
    r1[1] = foldBlocksIntoLastToolResult(r1[1], [{ type: 'text', text: `${USER_STEER_HEADER}\n${STEER}` }], { label: false });
    const stored = [SYSTEM, { role: 'user', content: 'find it' }, ...r1, { role: 'user', content: STEER },
      { role: 'assistant', content: [{ type: 'text', text: 'Halo 3 it is.' }] }];
    const ui = [SYSTEM, { role: 'user', content: 'find it' }, ...round('toolu_1'), { role: 'user', content: STEER }, stored.at(-1)];
    const { messages } = rehydrateHistory(clientNextTurn(ui, 'claude-code', 'next'), stored);
    expect(isPrefix(anthropicWire(stored.slice(0, -1)), anthropicWire([SYSTEM, ...messages]))).toBe(true);
  });

  it('OpenAI shapes: the separate steer message is restored with its header', () => {
    const call = { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"q":1}' } };
    const stored = [SYSTEM, { role: 'user', content: 'find it' },
      { role: 'assistant', content: 'Searching.', tool_calls: [call] }, { role: 'tool', tool_call_id: 'call_1', content: 'results\n'.repeat(600) },
      { role: 'user', content: `${USER_STEER_HEADER}\n${STEER}` }, { role: 'assistant', content: 'Halo 3 it is.' }];
    const ui = [SYSTEM, { role: 'user', content: 'find it' }, stored[2], stored[3], { role: 'user', content: STEER }, stored.at(-1)];
    for (const [wireOf, provider] of [[chatCompletionsWire, 'openai'], [responsesWire, 'openai-codex']]) {
      const { messages } = rehydrateHistory(clientNextTurn(ui, provider, 'next'), stored);
      expect(isPrefix(wireOf(stored.slice(0, -1)), wireOf([SYSTEM, ...messages])), provider).toBe(true);
    }
  });
});

describe('the context panel still itemizes a pinned skill', () => {
  it('finds the [ACTIVE SKILL] block in the messages, and ignores the release block', () => {
    const messages = [{ role: 'user', content: `${skill(SKILL_TEXT)}\n\nreview` }, { role: 'user', content: `${skill(NO_SKILL_TEXT)}\n\nstop` }];
    const found = findLoadedSkills(messages, (text) => text.length);
    expect(found.map((s) => s.name)).toEqual(['code-review']);
  });
});

// ── What the user sees on reload ────────────────────────────────────────────
// The transcript keeps the server's prefixes (it is replayed byte-for-byte);
// the reload view and the conversation title show only the user's words.
describe('reload view: server prefixes never show in a user bubble or title', () => {
  it('the display strings are exactly the server constants', () => {
    expect(SERVER_USER_BLOCKS).toEqual([[ACTIVE_SKILL_OPEN, ACTIVE_SKILL_CLOSE], [PAGE_CONTEXT_OPEN, PAGE_CONTEXT_CLOSE]]);
    expect(SERVER_USER_MARKERS).toEqual([VOICE_TURN_MARKER, TEXT_TURN_MARKER]);
    expect(SERVER_STEER_HEADER).toBe(USER_STEER_HEADER);
  });

  it('strips every combination the server produces, and nothing else', () => {
    const words = 'open the forge';
    const decorated = prependTurnContext(markTurnContent(words, { voiceMode: true, textMode: true }), [skill(SKILL_TEXT), page('WF')]);
    expect(stripServerUserPrefixes(decorated)).toBe(words);
    expect(stripServerUserPrefixes(`${USER_STEER_HEADER}\n${words}`)).toBe(words);
    expect(stripServerUserPrefixes(markTurnContent(words, { voiceMode: true }))).toBe(words);
    expect(stripServerUserPrefixes(words)).toBe(words);
    expect(stripServerUserPrefixes('[PAGE CONTEXT] is what I typed')).toBe('[PAGE CONTEXT] is what I typed');
    expect(stripServerUserPrefixes(`${PAGE_CONTEXT_OPEN}\nunterminated`)).toBe(`${PAGE_CONTEXT_OPEN}\nunterminated`);
  });

  it('a reloaded conversation shows the user\'s words and gets a clean title', () => {
    const requests = runConversation('claude-code', TURNS);
    const ui = serverMessagesToUi([...requests.at(-1), { role: 'assistant', content: 'done' }]);
    const users = ui.filter((m) => m.role === 'user').map((m) => m.content);
    expect(users).toEqual(TURNS.map((t) => t.text));
    expect(deriveTitle(ui)).toBe('hello');
    const forgeFirst = runConversation('claude-code', [{ text: 'build me a flow', pageText: 'WORKFLOW wf1' }]);
    expect(deriveTitle(serverMessagesToUi(forgeFirst[0]))).toBe('build me a flow');
  });

  it('after a reload the stripped client copy still rehydrates to the exact bytes sent', () => {
    const requests = runConversation('claude-code', TURNS.slice(0, 6), { toolRounds: true });
    const stored = [...requests.at(-1), { role: 'assistant', content: 'done' }];
    const { messages } = rehydrateHistory(clientNextTurn(stored, 'claude-code', 'next'), stored);
    expect(isPrefix(anthropicWire(stored.slice(0, -1)), anthropicWire([SYSTEM, ...messages]))).toBe(true);
  });
});

describe('static guard: per-turn context never re-enters the system prompt', () => {
  const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('buildUnifiedSystemPrompt does not call buildPageContextBlock, and the skill is never prepended to it', () => {
    const unified = strip(fs.readFileSync(new URL('./system-prompts/buildUnifiedPrompt.js', import.meta.url), 'utf8'));
    const body = unified.slice(unified.indexOf('export async function buildUnifiedSystemPrompt'), unified.indexOf('export async function buildPageContextBlock'));
    expect(body).not.toMatch(/buildPageContextBlock\(/);
    const orchestrator = strip(fs.readFileSync(new URL('../OrchestratorService.js', import.meta.url), 'utf8'));
    expect(orchestrator).not.toMatch(/systemPrompt = `\$\{skillBlock\}/);
  });
});
