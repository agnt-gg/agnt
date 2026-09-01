// The chat has always rendered ```html blocks as live, sandboxed, auto-sized
// iframes (MessageItem.vue addHTMLCodeButtons), and when a block matches a file
// the turn just wrote or read it points the iframe at the REAL file so relative
// asset paths resolve (findMatchingFileOnDisk). None of that was ever stated in
// the resident prompt.
//
// What WAS resident said the opposite: LOCAL_FILE_RENDERING's only worked
// example for an .html file was `<a href="file:///…/report.html">`, and the
// browser tool advertises that a browser is always available and opens itself
// if none is present. The full HTML guide had moved to ON_DEMAND_ELEMENTS,
// reachable only by spending a discover_tools round on a capability the model
// had no reason to suspect existed.
//
// Result: link the file, or open a browser to look at a file we wrote — never
// the one surface that costs nothing and needs no window.
//
// These assertions are about the DEFAULT: what the model is told with zero
// tools loaded, on turn one, having read nothing else. Each one fails against
// the prompt as it stood before 2026-09-01.
import { describe, it, expect } from 'vitest';
import { buildUnifiedSystemPrompt } from './buildUnifiedPrompt.js';
import {
  HTML_INLINE_RENDERING,
  LOCAL_FILE_RENDERING,
  VIZ_ADVANCED_CHEATSHEET,
} from './orchestrator-chat.js';
import { estimateTokens } from '../../../utils/contextManager.js';

const FROZEN = { skillsCatalogSection: '', memorySection: '', customInstructionsSection: '' };
const bareContext = (over = {}) => ({
  userId: 'u1',
  latestUserMessage: 'make me a page showing the numbers',
  normalizedProvider: 'anthropic',
  ...over,
});

describe('inline HTML is the resident default, not a discoverable extra', () => {
  it('the prompt states that an html block renders live, with no tool call', async () => {
    const prompt = await buildUnifiedSystemPrompt(bareContext(), FROZEN);

    // The capability itself.
    expect(prompt).toContain('```html');
    expect(prompt).toMatch(/HTML RENDERS LIVE IN THE CHAT/);
    expect(prompt).toMatch(/sandboxed iframe/i);
    // And that reaching it is free — the reason the model previously reached
    // for a browser instead.
    expect(prompt).toMatch(/No tool call, no window/i);
  });

  it('it arrives with no tools loaded and on every provider', async () => {
    // The block is unconditional on purpose. A gate here could flip mid
    // conversation, and a flickering resident block costs far more in rewritten
    // cache prefix than the 384 tokens it would occasionally save. See
    // promptElements.js for the measured cost model.
    for (const provider of ['anthropic', 'openai', 'claude-code', 'groq']) {
      const prompt = await buildUnifiedSystemPrompt(
        bareContext({ normalizedProvider: provider }),
        FROZEN,
      );
      expect(prompt, `missing on provider ${provider}`).toContain('HTML RENDERS LIVE IN THE CHAT');
    }
  });

  it('names both losing behaviours explicitly', async () => {
    const prompt = await buildUnifiedSystemPrompt(bareContext(), FROZEN);
    // Writing the file and handing over a link.
    expect(prompt).toMatch(/only LINKING to it/);
    // Driving a real browser at a local file we just authored.
    expect(prompt).toMatch(/browser is for REMOTE\s+pages/);
  });

  it('teaches the write-file-AND-echo pairing, which is the non-obvious part', async () => {
    // findMatchingFileOnDisk only fires when the block is echoed alongside the
    // write. Without this sentence the model picks one or the other and the
    // real-file iframe path — the one that makes relative asset paths resolve —
    // is never exercised.
    const prompt = await buildUnifiedSystemPrompt(bareContext(), FROZEN);
    expect(prompt).toMatch(/IF YOU ALSO WRITE THE FILE TO DISK, DO BOTH/);
    expect(prompt).toMatch(/points the iframe at the REAL file/);
  });

  it('is read before the file-linking guidance, not after', async () => {
    // Order is the fix. LOCAL_FILE_RENDERING is what taught link-first; the
    // policy has to land before it or the model meets the anti-pattern first.
    const prompt = await buildUnifiedSystemPrompt(bareContext(), FROZEN);
    const policyAt = prompt.indexOf('HTML RENDERS LIVE IN THE CHAT');
    const localFileAt = prompt.indexOf('LOCAL FILE RENDERING:');
    expect(policyAt).toBeGreaterThan(-1);
    expect(localFileAt).toBeGreaterThan(-1);
    expect(policyAt).toBeLessThan(localFileAt);
  });
});

describe('nothing resident still recommends linking an HTML file', () => {
  it('the linking example is no longer an .html file', () => {
    // The exact line that produced the reported behaviour. Any embeddable
    // format is a fine thing to link; .html is the one the chat renders
    // natively, so demonstrating a link to it taught the wrong default.
    expect(LOCAL_FILE_RENDERING).not.toContain('report.html');
    expect(LOCAL_FILE_RENDERING).toContain('report.pdf');
  });

  it('linking is scoped to wanting the file, and points back at the html block', () => {
    expect(LOCAL_FILE_RENDERING).toMatch(/Link a file only when the user wants the FILE/);
    expect(LOCAL_FILE_RENDERING).toContain('```html');
  });
});

describe('the split stays policy-resident / manual-on-demand', () => {
  it('the resident block carries no authoring manual', () => {
    // Anti-regression on the 2026-07-31 cleanup. The reason HTML guidance was
    // evicted was its SIZE, and the whole argument for bringing a piece back is
    // that policy is small and unrecoverable while the manual is large and
    // discoverable. If the design rules or worked examples creep back in here,
    // the eviction has been quietly undone.
    expect(HTML_INLINE_RENDERING).not.toContain('<!DOCTYPE html>');
    expect(HTML_INLINE_RENDERING).not.toMatch(/DESIGN QUALITY/);
    expect(HTML_INLINE_RENDERING).not.toMatch(/base-2 spacing scale/);
    expect(estimateTokens(HTML_INLINE_RENDERING)).toBeLessThan(400);
  });

  it('the manual is still on-demand and still much larger', () => {
    // Anti-vacuity for the assertion above: it would also pass if the manual
    // had been deleted rather than left where it is.
    expect(VIZ_ADVANCED_CHEATSHEET).toContain('HTML VISUALIZATION');
    expect(VIZ_ADVANCED_CHEATSHEET).toContain('DESIGN QUALITY');
    expect(estimateTokens(VIZ_ADVANCED_CHEATSHEET))
      .toBeGreaterThan(estimateTokens(HTML_INLINE_RENDERING) * 4);
  });

  it('the resident prompt still says how to load the manual', async () => {
    const prompt = await buildUnifiedSystemPrompt(bareContext(), FROZEN);
    expect(prompt).toContain('categories=["visualization"]');
  });
});
