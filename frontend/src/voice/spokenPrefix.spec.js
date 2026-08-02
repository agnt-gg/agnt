import { describe, it, expect } from 'vitest';
import { createPlaybackQueue, partialText, estimateDurationMs } from './spokenPrefix.js';

describe('estimateDurationMs', () => {
  it('is 0 for empty text', () => {
    expect(estimateDurationMs('')).toBe(0);
    expect(estimateDurationMs(null)).toBe(0);
  });

  it('scales with word count', () => {
    const one = estimateDurationMs('hello');
    const ten = estimateDurationMs('one two three four five six seven eight nine ten');
    expect(ten).toBeGreaterThan(one * 8);
  });

  it('honours the configured rate', () => {
    const slow = estimateDurationMs('one two three', 60);
    const fast = estimateDurationMs('one two three', 240);
    expect(slow).toBeCloseTo(fast * 4, -1);
  });
});

describe('partialText', () => {
  it('returns nothing at or below 0', () => {
    expect(partialText('hello world', 0)).toBe('');
    expect(partialText('hello world', -1)).toBe('');
  });

  it('returns everything at or above 1', () => {
    expect(partialText('hello world', 1)).toBe('hello world');
    expect(partialText('hello world', 2)).toBe('hello world');
  });

  it('snaps back to a word boundary — never mid-word', () => {
    const text = 'the quick brown fox jumps';
    for (let f = 0.05; f < 1; f += 0.05) {
      const p = partialText(text, f);
      if (!p) continue;
      expect(text.startsWith(p)).toBe(true);
      // The character after the cut must be a space or the end of the string.
      const next = text[p.length];
      expect(next === undefined || next === ' ').toBe(true);
    }
  });

  it('returns empty rather than half a first word', () => {
    expect(partialText('extraordinarily long', 0.2)).toBe('');
  });

  it('is safe on empty input', () => {
    expect(partialText('', 0.5)).toBe('');
    expect(partialText(null, 0.5)).toBe('');
  });

  it('can be told not to snap', () => {
    expect(partialText('hello world', 0.5, { snapToWord: false })).toBe('hello');
  });
});

describe('createPlaybackQueue — the bug this prevents', () => {
  /**
   * The model wrote four sentences. The user heard one and a half. If the
   * transcript records all four, "no, that's not what I meant" is resolved
   * against text that was never spoken — and the assistant defends a sentence
   * the user never heard. That is what "not listening" actually is.
   */
  it('records only what was actually heard', () => {
    const q = createPlaybackQueue();
    const a = q.enqueue('The build is green.', 1000);
    const b = q.enqueue('Three tests were added.', 1000);
    q.enqueue('The coverage went up.', 1000);
    q.enqueue('I also fixed a lint error.', 1000);

    q.markPlaying(a, 0);
    q.markDone(a, 1000);
    q.markPlaying(b, 1000);

    // Interrupted 400ms into the second sentence.
    const result = q.interrupt(1400);

    expect(result.spoken).toContain('The build is green.');
    expect(result.spoken).not.toContain('coverage');
    expect(result.spoken).not.toContain('lint error');
    expect(result.discarded).toContain('coverage');
    expect(result.discarded).toContain('lint error');
  });

  it('includes the interrupted sentence proportionally, on a word boundary', () => {
    const q = createPlaybackQueue();
    const id = q.enqueue('one two three four five six seven eight', 800);
    q.markPlaying(id, 0);
    const r = q.interrupt(400); // halfway

    expect(r.partial).not.toBe('');
    expect('one two three four five six seven eight').toContain(r.partial);
    expect(r.partial.split(' ').length).toBeLessThan(8);
    expect(r.partial).not.toMatch(/\s$/);
  });

  it('discards everything queued but never played', () => {
    const q = createPlaybackQueue();
    q.enqueue('first sentence here', 500);
    q.enqueue('second sentence here', 500);
    const r = q.interrupt(0);
    expect(r.spoken).toBe('');
    expect(r.discarded).toContain('first sentence here');
    expect(r.discarded).toContain('second sentence here');
  });

  it('counts a fully played chunk even if it was never explicitly ended', () => {
    const q = createPlaybackQueue();
    const id = q.enqueue('all of this was heard', 500);
    q.markPlaying(id, 0);
    const r = q.interrupt(9999); // long past the end
    expect(r.spoken).toBe('all of this was heard');
  });

  it('falls back to a WPM estimate when duration is unknown', () => {
    const q = createPlaybackQueue({ wordsPerMinute: 120 });
    const id = q.enqueue('one two three four five six seven eight nine ten'); // no duration
    q.markPlaying(id, 0);
    // 10 words at 120wpm = 5000ms; interrupt at 2500ms = half.
    const r = q.interrupt(2500);
    expect(r.partial.split(' ').length).toBeGreaterThan(2);
    expect(r.partial.split(' ').length).toBeLessThan(8);
  });
});

describe('createPlaybackQueue — spokenPrefix', () => {
  it('is empty before anything plays', () => {
    const q = createPlaybackQueue();
    q.enqueue('nothing heard yet', 500);
    expect(q.spokenPrefix(0)).toBe('');
  });

  it('grows as chunks complete', () => {
    const q = createPlaybackQueue();
    const a = q.enqueue('first part done', 500);
    const b = q.enqueue('second part done', 500);
    q.markPlaying(a, 0);
    q.markDone(a, 500);
    expect(q.spokenPrefix(500)).toBe('first part done');
    q.markPlaying(b, 500);
    q.markDone(b, 1000);
    expect(q.spokenPrefix(1000)).toBe('first part done second part done');
  });

  it('is stable after an interrupt', () => {
    const q = createPlaybackQueue();
    const a = q.enqueue('one two three four', 400);
    q.markPlaying(a, 0);
    q.interrupt(200);
    const first = q.spokenPrefix();
    const second = q.spokenPrefix();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('collapses whitespace across chunk joins', () => {
    const q = createPlaybackQueue();
    const a = q.enqueue('  padded  chunk  ', 100);
    q.markPlaying(a, 0);
    q.markDone(a, 100);
    expect(q.spokenPrefix(100)).toBe('padded chunk');
  });
});

describe('createPlaybackQueue — housekeeping', () => {
  it('ignores empty enqueues', () => {
    const q = createPlaybackQueue();
    expect(q.enqueue('')).toBeNull();
    expect(q.enqueue('   ')).toBeNull();
    expect(q.enqueue(null)).toBeNull();
    expect(q.size).toBe(0);
  });

  it('reports pending items', () => {
    const q = createPlaybackQueue();
    const a = q.enqueue('one one one', 100);
    q.enqueue('two two two', 100);
    q.markPlaying(a, 0);
    q.markDone(a, 100);
    expect(q.pending).toEqual(['two two two']);
  });

  it('markPlaying / markDone on an unknown id is a no-op, not a throw', () => {
    const q = createPlaybackQueue();
    expect(q.markPlaying(999, 0)).toBe(false);
    expect(q.markDone(999, 0)).toBe(false);
  });

  it('reset clears everything', () => {
    const q = createPlaybackQueue();
    const a = q.enqueue('something said', 100);
    q.markPlaying(a, 0);
    q.interrupt(50);
    q.reset();
    expect(q.size).toBe(0);
    expect(q.wasInterrupted).toBe(false);
    expect(q.spokenPrefix()).toBe('');
  });

  it('tracks whether an interrupt happened', () => {
    const q = createPlaybackQueue();
    expect(q.wasInterrupted).toBe(false);
    q.interrupt(0);
    expect(q.wasInterrupted).toBe(true);
  });
});
