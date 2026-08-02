import { describe, it, expect } from 'vitest';
import {
  Completeness,
  classifyCompleteness,
  thresholdFor,
  shouldEndpoint,
  DEFAULT_ENDPOINT_CONFIG,
} from './semanticEndpointer.js';

const cls = (t) => classifyCompleteness(t).completeness;

describe('classifyCompleteness — CONTINUING (must not cut the user off)', () => {
  it.each([
    'look at the',
    'I want you to open the',
    'can you check my',
    'run it and',
    'the problem is that it',
    'I was thinking about',
    'compare this with',
    'it should be',
    'we need to',
    'let me',
  ])('treats a dangling function word as continuing: %s', (text) => {
    expect(cls(text)).toBe(Completeness.CONTINUING);
  });

  it.each(['so I was thinking uh', 'open the file um', 'and then, er', 'maybe we should hmm'])(
    'treats a filled pause as continuing: %s',
    (text) => {
      expect(cls(text)).toBe(Completeness.CONTINUING);
    }
  );

  it('beats hallucinated terminal punctuation on a filler tail', () => {
    // Whisper loves to punctuate a trailing "um" into a sentence.
    expect(cls('so what I want is um.')).toBe(Completeness.CONTINUING);
  });

  it('treats trailing clause punctuation as continuing', () => {
    expect(cls('first, open the repo,')).toBe(Completeness.CONTINUING);
    expect(cls('here is the thing:')).toBe(Completeness.CONTINUING);
    expect(cls('two options —')).toBe(Completeness.CONTINUING);
  });
});

describe('classifyCompleteness — COMPLETE (must not make the user wait)', () => {
  it.each([
    "what's the weather",
    'what is the status of the build',
    'how do I run the tests',
    'can you open the repo',
    'where is the config file',
    'why did that fail',
  ])('recognises question form: %s', (text) => {
    expect(cls(text)).toBe(Completeness.COMPLETE);
  });

  it.each(['open the auth file', 'run the test suite', 'delete that branch', 'show me the diff'])(
    'recognises an imperative with a content-word tail: %s',
    (text) => {
      expect(cls(text)).toBe(Completeness.COMPLETE);
    }
  );

  it('recognises terminal punctuation', () => {
    expect(cls('That works.')).toBe(Completeness.COMPLETE);
    expect(cls('Really?')).toBe(Completeness.COMPLETE);
    expect(cls('Stop!')).toBe(Completeness.COMPLETE);
  });

  it.each(['yes', 'no', 'okay', 'stop', 'thanks', 'exactly'])('treats %s as a standalone complete answer', (text) => {
    expect(cls(text)).toBe(Completeness.COMPLETE);
  });
});

describe('classifyCompleteness — NEUTRAL', () => {
  it('is neutral on an empty transcript', () => {
    expect(cls('')).toBe(Completeness.NEUTRAL);
    expect(cls('   ')).toBe(Completeness.NEUTRAL);
    expect(cls(null)).toBe(Completeness.NEUTRAL);
  });

  it('is neutral on an unrecognised single token', () => {
    expect(cls('annie')).toBe(Completeness.NEUTRAL);
    expect(cls('deployment')).toBe(Completeness.NEUTRAL);
  });

  it('is neutral on a two-token phrase with no other signal', () => {
    expect(cls('the deployment')).toBe(Completeness.NEUTRAL);
  });

  it('never throws on non-string input', () => {
    expect(() => classifyCompleteness(undefined)).not.toThrow();
    expect(() => classifyCompleteness(42)).not.toThrow();
    expect(() => classifyCompleteness({})).not.toThrow();
  });
});

describe('thresholdFor', () => {
  it('maps each class to its budget', () => {
    expect(thresholdFor(Completeness.COMPLETE)).toBe(DEFAULT_ENDPOINT_CONFIG.completeMs);
    expect(thresholdFor(Completeness.NEUTRAL)).toBe(DEFAULT_ENDPOINT_CONFIG.neutralMs);
    expect(thresholdFor(Completeness.CONTINUING)).toBe(DEFAULT_ENDPOINT_CONFIG.continuingMs);
  });

  it('orders the budgets complete < neutral < continuing', () => {
    expect(thresholdFor(Completeness.COMPLETE)).toBeLessThan(thresholdFor(Completeness.NEUTRAL));
    expect(thresholdFor(Completeness.NEUTRAL)).toBeLessThan(thresholdFor(Completeness.CONTINUING));
  });

  it('honours config overrides', () => {
    expect(thresholdFor(Completeness.COMPLETE, { completeMs: 90 })).toBe(90);
  });
});

