import { describe, it, expect } from 'vitest';
import { createTurnGate, VoiceState, Effect, DEFAULT_GATE_CONFIG } from './turnGate.js';

/** Drive the gate and return the effects emitted. */
const fx = (r) => r.effects;

describe('turnGate — session lifecycle', () => {
  it('starts idle', () => {
    const g = createTurnGate();
    expect(g.state).toBe(VoiceState.IDLE);
  });

  it('start opens capture immediately when no wake word is configured', () => {
    const g = createTurnGate();
    const r = g.send({ type: 'start', now: 0 });
    expect(r.state).toBe(VoiceState.LISTENING);
    expect(fx(r)).toContain(Effect.START_CAPTURE);
  });

  it('start arms the wake detector when wakeWord is on', () => {
    const g = createTurnGate({ wakeWord: true });
    const r = g.send({ type: 'start', now: 0 });
    expect(r.state).toBe(VoiceState.WAKE_WAIT);
    expect(fx(r)).toContain(Effect.ARM_WAKE);
    expect(fx(r)).not.toContain(Effect.START_CAPTURE);
  });

  it('wake transitions to listening and disarms the detector', () => {
    const g = createTurnGate({ wakeWord: true });
    g.send({ type: 'start', now: 0 });
    const r = g.send({ type: 'wake', now: 100 });
    expect(r.state).toBe(VoiceState.LISTENING);
    expect(fx(r)).toEqual(expect.arrayContaining([Effect.DISARM_WAKE, Effect.START_CAPTURE]));
  });

  it('ignores wake when not waiting for one', () => {
    const g = createTurnGate();
    g.send({ type: 'start', now: 0 });
    const before = g.state;
    g.send({ type: 'wake', now: 10 });
    expect(g.state).toBe(before);
  });

  it('stop cancels everything and returns to idle', () => {
    const g = createTurnGate();
    g.send({ type: 'start', now: 0 });
    const r = g.send({ type: 'stop', now: 50 });
    expect(r.state).toBe(VoiceState.IDLE);
    expect(fx(r)).toEqual(
      expect.arrayContaining([Effect.STOP_CAPTURE, Effect.CANCEL_PLAYBACK, Effect.CANCEL_REQUEST, Effect.SESSION_END])
    );
  });
});

