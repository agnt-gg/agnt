import { describe, it, expect } from 'vitest';
import { detectWake, isStopPhrase, stripWakePhrase, tokenMatchesName, editDistance } from './wakePhrase.js';

const AGENTS = [
  { id: 'a1', name: 'Researcher' },
  { id: 'a2', name: 'Code Reviewer' },
  { id: 'a3', name: 'Scout' },
];

describe('editDistance', () => {
  it('is 0 for identical strings', () => {
    expect(editDistance('annie', 'annie')).toBe(0);
  });

  it('counts single edits', () => {
    expect(editDistance('annie', 'anie')).toBe(1); // deletion
    expect(editDistance('annie', 'annies')).toBe(1); // insertion
    expect(editDistance('annie', 'annix')).toBe(1); // substitution
  });

  it('early-exits above max without lying about the ordering', () => {
    expect(editDistance('annie', 'completely-different', 2)).toBeGreaterThan(2);
  });
});

describe('tokenMatchesName — ASR tolerance', () => {
  it('matches exactly', () => {
    expect(tokenMatchesName('annie', 'annie')).toBe(true);
  });

  it.each(['anie', 'anni', 'annies', 'annis'])('tolerates a common mishearing: %s', (heard) => {
    expect(tokenMatchesName(heard, 'annie')).toBe(true);
  });

  /**
   * The tolerance boundary, stated explicitly because it is a deliberate
   * asymmetry rather than an oversight.
   *
   * An always-on listener that FALSELY fires during ordinary conversation is
   * far worse than one that occasionally needs the phrase repeated: the false
   * accept hijacks the room, cancels whatever was playing, and trains the user
   * to distrust the feature. Edit distance 1 is the safety limit — at distance
   * 2 a 5-letter name starts matching real English words ('annex', 'annals'),
   * which is exactly the failure we cannot afford.
   */
  it('rejects distance-2 neighbours to keep false accepts near zero', () => {
    expect(tokenMatchesName('anny', 'annie')).toBe(false);
    expect(tokenMatchesName('annex', 'annie')).toBe(false);
    expect(tokenMatchesName('any', 'annie')).toBe(false);
  });

  it("strips a possessive 's", () => {
    expect(tokenMatchesName("annie's", 'annie')).toBe(true);
  });

  it('rejects an unrelated word', () => {
    expect(tokenMatchesName('banana', 'annie')).toBe(false);
    expect(tokenMatchesName('and', 'annie')).toBe(false);
  });

  it('requires an exact match for short names — fuzzy would match half the dictionary', () => {
    expect(tokenMatchesName('cat', 'car')).toBe(false);
    expect(tokenMatchesName('car', 'car')).toBe(true);
  });

  it('is safe on empty input', () => {
    expect(tokenMatchesName('', 'annie')).toBe(false);
    expect(tokenMatchesName('annie', '')).toBe(false);
    expect(tokenMatchesName(null, null)).toBe(false);
  });
});

describe('detectWake — the primary phrase', () => {
  it('detects "hey annie"', () => {
    const m = detectWake('hey annie');
    expect(m).not.toBeNull();
    expect(m.target).toBe('orchestrator');
  });

  it.each(['hey annie', 'hi annie', 'ok annie', 'okay annie', 'hello annie', 'yo annie'])(
    'accepts the prefix in: %s',
    (text) => {
      expect(detectWake(text)).not.toBeNull();
    }
  );

  it('carries the command spoken in the same breath', () => {
    const m = detectWake('hey annie what is the build status');
    expect(m.command).toBe('what is the build status');
  });

  it('requires a prefix by default, so ordinary talk about Annie does not fire', () => {
    expect(detectWake('I was telling annie about it')).toBeNull();
    expect(detectWake('annie is great')).toBeNull();
  });

  it('can be configured to accept a bare name', () => {
    const m = detectWake('annie open the repo', {}, { requirePrefix: false });
    expect(m).not.toBeNull();
    expect(m.command).toBe('open the repo');
  });

  it('finds the phrase mid-utterance', () => {
    const m = detectWake('um so hey annie run the tests');
    expect(m).not.toBeNull();
    expect(m.command).toBe('run the tests');
  });

  it('returns null on unrelated speech', () => {
    expect(detectWake('what time is the meeting')).toBeNull();
    expect(detectWake('')).toBeNull();
    expect(detectWake(null)).toBeNull();
  });

  it('ignores punctuation and casing', () => {
    expect(detectWake('Hey, Annie! Open the repo.')).not.toBeNull();
  });
});

