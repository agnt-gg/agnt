/**
 * CONTRACT: a bot-protection wall is named; a real page never is.
 *
 * Fixtures are the actual titles and text captured from the blocked pages on
 * 2026-09-27 (Zillow/PerimeterX, Lowe's/Akamai, Reddit, Amazon, Home Depot).
 * False positives are the expensive error — the agent abandons a site that
 * works — so the negative cases matter as much as the positive ones.
 */

import { describe, it, expect } from 'vitest';
import { classifyBlockPage, blockedHint, BLOCK_PROBE_EXPRESSION } from './browserBlockDetection.js';

const page = (overrides = {}) => ({
  title: 'Some Store', text: '', textLength: 0, markers: {}, status: 200, ...overrides,
});

describe('blocks that are named', () => {
  it('PerimeterX press-and-hold (Zillow), by marker or by title', () => {
    expect(classifyBlockPage(page({ markers: { pxCaptcha: true } })).by).toBe('PerimeterX (HUMAN)');
    expect(classifyBlockPage(page({ title: 'Access to this page has been denied', status: 403 })).by).toBe('PerimeterX (HUMAN)');
    const text = 'Press & Hold to confirm you are a human (and not a bot). Reference ID 223c29b0';
    expect(classifyBlockPage(page({ title: '', text, textLength: text.length })).by).toBe('PerimeterX (HUMAN)');
  });

  it('Akamai "Access Denied" (Lowe\'s), with its reference number', () => {
    const block = classifyBlockPage(page({ title: 'Access Denied', markers: { akamaiReference: true } }));
    expect(block.by).toBe('Akamai');
  });

  it('Cloudflare interstitial', () => {
    expect(classifyBlockPage(page({ title: 'Just a moment...' })).by).toBe('Cloudflare');
    expect(classifyBlockPage(page({ markers: { cloudflare: true } })).by).toBe('Cloudflare');
  });

  it('DataDome captcha iframe', () => {
    expect(classifyBlockPage(page({ markers: { dataDome: true } })).by).toBe('DataDome');
  });

  it('Reddit\'s first-hit challenge and Walmart\'s robot check', () => {
    expect(classifyBlockPage(page({ title: 'Reddit - Prove your humanity' })).by).toBe('Reddit');
    expect(classifyBlockPage(page({ title: 'Robot or human?' })).by).toBe('bot check');
  });

  it('Amazon\'s soft interstitial', () => {
    const text = 'Click the button below to continue shopping Continue shopping Conditions of Use';
    expect(classifyBlockPage(page({ title: 'Amazon.com', text, textLength: 146 })).by).toBe('Amazon');
  });

  it('a short page served with 403 (Home Depot\'s "Oops"), whatever it says', () => {
    const text = 'Oops!! Something went wrong. Please refresh page';
    const block = classifyBlockPage(page({ title: 'Error Page', text, textLength: 120, status: 403 }));
    expect(block).toEqual({ by: 'the site', evidence: 'HTTP 403 with a 120-character page' });
  });
});

describe('real pages that must NOT be called blocked', () => {
  it('an article that discusses captchas and "press and hold" is content, not a wall', () => {
    const text = `${'How bot protection works. '.repeat(80)}Some vendors ask you to press and hold a button; others show a captcha.`;
    expect(classifyBlockPage(page({ title: 'How CAPTCHAs work', text: text.slice(0, 1500), textLength: text.length }))).toBeNull();
  });

  it('a 403 on a full page (a real forbidden resource with navigation) is not a bot wall', () => {
    expect(classifyBlockPage(page({ title: 'Forbidden', text: 'x'.repeat(1500), textLength: 5000, status: 403 }))).toBeNull();
  });

  it('a login wall is a login wall, not a block', () => {
    const text = 'Log in to X. Sign up. Don\'t miss what\'s happening.';
    expect(classifyBlockPage(page({ title: 'X', text, textLength: text.length }))).toBeNull();
  });

  it('a blank page that is still loading is not a block', () => {
    expect(classifyBlockPage(page({ title: '', text: '', textLength: 0, status: 200 }))).toBeNull();
  });

  it('garbage in is null out', () => {
    expect(classifyBlockPage(null)).toBeNull();
    expect(classifyBlockPage('nope')).toBeNull();
  });
});

describe('what the agent is told', () => {
  it('names the vendor and says not to retry', () => {
    const hint = blockedHint({ by: 'Akamai', evidence: 'page title "Access Denied"' });
    expect(hint).toMatch(/Akamai/);
    expect(hint).toMatch(/will not help/);
  });

  it('the probe is self-identifying, so a stub reply cannot be mistaken for a clean page', () => {
    expect(BLOCK_PROBE_EXPRESSION).toContain("probe: 'agnt-block-probe'");
  });
});
