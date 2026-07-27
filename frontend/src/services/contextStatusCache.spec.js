// The panel read "0 / 1.0M" after every reload: the measured request size
// lived only in memory, and a provider/model watcher blanked it on the way in.
// This module is the persistence half of the fix.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadContextStatus,
  saveContextStatus,
  clearContextStatusCache,
  CACHE_LIMIT,
} from './contextStatusCache.js';

const STATUS = {
  currentTokens: 622200,
  tokenLimit: 1000000,
  utilizationPercent: 62.2,
  model: 'claude-opus-5',
  messagesCount: 14,
  breakdown: { systemTokens: 41400, toolTokens: 62400, messagesTokens: 518500, outputBufferTokens: 60000 },
};

beforeEach(() => {
  localStorage.clear();
});

describe('round trip', () => {
  it('restores the exact status that was reported', () => {
    saveContextStatus('conv-1', STATUS);
    expect(loadContextStatus('conv-1')).toEqual(STATUS);
  });

  it('preserves the breakdown so the segmented bar survives a reload', () => {
    saveContextStatus('conv-1', STATUS);
    expect(loadContextStatus('conv-1').breakdown.messagesTokens).toBe(518500);
  });

  it('does not leak its own bookkeeping into the restored shape', () => {
    saveContextStatus('conv-1', STATUS);
    expect(loadContextStatus('conv-1')).not.toHaveProperty('cachedAt');
  });

  it('keeps conversations independent', () => {
    saveContextStatus('conv-1', STATUS);
    saveContextStatus('conv-2', { ...STATUS, currentTokens: 100 });
    expect(loadContextStatus('conv-1').currentTokens).toBe(622200);
    expect(loadContextStatus('conv-2').currentTokens).toBe(100);
  });

  it('the newest report wins', () => {
    saveContextStatus('conv-1', STATUS);
    saveContextStatus('conv-1', { ...STATUS, currentTokens: 700000 });
    expect(loadContextStatus('conv-1').currentTokens).toBe(700000);
  });

  it('returns null for an unknown conversation', () => {
    expect(loadContextStatus('never-seen')).toBeNull();
  });
});

describe('refuses to cache what it cannot key', () => {
  it('ignores optimistic temp- ids, which are replaced by the server', () => {
    saveContextStatus('temp-123', STATUS);
    expect(loadContextStatus('temp-123')).toBeNull();
    expect(localStorage.getItem('agnt_last_context_status')).toBeNull();
  });

  it('ignores empty / non-string ids', () => {
    for (const id of ['', null, undefined, 42, {}]) {
      saveContextStatus(id, STATUS);
      expect(loadContextStatus(id)).toBeNull();
    }
  });

  it('ignores a missing or non-object status', () => {
    saveContextStatus('conv-1', null);
    saveContextStatus('conv-1', 'nope');
    expect(loadContextStatus('conv-1')).toBeNull();
  });
});

describe('bounded growth', () => {
  it('evicts the oldest beyond the limit and keeps the newest', () => {
    for (let i = 0; i < CACHE_LIMIT + 15; i++) {
      saveContextStatus(`conv-${i}`, { ...STATUS, currentTokens: i });
      // Distinct timestamps so eviction order is deterministic rather than
      // dependent on how fast the loop runs.
      vi.setSystemTime(Date.now() + 1000);
    }
    const stored = JSON.parse(localStorage.getItem('agnt_last_context_status'));
    expect(Object.keys(stored).length).toBeLessThanOrEqual(CACHE_LIMIT);
    expect(loadContextStatus(`conv-${CACHE_LIMIT + 14}`)).not.toBeNull();
    expect(loadContextStatus('conv-0')).toBeNull();
  });
});

describe('never breaks the panel it feeds', () => {
  it('survives corrupt stored JSON', () => {
    localStorage.setItem('agnt_last_context_status', '{not json');
    expect(loadContextStatus('conv-1')).toBeNull();
    expect(() => saveContextStatus('conv-1', STATUS)).not.toThrow();
    expect(loadContextStatus('conv-1')).toEqual(STATUS);
  });

  it('survives a non-object payload', () => {
    localStorage.setItem('agnt_last_context_status', '["array"]');
    expect(loadContextStatus('conv-1')).toBeNull();
  });

  it('swallows a storage quota failure rather than throwing into the UI', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveContextStatus('conv-1', STATUS)).not.toThrow();
    spy.mockRestore();
  });

  it('clears cleanly', () => {
    saveContextStatus('conv-1', STATUS);
    clearContextStatusCache();
    expect(loadContextStatus('conv-1')).toBeNull();
  });
});
