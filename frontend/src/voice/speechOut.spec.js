import { describe, it, expect, vi } from 'vitest';
import { createSpeechOut, OutputState } from './speechOut.js';

/**
 * A controllable stand-in for window.speechSynthesis. Utterances do not finish
 * until the test says so, which is what lets us drive the interruption race
 * deterministically instead of hoping a timer lands the right way.
 */
function makeSynth() {
  const spoken = [];
  let pending = [];
  return {
    spoken,
    speak(u) {
      spoken.push(u.text);
      pending.push(u);
    },
    cancel() {
      for (const u of pending) u.onerror?.({ error: 'interrupted' });
      pending = [];
    },
    /** Finish the oldest in-flight utterance. */
    finishOne() {
      const u = pending.shift();
      u?.onend?.();
    },
    finishAll() {
      const all = pending;
      pending = [];
      for (const u of all) u.onend?.();
    },
    get inFlight() {
      return pending.length;
    },
  };
}

class FakeUtterance {
  constructor(text) {
    this.text = text;
  }
}

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

/**
 * Let the playback chain advance, completing any utterance the fake synth is
 * holding. Counting microtasks by hand is brittle — the chain's internal hop
 * count is an implementation detail, and asserting on it makes unrelated
 * refactors fail. Drain until quiet instead.
 */
async function drain(synth, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 1));
    synth.finishAll();
  }
}

