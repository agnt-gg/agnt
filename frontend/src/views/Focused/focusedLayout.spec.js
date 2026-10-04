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
  it('regression: a full-width row is border-box, so a <div> row (Scheduled) never overflows its list', () => {
    const row = rule('.ui-focused .focused-row');
    expect(row).toMatch(/width:\s*100%/);
    expect(row).toMatch(/box-sizing:\s*border-box/);
  });
});
