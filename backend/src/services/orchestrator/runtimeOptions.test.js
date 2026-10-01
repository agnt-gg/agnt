/**
 * The runtime option contract: absent means today, profiles mean what their
 * docs say, overrides are exact, and nothing is guessed.
 *
 * The test that would have caught the 2026-10-01 report is "a non-ui profile
 * never broadcasts": thirteen programmatic calls became thirteen sidebar
 * entries because every run was announced to the open app.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveRuntimeOptions,
  createLineFramer,
  RuntimeOptionsError,
  RUNTIME_PROFILES,
  MINIMAL_STREAM_EVENTS,
} from './runtimeOptions.js';

describe('absent runtime is exactly today', () => {
  it.each([undefined, null])('%s resolves to the ui profile, not explicit', (raw) => {
    const runtime = resolveRuntimeOptions(raw);
    expect(runtime.explicit).toBe(false);
    expect(runtime.profile).toBe('ui');
  });

  it('the ui profile turns nothing off', () => {
    const runtime = resolveRuntimeOptions(undefined);
    expect(runtime.prompt).toEqual({ platform: 'full', memory: true, skills: true, customInstructions: true, workspace: true, append: null });
    expect(runtime.tools).toBe('agent');
    expect(Object.values(runtime.persist).every(Boolean)).toBe(true);
    expect(runtime.broadcast).toBe(true);
    expect(runtime.model.fallback).toBe('chain');
    expect(runtime.stream).toEqual({ events: 'all', lines: false });
    expect(runtime.limits).toEqual({ maxInputTokens: null, timeoutMs: null, maxToolRounds: null, cancelOnDisconnect: false });
  });

  it('an explicit { profile: "ui" } equals absent, apart from the explicit flag', () => {
    const { explicit: a, ...absent } = resolveRuntimeOptions(undefined);
    const { explicit: b, ...named } = resolveRuntimeOptions({ profile: 'ui' });
    expect([a, b]).toEqual([false, true]);
    expect(named).toEqual(absent);
  });
});

describe('profiles', () => {
  it('lists exactly the four documented profiles', () => {
    expect([...RUNTIME_PROFILES]).toEqual(['ui', 'api', 'background', 'realtime']);
  });

  it.each(['api', 'background', 'realtime'])('%s never broadcasts and never writes a transcript', (profile) => {
    const runtime = resolveRuntimeOptions({ profile });
    expect(runtime.broadcast).toBe(false);
    expect(runtime.persist.transcript).toBe(false);
  });

  it('a non-ui caller cannot opt back into broadcasting', () => {
    // A broadcast run is adopted and autosaved by the open app. Only the chat
    // app's own turns own a sidebar entry.
    expect(resolveRuntimeOptions({ profile: 'api', broadcast: true }).broadcast).toBe(false);
    expect(resolveRuntimeOptions({ profile: 'ui', broadcast: false }).broadcast).toBe(false);
  });

  it('realtime is persona-only, tool-less, unpersisted, no failover, line-framed, cancel-on-close', () => {
    const runtime = resolveRuntimeOptions({ profile: 'realtime' });
    expect(runtime.prompt).toMatchObject({ platform: 'none', memory: false, skills: false, customInstructions: false, workspace: false });
    expect(runtime.tools).toBe('none');
    expect(Object.values(runtime.persist).some(Boolean)).toBe(false);
    expect(runtime.model.fallback).toBe('none');
    expect(runtime.stream).toEqual({ events: 'minimal', lines: true });
    expect(runtime.limits.maxToolRounds).toBe(0);
    expect(runtime.limits.cancelOnDisconnect).toBe(true);
  });

  it('api drops the chat-UI blocks and every write, keeps the agent tools', () => {
    const runtime = resolveRuntimeOptions({ profile: 'api' });
    expect(runtime.prompt.platform).toBe('lean');
    expect(runtime.tools).toBe('agent');
    expect(Object.values(runtime.persist).some(Boolean)).toBe(false);
  });

  it('background keeps the conversation log and insights for later turns', () => {
    const runtime = resolveRuntimeOptions({ profile: 'background' });
    expect(runtime.persist).toEqual({ conversationLog: true, transcript: false, conversationState: true, insights: true });
  });
});

describe('overrides are field-exact', () => {
  it('a section override changes only the named field', () => {
    const runtime = resolveRuntimeOptions({ profile: 'realtime', prompt: { memory: true }, stream: { events: 'all' } });
    expect(runtime.prompt).toMatchObject({ platform: 'none', memory: true, skills: false });
    expect(runtime.stream).toEqual({ events: 'all', lines: true });
  });

  it('append is trimmed, and blank collapses to null', () => {
    expect(resolveRuntimeOptions({ prompt: { append: '  Reply in JSON.  ' } }).prompt.append).toBe('Reply in JSON.');
    expect(resolveRuntimeOptions({ prompt: { append: '   ' } }).prompt.append).toBeNull();
  });

  it('a tool list is de-duplicated, and an empty list means none', () => {
    expect(resolveRuntimeOptions({ tools: ['web_search', 'web_search ', 'recall'] }).tools).toEqual(['web_search', 'recall']);
    expect(resolveRuntimeOptions({ tools: [] }).tools).toBe('none');
  });

  it('model.override pins a pair only when both halves are named', () => {
    const runtime = resolveRuntimeOptions({ model: { provider: 'groq', model: 'openai/gpt-oss-120b', override: true } });
    expect(runtime.model).toEqual({ provider: 'groq', model: 'openai/gpt-oss-120b', override: true, fallback: 'chain' });
    expect(() => resolveRuntimeOptions({ model: { provider: 'groq', override: true } })).toThrow(RuntimeOptionsError);
  });

  it('accepts the multipart string form', () => {
    expect(resolveRuntimeOptions('{"profile":"realtime"}').profile).toBe('realtime');
  });

  it('the resolved object is frozen, so no call site can mutate a shared default', () => {
    const runtime = resolveRuntimeOptions({ profile: 'realtime' });
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.prompt)).toBe(true);
    expect(resolveRuntimeOptions({ profile: 'realtime' }).prompt.memory).toBe(false);
  });
});

describe('nothing is guessed', () => {
  // Each of these would otherwise fall back to the expensive default silently.
  it.each([
    [{ profil: 'realtime' }, /unknown key "profil"/],
    [{ prompt: { memroy: false } }, /unknown key "prompt.memroy"/],
    [{ profile: 'fast' }, /profile must be one of/],
    [{ prompt: { platform: 'tiny' } }, /prompt.platform must be one of/],
    [{ prompt: { memory: 'no' } }, /prompt.memory must be true or false/],
    [{ tools: 'all' }, /tools must be/],
    [{ tools: ['ok', ''] }, /tools must be/],
    [{ limits: { timeoutMs: 0 } }, /limits.timeoutMs must be an integer/],
    [{ limits: { maxToolRounds: -1 } }, /limits.maxToolRounds must be an integer/],
    [{ limits: { maxInputTokens: 1.5 } }, /limits.maxInputTokens must be an integer/],
    [{ stream: { events: 'some' } }, /stream.events must be one of/],
    [['realtime'], /runtime must be an object/],
    ['{not json', /runtime must be a JSON object/],
  ])('%j is rejected', (raw, message) => {
    expect(() => resolveRuntimeOptions(raw)).toThrow(message);
  });

  it('carries a 400 status for the transport to report', () => {
    try { resolveRuntimeOptions({ nope: 1 }); } catch (error) { expect(error.status).toBe(400); }
    expect.assertions(1);
  });

  it('allows zero tool rounds, which is how a tool-less caller says so', () => {
    expect(resolveRuntimeOptions({ limits: { maxToolRounds: 0 } }).limits.maxToolRounds).toBe(0);
  });
});

describe('minimal stream events', () => {
  it('keeps what a programmatic caller acts on and drops chat-panel telemetry', () => {
    for (const kept of ['content_delta', 'line', 'final_content', 'error', 'provider_fallback', 'agent_execution_completed', 'done']) {
      expect(MINIMAL_STREAM_EVENTS.has(kept)).toBe(true);
    }
    for (const dropped of ['context_status', 'context_manifest', 'assistant_message']) {
      expect(MINIMAL_STREAM_EVENTS.has(dropped)).toBe(false);
    }
  });
});

describe('createLineFramer', () => {
  const frame = (chunks, { flush = true } = {}) => {
    const lines = [];
    const framer = createLineFramer((line, index) => lines.push([index, line]));
    for (const chunk of chunks) framer.push(chunk);
    if (flush) framer.flush();
    return lines;
  };

  it('emits a line the moment its newline arrives, across chunk boundaries', () => {
    const lines = [];
    const framer = createLineFramer((line) => lines.push(line));
    framer.push('{"bot":1,');
    expect(lines).toEqual([]);
    framer.push('"mode":"attack"}\n{"say"');
    expect(lines).toEqual(['{"bot":1,"mode":"attack"}']);
  });

  it('holds a trailing partial line until flush', () => {
    expect(frame(['a\nb'], { flush: false })).toEqual([[0, 'a']]);
    expect(frame(['a\nb'])).toEqual([[0, 'a'], [1, 'b']]);
  });

  it('skips blank lines, strips CR, and numbers only real lines', () => {
    expect(frame(['a\r\n\n  \nb\n'])).toEqual([[0, 'a'], [1, 'b']]);
  });

  it('ignores empty and non-string deltas', () => {
    expect(frame(['', undefined, null, 'x'])).toEqual([[0, 'x']]);
  });

  it('a second flush emits nothing', () => {
    const lines = [];
    const framer = createLineFramer((line) => lines.push(line));
    framer.push('x');
    framer.flush();
    framer.flush();
    expect(lines).toEqual(['x']);
  });
});
