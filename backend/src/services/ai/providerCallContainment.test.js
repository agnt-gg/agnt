import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * CONTAINMENT: text generation goes through the adapter layer, or it is on a
 * list somebody had to edit on purpose.
 *
 * AGNT reached providers from three places. Only one of them had the cache and
 * usage fixes, and nothing announced the difference:
 *
 *   llmAdapters.js        chat/orchestrator   all fixes
 *   StreamEngine.js       SSE + generators    none of them
 *   generate-with-ai-llm  workflow AI node    none of them
 *
 * So Grok cost 6.2x more per turn from a workflow node than from chat, Codex
 * cached at 65% instead of ~100%, and a provider that omits `choices` on its
 * final usage chunk lost the entire billing record. None of that was visible
 * from any single file.
 *
 * The root cause is not any one of those bugs. It is that a new provider call
 * could be written anywhere, and the fixes only ever reached the file the
 * author happened to be reading. This test makes that structural: adding a
 * fourth implementation now means adding yourself to ALLOWED below, in a diff
 * a reviewer will see and ask about.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.resolve(__dirname, '../../');

/**
 * A direct TEXT-GENERATION call against a provider SDK.
 *
 * Image generation is deliberately excluded: it is a genuinely different API
 * with no chat semantics, no prompt cache and no tool loop, so routing it
 * through a chat adapter would buy nothing.
 */
const DIRECT_TEXT_CALL = new RegExp([
  // OpenAI-compatible, Anthropic, and the Responses API.
  /\b(?:client|openai|anthropic|genAI|ai)\s*\.\s*(?:chat\s*\.\s*completions|messages|responses)\s*\.\s*(?:create|stream)\s*\(/.source,
  // Gemini. Originally MISSING, and the staleness check below is what caught
  // it: transports/gemini.js was on the allow-list while the detector could
  // not see a single call in it, so the whole Gemini transport was
  // unguarded — a new module could have copied its SDK calls freely.
  /\b(?:client|genAI|ai)\s*\.\s*models\s*\.\s*generateContent(?:Stream)?\s*\(/.source,
].join('|'));

/**
 * Every file still allowed to call a provider SDK directly, with the reason.
 * This list may SHRINK freely. Growing it should require an argument.
 */
const ALLOWED = new Map([
  // THE adapter layer. These four files ARE the sanctioned SDK boundary — one
  // per wire protocol. llmAdapters.js itself is no longer listed because after
  // the transport split it is a factory and a re-export list, and it makes no
  // provider calls at all; leaving it here would grant permission nothing uses.
  [
    'services/orchestrator/transports/chatCompletions.js',
    'OpenAI-compatible Chat Completions — fourteen providers.',
  ],
  [
    'services/orchestrator/transports/anthropicMessages.js',
    'Anthropic Messages — anthropic and claude-code.',
  ],
  [
    'services/orchestrator/transports/openaiResponses.js',
    'OpenAI Responses — openai (gpt-5.x / o-series) and openai-codex.',
  ],
  [
    'services/orchestrator/transports/gemini.js',
    'Google Gemini — gemini, gemini-cli and antigravity.',
  ],
  [
    'stream/StreamEngine.js',
    'startClaudeAIStream / startOpenAiLikeStream / startCodexResponsesStream still '
    + 'own the /api/stream/* SSE path. Its four generators were migrated; the '
    + 'streaming trio is the remaining work and is tracked, not forgotten.',
  ],
  [
    'tools/library/actions/generate-with-ai-llm.js',
    'generateWithGoogleGateway and generateWithAnthropic remain. The main '
    + 'OpenAI-like path (most of the catalog) and the Codex/managed paths now '
    + 'route through the adapter.',
  ],
  // CustomOpenAIProviderService was listed here on the assumption that it
  // probes a user-supplied endpoint via the SDK. The staleness check below
  // proved it does not, so the entry is gone — an unused permission is a
  // silent re-authorisation waiting for someone to add a call back.
]);

function scan() {
  const offenders = [];
  const seen = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.js$/.test(entry.name) || /\.(test|spec)\.js$/.test(entry.name)) continue;
      const rel = path.relative(BACKEND_SRC, full).replace(/\\/g, '/');
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!DIRECT_TEXT_CALL.test(line)) return;
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // a comment describing one
        seen.add(rel);
        if (!ALLOWED.has(rel)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
  };
  walk(BACKEND_SRC);
  return { offenders, seen };
}

describe('provider SDK calls are contained', () => {
  const { offenders, seen } = scan();

  it('ANTI-VACUITY: the detector actually finds the known call sites', () => {
    // If the regex stops matching, every assertion below passes while
    // guarding nothing at all.
    expect(seen.has('services/orchestrator/transports/chatCompletions.js')).toBe(true);
    expect(seen.has('services/orchestrator/transports/anthropicMessages.js')).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it('no unlisted module calls a provider SDK directly for text generation', () => {
    expect(
      offenders,
      'Route this through createLlmAdapter. Every cache and usage fix lives there, '
      + 'and a parallel implementation silently misses all of them.'
    ).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    // An entry that no longer calls an SDK is permission nobody needs, and it
    // would quietly re-authorise the file if someone added a call back later.
    const stale = [...ALLOWED.keys()].filter((f) => !seen.has(f));
    expect(stale, 'remove these from ALLOWED — they no longer call a provider SDK').toEqual([]);
  });
});
