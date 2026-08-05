import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GLOBAL_FRONTEND_EVENTS,
  windowEventNameFor,
  isGlobalFrontendEvent,
  dispatchGlobalFrontendEvent,
  dispatchGlobalFrontendEvents,
} from './globalFrontendEvents.js';

describe('globalFrontendEvents registry', () => {
  let received;
  const listeners = [];

  function listen(name) {
    const fn = (e) => received.push({ name, detail: e.detail });
    window.addEventListener(name, fn);
    listeners.push([name, fn]);
  }

  beforeEach(() => {
    received = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    while (listeners.length) {
      const [name, fn] = listeners.pop();
      window.removeEventListener(name, fn);
    }
    vi.restoreAllMocks();
  });

  it('maps every declared type to a window event name', () => {
    expect(windowEventNameFor('tutorial:start')).toBe('ai-tour:start');
    expect(windowEventNameFor('tutorial:end')).toBe('ai-tour:end');
    expect(windowEventNameFor('appearance:background')).toBe('agnt:appearance-background');
  });

  it('treats unknown and non-string types as channel-scoped', () => {
    expect(windowEventNameFor('widget:saved')).toBeNull();
    expect(windowEventNameFor(undefined)).toBeNull();
    expect(windowEventNameFor(null)).toBeNull();
    expect(windowEventNameFor(42)).toBeNull();
    expect(isGlobalFrontendEvent('widget:saved')).toBe(false);
  });

  // Object key lookup must not answer "yes" for inherited Object.prototype
  // members — 'constructor' is not a global frontend event.
  it('does not inherit prototype keys', () => {
    expect(windowEventNameFor('constructor')).toBeNull();
    expect(windowEventNameFor('toString')).toBeNull();
  });

  it('is frozen — a consumer cannot mutate the shared contract', () => {
    expect(Object.isFrozen(GLOBAL_FRONTEND_EVENTS)).toBe(true);
  });

  it('dispatches a window CustomEvent carrying the payload', () => {
    listen('agnt:appearance-background');
    const detail = { url: '/api/local-file/C:/x/annie.png', kind: 'image', fileName: 'annie.png' };

    expect(dispatchGlobalFrontendEvent('appearance:background', detail)).toBe(true);
    expect(received).toEqual([{ name: 'agnt:appearance-background', detail }]);
  });

  it('normalises a missing payload to an object rather than dispatching undefined', () => {
    listen('agnt:appearance-background');
    dispatchGlobalFrontendEvent('appearance:background', undefined);
    expect(received[0].detail).toEqual({});
  });

  it('returns false and dispatches nothing for a channel-scoped type', () => {
    listen('ai-tour:start');
    listen('agnt:appearance-background');
    expect(dispatchGlobalFrontendEvent('widget:saved', { id: 1 })).toBe(false);
    expect(received).toEqual([]);
  });

  // The guard exists so a failure in the delivery layer cannot kill the SSE
  // reducer mid-run — the rest of the turn (message content, tool results)
  // must keep arriving even if the window refuses the event.
  it('reports failure instead of throwing when dispatch itself fails', () => {
    const spy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {
      throw new Error('dispatch exploded');
    });
    let result;
    expect(() => { result = dispatchGlobalFrontendEvent('tutorial:start', { steps: [] }); }).not.toThrow();
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalled();
    spy.mockRestore();
  });

  describe('dispatchGlobalFrontendEvents (tool-result array)', () => {
    it('splits global events to the window and the rest to the callback', () => {
      listen('agnt:appearance-background');
      const onNonGlobal = vi.fn();

      dispatchGlobalFrontendEvents([
        { type: 'appearance:background', data: { url: '/x.png' } },
        { type: 'widget:saved', data: { id: 'w1' } },
      ], onNonGlobal);

      expect(received).toHaveLength(1);
      expect(onNonGlobal).toHaveBeenCalledTimes(1);
      expect(onNonGlobal).toHaveBeenCalledWith('widget:saved', { id: 'w1' });
    });

    it('tolerates junk entries and a non-array argument', () => {
      const onNonGlobal = vi.fn();
      expect(() => dispatchGlobalFrontendEvents(null, onNonGlobal)).not.toThrow();
      expect(() => dispatchGlobalFrontendEvents([null, {}, { type: 7 }], onNonGlobal)).not.toThrow();
      expect(onNonGlobal).not.toHaveBeenCalled();
    });

    it('keeps processing after a throwing non-global handler', () => {
      listen('agnt:appearance-background');
      const onNonGlobal = vi.fn(() => { throw new Error('consumer exploded'); });

      expect(() => dispatchGlobalFrontendEvents([
        { type: 'widget:saved', data: {} },
        { type: 'appearance:background', data: { url: '/x.png' } },
      ], onNonGlobal)).not.toThrow();

      expect(received).toHaveLength(1);
    });
  });
});
