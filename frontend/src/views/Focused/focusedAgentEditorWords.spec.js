// The agent editor: who can use it, how to try it, which tools it can use.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'FocusedAgentEditor.vue'), 'utf8');

describe('the agent editor', () => {
  it('says it is private and offers Try it, which mentions it in a chat', () => {
    expect(SRC).toContain("'Private: only you can use it'");
    expect(SRC).toMatch(/data-action="try-it" @click="nav\.ask\('@' \+ v\.name\.replace\(\/\\s\+\/g, ''\) \+ ' '\)"/);
  });
  it('picks its tools as Every tool or Only ones I pick', () => {
    expect(SRC).toContain('>Every tool</button>');
    expect(SRC).toContain('>Only ones I pick</button>');
    expect(SRC).toContain('aria-label="Tools"');
  });
  it('keeps My default model as the default', () => {
    expect(SRC).toContain("{ label: 'My default model', value: '' }");
  });
});
