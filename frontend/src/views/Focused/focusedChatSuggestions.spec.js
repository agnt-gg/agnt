// Reported 2026-10-21: AGNT One's chat showed no follow-up suggestions once a
// conversation was going. focused.css hid the suggestions bar everywhere, on
// the idea that the rotating starters replace it; they only show on the empty
// start screen. The bar may be hidden there and nowhere else.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'focused.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('AGNT One chat suggestions', () => {
  it('the suggestions bar is hidden only on the start screen (.focused-home)', () => {
    const hiding = [...CSS.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim()))
      .filter((selector) => selector.includes('.suggestions-bar'));
    expect(hiding).toEqual(['.ui-focused .chat-screen-wrapper.focused-home .suggestions-bar']);
  });
});