/** Advance microtasks without completing anything. */
async function tick(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function build(overrides = {}, depOverrides = {}) {
  const synth = makeSynth();
  const clock = makeClock();
  const out = createSpeechOut(
    { engine: 'webspeech', ...overrides },
    { speechSynthesis: synth, SpeechSynthesisUtterance: FakeUtterance, now: clock.now, ...depOverrides }
  );
  return { out, synth, clock };
}

describe('speechOut — basic playback', () => {
  it('starts idle', () => {
    const { out } = build();
    expect(out.state).toBe(OutputState.IDLE);
    expect(out.isSpeaking).toBe(false);
  });

  it('speaks a chunk', async () => {
    const { out, synth } = build();
    const p = out.speak('Hello there.');
    await Promise.resolve();
    await Promise.resolve();
    expect(synth.spoken).toEqual(['Hello there.']);
    synth.finishAll();
    await p;
  });

  it('ignores empty text', async () => {
    const { out, synth } = build();
    await out.speak('');
    await out.speak('   ');
    await out.speak(null);
    expect(synth.spoken).toEqual([]);
  });

  it('serialises chunks so they never overlap', async () => {
    const { out, synth } = build();
    out.speak('First sentence.');
    out.speak('Second sentence.');
    await tick();

    // The second chunk must NOT start while the first is still in flight.
    expect(synth.spoken).toEqual(['First sentence.']);
    expect(synth.inFlight).toBe(1);

    await drain(synth);
    expect(synth.spoken).toEqual(['First sentence.', 'Second sentence.']);
  });

  it('reports SPEAKING while audio is in flight and IDLE after', async () => {
    const { out, synth } = build();
    const states = [];
    out.on('state', (s) => states.push(s));

    const p = out.speak('Something to say.');
    await Promise.resolve();
    await Promise.resolve();
    expect(out.state).toBe(OutputState.SPEAKING);

    synth.finishAll();
    await p;
    expect(states).toContain(OutputState.SPEAKING);
    expect(out.state).toBe(OutputState.IDLE);
  });
});

describe('speechOut — cancellation (the barge-in path)', () => {
  it('cancel stops playback immediately', async () => {
    const { out, synth } = build();
    out.speak('A long sentence that is being spoken right now.');
    await Promise.resolve();
    await Promise.resolve();
    expect(synth.inFlight).toBe(1);

    out.cancel();
    expect(synth.inFlight).toBe(0);
    expect(out.state).toBe(OutputState.IDLE);
  });

  it('cancel drops everything still queued', async () => {
    const { out, synth } = build();
    out.speak('First sentence here.');
    out.speak('Second sentence here.');
    out.speak('Third sentence here.');
    await Promise.resolve();
    await Promise.resolve();

    const result = out.cancel();
    expect(result.discarded).toContain('Second sentence here.');
    expect(result.discarded).toContain('Third sentence here.');

    // And nothing further is ever spoken.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(synth.spoken).toEqual(['First sentence here.']);
  });

  it('reports what was actually heard, not what was generated', async () => {
    const { out, synth, clock } = build();
    out.speak('one two three four five six seven eight');
    await Promise.resolve();
    await Promise.resolve();

    clock.advance(1000); // partway through
    const result = out.cancel();

    expect(result.spoken.length).toBeGreaterThan(0);
    expect('one two three four five six seven eight').toContain(result.spoken);
    expect(result.spoken.length).toBeLessThan('one two three four five six seven eight'.length);
    void synth;
  });

  it('THE RACE: a synthesis resolving after cancel does not start playing', async () => {
    // A provider request in flight when the user interrupts will still resolve.
    // Without a generation check it happily plays audio the user cancelled.
    let releaseFetch;
    const gate = new Promise((r) => {
      releaseFetch = r;
    });
    const played = [];

    const { out } = build(
      { engine: 'provider' },
      {
        fetch: async () => {
          await gate;
          return {
            ok: true,
            headers: { get: () => 'audio/mpeg' },
            blob: async () => new Blob(['x']),
          };
        },
        createAudio: (src) => {
          played.push(src);
          return { play: () => Promise.resolve(), pause() {}, volume: 1 };
        },
      }
    );

    out.speak('This should never be heard.');
    await Promise.resolve();
    await Promise.resolve();

    out.cancel(); // user interrupts while the request is still open
    releaseFetch();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(played).toEqual([]);
  });

  it('a chunk queued before a cancel never even enters the speaking state', async () => {
    // Guards the generation check at the ENTRY to the playback chain,
    // independently of the per-engine checks further down. Without it a
    // cancelled chunk still flips the UI to "speaking" while nothing plays.
    const { out, synth } = build();
    out.speak('First chunk being spoken.');
    out.speak('Second chunk still queued.');
    await tick();

    out.cancel();
    expect(out.state).toBe(OutputState.IDLE);

    await drain(synth);
    expect(out.state).toBe(OutputState.IDLE);
    expect(synth.spoken).toEqual(['First chunk being spoken.']);
  });

  it('cancel is safe when nothing is playing', () => {
    const { out } = build();
    expect(() => out.cancel()).not.toThrow();
    const r = out.cancel();
    expect(r.spoken).toBe('');
  });

  it('speech after a cancel works normally', async () => {
    const { out, synth } = build();
    out.speak('Interrupted sentence.');
    await Promise.resolve();
    out.cancel();

    const p = out.speak('A fresh sentence.');
    await Promise.resolve();
    await Promise.resolve();
    expect(synth.spoken).toContain('A fresh sentence.');
    synth.finishAll();
    await p;
  });
});

describe('speechOut — provider engine and fallback', () => {
  /**
   * Object-URL support is AMBIENT STATE, so these tests set it explicitly
   * rather than inheriting whatever the runtime happens to provide.
   *
   * This helper originally only STUBBED the function, on the assumption that
   * jsdom does not implement it. jsdom does (measured: hasOwnProperty true,
   * typeof function). So the sibling test below — "falls back when the runtime
   * has no object URLs" — was not testing absence at all; it inherited a real
   * implementation, took the provider path, and hung on a jsdom <audio> that
   * never fires `onended`. It passed or failed depending on what else ran in
   * the same worker, which makes it not a test.
   *
   * `withObjectUrl(present, fn)` forces the world into the state the test
   * claims to be describing, and restores exactly what was there before.
   */
  function withObjectUrl(present, fn) {
    const prevCreate = URL.createObjectURL;
    const prevRevoke = URL.revokeObjectURL;

    // Absence is expressed by ASSIGNING undefined, not by `delete`. jsdom
    // defines these as non-configurable, so `delete` is a silent no-op — which
    // meant the "no object URLs" case below was never actually created, and
    // that test was passing for a reason nobody had verified. The anti-vacuity
    // test directly beneath this is what caught it.
    URL.createObjectURL = present ? () => 'blob:fake' : undefined;
    URL.revokeObjectURL = present ? () => {} : undefined;

    return Promise.resolve(fn()).finally(() => {
      URL.createObjectURL = prevCreate;
      URL.revokeObjectURL = prevRevoke;
    });
  }

  it('the helper actually controls object-URL support (anti-vacuity)', async () => {
    // Without this, a future runtime change could make BOTH branches below
    // exercise the same path and neither test would notice.
    //
    // Note what is NOT asserted: that the runtime provides createObjectURL at
    // all. Whether jsdom defines it varies between an isolated run and a full
    // suite run, and an earlier version of this test asserted `typeof ===
    // 'function'` after restore — which made the guard itself order-dependent,
    // the exact defect it was written to prevent. What matters is that the
    // helper RESTORES whatever was there, so assert against the captured
    // original rather than against an assumed ambient value.
    const original = URL.createObjectURL;

    await withObjectUrl(true, () => {
      expect(typeof URL.createObjectURL).toBe('function');
      expect(URL.createObjectURL(null)).toBe('blob:fake');
    });
    expect(URL.createObjectURL).toBe(original);

    await withObjectUrl(false, () => {
      expect(URL.createObjectURL).toBeUndefined();
    });
    expect(URL.createObjectURL).toBe(original);
  });

  it('uses the provider when configured', async () => {
    await withObjectUrl(true, async () => {
      const played = [];
      const { out } = build(
        { engine: 'provider' },
        {
          fetch: async () => ({
            ok: true,
            headers: { get: () => 'audio/mpeg' },
            blob: async () => new Blob(['audio']),
          }),
          createAudio: (src) => {
            played.push(src);
            const audio = { play: () => Promise.resolve(), pause() {}, volume: 1 };
            Object.defineProperty(audio, 'onended', { set: (fn) => setTimeout(fn, 0) });
            return audio;
          },
        }
      );

      out.speak('Provider speech.');
      await new Promise((r) => setTimeout(r, 20));
      expect(played).toEqual(['blob:fake']);
    });
  });

  it('falls back when the runtime has no object URLs, instead of going silent', async () => {
    // REGRESSION: this threw into the playback promise chain. Because `chain`
    // IS the queue, one rejection skipped every later .then and the assistant
    // went permanently mute for the session with no visible error.
    //
    // The absence of object-URL support is FORCED here. Relying on jsdom to
    // lack it was wrong — jsdom provides it — so this test used to inherit a
    // real implementation and pass or fail on run order.
    await withObjectUrl(false, async () => {
      const { out, synth } = build(
        { engine: 'provider' },
        {
          fetch: async () => ({
            ok: true,
            headers: { get: () => 'audio/mpeg' },
            blob: async () => new Blob(['audio']),
          }),
        }
      );
      out.speak('Must still be heard.');
      await drain(synth);
      expect(synth.spoken).toEqual(['Must still be heard.']);
    });
  });

  it('a synthesiser that THROWS does not mute the rest of the session', async () => {
    /**
     * `chain` is the playback queue. A rejection propagating into it skips
     * every later `.then`, so the assistant goes permanently mute with no
     * visible error. Browsers really do throw from speak() when the synth is
     * in a bad state, so this is a live path, not a hypothetical.
     */
    const synth = makeSynth();
    let first = true;
    const throwingSynth = {
      ...synth,
      speak(u) {
        if (first) {
          first = false;
          throw new Error('synth engine unavailable');
        }
        synth.speak(u);
      },
      cancel: () => synth.cancel(),
    };

    const out = createSpeechOut(
      { engine: 'webspeech' },
      { speechSynthesis: throwingSynth, SpeechSynthesisUtterance: FakeUtterance, now: () => 0 }
    );

    out.speak('First chunk explodes.');
    out.speak('Second chunk must still be heard.');
    await drain(synth);

    expect(synth.spoken).toEqual(['Second chunk must still be heard.']);
  });

  it('a failing chunk does not mute every chunk after it', async () => {
    let call = 0;
    const { out, synth } = build(
      { engine: 'provider' },
      {
        fetch: async () => {
          call += 1;
          if (call === 1) throw new Error('transient');
          return { ok: false, status: 500, headers: { get: () => '' } };
        },
      }
    );

    out.speak('First chunk here.');
    out.speak('Second chunk here.');
    await drain(synth);
    expect(synth.spoken).toEqual(['First chunk here.', 'Second chunk here.']);
  });

  it('falls back to the browser voice when the provider has no credentials', async () => {
    const { out, synth } = build(
      { engine: 'provider' },
      {
        // The documented "no key configured" answer: 200 with JSON.
        fetch: async () => ({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ success: false, available: false }),
        }),
      }
    );

    out.speak('Should still be heard.');
    await drain(synth);
    expect(synth.spoken).toEqual(['Should still be heard.']);
  });

  it('falls back when the provider errors', async () => {
    const { out, synth } = build(
      { engine: 'provider' },
      { fetch: async () => ({ ok: false, status: 502, headers: { get: () => '' } }) }
    );
    out.speak('Network trouble here.');
    await drain(synth);
    expect(synth.spoken).toEqual(['Network trouble here.']);
  });

  it('stops retrying the provider after a quota/auth failure', async () => {
    // Found by a live smoke test against a real OpenAI key with no credits:
    // a 429 is permanent for the session, so retrying it once per SENTENCE
    // makes every chunk pay a doomed round trip before falling back.
    const calls = [];
    const { out, synth } = build(
      { engine: 'provider' },
      {
        fetch: async () => {
          calls.push(1);
          return { ok: false, status: 429, headers: { get: () => '' } };
        },
      }
    );

    out.speak('First sentence here.');
    await drain(synth);
    expect(calls.length).toBe(1);
    expect(out.config.engine).toBe('webspeech');

    out.speak('Second sentence here.');
    out.speak('Third sentence here.');
    await drain(synth);

    expect(calls.length).toBe(1); // never asked again
    expect(synth.spoken).toEqual([
      'First sentence here.',
      'Second sentence here.',
      'Third sentence here.',
    ]);
  });

  it('keeps retrying after a TRANSIENT provider failure', async () => {
    // A 500 or a dropped connection may well succeed next time; demoting on
    // those would give up the good voice for the rest of the session.
    const calls = [];
    const { out, synth } = build(
      { engine: 'provider' },
      {
        fetch: async () => {
          calls.push(1);
          return { ok: false, status: 503, headers: { get: () => '' } };
        },
      }
    );

    out.speak('First sentence here.');
    await drain(synth);
    out.speak('Second sentence here.');
    await drain(synth);

    expect(calls.length).toBe(2);
    expect(out.config.engine).toBe('provider');
  });

  it('falls back when fetch throws outright', async () => {
    const { out, synth } = build(
      { engine: 'provider' },
      {
        fetch: async () => {
          throw new Error('offline');
        },
      }
    );
    out.speak('Offline but still speaking.');
    await drain(synth);
    expect(synth.spoken).toEqual(['Offline but still speaking.']);
  });

  it('does NOT fall back after a cancel — that would speak the cancelled text', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const { out, synth } = build(
      { engine: 'provider' },
      {
        fetch: async () => {
          await gate;
          return { ok: false, status: 500, headers: { get: () => '' } };
        },
      }
    );

    out.speak('Cancelled text.');
    await tick(2);
    out.cancel();
    release();
    await drain(synth);

    expect(synth.spoken).toEqual([]);
  });
});

