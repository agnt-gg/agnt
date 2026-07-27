// AUTO_ENABLED_TOOLS sentinel — "all tools" persists as a mode, not an
// enumerated list. An enumerated full-registry list froze today's tool set
// into localStorage and forced the backend to ship every schema on every
// turn; the sentinel resolves to `undefined` so the backend keeps its lean
// lazy-discovery default.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AUTO_ENABLED_TOOLS,
  setChannelEnabledTools,
  resolveChannelEnabledTools,
  getChannelConfig,
} from './chatChannelConfig.js';

const KEY = 'orchestrator:default';

beforeEach(() => {
  localStorage.clear();
});

describe('AUTO_ENABLED_TOOLS sentinel', () => {
  it('round-trips through storage as the literal sentinel', () => {
    setChannelEnabledTools(KEY, AUTO_ENABLED_TOOLS);
    expect(getChannelConfig(KEY).enabledTools).toBe(AUTO_ENABLED_TOOLS);
  });

  it('resolves to undefined (backend discovery default)', () => {
    setChannelEnabledTools(KEY, AUTO_ENABLED_TOOLS);
    expect(resolveChannelEnabledTools(KEY)).toBeUndefined();
  });

  it('beats a stale legacy global full list', () => {
    localStorage.setItem('agnt_enabled_tools', JSON.stringify(['a', 'b', 'c']));
    setChannelEnabledTools(KEY, AUTO_ENABLED_TOOLS);
    expect(resolveChannelEnabledTools(KEY)).toBeUndefined();
  });
});

describe('existing behaviours preserved', () => {
  it('a saved array still resolves exactly', () => {
    setChannelEnabledTools(KEY, ['x', 'y']);
    expect(resolveChannelEnabledTools(KEY)).toEqual(['x', 'y']);
  });

  it('an empty array is a real "zero tools" selection, not auto', () => {
    setChannelEnabledTools(KEY, []);
    expect(resolveChannelEnabledTools(KEY)).toEqual([]);
  });

  it('no config falls back to the legacy global list, then undefined', () => {
    localStorage.setItem('agnt_enabled_tools', JSON.stringify(['a']));
    expect(resolveChannelEnabledTools(KEY)).toEqual(['a']);
    localStorage.clear();
    expect(resolveChannelEnabledTools(KEY)).toBeUndefined();
  });

  it('sidebar channels keep specialty + memory defaults on first open', () => {
    const res = resolveChannelEnabledTools('widget:abc');
    expect(res).toContain('edit_widget_code');
    expect(res).toContain('recall');
  });

  it('sidebar saved lists still union the locked specialty set', () => {
    setChannelEnabledTools('widget:abc', ['recall']);
    const res = resolveChannelEnabledTools('widget:abc');
    expect(res).toContain('edit_widget_code'); // locked specialty rides along
    expect(res).toContain('recall');
  });
});
