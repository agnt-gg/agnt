/**
 * Per-channel routing mode — the tri-state, and the migration into it.
 *
 * THE DEFECT THIS FIXES
 * ─────────────────────
 * Every send resolved a concrete provider/model pair, so "follow my global
 * setting" was not a state this app could represent. Once a chat had been
 * given a model there was no way back to the default, and there was nowhere
 * for dynamic routing to live either. One field fixes both, and the rule that
 * makes it safe is the migration one: a config saved before this existed
 * carries a pair and no mode, and MUST read as 'pinned' — those users chose
 * that model.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveChannelMode,
  resolveChannelRouting,
  setChannelMode,
  setChannelProvider,
  setChannelModel,
  getChannelConfig,
  CHAT_MODES,
} from './chatChannelConfig.js';

const KEY = 'agent:test-channel';
const GLOBAL = { selectedProvider: 'global-p', selectedModel: 'global-m' };

beforeEach(() => localStorage.clear());

describe('resolveChannelMode — migration without a migration', () => {
  it('a channel with no config at all follows the global setting', () => {
    // This is what lets the account toggle convert every untouched surface at
    // once, with no per-channel opt-in.
    expect(resolveChannelMode(null)).toBe('default');
    expect(resolveChannelMode(undefined)).toBe('default');
    expect(resolveChannelMode({})).toBe('default');
  });

  it('a LEGACY config (pair, no mode) reads as pinned', () => {
    expect(resolveChannelMode({ provider: 'anthropic', model: 'sonnet' })).toBe('pinned');
  });

  it('a half-written legacy config is not a pin', () => {
    // A provider with no model cannot be sent as a pair, so treating it as one
    // would transmit an incomplete selection.
    expect(resolveChannelMode({ provider: 'anthropic' })).toBe('default');
    expect(resolveChannelMode({ model: 'sonnet' })).toBe('default');
  });

  it('an explicit mode always wins over the inferred one', () => {
    expect(resolveChannelMode({ provider: 'a', model: 'm', mode: 'dynamic' })).toBe('dynamic');
    expect(resolveChannelMode({ provider: 'a', model: 'm', mode: 'default' })).toBe('default');
  });

  it('an unrecognised mode falls back to inference, never to routing', () => {
    expect(resolveChannelMode({ mode: 'turbo' })).toBe('default');
    expect(resolveChannelMode({ provider: 'a', model: 'm', mode: 'turbo' })).toBe('pinned');
  });
});

describe('choosing a model IS pinning one', () => {
  it('setChannelProvider and setChannelModel both set mode=pinned', () => {
    setChannelProvider(KEY, 'anthropic');
    expect(getChannelConfig(KEY).mode).toBe('pinned');

    localStorage.clear();
    setChannelModel(KEY, 'sonnet');
    expect(getChannelConfig(KEY).mode).toBe('pinned');
  });
});

describe('switching mode is never a one-way door', () => {
  it('the pinned pair survives a trip through dynamic and back', () => {
    // A user who flips to Dynamic to try it must not lose the model they
    // chose. Clearing it here would make the control a trap.
    setChannelProvider(KEY, 'anthropic');
    setChannelModel(KEY, 'sonnet');

    setChannelMode(KEY, 'dynamic');
    expect(getChannelConfig(KEY).provider).toBe('anthropic');
    expect(getChannelConfig(KEY).model).toBe('sonnet');

    setChannelMode(KEY, 'pinned');
    expect(resolveChannelRouting(KEY, GLOBAL)).toEqual({
      mode: 'pinned', provider: 'anthropic', model: 'sonnet',
    });
  });

  it('an invalid mode is ignored rather than stored', () => {
    setChannelMode(KEY, 'dynamic');
    setChannelMode(KEY, 'nonsense');
    expect(getChannelConfig(KEY).mode).toBe('dynamic');
  });

  it('every declared mode is settable', () => {
    for (const m of CHAT_MODES) {
      setChannelMode(KEY, m);
      expect(getChannelConfig(KEY).mode).toBe(m);
    }
  });
});

describe('resolveChannelRouting — what actually goes on the wire', () => {
  it('ONLY a pinned channel transmits a provider/model pair', () => {
    // The absence of the pair is the mechanism: it is what hands the decision
    // to the server. Sending one alongside 'default' or 'dynamic' would be
    // read as a pin by the backend's legacy-caller rule and defeat both.
    setChannelProvider(KEY, 'anthropic');
    setChannelModel(KEY, 'sonnet');

    for (const mode of ['default', 'dynamic']) {
      setChannelMode(KEY, mode);
      const wire = resolveChannelRouting(KEY, GLOBAL);
      expect(wire.mode).toBe(mode);
      expect(wire.provider).toBeNull();
      expect(wire.model).toBeNull();
    }
  });

  it('an untouched channel defers without inventing a pair', () => {
    expect(resolveChannelRouting('agent:never-opened', GLOBAL)).toEqual({
      mode: 'default', provider: null, model: null,
    });
  });

  it('a pinned channel with a partial config falls back to the global pair', () => {
    setChannelMode(KEY, 'pinned');
    setChannelProvider(KEY, 'anthropic');
    const wire = resolveChannelRouting(KEY, GLOBAL);
    expect(wire.provider).toBe('anthropic');
    expect(wire.model).toBe('global-m');
  });

  it('survives a corrupt localStorage blob rather than throwing mid-send', () => {
    localStorage.setItem('agnt_chat_channel_configs', '{not json');
    expect(resolveChannelRouting(KEY, GLOBAL).mode).toBe('default');
  });
});