describe('detectWake — agent routing (every agent is wakeable, with no config)', () => {
  it('routes to a named agent', () => {
    const m = detectWake('hey researcher find the paper', { agents: AGENTS });
    expect(m.target).toBe('agent');
    expect(m.agentId).toBe('a1');
    expect(m.command).toBe('find the paper');
  });

  it('matches a multi-word agent name', () => {
    const m = detectWake('hey code reviewer look at this diff', { agents: AGENTS });
    expect(m.target).toBe('agent');
    expect(m.agentId).toBe('a2');
    expect(m.command).toBe('look at this diff');
  });

  it('prefers the longest matching name', () => {
    const agents = [
      { id: 'x', name: 'Code' },
      { id: 'y', name: 'Code Reviewer' },
    ];
    const m = detectWake('hey code reviewer go', { agents });
    expect(m.agentId).toBe('y');
  });

  it('still routes to the orchestrator for the primary name', () => {
    const m = detectWake('hey annie do the thing', { agents: AGENTS });
    expect(m.target).toBe('orchestrator');
    expect(m.agentId).toBeUndefined();
  });

  it('tolerates a mishearing of an agent name', () => {
    const m = detectWake('hey scowt check this', { agents: AGENTS });
    expect(m).not.toBeNull();
    expect(m.agentId).toBe('a3');
  });

  it('ignores agents with no usable name', () => {
    const agents = [{ id: 'bad', name: '' }, { id: 'bad2' }, null];
    expect(() => detectWake('hey annie hello', { agents })).not.toThrow();
    expect(detectWake('hey annie hello', { agents }).target).toBe('orchestrator');
  });
});

describe('isStopPhrase — whole utterance only', () => {
  it.each(['stop', 'never mind', 'nevermind', 'goodbye', 'cancel', "that's all", 'exit', 'quit'])(
    'ends the session on a bare: %s',
    (text) => {
      expect(isStopPhrase(text)).toBe(true);
    }
  );

  it('THE CRITICAL CASE: a real instruction containing "stop" goes through', () => {
    expect(isStopPhrase('stop the docker container')).toBe(false);
    expect(isStopPhrase('stop the build and tell me why')).toBe(false);
    expect(isStopPhrase('cancel the deployment')).toBe(false);
    expect(isStopPhrase('exit the function early')).toBe(false);
  });

  it('tolerates politeness and filler around the stop word', () => {
    expect(isStopPhrase('ok stop')).toBe(true);
    expect(isStopPhrase('stop please')).toBe(true);
    expect(isStopPhrase('um, stop')).toBe(true);
    expect(isStopPhrase('annie stop')).toBe(true);
  });

  it('ignores punctuation and casing', () => {
    expect(isStopPhrase('Stop!')).toBe(true);
    expect(isStopPhrase('  GOODBYE.  ')).toBe(true);
  });

  it('is false for empty input', () => {
    expect(isStopPhrase('')).toBe(false);
    expect(isStopPhrase(null)).toBe(false);
    expect(isStopPhrase('   ')).toBe(false);
  });
});

describe('stripWakePhrase', () => {
  it('removes the wake phrase and leaves the command', () => {
    const t = 'hey annie open the repo';
    expect(stripWakePhrase(t, detectWake(t))).toBe('open the repo');
  });

  it('returns empty when only the wake phrase was spoken', () => {
    const t = 'hey annie';
    expect(stripWakePhrase(t, detectWake(t))).toBe('');
  });

  it('handles a multi-word agent name', () => {
    const t = 'hey code reviewer look at this';
    expect(stripWakePhrase(t, detectWake(t, { agents: AGENTS }))).toBe('look at this');
  });

  it('passes the transcript through when there is no match', () => {
    expect(stripWakePhrase('just some words', null)).toBe('just some words');
  });
});
