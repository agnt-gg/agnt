/**
 * The sidebar's "active" highlight has ONE source of truth: the chat store's
 * savedOutputId (the mirror of the active conversation's output row).
 *
 * The local ref this replaces was written in exactly one place — clicking a
 * row — so a brand-new conversation never highlighted until it was manually
 * clicked, and the file carried TWO disagreeing answers to "which chat is
 * open" (the chime asked the store, the highlight asked the local ref).
 *
 * Source-contract spec: mounting OutputList drags in the whole panel tree;
 * what must not regress here is the wiring, which is visible in the source.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, 'OutputList.vue'), 'utf8');

describe('OutputList active-row wiring', () => {
  it('derives the active row from the route param first, then the chat store', () => {
    // Route param = written synchronously by the click, so the highlight is
    // IMMEDIATE; the store mirror takes over when the load completes and
    // Chat.vue strips the param. The store fallback is also what highlights
    // a brand-new chat on its first autosave, with no click at all.
    expect(SRC).toMatch(/const activeOutputId = computed\(\(\) => route\.query\['content-id'\] \|\| store\.state\.chat\.savedOutputId\);/);
  });

  it('keeps a single source of truth — no local active ref to drift from the store', () => {
    expect(SRC).not.toMatch(/activeOutputId = ref\(/);
    // Assignment only — `.value ===` comparisons are legitimate reads.
    expect(SRC).not.toMatch(/activeOutputId\.value\s*=(?!=)/);
  });

  it('the chime excludes only streaming conversations — the active chat rings like any other (oven timer)', () => {
    const call = SRC.match(/notifiableUnreadIds\(unreadOutputIds\.value, \{[\s\S]*?\}\)/);
    expect(call).toBeTruthy();
    expect(call[0]).toContain('streamingIds');
    expect(call[0]).not.toContain('activeIds');
  });
});
