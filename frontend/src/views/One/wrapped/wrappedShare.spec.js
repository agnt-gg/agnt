import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildCards } from './wrappedModel.js';
import { copyShareImage, drawShareCard, shareableFigures, shareImageBlob, shareIntentUrl, shareText, wrapLines } from './wrappedShare.js';
import { yearFixture } from './wrapped.fixture.js';

const summary = buildCards(yearFixture()).find((c) => c.id === 'summary');

/** A 2D context that records what was written, for the drawing without a real canvas. */
function recordingContext() {
  const texts = [];
  const ctx = {
    texts,
    font: '10px sans-serif',
    fillStyle: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillText: (text) => texts.push(String(text)),
    measureText(text) {
      const size = Number(/(\d+)px/.exec(this.font)?.[1] || 10);
      return { width: String(text).length * size * 0.55 };
    },
  };
  return ctx;
}

afterEach(() => vi.restoreAllMocks());

describe('what leaves the app', () => {
  it('keeps spend and goal names out unless the person includes them', () => {
    expect(shareableFigures(summary)).toMatchObject({ topGoal: null, saved: null, streak: '43', calls: '4,200' });
    expect(shareableFigures(summary, { includePrivate: true })).toMatchObject({ topGoal: 'Morning digest', saved: '$1.8K' });
  });

  it('the post text says the year in one line, private figures only on request', () => {
    const text = shareText(summary);
    expect(text).toBe("My 2026 in @agnt_gg: 43-day streak · 4,200 model calls · #1 model: claude-opus-5-5 · 35 skills built. I'm The Conductor. agnt.gg");
    expect(text).not.toContain('$');
    expect(shareText(summary, { includePrivate: true })).toContain('$1.8K saved by caching');
    expect(text.length).toBeLessThanOrEqual(280);
  });

  it('opens a post on X with that text', () => {
    expect(shareIntentUrl('a b & #c')).toBe('https://x.com/intent/post?text=a%20b%20%26%20%23c');
  });
});

describe('the image', () => {
  it('wraps a long line and ends a cut one with an ellipsis', () => {
    const measure = (t) => t.length * 10;
    expect(wrapLines(measure, 'Email Digest of Latest Most Impactful AI News', 200, 3)).toEqual(['Email Digest of', 'Latest Most', 'Impactful AI News']);
    expect(wrapLines(measure, 'Email Digest of Latest Most Impactful AI News', 200, 2)).toEqual(['Email Digest of', 'Latest Most…']);
  });

  it('draws the year with the private figures left out', () => {
    const ctx = recordingContext();
    drawShareCard(ctx, shareableFigures(summary));
    expect(ctx.texts).toEqual(expect.arrayContaining(['2026 WRAPPED', 'My 2026', 'in AGNT', '43', '4,200', 'DAY STREAK', 'claude-opus-5-5', '35', 'SKILLS BUILT', '30', 'MODELS TRIED', 'The Conductor', 'agnt.gg']));
    expect(ctx.texts.join(' ')).not.toContain('Morning digest');
    expect(ctx.texts.join(' ')).not.toContain('$');
  });

  it('draws them when the person includes them', () => {
    const ctx = recordingContext();
    drawShareCard(ctx, shareableFigures(summary, { includePrivate: true }));
    expect(ctx.texts).toEqual(expect.arrayContaining(['Morning digest', '$1.8K', 'SAVED BY CACHING']));
  });

  it('says plainly when the device cannot draw it', async () => {
    const doc = { createElement: () => ({ getContext: () => null }) };
    await expect(shareImageBlob(summary, {}, doc)).rejects.toThrow('This device cannot draw the image.');
  });

  it('copying asks for an image clipboard, and says so when there is none', async () => {
    vi.stubGlobal('navigator', { clipboard: {} });
    await expect(copyShareImage(summary, {})).rejects.toThrow('Copying images is not available here. Save it instead.');
    vi.unstubAllGlobals();
  });
});
