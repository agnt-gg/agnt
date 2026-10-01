// WHICH BROWSER CARD OWNS THE LIVE STREAM.
//
// A conversation accumulates browser steps and every one renders a card. If
// each subscribed, one browsing turn would leave a dozen live screencasts in
// the transcript, all of the same browser, each holding a viewer ref-count.
// Ack-on-paint makes that quieter and worse: an offscreen card stalls its own
// stream instead of failing, so the user would see several cards frozen at
// different moments of one session with nothing marking which is current.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  claimLiveView, releaseLiveView, ownsLiveView, activeLiveKey, _resetLiveRegistry,
} from './browserLiveRegistry.js';

beforeEach(() => _resetLiveRegistry());

describe('the newest card owns the stream', () => {
  it('gives it to the first claimant when nothing holds it', () => {
    expect(claimLiveView('a', 100)).toBe(true);
    expect(ownsLiveView('a')).toBe(true);
    expect(activeLiveKey.value).toBe('a');
  });

  it('hands it over to a NEWER card', () => {
    claimLiveView('a', 100);
    expect(claimLiveView('b', 200)).toBe(true);
    expect(ownsLiveView('b')).toBe(true);
    expect(ownsLiveView('a')).toBe(false);
  });

  it('REFUSES an older card — scrolling up must not steal the stream', () => {
    // The regression this pins: a virtualised transcript re-mounts old cards
    // as the user scrolls. With mount-order arbitration, scrolling up would
    // hand the live view to a card from ten minutes ago.
    claimLiveView('b', 200);
    expect(claimLiveView('a', 100)).toBe(false);
    expect(ownsLiveView('b')).toBe(true);
  });

  it('lets a card re-claim its own place at the same order', () => {
    // A re-mount of the CURRENT card (a re-render, a chunk reload) must not
    // leave the transcript with no live view.
    claimLiveView('b', 200);
    expect(claimLiveView('b', 200)).toBe(true);
    expect(ownsLiveView('b')).toBe(true);
  });

  it('ignores a claim with no key', () => {
    expect(claimLiveView('', 999)).toBe(false);
    expect(activeLiveKey.value).toBeNull();
  });
});

describe('giving it up', () => {
  it('releases when the holder unmounts', () => {
    claimLiveView('a', 100);
    releaseLiveView('a');
    expect(activeLiveKey.value).toBeNull();
    expect(ownsLiveView('a')).toBe(false);
  });

  it('a non-holder unmounting changes nothing', () => {
    claimLiveView('b', 200);
    releaseLiveView('a');
    expect(ownsLiveView('b')).toBe(true);
  });

  it('a LOWER-ordered card can claim after a release — conversations switch', () => {
    // Switching conversations unmounts every card, and the next
    // conversation's cards may carry lower orders than the ones just torn
    // down. Keeping the old high-water mark would mean nothing could ever
    // claim again, and the feature would silently stop working.
    claimLiveView('old', 9999);
    releaseLiveView('old');
    expect(claimLiveView('new', 5)).toBe(true);
    expect(ownsLiveView('new')).toBe(true);
  });

  it('nobody owns it when nothing has claimed', () => {
    expect(ownsLiveView('a')).toBe(false);
    expect(ownsLiveView(null)).toBe(false);
  });

  it('HANDS OVER to the next-highest card still mounted', () => {
    // A virtualised transcript reclaims rows as the user scrolls, so the owner
    // can vanish while older cards are still on screen. Without a handover the
    // live view would disappear entirely and nothing could take it — the
    // remaining cards only claim once, at mount.
    claimLiveView('old', 100);
    claimLiveView('mid', 200);
    claimLiveView('new', 300);
    expect(ownsLiveView('new')).toBe(true);

    releaseLiveView('new');
    expect(ownsLiveView('mid')).toBe(true);

    releaseLiveView('mid');
    expect(ownsLiveView('old')).toBe(true);

    releaseLiveView('old');
    expect(activeLiveKey.value).toBeNull();
  });

  it('re-mounting an older card does not disturb the owner', () => {
    claimLiveView('new', 300);
    // Scrolling back up re-mounts an older card; it registers but must not win.
    expect(claimLiveView('old', 100)).toBe(false);
    expect(ownsLiveView('new')).toBe(true);
  });
});

describe('one owner PER CONVERSATION', () => {
  // Each conversation has its own browser tab. Two chats on screen at once
  // must each stream their own; one app-wide owner left one of them blank.
  it('the newest card of EACH conversation owns that conversation\'s stream', () => {
    claimLiveView('a-old', 100, 'conv-a');
    claimLiveView('a-new', 200, 'conv-a');
    claimLiveView('b-only', 50, 'conv-b');
    expect(ownsLiveView('a-new')).toBe(true);
    expect(ownsLiveView('a-old')).toBe(false);
    expect(ownsLiveView('b-only')).toBe(true);
  });

  it('a newer card in one conversation never takes another conversation\'s stream', () => {
    claimLiveView('b', 50, 'conv-b');
    claimLiveView('a', 9999, 'conv-a');
    expect(ownsLiveView('b')).toBe(true);
  });

  it('hands over within its own conversation only', () => {
    claimLiveView('a1', 100, 'conv-a');
    claimLiveView('a2', 200, 'conv-a');
    claimLiveView('b1', 300, 'conv-b');
    releaseLiveView('a2');
    expect(ownsLiveView('a1')).toBe(true);
    expect(ownsLiveView('b1')).toBe(true);
  });

  it('cards with no conversation keep the old single default group', () => {
    claimLiveView('x', 1);
    expect(activeLiveKey.value).toBe('x');
    claimLiveView('y', 2, 'conv-a');
    expect(activeLiveKey.value).toBe('x');
  });
});
