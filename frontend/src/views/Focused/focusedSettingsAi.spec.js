// Settings speaks plainly about the AI: let Annie choose, or pick one; how hard she thinks.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'FocusedSettings.vue'), 'utf8');

describe('AI model settings', () => {
  it('offers Let Annie choose or one specific AI, through the routing mode', () => {
    expect(SRC).toContain('Let Annie choose (recommended)');
    expect(SRC).toContain('Always use a specific AI');
    expect(SRC).toContain("store.dispatch('aiProvider/setRoutingMode', mode)");
  });
  it('names the routing policies Quick, Balanced and Thorough', () => {
    expect(SRC).toMatch(/\{ id: 'save', label: 'Quick' \},\s*\{ id: 'balanced', label: 'Balanced' \},\s*\{ id: 'quality', label: 'Thorough' \}/);
    expect(SRC).toContain("store.dispatch('aiProvider/setRoutingPolicy', p.id)");
  });
  it('groups the sections: You, AI, Team & billing, Advanced', () => {
    expect([...SRC.matchAll(/\{ label: '([^']+)', sections:/g)].map((m) => m[1])).toEqual(['You', 'AI', 'Team & billing', 'Advanced']);
  });
});
