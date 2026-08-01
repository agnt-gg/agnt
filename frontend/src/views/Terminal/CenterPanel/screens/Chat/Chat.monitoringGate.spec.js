import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { hasContextActivity } from '@/services/contextActivity.js';

// Chat.vue is a 3000-line component wired to the store, the socket and the
// router; mounting it to assert one v-if would test the harness, not the gate.
// The gate lives entirely in the template, so the template is what is pinned —
// plus a live evaluation of the predicate itself so this file cannot pass on
// dead code that merely looks right.
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'Chat.vue'),
  'utf8',
);

describe('Chat.vue — the monitoring panel is gated on real activity', () => {
  it('imports the shared predicate rather than re-deriving one', () => {
    expect(src).toMatch(/import \{ hasContextActivity \} from '@\/services\/contextActivity\.js';/);
  });

  it('feeds it every signal the panel renders from', () => {
    const m = src.match(/const hasMonitoringData = computed\(\(\) => hasContextActivity\(\{([\s\S]*?)\}\)\);/);
    expect(m).toBeTruthy();
    for (const key of ['contextStatus', 'totalTokenUsage', 'totalCost', 'executionsCount', 'rounds']) {
      expect(m[1]).toContain(`${key}:`);
    }
  });

  it('exposes it to the template', () => {
    expect(src).toMatch(/^\s*hasMonitoringData,$/m);
  });

  it('REGRESSION: the panel element itself is conditional on it', () => {
    // Not merely "the string appears somewhere" — the v-if on the panel must
    // reference it, which is the single line that makes an empty chat clean.
    const el = src.match(/<div\s+([\s\S]{0,200}?)class="monitoring-panel"/);
    expect(el).toBeTruthy();
    expect(el[1]).toMatch(/v-if="[^"]*hasMonitoringData[^"]*"/);
  });

  it('and that gate is closed for a conversation that has not started', () => {
    // The predicate is evaluated for real here, with the exact shape Chat.vue
    // builds for a fresh conversation, so a broken predicate fails this file
    // too rather than only the service spec.
    expect(hasContextActivity({
      contextStatus: { currentTokens: 0, tokenLimit: 1_000_000, model: 'claude-opus-5' },
      totalTokenUsage: {},
      totalCost: 0,
      executionsCount: 0,
      rounds: [],
    })).toBe(false);
  });
});
