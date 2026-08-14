/**
 * ChatProviderSelector — panel ORDER and per-mode CONTENT.
 *
 * Two properties that are invisible to any test which mounts the component and
 * asserts on behaviour, because the component renders perfectly either way:
 *
 *   1. The mode row is the LAST thing in the panel.
 *      The popup is anchored by its bottom-right corner, so the row nearest
 *      that corner is the one that holds still while the panel above it grows
 *      and shrinks between Default / Dynamic / Specific. Ordering the control
 *      first put it furthest from the fixed edge — the part that appeared to
 *      move most.
 *
 *   2. Provider management belongs to Specific only.
 *      "Add Custom" / edit / delete sat outside the pinned block, so they
 *      showed in Default and Dynamic — modes in which the user has explicitly
 *      said "I am not picking a provider". An action with no visible
 *      consequence reads as a broken button.
 *
 * Asserted at source level, on the template's element ORDER, because that is
 * the actual contract. A mounted-render test would have to enumerate what is
 * on screen in each mode and would still say nothing about sequence.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(DIR, 'ChatProviderSelector.vue'), 'utf8');

/** The SFC's root <template>, i.e. everything before the script block. */
const TEMPLATE = SRC.slice(0, SRC.indexOf('<script>'));

const at = (needle) => {
  const i = TEMPLATE.indexOf(needle);
  expect(i, `not found in template: ${needle}`).toBeGreaterThan(-1);
  return i;
};

/** Every block that makes up the panel body, in no particular order. */
const BODY_BLOCKS = [
  'class="routing-mode-note"',
  'class="current-selection"',
  'class="chat-provider-search"',
  'class="selector-group"',
  'class="connection-status"',
  'class="tool-support-warning"',
  'class="custom-provider-row"',
];

describe('the mode row is the last thing in the panel', () => {
  it('comes after every other body block', () => {
    const modeRow = at('class="routing-mode-row"');

    for (const block of BODY_BLOCKS) {
      expect(at(block), `${block} should come BEFORE the mode row`).toBeLessThan(modeRow);
    }
  });

  it('is the final element inside .dropdown-content', () => {
    // Nothing but closing tags may follow it. If a future block is appended
    // after the mode row, the control stops being the row nearest the anchored
    // corner and starts drifting again.
    const modeRow = at('class="routing-mode-row"');
    const tail = TEMPLATE.slice(modeRow);
    const closeContent = tail.indexOf('</div>\n    </div>');

    expect(closeContent, '.dropdown-content close not found after the mode row').toBeGreaterThan(-1);

    const between = tail.slice(0, closeContent);
    // The row's own buttons are expected; any further <div class="..."> is not.
    expect(between.match(/<div class="(?!routing-mode-row)/g)).toBeNull();
  });

  it('renders in every mode — it is not inside the pinned block', () => {
    // The control that CHANGES the mode obviously cannot be conditional on the
    // mode. Stated explicitly because the fix moved it right past that block.
    expect(at('class="routing-mode-row"')).toBeGreaterThan(at('</template>'));
  });
});

describe('provider management is Specific-only', () => {
  const pinnedOpen = () => at(`<template v-if="activeMode === 'pinned'">`);
  const pinnedClose = () => at('</template>');

  it('the Add Custom row sits inside the pinned block', () => {
    const row = at('class="custom-provider-row"');

    expect(row, 'custom-provider-row must be after the pinned block opens').toBeGreaterThan(pinnedOpen());
    expect(row, 'custom-provider-row must be before the pinned block closes').toBeLessThan(pinnedClose());
  });

  it('the edit and delete actions go with it', () => {
    for (const action of ['class="btn-add-custom"', 'class="btn-edit-provider"', 'class="btn-delete-provider"']) {
      expect(at(action)).toBeGreaterThan(pinnedOpen());
      expect(at(action)).toBeLessThan(pinnedClose());
    }
  });

  it('guards a single pinned block, so the ordering above is unambiguous', () => {
    // Every assertion here resolves `</template>` to the FIRST match and reads
    // it as "the pinned block closes here". That holds only while there are
    // exactly two templates — the SFC root and the pinned block nested inside
    // it — because then the first close must be the inner one. A third
    // template would silently redirect every ordering assertion above.
    expect(TEMPLATE.match(/<template[ >]/g)).toHaveLength(2); // root + pinned
    expect(TEMPLATE.match(/<\/template>/g)).toHaveLength(2); // pinned, then root

    // And the pinned block really is the inner one.
    expect(at(`<template v-if="activeMode === 'pinned'"`)).toBeGreaterThan(at('<template>'));
  });
});

describe('the mode notes stay with their modes', () => {
  it('Default and Dynamic each explain themselves', () => {
    // With provider management gone from these modes, the note is the only
    // body content they have. If it were ever removed the panel would render
    // as an empty box with three buttons.
    expect(TEMPLATE).toMatch(/v-if="activeMode === 'default'"[\s\S]*?routing-mode-note/);
    expect(TEMPLATE).toMatch(/v-else-if="activeMode === 'dynamic'"[\s\S]*?routing-mode-note/);
  });

  it('the notes render outside the pinned block', () => {
    const pinnedOpen = at(`<template v-if="activeMode === 'pinned'">`);
    expect(at(`v-if="activeMode === 'default'"`)).toBeLessThan(pinnedOpen);
    expect(at(`v-else-if="activeMode === 'dynamic'"`)).toBeLessThan(pinnedOpen);
  });
});
