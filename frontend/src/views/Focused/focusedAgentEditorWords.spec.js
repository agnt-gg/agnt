// The assistant editor in plain words: who can use it, how to try it, what it can use.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'FocusedAgentEditor.vue'), 'utf8');

describe('the assistant editor', () => {
  it('says it is private and offers Try it, which mentions it in a chat', () => {
    expect(SRC).toContain("'Private: only you can use it'");
    expect(SRC).toMatch(/data-action="try-it" @click="nav\.ask\('@' \+ v\.name\.replace\(\/\\s\+\/g, ''\) \+ ' '\)"/);
  });
  it('picks what it can use as Everything or Only ones I pick', () => {
    expect(SRC).toContain('>Everything</button>');
    expect(SRC).toContain('>Only ones I pick</button>');
    expect(SRC).not.toContain('aria-label="Every action"');
  });
  it('names the default AI as the same as Annie', () => {
    expect(SRC).toContain("{ label: 'Same as Annie (recommended)', value: '' }");
  });
});