describe('shouldEndpoint — the behaviour that fixes the menu feel', () => {
  it('THE CORE CASE: same pause, opposite decisions', () => {
    const pause = 400;
    const done = shouldEndpoint({ transcript: "what's the weather", silenceMs: pause });
    const thinking = shouldEndpoint({ transcript: 'I want you to look at the', silenceMs: pause });

    expect(done.endpoint).toBe(true);
    expect(thinking.endpoint).toBe(false);
  });

  it('does not endpoint before the threshold', () => {
    const r = shouldEndpoint({ transcript: "what's the weather", silenceMs: 100 });
    expect(r.endpoint).toBe(false);
    expect(r.thresholdMs).toBe(DEFAULT_ENDPOINT_CONFIG.completeMs);
  });

  it('endpoints exactly at the threshold', () => {
    const r = shouldEndpoint({ transcript: "what's the weather", silenceMs: DEFAULT_ENDPOINT_CONFIG.completeMs });
    expect(r.endpoint).toBe(true);
  });

  it('never endpoints before any speech, however long the silence', () => {
    const r = shouldEndpoint({ transcript: '', silenceMs: 60000, hasSpeech: false });
    expect(r.endpoint).toBe(false);
    expect(r.reason).toBe('no-speech-yet');
  });

  it('the max-wait ceiling fires even on a trailing filler', () => {
    const r = shouldEndpoint({ transcript: 'so I was thinking uh', silenceMs: DEFAULT_ENDPOINT_CONFIG.maxWaitMs });
    expect(r.endpoint).toBe(true);
    expect(r.reason).toBe('max-wait');
  });

  it('a continuing utterance survives a pause that would end a complete one', () => {
    const t = 'open the';
    expect(shouldEndpoint({ transcript: t, silenceMs: 200 }).endpoint).toBe(false);
    expect(shouldEndpoint({ transcript: t, silenceMs: 700 }).endpoint).toBe(false);
    expect(shouldEndpoint({ transcript: t, silenceMs: 1100 }).endpoint).toBe(true);
  });

  it('reports the threshold it used, for instrumentation', () => {
    const r = shouldEndpoint({ transcript: 'open the', silenceMs: 0 });
    expect(r.thresholdMs).toBe(DEFAULT_ENDPOINT_CONFIG.continuingMs);
    expect(r.completeness).toBe(Completeness.CONTINUING);
  });

  it('treats missing silenceMs as 0 rather than NaN', () => {
    const r = shouldEndpoint({ transcript: 'yes' });
    expect(r.endpoint).toBe(false);
    expect(r.silenceMs).toBe(0);
  });

  it('is a pure function of its inputs', () => {
    const a = shouldEndpoint({ transcript: 'run the tests', silenceMs: 300 });
    const b = shouldEndpoint({ transcript: 'run the tests', silenceMs: 300 });
    expect(a).toEqual(b);
  });
});

describe('shouldEndpoint — realistic self-correction transcript', () => {
  /**
   * THE CONTRACT THIS MODULE ACTUALLY HAS.
   *
   * A lexical classifier cannot be perfect, and it does not need to be.
   * "open the auth" is, on its face, a finished imperative — the endpointer is
   * RIGHT to say so, even though the speaker was about to add "file". Demanding
   * perfection here would mean inflating every threshold until the whole
   * pipeline feels sluggish, which is the tradeoff this design exists to avoid.
   *
   * The guarantee is narrower and achievable: never endpoint while the
   * transcript is SYNTACTICALLY OPEN. Recovering from a premature endpoint on a
   * merely ambiguous transcript is the reopen window's job, and
   * turnGate.spec.js drives this exact transcript through the state machine to
   * prove the whole turn survives.
   */
  it('never endpoints while the transcript is syntactically open', () => {
    const openStates = [
      { transcript: 'open the', silenceMs: 900 },
      { transcript: 'open the auth file no wait the', silenceMs: 900 },
      { transcript: 'I think we should look at', silenceMs: 1000 },
      { transcript: 'the problem is that it', silenceMs: 1000 },
      { transcript: 'so I was thinking uh', silenceMs: 1000 },
    ];
    for (const s of openStates) {
      const r = shouldEndpoint(s);
      expect(r.completeness).toBe(Completeness.CONTINUING);
      expect(r.endpoint).toBe(false);
    }
  });

  it('commits promptly once the thought closes', () => {
    const r = shouldEndpoint({ transcript: 'open the auth file no wait the session one', silenceMs: 250 });
    expect(r.endpoint).toBe(true);
  });

  it('gives an ambiguous mid-thought transcript more room than a closed one', () => {
    // Not perfection — just the right ORDERING of patience.
    const open = shouldEndpoint({ transcript: 'open the auth file no wait the', silenceMs: 0 });
    const closed = shouldEndpoint({ transcript: 'open the auth file', silenceMs: 0 });
    expect(open.thresholdMs).toBeGreaterThan(closed.thresholdMs);
  });
});
