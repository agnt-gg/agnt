import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * ONE READER for provider cache-usage fields.
 *
 * Reading a provider's cache counters by hand, inside an adapter, is how the
 * same bug shipped three times:
 *   - Codex hits accumulated as zero for months (input_tokens_details unread)
 *   - every OpenRouter cache WRITE accumulated as zero across 816 live
 *     executions while genuinely paying a write premium
 *   - Gemini measured 0% on the API-key backend and 99.6% on Code Assist
 *     through the SAME adapter (2026-08-09)
 *
 * Each time the fix was to teach the shared reader another shape, and each
 * recurrence happened because a call site bypassed it. This guard turns the
 * bypass into a test failure rather than a discovery six months later.
 *
 * SCOPE, deliberately narrow: only the GEMINI spellings. The generic
 * OpenAI-shaped fields (prompt_tokens_details / input_tokens_details) are still
 * read by several legitimate accumulators in the ledger and manifest layers;
 * collapsing those is a later phase, and a guard that fails for correct code
 * gets disabled.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.resolve(__dirname, '..');
const ALLOWED = 'utils/usageCacheFields.js';

const FIELD_RE = /cachedContentTokenCount|cached_content_token_count|totalCachedTokens|total_cached_tokens/;
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

function scan() {
  const offenders = [];
  let allowedFileCodeHits = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.js$/.test(entry.name) || /\.(test|spec)\.js$/.test(entry.name)) continue;
      const rel = path.relative(BACKEND_SRC, full).replace(/\\/g, '/');
      fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        if (!FIELD_RE.test(line) || isComment(line)) return;
        if (rel === ALLOWED) { allowedFileCodeHits++; return; }
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
  };
  walk(BACKEND_SRC);
  return { offenders, allowedFileCodeHits };
}

describe('Gemini cache-usage fields have exactly one reader', () => {
  const { offenders, allowedFileCodeHits } = scan();

  it('ANTI-VACUITY: the shared reader itself still reads the fields', () => {
    // Without this, deleting the reader would make the guard below pass while
    // guarding nothing at all.
    expect(allowedFileCodeHits).toBeGreaterThanOrEqual(4);
  });

  it('no other production module reads them', () => {
    expect(
      offenders,
      'Route Gemini usage through normalizeGeminiUsage()/readGeminiCachedTokens() in utils/usageCacheFields.js — a hand-rolled read of one spelling is indistinguishable from caching being off.'
    ).toEqual([]);
  });
});
