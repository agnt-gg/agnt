/**
 * EVERY CONVERSATION ROW SHOWS ITS PEOPLE.
 *
 * OutputList renders a conversation row in FOUR places — inside a group,
 * ungrouped, the flat no-groups list, and archived — and those four copies
 * have drifted before: the archived one silently lost the streaming indicator
 * and the unread dot, and nothing caught it because each copy independently
 * looked fine.
 *
 * So this reads the source and asserts the count, not the appearance. A fifth
 * row site added without a meta line fails here rather than shipping a row
 * whose avatars are missing on one code path only.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8');

const OUTPUT_LIST = read('OutputList.vue');
const META_LINE = read('ConversationMetaLine.vue');

/**
 * The SFC's template block, with HTML comments removed.
 *
 * TWO TRAPS, BOTH HIT WHILE WRITING THIS FILE:
 *
 * 1. Cut at the SCRIPT tag, not at the first `</template>`. Both of these
 *    files use `<template v-for>` / `<template v-if>` INSIDE the block, so
 *    the first closing tag belongs to a nested one — slicing there silently
 *    kept a fifth of the file and the row count came back 1 instead of 4.
 * 2. Strip comments. A comment that mentions a tag would be counted as a use
 *    of it — the same family as the FA-icon-in-a-comment trap that has bitten
 *    source-reading guards in this repo before.
 */
const templateOf = (sfc) => sfc.slice(0, sfc.indexOf('\n<script')).replace(/<!--[\s\S]*?-->/g, '');

const template = templateOf(OUTPUT_LIST);

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

describe('OutputList row sites', () => {
  it('renders a conversation row in exactly the four places this guard knows about', () => {
    // If this number changes, the assertions below need a deliberate look —
    // that is the point of pinning it.
    expect(countOf(template, 'v-for="output in ')).toBe(4);
  });

  it('gives EVERY row site a meta line', () => {
    expect(countOf(template, '<ConversationMetaLine')).toBe(countOf(template, 'v-for="output in '));
  });

  it('leaves no row rendering a bare date, which would be a row with no people', () => {
    expect(template).not.toContain('<div class="output-date">{{ formatDate(');
  });

  it('passes the stored roster and the live speaker to every live row', () => {
    expect(countOf(template, ':participants="participantsFor(output)"')).toBe(4);
    // Three live sites take a speaker; the archived one deliberately does not,
    // because nothing runs in a conversation that has been put away.
    expect(countOf(template, ':speaker="speakerFor(output.id)"')).toBe(3);
  });

  it('registers the component it renders', () => {
    // <script setup> auto-registers, but OutputList is an Options component:
    // an unregistered tag there resolves to nothing and renders empty.
    expect(OUTPUT_LIST).toContain("import ConversationMetaLine from './ConversationMetaLine.vue'");
    expect(OUTPUT_LIST).toMatch(/components:\s*\{[^}]*ConversationMetaLine/);
  });

  it('exposes the helpers its template calls', () => {
    // setup() must RETURN these or the template silently renders nothing.
    expect(OUTPUT_LIST).toMatch(/\n\s*participantsFor,/);
    expect(OUTPUT_LIST).toMatch(/\n\s*speakerFor,/);
  });
});

describe('ConversationMetaLine', () => {
  it('leads with the avatars, then the date — who, then when', () => {
    const body = templateOf(META_LINE);
    expect(body).toContain('<AgentAvatarStack');
    expect(body.indexOf('<AgentAvatarStack')).toBeLessThan(body.indexOf('output-date'));
  });

  it('names the speaker only while something is running', () => {
    // A permanent attribution would spend the timestamp column on a fact the
    // avatars already carry.
    expect(META_LINE).toContain('v-if="speaker"');
    expect(META_LINE).toContain('speaking');
  });

  it('cannot grow a row taller than its neighbours', () => {
    const styles = META_LINE.slice(META_LINE.indexOf('<style'));
    expect(styles).toContain('white-space: nowrap');
    expect(styles).toContain('text-overflow: ellipsis');
  });
});

describe('the avatar ring tracks the row background', () => {
  it('sets --avatar-ring for the base row and the selected row', () => {
    // The ring is what separates overlapping faces, so it has to be the row's
    // own background — a fixed colour reads as an outline on a tinted row.
    const styles = OUTPUT_LIST.slice(OUTPUT_LIST.indexOf('<style'));
    expect(styles).toMatch(/\.output-item\s*\{[^}]*--avatar-ring/);
    expect(styles).toMatch(/\.output-item\.active\s*\{[^}]*--avatar-ring/);
  });
});
