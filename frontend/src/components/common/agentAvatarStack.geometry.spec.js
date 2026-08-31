/**
 * THE GEOMETRY OF THE AVATAR CLUSTER.
 *
 * jsdom has no layout engine, so nothing here can measure a pixel. What it CAN
 * do is pin the handful of declarations that the real geometry depends on —
 * each one of which was wrong in a shipped build, and each one of which was
 * invisible to every other test in this repo.
 *
 * The measurements quoted below came from a Chromium harness that renders
 * these components' real <style> blocks and reads getBoundingClientRect():
 * projects/chat-roster-avatars/measure-gap.mjs.
 *
 * ─── WHY DOM ORDER IS THE WHOLE DESIGN ─────────────────────────────────────
 *
 * The stack is `flex-direction: row-reverse`, which makes ONE list serve two
 * purposes at once:
 *
 *   position — the FIRST child sits at the far RIGHT, the LAST at the far LEFT
 *   paint    — the LAST child is drawn ON TOP
 *
 * Annie must be leftmost AND on top, so she must be LAST in the DOM. That is
 * why the template renders the roster reversed, and why the overflow count is
 * emitted first. Get the order backwards and the cluster silently renders
 * mirrored — which is exactly what shipped.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildRoster, ANNIE_NAME } from '@/utils/agentAvatar.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');

const STACK = read('AgentAvatarStack.vue');
const AVATAR = read('AgentAvatar.vue');

/**
 * The template block, comments stripped. Cut at the SCRIPT tag rather than the
 * first `</template>` — a nested `<template v-for>` would end the slice early —
 * and drop HTML comments, or prose describing a tag counts as a use of it.
 */
const templateOf = (sfc) => sfc.slice(0, sfc.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');
const stylesOf = (sfc) => sfc.slice(sfc.indexOf('<style'));

/**
 * The style block with CSS comments removed — for assertions about what the
 * stylesheet does NOT contain.
 *
 * This caught itself on the first run: the rule below documents the bug in
 * prose ("this used to say :last-child"), and a bare `not.toContain` matched
 * the explanation rather than a declaration. Same family as the
 * icon-name-in-a-comment trap.
 *
 * Safe HERE because the slice is real CSS. Do NOT run this over a whole .vue
 * file: `import.meta.glob('./types/*\/*.vue')` contains the two characters
 * that open a CSS comment, and a stripper will eat the file from there to the
 * next close.
 */
const declarationsOf = (sfc) => stylesOf(sfc).replace(/\/\*[\s\S]*?\*\//g, '');
const scriptOf = (sfc) => sfc.slice(sfc.indexOf('\n<script'), sfc.indexOf('<style'));

/** The declarations inside one CSS rule, addressed by its exact selector. */
const ruleFor = (styles, selector) => {
  const at = styles.indexOf(`${selector} {`);
  return at === -1 ? '' : styles.slice(at, styles.indexOf('}', at));
};

describe('the cluster does not push into the text beside it', () => {
  const styles = stylesOf(STACK);

  it('zeroes the margin on the child at the VISUAL RIGHT EDGE (:first-child)', () => {
    // THE BUG: this said `:last-child`. Under row-reverse the last child is the
    // LEFTMOST one, so the rule zeroed a margin at the edge nothing touches and
    // left -6px on the child standing against the text. That negative margin
    // pulls the stack's box out from under its own ink: MEASURED, the rightmost
    // avatar rendered 6.00px past the container's right edge, which is exactly
    // the `gap: 6px` .output-meta puts between the cluster and the timestamp.
    // Declared gap 6px, actual daylight 0px, on every row with 2+ faces.
    expect(styles).toContain('.agent-avatar:first-child');
    expect(styles).toContain('.agent-avatar-overflow:first-child');
  });

  it('has no margin rule keyed on :last-child left anywhere', () => {
    // A single surviving `:last-child` margin rule reintroduces the leak,
    // because it zeroes the wrong end of a reversed row.
    expect(declarationsOf(STACK)).not.toContain(':last-child');
  });

  it('keeps row-reverse, which is what makes first-child the right edge', () => {
    // If this ever becomes plain `row`, every rule above points at the wrong
    // end and the whole cluster mirrors.
    expect(ruleFor(styles, '.agent-avatar-stack')).toContain('flex-direction: row-reverse');
  });
});

describe('DOM order puts Annie last, so she leads and is never clipped', () => {
  it('renders the roster reversed rather than in reading order', () => {
    expect(scriptOf(STACK)).toMatch(/\[\s*\.\.\.roster\.value\.shown\s*\]\.reverse\(\)/);
    expect(templateOf(STACK)).toContain('v-for="member in painted"');
  });

  it('emits the overflow count BEFORE the faces, so it lands at the far right', () => {
    const body = templateOf(STACK);
    expect(body.indexOf('agent-avatar-overflow')).toBeLessThan(body.indexOf('<AgentAvatar'));
  });

  it('buildRoster still returns READING order, which is what everything else wants', () => {
    // The reversal belongs to the renderer, not to the data. If buildRoster
    // ever starts returning paint order the template would double-reverse.
    const { shown } = buildRoster([{ id: 'a1', name: 'Sol' }], { max: 3 });
    expect(shown[0].name).toBe(ANNIE_NAME);
  });
});

describe('the +N count stays readable', () => {
  it('makes its neighbour stand off instead of overlapping it', () => {
    // "+4" is two glyphs in a 14px circle. Overlapped by the next face it lost
    // the digit and read as an unlabelled blob.
    expect(stylesOf(STACK)).toContain('.agent-avatar-overflow + ');
    const at = stylesOf(STACK).indexOf('.agent-avatar-overflow + ');
    const rule = stylesOf(STACK).slice(at, stylesOf(STACK).indexOf('}', at));
    expect(rule).toMatch(/margin-right:\s*3px/);
  });
});

describe('the speaking indicator costs no width and cannot graze a neighbour', () => {
  const styles = stylesOf(AVATAR);
  const speaking = ruleFor(styles, '.agent-avatar.is-speaking');

  it('recolours the rim rather than adding a ring outside the box', () => {
    // An outset `box-shadow` ring renders 1.5px wider than the layout box, so
    // a speaking face at the right edge ate a quarter of the gap to the text
    // and that row measured tighter than every other; and its right arc landed
    // on the neighbouring face as a bright stroke through someone's portrait.
    // The border is already there and already inside the box.
    expect(speaking).toContain('border-color');
    expect(speaking).not.toContain('box-shadow');
  });

  it('animates a property that cannot change the element\'s size', () => {
    const keyframes = styles.slice(styles.indexOf('@keyframes agent-avatar-pulse'));
    expect(keyframes).toContain('border-color');
    expect(keyframes).not.toContain('box-shadow');
  });

  it('declares its stacking instead of inheriting it from a compositing accident', () => {
    // A running animation gets the element promoted to its own layer, which
    // put the speaker above later siblings anyway — the behaviour we want,
    // arrived at by luck and not guaranteed. Stated outright instead.
    expect(speaking).toContain('z-index');
    expect(ruleFor(styles, '.agent-avatar')).toContain('position: relative');
  });
});
