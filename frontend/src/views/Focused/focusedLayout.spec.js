/**
 * Layout rules jsdom cannot measure, pinned at the source.
 *
 * Scheduled's rows are <div>s (a row button plus a switch), and a <div> is
 * content-box by default where a <button> is border-box. With width:100% and
 * 14px side padding the row ran 28px past the list, whose overflow:hidden
 * clipped the on/off switch off the right edge.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'focused.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('Focused layout', () => {
  it('regression: transcript and composer use one column, without Studio avatar offsets', () => {
    const column = rule('.ui-focused .chat-screen-wrapper .input-container');
    expect(column).toMatch(/width:\s*var\(--focused-chat-column-width\)/);
    const flow = rule('.ui-focused .chat-screen-wrapper .message-flow');
    expect(flow).toMatch(/--chat-avatar-gutter:\s*0px/);
    expect(flow).toMatch(/--chat-body-width:\s*100%/);
    expect(rule('.ui-focused .chat-screen-wrapper .message-wrapper.assistant')).toMatch(/width:\s*100%/);
  });

  it('regression: light user-message text inherits the bubble foreground', () => {
    expect(rule('.ui-focused .chat-screen-wrapper .message-wrapper.user .message-text')).toMatch(/color:\s*inherit/);
  });

  it('regression: the home heading stays one line and is not narrowed by global heading caps', () => {
    const heading = rule('.ui-focused .focused-home-hero h1');
    expect(heading).toMatch(/white-space:\s*nowrap/);
    expect(heading).toMatch(/max-width:\s*none/);
  });

  it('regression: recents titles and status are bounded within a border-box row', () => {
    const row = rule('.ui-focused .focused-recent');
    expect(row).toMatch(/box-sizing:\s*border-box/);
    expect(row).toMatch(/overflow:\s*hidden/);
    expect(rule('.ui-focused .focused-recent-status')).toMatch(/width:\s*100%/);
  });
  it('regression: an on/off switch after a row label stays switch-sized at the right, not stretched across the row', () => {
    // The "value fills the rest of the row" rule out-specifies .focused-switch,
    // so it must not match a switch at all (Agents' Active / Every tool).
    expect(css).not.toMatch(/\.focused-edit-label \+ \* \{/);
    expect(rule('.ui-focused .focused-edit-row:not(.column) > .focused-edit-label + :not(.focused-switch)')).toMatch(/flex:\s*1/);
    const sw = rule('.ui-focused .focused-switch');
    expect(sw).toMatch(/flex:\s*0 0 auto/);
    expect(sw).toMatch(/width:\s*38px/);
    expect(sw).toMatch(/margin-left:\s*auto/);
  });
  it('regression: on a phone the keyboard never pushes the suggestions over the logo and tagline', () => {
    // Measured in Chrome at 390px wide: suggestions over the hero from 520px tall
    // (keyboard up), under the header from 400px. The hero box measures itself
    // and clips; the logo, then the hero, then the suggestions give way.
    expect(css).toMatch(/\.chat-screen-wrapper\.focused-home \.main-panel \{\s*container:\s*ui-focused-home-panel\s*\/\s*size;/);
    expect(css).toMatch(/\.chat-screen-wrapper\.focused-home \.conversation-canvas-wrapper \{\s*container:\s*ui-focused-home-hero\s*\/\s*size;[^}]*overflow:\s*hidden;/);
    expect(css).toMatch(/@container ui-focused-home-hero \(max-height: \d+px\) \{\s*\.ui-focused \.focused-home-logo \{\s*display: none;/);
    expect(css).toMatch(/@container ui-focused-home-hero \(max-height: \d+px\) \{\s*\.ui-focused \.focused-home-hero \{\s*display: none;/);
    expect(css).toMatch(/@container ui-focused-home-panel \(max-height: \d+px\) \{[^}]*\.focused-starters[^}]*\{\s*display: none;/);
  });

  it('regression: a full-width row is border-box, so a <div> row (Scheduled) never overflows its list', () => {
    const row = rule('.ui-focused .focused-row');
    expect(row).toMatch(/width:\s*100%/);
    expect(row).toMatch(/box-sizing:\s*border-box/);
  });
});
