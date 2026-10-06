/**
 * "AGNT Flash · Free trial · 1M left" is one centred line, and only once the
 * chat has content. It was left-aligned, and on an empty chat (Studio and
 * Focused alike) it just sat in the way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const meter = readFileSync(join(DIR, 'AgntFlashMeter.vue'), 'utf8');
const chat = readFileSync(join(DIR, '..', 'Chat.vue'), 'utf8');
const rule = (selector) => (meter.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`)) || [])[1] || '';

describe('the AGNT Flash meter', () => {
  it('is centred', () => {
    expect(rule('.afm-row')).toMatch(/justify-content:\s*center/);
    // The old right-push on the credit count is what left-aligned the label.
    expect(rule('.afm-left')).not.toMatch(/margin-left:\s*auto/);
  });

  it('appears only once the chat has content, in both modes', () => {
    const mount = chat.match(/<AgntFlashMeter v-if="([^"]+)"/);
    expect(mount, 'the meter is mounted in Chat.vue').not.toBeNull();
    expect(mount[1]).toMatch(/conversationStarted/);
    expect(chat).toMatch(/const conversationStarted = computed\(\(\) => !isUnstartedConversation\(store\.state\.chat\.messages\)\)/);
  });
});
