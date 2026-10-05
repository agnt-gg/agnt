/**
 * The Market shelf sits ABOVE a Library tab's list.
 *
 * Reported: Focused's Agents page showed no Market items. It did render them,
 * after the whole list: 8,361px down on an account with 124 agents. Only a
 * short tab (Tools, 22 items) ever showed the shelf on screen.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const templateOf = (file) => {
  const src = readFileSync(join(DIR, file), 'utf8');
  return src.slice(src.indexOf('<template>'), src.indexOf('<script'));
};

describe('Library Market shelf placement', () => {
  it.each(['FocusedLibrary.vue', 'FocusedFiles.vue'])('%s puts the shelf before the list', (file) => {
    const t = templateOf(file);
    const shelf = t.indexOf('<MarketplaceShelf');
    const list = t.indexOf('class="focused-list"');
    expect(shelf, 'shelf is mounted').toBeGreaterThan(-1);
    expect(list, 'list is rendered').toBeGreaterThan(-1);
    expect(shelf).toBeLessThan(list);
    expect(t.match(/<MarketplaceShelf/g)).toHaveLength(1);
  });
});
