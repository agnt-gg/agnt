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
  setMainChatToolSelectorShown,
} from './chatChannelConfig.js';

const KEY = 'orchestrator:default';

beforeEach(() => {
  localStorage.clear();
  setMainChatToolSelectorShown(true);
});

// Reported 2026-10-20: AGNT One has no tool selector, so installed plugins
// must work by default. A selection saved in Studio would otherwise cap the
// chat invisibly and keep every later plugin out, with no way to change it.
describe('a frame without the main chat\u2019s tool selector', () => {
  it('ignores a saved selection on the main chat', () => {
    setChannelEnabledTools(KEY, ['web_search']);
    setMainChatToolSelectorShown(false);
    expect(resolveChannelEnabledTools(KEY)).toBeUndefined();
  });

  it('ignores the legacy global list too', () => {
    localStorage.setItem('agnt_enabled_tools', JSON.stringify(['a']));
    setMainChatToolSelectorShown(false);
    expect(resolveChannelEnabledTools(KEY)).toBeUndefined();
  });

  it('leaves a saved agent\u2019s chat to the agent\u2019s own tools', () => {
    setChannelEnabledTools('agent:abc', ['web_search']);
    setMainChatToolSelectorShown(false);
    expect(resolveChannelEnabledTools('agent:abc')).toBeUndefined();
  });

  it('keeps a sidebar chat\u2019s locked page tools and its own visible selection', () => {
    setChannelEnabledTools('widget:abc', ['recall']);
    setMainChatToolSelectorShown(false);
    const res = resolveChannelEnabledTools('widget:abc');
    expect(res).toContain('edit_widget_code');
    expect(res).toContain('recall');
  });

  it('honours the saved selection again once the selector is back (Studio)', () => {
    setChannelEnabledTools(KEY, ['web_search']);
    setMainChatToolSelectorShown(false);
    setMainChatToolSelectorShown(true);
    expect(resolveChannelEnabledTools(KEY)).toEqual(['web_search']);
  });
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
