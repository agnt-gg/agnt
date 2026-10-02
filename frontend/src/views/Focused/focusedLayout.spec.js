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
  it('regression: a full-width row is border-box, so a <div> row (Scheduled) never overflows its list', () => {
    const row = rule('.ui-focused .focused-row');
    expect(row).toMatch(/width:\s*100%/);
    expect(row).toMatch(/box-sizing:\s*border-box/);
  });
});
