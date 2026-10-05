/**
 * The chat shows no scrollbar by default. Reported: Studio's chat had an
 * always-on scrollbar (overflow-y: scroll, a 10px bar on a filled track),
 * even with nothing to scroll. The conversation still scrolls.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Chat.vue'), 'utf8');
const css = src.slice(src.indexOf('<style'));
const rule = (selector) => (css.match(new RegExp(`\\n${selector.replace(/[.:-]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';

describe('chat scrollbar', () => {
  it('scrolls, but never forces a scrollbar on', () => {
    const canvas = rule('.conversation-canvas');
    expect(canvas).toMatch(/overflow-y:\s*auto/);
    expect(canvas).not.toMatch(/overflow-y:\s*scroll/);
    expect(canvas).toMatch(/scrollbar-width:\s*none/);
  });

  it('hides the WebKit bar too, and paints no track', () => {
    expect(rule('.conversation-canvas::-webkit-scrollbar')).toMatch(/display:\s*none/);
    expect(css).not.toMatch(/\.conversation-canvas::-webkit-scrollbar-track/);
  });
});
