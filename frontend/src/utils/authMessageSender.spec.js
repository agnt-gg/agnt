/**
 * Sender identity for a message that can complete a sign-in.
 *
 * The origin check cannot settle this one: AGNT renders authored artifact and
 * widget HTML in iframes carrying `allow-scripts allow-same-origin`, so that
 * content runs at the real origin and passes any origin test by construction.
 */

import { describe, it, expect } from 'vitest';
import { isTrustedAuthMessageSender } from './authMessageSender.js';

const ORIGIN = 'https://tenant.example.com';

describe('when we hold the popup handle', () => {
  const popup = { name: 'the popup we opened' };
  const win = { location: { origin: ORIGIN } };

  it('accepts the window we opened', () => {
    expect(isTrustedAuthMessageSender({ source: popup }, popup, win)).toBe(true);
  });

  it('refuses anything else', () => {
    const artifact = { name: 'an allow-same-origin srcdoc iframe' };
    expect(isTrustedAuthMessageSender({ source: artifact }, popup, win)).toBe(false);
  });

  it('refuses a missing event outright', () => {
    expect(isTrustedAuthMessageSender(undefined, popup, win)).toBe(false);
    expect(isTrustedAuthMessageSender(null, popup, win)).toBe(false);
  });
});

/**
 * `window.open` returns null when the browser BLOCKS the popup — the default
 * on first use, and therefore exactly when a user is most likely to be
 * clicking the button again. A check conditioned on the handle does not run at
 * all in that state, and every sender is believed.
 */
describe('when the popup was blocked, so there is no handle', () => {
  it('refuses a direct child frame', () => {
    const artifact = { name: 'an artifact iframe' };
    const win = { location: { origin: ORIGIN }, frames: { length: 1, 0: artifact } };

    expect(isTrustedAuthMessageSender({ source: artifact }, null, win)).toBe(false);
  });

  it('refuses a NESTED frame, which posts to top with itself as source', () => {
    const nested = { name: 'an iframe inside a widget' };
    const widget = { name: 'the widget', frames: { length: 1, 0: nested } };
    const win = { location: { origin: ORIGIN }, frames: { length: 1, 0: widget } };

    expect(isTrustedAuthMessageSender({ source: nested }, null, win)).toBe(false);
  });

  it('still abstains for a sender it cannot place', () => {
    // The sign-in has to keep working for anyone whose embedder hands back a
    // window we cannot match by reference. Refuse what is identified; abstain
    // on what cannot be seen.
    const win = { location: { origin: ORIGIN }, frames: { length: 0 } };

    expect(isTrustedAuthMessageSender({ source: { a: 'popup' } }, null, win)).toBe(true);
  });

  it('abstains when a cross-origin child cannot be inspected', () => {
    const win = {
      location: { origin: ORIGIN },
      frames: {
        length: 1,
        get 0() {
          throw new Error('cross-origin frame access');
        },
      },
    };

    expect(isTrustedAuthMessageSender({ source: { a: 'window' } }, null, win)).toBe(true);
  });
});

describe('the walk is bounded', () => {
  it('terminates on a frame tree deeper than it will walk', () => {
    let deepest = { name: 'the deepest frame' };
    const target = deepest;
    for (let i = 0; i < 12; i += 1) deepest = { frames: { length: 1, 0: deepest } };
    const win = { location: { origin: ORIGIN }, frames: deepest.frames };

    expect(isTrustedAuthMessageSender({ source: target }, null, win)).toBe(true);
  });

  it('does not blow the stack on a frame tree that contains itself', () => {
    const cyclic = { location: { origin: ORIGIN } };
    cyclic.frames = { length: 1, 0: cyclic };

    expect(() => isTrustedAuthMessageSender({ source: { a: 'w' } }, null, cyclic)).not.toThrow();
  });

  it('survives a window with no frames collection at all', () => {
    expect(isTrustedAuthMessageSender({ source: { a: 'w' } }, null, {})).toBe(true);
    expect(isTrustedAuthMessageSender({ source: { a: 'w' } }, null, undefined)).toBe(true);
  });
});
