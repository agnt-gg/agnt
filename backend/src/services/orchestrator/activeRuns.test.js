/**
 * activeRuns — the registry that decouples a run's lifetime from the socket
 * that started it.
 *
 * The bug this replaced: `res.on('close')` aborted generation, so a refresh
 * mid-turn cancelled the work outright and the partial answer became
 * unreachable. These tests pin the properties that make a refresh survivable.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  startRun,
  publish,
  attachSubscriber,
  cancelRun,
  endRun,
  getRunStatus,
  _runCount,
  _resetForTests,
} from './activeRuns.js';

/** Minimal express-response stand-in that records every frame written to it. */
const makeRes = () => {
  const frames = [];
  return {
    frames,
    write: vi.fn((chunk) => { frames.push(chunk); return true; }),
    end: vi.fn(),
    on: vi.fn(),
    /** Parse recorded SSE frames back into { eventName, data } pairs. */
    events() {
      return frames
        .filter((f) => f.startsWith('event: '))
        .map((f) => {
          const eventName = f.slice(7, f.indexOf('\n'));
          const dataRaw = f.slice(f.indexOf('data: ') + 6).trim();
          return { eventName, data: JSON.parse(dataRaw) };
        });
    },
  };
};

const CONV = 'conv-1';

beforeEach(() => {
  _resetForTests();
});

describe('run lifetime is independent of any socket', () => {
  it('keeps a run alive and recording after its originating socket is gone', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1', chatType: 'orchestrator' });

    // The socket dies here. Nothing in this module is told, because nothing
    // should need to be told — publishing continues regardless.
    publish(run, 'assistant_message', { id: 'a1' });
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'still ' });
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'working' });

    expect(getRunStatus(CONV, 'u1').active).toBe(true);

    const res = makeRes();
    attachSubscriber(CONV, res, 'u1');
    const events = res.events();

    expect(events[0].eventName).toBe('run_resumed');
    const delta = events.find((e) => e.eventName === 'content_delta');
    expect(delta.data.delta).toBe('still working');
  });

  it('streams live events to a client that reattached mid-run', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    publish(run, 'assistant_message', { id: 'a1' });

    const res = makeRes();
    expect(attachSubscriber(CONV, res, 'u1')).toBe('attached');
    const afterReplay = res.frames.length;

    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'live' });

    expect(res.frames.length).toBeGreaterThan(afterReplay);
    expect(res.events().at(-1).data.delta).toBe('live');
  });

  it('replays to a SECOND reattaching client without disturbing the first', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    publish(run, 'assistant_message', { id: 'a1' });

    const first = makeRes();
    attachSubscriber(CONV, first, 'u1');
    const second = makeRes();
    attachSubscriber(CONV, second, 'u1');

    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'x' });

    expect(first.events().at(-1).data.delta).toBe('x');
    expect(second.events().at(-1).data.delta).toBe('x');
  });
});

describe('reattaching does not duplicate what the client already has', () => {
  it('names every assistant message the replay will re-emit', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    publish(run, 'assistant_message', { id: 'a1' });
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'hi' });
    publish(run, 'assistant_message', { id: 'a2' });

    const res = makeRes();
    attachSubscriber(CONV, res, 'u1');

    const head = res.events()[0];
    expect(head.eventName).toBe('run_resumed');
    // Without this the client cannot know which of its own partial bubbles the
    // replay is about to recreate, and renders the answer twice.
    expect(head.data.replayedMessageIds).toEqual(['a1', 'a2']);
  });

  it('carries the user turn so a client whose snapshot predates the send can restore it', () => {
    startRun({ conversationId: CONV, userId: 'u1', userMessage: 'what is 2+2?' });
    const res = makeRes();
    attachSubscriber(CONV, res, 'u1');
    expect(res.events()[0].data.userMessage).toBe('what is 2+2?');
  });
});

describe('cancellation is explicit', () => {
  it('aborts the controller only when asked', () => {
    const abortController = new AbortController();
    startRun({ conversationId: CONV, userId: 'u1', abortController });

    // A socket closing is NOT a cancel — nothing in this module observes it.
    expect(abortController.signal.aborted).toBe(false);

    expect(cancelRun(CONV, 'u1')).toBe('cancelled');
    expect(abortController.signal.aborted).toBe(true);
  });

  it('refuses to cancel another user\'s run', () => {
    const abortController = new AbortController();
    startRun({ conversationId: CONV, userId: 'u1', abortController });
    expect(cancelRun(CONV, 'someone-else')).toBe('forbidden');
    expect(abortController.signal.aborted).toBe(false);
  });

  it('reports cancelled status rather than completed', () => {
    startRun({ conversationId: CONV, userId: 'u1', abortController: new AbortController() });
    cancelRun(CONV, 'u1');
    endRun(CONV, 'completed');
    expect(getRunStatus(CONV, 'u1').status).toBe('cancelled');
  });
});

describe('a new turn supersedes an abandoned one', () => {
  it('cancels the previous run for the same conversation', () => {
    const first = new AbortController();
    startRun({ conversationId: CONV, userId: 'u1', abortController: first });

    // User refreshed and re-sent. Two concurrent generations writing to one
    // conversation would interleave; the older one loses.
    startRun({ conversationId: CONV, userId: 'u1', abortController: new AbortController() });

    expect(first.signal.aborted).toBe(true);
    expect(_runCount()).toBe(1);
  });
});