describe('turnGate — the reopen window', () => {
  function toReopen(g, text = 'open the auth file') {
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'speech_start', now: 10 });
    g.send({ type: 'transcript', now: 100, text });
    return g.send({ type: 'endpoint', now: 200 });
  }

  it('an endpoint does NOT commit — it opens the reopen window', () => {
    const g = createTurnGate();
    const r = toReopen(g);
    expect(r.state).toBe(VoiceState.REOPEN);
    expect(fx(r)).toContain(Effect.STOP_CAPTURE);
    expect(fx(r)).not.toContain(Effect.COMMIT_TURN);
  });

  it('commits only after the window expires with no new speech', () => {
    const g = createTurnGate({ reopenMs: 600 });
    toReopen(g);

    const early = g.send({ type: 'tick', now: 700 }); // 500ms in
    expect(early.state).toBe(VoiceState.REOPEN);
    expect(fx(early)).not.toContain(Effect.COMMIT_TURN);

    const late = g.send({ type: 'tick', now: 801 }); // 601ms in
    expect(late.state).toBe(VoiceState.THINKING);
    expect(fx(late)).toContain(Effect.COMMIT_TURN);
  });

  it('THE CORE BEHAVIOUR: speech inside the window rejoins the same turn', () => {
    const g = createTurnGate({ reopenMs: 600 });
    toReopen(g);
    const turnBefore = g.turnId;

    const r = g.send({ type: 'speech_start', now: 500 }); // 300ms into the window
    expect(r.state).toBe(VoiceState.LISTENING);
    expect(fx(r)).toContain(Effect.APPEND_CAPTURE);
    expect(fx(r)).not.toContain(Effect.START_CAPTURE); // NOT a new turn
    expect(g.turnId).toBe(turnBefore); // same turn id — nothing was committed
  });

  it('preserves the accumulated transcript across a reopen', () => {
    const g = createTurnGate({ reopenMs: 600 });
    toReopen(g, 'open the auth file');
    g.send({ type: 'speech_start', now: 400 });
    g.send({ type: 'transcript', now: 600, text: 'open the auth file no wait the session one' });
    const r = g.send({ type: 'endpoint', now: 800 });
    expect(r.state).toBe(VoiceState.REOPEN);
    expect(g.transcript).toBe('open the auth file no wait the session one');
  });

  it('an endpoint with no speech heard is ignored (room noise, not a turn)', () => {
    const g = createTurnGate();
    g.send({ type: 'start', now: 0 });
    // No speech_start, no transcript — nothing happened.
    const r = g.send({ type: 'endpoint', now: 200 });
    expect(r.state).toBe(VoiceState.LISTENING);
  });

  it('REGRESSION: endpoints on heard speech even when no transcript has arrived', () => {
    /**
     * The guard used to be `if (!transcript.trim()) return` — "an empty
     * transcript means room noise". That is only true with STREAMING
     * recognition. With batch transcription the transcript is empty at endpoint
     * time BY CONSTRUCTION: recording must stop before there is anything to
     * transcribe, and endpointing is what stops it. The guard therefore refused
     * every single turn, and the assistant listened forever without ever
     * answering. Unit tests missed it because they inject `transcript`
     * directly; only the wired integration exposed it.
     */
    const g = createTurnGate();
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'speech_start', now: 10 });
    expect(g.sawSpeech).toBe(true);

    const r = g.send({ type: 'endpoint', now: 800 });
    expect(r.state).toBe(VoiceState.REOPEN);
    expect(fx(r)).toContain(Effect.STOP_CAPTURE);
  });

  it('clears the speech flag when a new turn begins', () => {
    const g = createTurnGate();
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'speech_start', now: 10 });
    g.send({ type: 'transcript', now: 20, text: 'do the thing' });
    g.send({ type: 'endpoint', now: 800 });
    g.send({ type: 'tick', now: 1500 });
    g.send({ type: 'reply_start', now: 1600 });
    g.send({ type: 'reply_end', now: 3000 });
    expect(g.sawSpeech).toBe(false);
  });

  it('endpoint is ignored outside LISTENING', () => {
    const g = createTurnGate();
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'transcript', now: 10, text: 'hello there' });
    g.send({ type: 'endpoint', now: 20 });
    const again = g.send({ type: 'endpoint', now: 30 });
    expect(again.state).toBe(VoiceState.REOPEN);
  });
});

describe('turnGate — self-correction, end to end', () => {
  /**
   * The scenario the whole design exists for, driven through the real machine:
   *
   *   "open the auth file"  <pause>  "no wait, the session one"
   *
   * The endpointer legitimately fires after "open the auth file" — it looks
   * like a finished imperative. Committing there would open the WRONG FILE and
   * strand the correction as a contextless second turn. The reopen window is
   * what makes the premature endpoint harmless.
   */
  it('a premature endpoint does not destroy the thought', () => {
    const g = createTurnGate({ reopenMs: 600 });
    const committed = [];

    const step = (e) => {
      const r = g.send(e);
      if (r.effects.includes(Effect.COMMIT_TURN)) committed.push(r.transcript);
      return r;
    };

    step({ type: 'start', now: 0 });
    step({ type: 'speech_start', now: 100 });
    step({ type: 'transcript', now: 900, text: 'open the auth file' });
    step({ type: 'endpoint', now: 1100 }); // premature but plausible
    expect(committed).toEqual([]); // nothing acted on yet

    step({ type: 'speech_start', now: 1400 }); // 300ms into the window
    step({ type: 'transcript', now: 2000, text: 'open the auth file no wait the session one' });
    step({ type: 'endpoint', now: 2200 });
    step({ type: 'tick', now: 2900 }); // window expires for real

    expect(committed).toEqual(['open the auth file no wait the session one']);
    expect(committed).toHaveLength(1); // exactly one turn, not two
  });
});

