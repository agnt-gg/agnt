/**
 * inflightRuns — the one fact that has to survive a refresh.
 *
 * Neither chat store can be trusted to remember "a turn was generating" across a
 * reload (one persists to localStorage on a debounce, the other keeps messages
 * in memory only), so the marker lives on its own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  markRunStarted,
  markRunEnded,
  listInflightRuns,
  _clearAllMarkers,
  _STORAGE_KEY,
} from './inflightRuns.js';

beforeEach(() => {
  localStorage.clear();
  _clearAllMarkers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('marking a turn in flight', () => {
  it('survives a reload — that is the entire point', () => {
    markRunStarted('conv-1', { chatType: 'agent', channelKey: 'agent:42' });

    // Simulate a fresh page: nothing but localStorage carries over.
    const runs = listInflightRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      conversationId: 'conv-1',
      chatType: 'agent',
      channelKey: 'agent:42',
    });
  });

  it('clears the marker when the turn ends', () => {
    markRunStarted('conv-1', { chatType: 'agent', channelKey: 'agent:42' });
    markRunEnded('conv-1');
    expect(listInflightRuns()).toHaveLength(0);
  });

  it('refuses client temp ids — the server has never heard of them', () => {
    // A temp id cannot be reattached to, so recording one guarantees a failed
    // request on the next load.
    markRunStarted('temp-1712345', { chatType: 'orchestrator' });
    expect(listInflightRuns()).toHaveLength(0);
  });

  it('distinguishes the main chat from a sidebar channel', () => {
    markRunStarted('conv-main', { chatType: 'orchestrator' });
    markRunStarted('conv-side', { chatType: 'tool', channelKey: 'tool:9' });

    const byId = Object.fromEntries(listInflightRuns().map((r) => [r.conversationId, r]));
    expect(byId['conv-main'].channelKey).toBeNull();
    expect(byId['conv-side'].channelKey).toBe('tool:9');
  });

  it('tracks several concurrent turns', () => {
    markRunStarted('c1', { channelKey: 'agent:1' });
    markRunStarted('c2', { channelKey: 'agent:2' });
    markRunStarted('c3', { channelKey: 'agent:3' });
    expect(listInflightRuns()).toHaveLength(3);

    markRunEnded('c2');
    expect(listInflightRuns().map((r) => r.conversationId).sort()).toEqual(['c1', 'c3']);
  });
});

describe('markers expire on their own', () => {
  it('drops entries older than the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    markRunStarted('stale', { chatType: 'orchestrator' });

    // A tab that died without cleanup would otherwise trigger a pointless
    // reattach on every future page load, forever.
    vi.setSystemTime(new Date('2026-01-01T00:31:00Z'));
    expect(listInflightRuns()).toHaveLength(0);
  });

  it('keeps entries inside the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    markRunStarted('fresh', { chatType: 'orchestrator' });

    vi.setSystemTime(new Date('2026-01-01T00:20:00Z'));
    expect(listInflightRuns()).toHaveLength(1);
  });

  it('caps how many markers can accumulate', () => {
    for (let i = 0; i < 80; i++) markRunStarted(`c${i}`, { chatType: 'orchestrator' });
    expect(listInflightRuns().length).toBeLessThanOrEqual(50);
  });
});

describe('never breaks the thing it is helping', () => {
  it('recovers from corrupted storage instead of throwing', () => {
    localStorage.setItem(_STORAGE_KEY, '{not json');
    expect(() => listInflightRuns()).not.toThrow();
    expect(listInflightRuns()).toEqual([]);
  });

  it('ignores a non-object payload', () => {
    localStorage.setItem(_STORAGE_KEY, '["unexpected","array"]');
    expect(listInflightRuns()).toEqual([]);
  });

  it('swallows a storage quota failure — resume is an enhancement, not a dependency', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    // If this threw, it would propagate into sendMessage and break sending
    // outright — a strictly worse failure than losing resume.
    expect(() => markRunStarted('conv-1', { chatType: 'agent' })).not.toThrow();
    spy.mockRestore();
  });

  it('ignores an unknown conversation on clear', () => {
    expect(() => markRunEnded('never-existed')).not.toThrow();
    expect(() => markRunEnded(null)).not.toThrow();
  });
});
