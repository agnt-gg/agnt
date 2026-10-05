/**
 * Groups view lists every chat that is not in a group, under Ungrouped, even
 * when no group exists yet.
 *
 * Reported: chats did not show under Groups until a group was created. The
 * Ungrouped section required `groups.length > 0`, so a new account's Groups
 * view showed only "No groups yet".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'OutputList.vue'), 'utf8');

describe('Groups view', () => {
  it('always shows Ungrouped, whether or not any group exists', () => {
    const section = src.match(/<div class="group-section ungrouped-section" v-if="([^"]+)">/);
    expect(section, 'the Ungrouped section is rendered').not.toBeNull();
    expect(section[1]).toBe("viewMode === 'groups'");
  });

  it('pages the ungrouped list the same way with or without groups', () => {
    const body = (name) => src.slice(src.indexOf(`const ${name} = computed(`), src.indexOf(';', src.indexOf(`const ${name} = computed(`)));
    for (const name of ['ungroupedOutputs', 'hasMoreUngrouped']) {
      expect(body(name), `${name} must not depend on whether groups exist`).not.toMatch(/groups\.value\.length/);
    }
    expect(body('ungroupedOutputs')).toMatch(/slice\(0, ungroupedDisplayLimit\.value\)/);
  });
});
