/**
 * The voice floor, on its own.
 *
 * voiceExclusivity.spec.js proves the BEHAVIOUR through the real composable.
 * This file pins the primitive's edges — the ones that are invisible until
 * they strand the feature: a stale release stealing the floor from a live
 * session, and a holder that throws on the way out taking the new session
 * down with it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  claimVoiceFloor,
  releaseVoiceFloor,
  voiceFloorTicket,
  isVoiceFloorHeld,
} from './voiceFloor.js';

beforeEach(() => {
  // Leave no holder behind for the next test: claim it and release it.
  releaseVoiceFloor(claimVoiceFloor(() => {}));
});

describe('voiceFloor', () => {
  it('starts free', () => {
    expect(voiceFloorTicket()).toBeNull();
  });

  describe('isVoiceFloorHeld — "is a microphone open right now?"', () => {
    /**
     * Asked by the notification sound, which is not a voice host and has no
     * other way to know. Playing a chime into a live microphone makes the
     * Realtime server hear speech and cut the assistant off mid-sentence.
     */
    it('is false with no session', () => {
      expect(isVoiceFloorHeld()).toBe(false);
    });

    it('is true while a session holds the floor', () => {
      claimVoiceFloor(() => {});
      expect(isVoiceFloorHeld()).toBe(true);
    });

    it('is false again once released', () => {
      releaseVoiceFloor(claimVoiceFloor(() => {}));
      expect(isVoiceFloorHeld()).toBe(false);
    });

    it('stays true across an eviction — the mic never actually closed', () => {
      // Two hosts handing the floor between them is still one open microphone.
      // A naive "release then claim" reading would report a gap that does not
      // exist and let a chime through in the middle of a handover.
      const first = claimVoiceFloor(() => releaseVoiceFloor(first));
      claimVoiceFloor(() => {});
      expect(isVoiceFloorHeld()).toBe(true);
    });

    it('agrees with voiceFloorTicket at all times', () => {
      // Two answers to one question is how they drift. This pins them together
      // so a future change cannot make the sound guard and the eviction logic
      // disagree about whether a session is live.
      expect(isVoiceFloorHeld()).toBe(voiceFloorTicket() !== null);
      const ticket = claimVoiceFloor(() => {});
      expect(isVoiceFloorHeld()).toBe(voiceFloorTicket() !== null);
      releaseVoiceFloor(ticket);
      expect(isVoiceFloorHeld()).toBe(voiceFloorTicket() !== null);
    });
  });

  it('a claim takes the floor', () => {
    const ticket = claimVoiceFloor(() => {});
    expect(voiceFloorTicket()).toBe(ticket);
  });

  it('a second claim stops the first holder', () => {
    const stopA = vi.fn();
    claimVoiceFloor(stopA);
    claimVoiceFloor(() => {});
    expect(stopA).toHaveBeenCalledTimes(1);
  });

  it('an evicted session releasing on its way out does not free the new one', () => {
    // THE BUG THIS EXISTS FOR: the evicted session's stop() calls
    // releaseVoiceFloor on its way out. If release were a bare "holder = null"
    // the incoming session would be left holding nothing, and the next claim
    // would find no one to evict — two live sessions again, one claim later.
    // What prevents that is the TICKET COMPARISON in releaseVoiceFloor, which
    // is what this drives.
    let ticketA;
    ticketA = claimVoiceFloor(() => releaseVoiceFloor(ticketA));
    const ticketB = claimVoiceFloor(() => {});
    expect(voiceFloorTicket()).toBe(ticketB);
  });

  it('releasing a ticket that no longer holds the floor does nothing', () => {
    const ticketA = claimVoiceFloor(() => {});
    const ticketB = claimVoiceFloor(() => {});
    releaseVoiceFloor(ticketA);
    expect(voiceFloorTicket()).toBe(ticketB);
  });

  it('releasing the current ticket frees the floor', () => {
    const ticket = claimVoiceFloor(() => {});
    releaseVoiceFloor(ticket);
    expect(voiceFloorTicket()).toBeNull();
  });

  it('tickets are never reused, so a late release cannot alias a live one', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(claimVoiceFloor(() => {}));
    expect(seen.size).toBe(50);
  });

  it('a holder that throws on the way out does not block the new session', () => {
    claimVoiceFloor(() => {
      throw new Error('teardown exploded');
    });
    const ticket = claimVoiceFloor(() => {});
    expect(voiceFloorTicket()).toBe(ticket);
  });

  it('tolerates a claim with no stop function', () => {
    claimVoiceFloor(null);
    expect(() => claimVoiceFloor(() => {})).not.toThrow();
  });
});
