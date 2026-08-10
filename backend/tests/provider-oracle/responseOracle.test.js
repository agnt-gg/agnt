import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { recordCase, CASES } from './recordResponses.mjs';

/**
 * THE RESPONSE ORACLE.
 *
 * The wire oracle records the REQUEST each adapter builds. This records what
 * each adapter turns a provider's REPLY into: accumulated text, reassembled
 * tool calls, extracted usage, reasoning and thinking blocks, replay payloads,
 * and whether the turn fell into the error-recovery path.
 *
 * The two are not interchangeable, and the gap between them is dangerous. When
 * the Gemini usage reader was fixed, the wire oracle correctly reported all 20
 * providers byte-identical — because the request never changed. Anything that
 * rewrites response handling is invisible to it.
 *
 * That is exactly what the transport split rewrites. Before this existed,
 * GeminiAdapter had ZERO tests that drove a response through it (934 lines,
 * including thought-signature backfill) and OpenAiLikeAdapter had ONE while
 * serving 14 providers. A split could have corrupted tool-call assembly across
 * the whole catalog with every suite still green.
 *
 * UPDATING A GOLDEN IS DELIBERATE:
 *   node backend/tests/provider-oracle/recordResponses.mjs
 * Re-record only when the change in behaviour is intended, and say why.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(__dirname, 'response-goldens.json');
const goldens = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

describe('provider response oracle', () => {
  it('covers all four transports', () => {
    const keys = Object.keys(goldens);
    // chatCompletions, anthropicMessages, openaiResponses, gemini
    expect(keys.some((k) => k.startsWith('groq/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('anthropic/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('openai/'))).toBe(true);
    expect(keys.some((k) => k.startsWith('gemini/'))).toBe(true);
    expect(keys.length).toBe(CASES.length);
  });

  it('covers BOTH entry points, not just streaming', () => {
    // callStream is the chat path; call() is a separate implementation used by
    // eight background services and every StreamEngine generator. The first
    // version of this oracle recorded only callStream, and a negative control
    // that broke the non-streaming Codex replay capture left it green.
    const missing = Object.entries(goldens)
      .filter(([, g]) => !g.stream || !g.nonStream)
      .map(([k]) => k);
    expect(missing, 'every case must record both entry points').toEqual([]);
  });

  it('ANTI-VACUITY: the goldens contain real assembled semantics', () => {
    // A recording where everything came back empty would compare equal to
    // itself forever while proving nothing. These floors were measured when
    // the oracle was written.
    const all = Object.values(goldens).flatMap((g) => [g.stream, g.nonStream].filter(Boolean));
    const withToolCalls = all.filter((g) => (g.toolCalls || []).length > 0);
    const withUsage = all.filter((g) => g.usage?.input > 0);
    const withCachedRead = all.filter((g) => g.usage?.cachedRead > 0);

    expect(withToolCalls.length, 'tool-call assembly must be exercised').toBeGreaterThanOrEqual(10);
    expect(withUsage.length, 'usage extraction must be exercised').toBeGreaterThanOrEqual(30);
    expect(withCachedRead.length, 'cached-token reads must be exercised').toBeGreaterThanOrEqual(15);
  });

  it('tool-call arguments are reassembled from fragments on every transport', () => {
    // Each transport streams arguments as fragments and must rebuild them.
    // This is the single most breakable thing in a transport split.
    for (const key of ['groq/toolCall', 'anthropic/toolCall', 'openai/toolCall', 'gemini/toolCall', 'cerebras/toolCall']) {
      const g = goldens[key]?.stream;
      expect(g, `${key} must be recorded`).toBeTruthy();
      expect(g.toolCalls.length, `${key} must assemble one call`).toBe(1);
      expect(JSON.parse(g.toolCalls[0].arguments), `${key} arguments must parse`).toEqual({ path: 'a.txt' });
      expect(g.toolCalls[0].name).toBe('read_file');
    }
  });

  it('parallel tool calls keep their pairing between id, name and arguments', () => {
    // Interleaved fragments are the classic reassembly trap: a shared buffer
    // gives call A the arguments of call B, and the model then reads the wrong
    // file with a plausible-looking id.
    const g = goldens['groq/parallelToolCalls'].stream;
    expect(g.toolCalls).toHaveLength(2);
    const byName = Object.fromEntries(g.toolCalls.map((t) => [t.name, JSON.parse(t.arguments)]));
    expect(byName.web_search).toEqual({ query: 'x' });
    expect(byName.read_file).toEqual({ path: 'b' });
  });

  it('Anthropic thinking blocks survive into the message content', () => {
    const g = goldens['anthropic/withThinking'].stream;
    const kinds = g.content.map((b) => b.type);
    expect(kinds).toContain('thinking');
    expect(kinds).toContain('text');
  });

  it('Codex captures encrypted reasoning for replay', () => {
    // Without the replayed reasoning item the NEXT turn cannot achieve a full
    // cache hit — OpenAI documents this explicitly.
    // Both entry points must capture it: call() is what the generators use.
    expect(goldens['openai-codex/withReasoning'].stream.hasReplayItems).toBe(true);
    expect(goldens['openai-codex/withReasoning'].nonStream.hasReplayItems).toBe(true);
  });

  it('Gemini reads cached tokens under BOTH field spellings', () => {
    expect(goldens['gemini/plainText'].stream.usage.cachedRead).toBe(1024);       // camelCase
    expect(goldens['gemini/snakeCaseUsage'].stream.usage.cachedRead).toBe(1024);  // snake_case
  });

  it('a usage chunk without `choices` still yields the billing record', () => {
    const g = goldens['kimi/usageChunkWithoutChoices'].stream;
    expect(g.usage.input).toBe(1200);
    expect(g.usage.cachedRead).toBe(1024);
  });

  describe.each(Object.keys(goldens))('%s', (key) => {
    it('response handling is unchanged', async () => {
      const spec = CASES.find(([p, , s]) => `${p}/${s}` === key);
      expect(spec, `no case spec for ${key}`).toBeTruthy();
      const fresh = await recordCase(spec);
      fresh.model = spec[1];
      expect(fresh).toEqual(goldens[key]);
    }, 30000);
  });
});