describe('speechOut — whenIdle (the drain primitive)', () => {
  it('resolves immediately when nothing is queued', async () => {
    const { out } = build();
    let settled = false;
    out.whenIdle().then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(true);
  });

  it('REGRESSION: does not resolve while chunks are still playing', async () => {
    // speak('') was used as a drain, but its empty-text guard never touches
    // the chain — the "drain" resolved instantly and the caller cancelled
    // audio that was still in flight. whenIdle must track REAL playback.
    const { out, synth } = build();
    out.speak('First sentence still in flight.');
    out.speak('Second sentence queued behind it.');
    await tick();

    let settled = false;
    out.whenIdle().then(() => {
      settled = true;
    });
    await tick(8);
    expect(settled).toBe(false); // both chunks unfinished

    synth.finishOne();
    await tick(8);
    expect(settled).toBe(false); // one still unfinished

    await drain(synth);
    expect(settled).toBe(true);
  });

  it('resolves after a cancel — cancelled audio is finished audio', async () => {
    const { out } = build();
    out.speak('About to be interrupted.');
    await tick();
    const p = out.whenIdle();
    out.cancel();
    await expect(p).resolves.toBeUndefined();
  });
});

describe('speechOut — session housekeeping', () => {
  it('reset clears the heard-so-far record', async () => {
    const { out, synth, clock } = build();
    out.speak('Something already said.');
    await Promise.resolve();
    await Promise.resolve();
    synth.finishAll();
    clock.advance(500);
    await Promise.resolve();

    expect(out.spokenPrefix().length).toBeGreaterThan(0);
    out.reset();
    expect(out.spokenPrefix()).toBe('');
  });

  it('exposes pending chunks', async () => {
    const { out } = build();
    out.speak('First one here.');
    out.speak('Second one here.');
    await Promise.resolve();
    expect(out.pending.length).toBeGreaterThan(0);
  });

  it('configure changes settings without losing the queue', () => {
    const { out } = build();
    out.configure({ rate: 1.5, voice: 'x' });
    expect(out.config.rate).toBe(1.5);
    expect(out.config.voice).toBe('x');
  });

  it('a throwing listener never breaks playback', async () => {
    const { out, synth } = build();
    out.on('state', () => {
      throw new Error('listener blew up');
    });
    const p = out.speak('Still works fine.');
    await Promise.resolve();
    await Promise.resolve();
    expect(synth.spoken).toEqual(['Still works fine.']);
    synth.finishAll();
    await p;
  });

  it('survives a missing speechSynthesis entirely', async () => {
    const out = createSpeechOut({ engine: 'webspeech' }, { speechSynthesis: null, SpeechSynthesisUtterance: null });
    await expect(out.speak('nothing to play')).resolves.toBeUndefined();
    expect(() => out.cancel()).not.toThrow();
  });
});