describe('turnGate — barge-in', () => {
  function toSpeaking(g) {
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'transcript', now: 100, text: 'tell me about the repo' });
    g.send({ type: 'endpoint', now: 200 });
    g.send({ type: 'tick', now: 900 });
    return g.send({ type: 'reply_start', now: 1000 });
  }

  it('enters SPEAKING when the reply begins', () => {
    const g = createTurnGate();
    const r = toSpeaking(g);
    expect(r.state).toBe(VoiceState.SPEAKING);
  });

  it('cancels playback and the request on sustained speech', () => {
    const g = createTurnGate({ bargeInGraceMs: 250, bargeInMinSpeechMs: 120 });
    toSpeaking(g);

    g.send({ type: 'speech_start', now: 1400 });
    const r = g.send({ type: 'tick', now: 1500, speechMs: 150 });

    expect(r.state).toBe(VoiceState.LISTENING);
    expect(fx(r)).toEqual(
      expect.arrayContaining([Effect.CANCEL_PLAYBACK, Effect.CANCEL_REQUEST, Effect.START_CAPTURE])
    );
  });

  it('the grace period stops our own first word from self-interrupting', () => {
    const g = createTurnGate({ bargeInGraceMs: 250, bargeInMinSpeechMs: 120 });
    toSpeaking(g); // playback started at now=1000

    const r = g.send({ type: 'tick', now: 1100, speechMs: 200 }); // only 100ms in
    expect(r.state).toBe(VoiceState.SPEAKING);
    expect(fx(r)).not.toContain(Effect.CANCEL_PLAYBACK);
  });

  it('a cough is not a barge-in', () => {
    const g = createTurnGate({ bargeInGraceMs: 250, bargeInMinSpeechMs: 120 });
    toSpeaking(g);
    const r = g.send({ type: 'tick', now: 1600, speechMs: 60 });
    expect(r.state).toBe(VoiceState.SPEAKING);
  });

  it('interrupting during THINKING (before any audio) also cancels', () => {
    const g = createTurnGate({ bargeInMinSpeechMs: 120 });
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'transcript', now: 100, text: 'tell me about the repo' });
    g.send({ type: 'endpoint', now: 200 });
    g.send({ type: 'tick', now: 900 });
    expect(g.state).toBe(VoiceState.THINKING);

    const r = g.send({ type: 'tick', now: 1000, speechMs: 200 });
    expect(r.state).toBe(VoiceState.LISTENING);
    expect(fx(r)).toContain(Effect.CANCEL_REQUEST);
  });

  it('bumps the turn id so a superseded reply can be discarded', () => {
    const g = createTurnGate();
    toSpeaking(g);
    const before = g.turnId;
    g.send({ type: 'speech_start', now: 1400 });
    g.send({ type: 'tick', now: 1500, speechMs: 150 });
    expect(g.turnId).toBeGreaterThan(before);
  });

  it('clears the transcript so the interruption starts clean', () => {
    const g = createTurnGate();
    toSpeaking(g);
    g.send({ type: 'tick', now: 1500, speechMs: 150 });
    expect(g.transcript).toBe('');
  });

  it('isInterruptible is true exactly while a turn is in flight', () => {
    const g = createTurnGate();
    expect(g.isInterruptible()).toBe(false);
    g.send({ type: 'start', now: 0 });
    expect(g.isInterruptible()).toBe(false);
    g.send({ type: 'transcript', now: 10, text: 'hello there friend' });
    g.send({ type: 'endpoint', now: 20 });
    g.send({ type: 'tick', now: 700 });
    expect(g.isInterruptible()).toBe(true); // THINKING
    g.send({ type: 'reply_start', now: 800 });
    expect(g.isInterruptible()).toBe(true); // SPEAKING
  });
});