describe('ownership', () => {
  it('hides another user\'s run entirely', () => {
    startRun({ conversationId: CONV, userId: 'u1' });
    expect(getRunStatus(CONV, 'intruder')).toEqual({ active: false, known: false });
    expect(attachSubscriber(CONV, makeRes(), 'intruder')).toBe('forbidden');
  });
});

describe('a finished run stays readable briefly', () => {
  it('replays and closes for a client that arrives just after the end', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    publish(run, 'assistant_message', { id: 'a1' });
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'done answer' });
    endRun(CONV, 'completed');

    const res = makeRes();
    // Without a retention window, the race this module exists to fix would
    // simply reopen in the instant between the last token and the socket close.
    expect(attachSubscriber(CONV, res, 'u1')).toBe('ended');
    expect(res.events().find((e) => e.eventName === 'content_delta').data.delta).toBe('done answer');
    expect(res.events().at(-1).eventName).toBe('run_ended');
    expect(res.end).toHaveBeenCalled();
  });

  it('closes subscribers when the run ends', () => {
    startRun({ conversationId: CONV, userId: 'u1' });
    const res = makeRes();
    attachSubscriber(CONV, res, 'u1');
    endRun(CONV, 'completed');
    expect(res.events().at(-1).eventName).toBe('run_ended');
    expect(res.end).toHaveBeenCalled();
  });

  it('reports nothing for a conversation that never ran', () => {
    expect(getRunStatus('never-existed', 'u1')).toEqual({ active: false, known: false });
    expect(attachSubscriber('never-existed', makeRes(), 'u1')).toBe('not_found');
  });
});

describe('the replay log is bounded', () => {
  it('coalesces consecutive deltas so growth is O(answer), not O(chunks)', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    publish(run, 'assistant_message', { id: 'a1' });
    for (let i = 0; i < 5000; i++) {
      publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'x' });
    }

    const res = makeRes();
    attachSubscriber(CONV, res, 'u1');
    const deltas = res.events().filter((e) => e.eventName === 'content_delta');

    expect(deltas).toHaveLength(1);
    expect(deltas[0].data.delta).toHaveLength(5000);
  });

  it('does not coalesce across different assistant messages', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'first' });
    publish(run, 'content_delta', { assistantMessageId: 'a2', delta: 'second' });

    const res = makeRes();
    attachSubscriber(CONV, res, 'u1');
    const deltas = res.events().filter((e) => e.eventName === 'content_delta');
    expect(deltas.map((d) => d.data.delta)).toEqual(['first', 'second']);
  });

  it('keeps only the newest instance of superseding telemetry', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    publish(run, 'context_status', { round: 1 });
    publish(run, 'context_status', { round: 2 });
    publish(run, 'context_status', { round: 3 });

    const res = makeRes();
    attachSubscriber(CONV, res, 'u1');
    const statuses = res.events().filter((e) => e.eventName === 'context_status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].data.round).toBe(3);
  });

  it('sheds blobs rather than the answer when the ceiling is hit', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    const megabyte = 'z'.repeat(1024 * 1024);

    // Twelve megabytes of tool payloads against an 8MB ceiling.
    for (let i = 0; i < 12; i++) {
      publish(run, 'tool_end', { toolCall: { id: `t${i}`, result: megabyte } });
    }
    // Text emitted AFTER the ceiling is reached must still survive.
    publish(run, 'assistant_message', { id: 'a1' });
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'the answer' });

    const res = makeRes();
    attachSubscriber(CONV, res, 'u1');
    const events = res.events();

    expect(events[0].data.truncated).toBe(true);
    expect(events.filter((e) => e.eventName === 'tool_end').length).toBeLessThan(12);
    expect(events.find((e) => e.eventName === 'content_delta').data.delta).toBe('the answer');
  });
});

describe('robustness', () => {
  it('survives an unserializable payload instead of throwing into the run', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    const circular = { name: 'loop' };
    circular.self = circular;

    expect(() => publish(run, 'tool_end', circular)).not.toThrow();

    const res = makeRes();
    expect(() => attachSubscriber(CONV, res, 'u1')).not.toThrow();
  });

  it('drops a subscriber whose socket throws on write', () => {
    const run = startRun({ conversationId: CONV, userId: 'u1' });
    const res = makeRes();
    attachSubscriber(CONV, res, 'u1');

    res.write.mockImplementation(() => { throw new Error('EPIPE'); });
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'x' });
    const callsAfterFailure = res.write.mock.calls.length;

    // A socket that threw once is gone. Further publishes must not reach it at
    // all — otherwise every event for the rest of the run pays a throw/catch.
    res.write.mockImplementation(() => true);
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'y' });
    publish(run, 'content_delta', { assistantMessageId: 'a1', delta: 'z' });
    expect(res.write.mock.calls.length).toBe(callsAfterFailure);
  });

  it('ignores a run with no conversation id', () => {
    expect(startRun({ conversationId: null, userId: 'u1' })).toBeNull();
    expect(_runCount()).toBe(0);
  });
});