describe('turnGate — continuous vs one-shot', () => {
  it('continuous mode listens again after a reply', () => {
    const g = createTurnGate({ continuous: true });
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'transcript', now: 10, text: 'what time is it' });
    g.send({ type: 'endpoint', now: 20 });
    g.send({ type: 'tick', now: 700 });
    g.send({ type: 'reply_start', now: 800 });
    const r = g.send({ type: 'reply_end', now: 3000 });

    expect(r.state).toBe(VoiceState.LISTENING);
    expect(fx(r)).toContain(Effect.START_CAPTURE);
  });

  it('one-shot mode returns to the wake detector after a reply (the Hermes model)', () => {
    const g = createTurnGate({ continuous: false, wakeWord: true });
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'wake', now: 10 });
    g.send({ type: 'transcript', now: 20, text: 'what time is it' });
    g.send({ type: 'endpoint', now: 30 });
    g.send({ type: 'tick', now: 700 });
    g.send({ type: 'reply_start', now: 800 });
    const r = g.send({ type: 'reply_end', now: 3000 });

    expect(r.state).toBe(VoiceState.WAKE_WAIT);
    expect(fx(r)).toContain(Effect.ARM_WAKE);
  });

  it('one-shot without a wake word ends the session after a reply', () => {
    const g = createTurnGate({ continuous: false, wakeWord: false });
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'transcript', now: 10, text: 'what time is it' });
    g.send({ type: 'endpoint', now: 20 });
    g.send({ type: 'tick', now: 700 });
    const r = g.send({ type: 'request_done', now: 2000 });
    expect(r.state).toBe(VoiceState.IDLE);
    expect(fx(r)).toContain(Effect.SESSION_END);
  });
});

describe('turnGate — idle timeout', () => {
  it('closes an abandoned hands-free session', () => {
    const g = createTurnGate({ idleTimeoutMs: 5000 });
    g.send({ type: 'start', now: 0 });
    const r = g.send({ type: 'tick', now: 5001 });
    expect(r.state).toBe(VoiceState.IDLE);
    expect(fx(r)).toContain(Effect.SESSION_END);
  });

  it('speech resets the idle clock', () => {
    const g = createTurnGate({ idleTimeoutMs: 5000 });
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'speech_start', now: 4000 });
    const r = g.send({ type: 'tick', now: 8000 });
    expect(r.state).toBe(VoiceState.LISTENING);
  });

  it('idleTimeoutMs = 0 disables the timeout', () => {
    const g = createTurnGate({ idleTimeoutMs: 0 });
    g.send({ type: 'start', now: 0 });
    const r = g.send({ type: 'tick', now: 10 ** 7 });
    expect(r.state).toBe(VoiceState.LISTENING);
  });

  it('does not time out while thinking or speaking', () => {
    const g = createTurnGate({ idleTimeoutMs: 1000 });
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'transcript', now: 10, text: 'run the whole suite' });
    g.send({ type: 'endpoint', now: 20 });
    g.send({ type: 'tick', now: 700 });
    expect(g.state).toBe(VoiceState.THINKING);
    // A long tool run must not close the session.
    const r = g.send({ type: 'tick', now: 60000 });
    expect(r.state).toBe(VoiceState.THINKING);
  });
});

describe('turnGate — robustness', () => {
  it('ignores unknown events', () => {
    const g = createTurnGate();
    g.send({ type: 'start', now: 0 });
    const r = g.send({ type: 'not-a-real-event', now: 10 });
    expect(r.state).toBe(VoiceState.LISTENING);
  });

  it('tolerates a missing now', () => {
    const g = createTurnGate();
    expect(() => g.send({ type: 'start' })).not.toThrow();
    expect(() => g.send({ type: 'tick' })).not.toThrow();
  });

  it('tolerates an empty event', () => {
    const g = createTurnGate();
    expect(() => g.send()).not.toThrow();
    expect(g.state).toBe(VoiceState.IDLE);
  });

  it('exposes its resolved config', () => {
    const g = createTurnGate({ reopenMs: 999 });
    expect(g.config.reopenMs).toBe(999);
    expect(g.config.bargeInGraceMs).toBe(DEFAULT_GATE_CONFIG.bargeInGraceMs);
  });

  it('abort returns to listening without ending the session', () => {
    const g = createTurnGate({ continuous: true });
    g.send({ type: 'start', now: 0 });
    g.send({ type: 'transcript', now: 10, text: 'do the thing' });
    g.send({ type: 'endpoint', now: 20 });
    g.send({ type: 'tick', now: 700 });
    const r = g.send({ type: 'abort', now: 800 });
    expect(r.state).toBe(VoiceState.LISTENING);
    expect(fx(r)).toContain(Effect.CANCEL_REQUEST);
    expect(fx(r)).not.toContain(Effect.SESSION_END);
  });
});
