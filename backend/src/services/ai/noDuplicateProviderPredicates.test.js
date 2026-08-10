import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * INVARIANT I1 — declare once, consume twice.
 *
 * A provider capability predicate may be DEFINED in exactly one backend module.
 *
 * Nine of these were copy-pasted between providerConfigs.js (which drives the
 * UI) and llmAdapters.js (which drives the wire). Two had drifted:
 * isGroqGptOssReasoningModel and isGroqQwenReasoningModel used startsWith() in
 * the config and exact-match in the adapter, so a newly listed Groq model in
 * the gap would show the user a reasoning toggle that silently sent nothing.
 *
 * Copies also existed under DIFFERENT NAMES — supportsDeepSeekThinkingToggle /
 * supportsDeepSeekToggle, supportsKimiReasoningToggle / supportsKimiToggle,
 * isAnthropicAdaptiveThinkingModel / supportsAnthropicAdaptiveThinking — which
 * is why this guard matches the NAMING PATTERN rather than an allow-list of
 * known names. An allow-list would have missed all three pairs.
 *
 * SCOPE: backend/src production files. The frontend still mirrors these in
 * store/app/aiProvider.js; that copy exists because the frontend cannot import
 * backend modules (no npm workspace) and is removed when the shared descriptor
 * package lands, not guarded here.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.resolve(__dirname, '../../');

const PREDICATE_RE =
  /^\s*(?:export\s+)?function\s+((?:is|supports)[A-Z]\w*(?:ReasoningModel|Toggle|Thinking\w*|ReasoningEffort))\s*\(/gm;

function collectDefinitions() {
  const map = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.js$/.test(entry.name) || /\.(test|spec)\.js$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, 'utf8');
      PREDICATE_RE.lastIndex = 0;
      let m;
      while ((m = PREDICATE_RE.exec(text))) {
        const rel = path.relative(BACKEND_SRC, full).replace(/\\/g, '/');
        if (!map.has(m[1])) map.set(m[1], []);
        map.get(m[1]).push(rel);
      }
    }
  };
  walk(BACKEND_SRC);
  return map;
}

describe('provider predicate definitions are unique (I1)', () => {
  const defs = collectDefinitions();

  it('ANTI-VACUITY: the predicate family is actually found', () => {
    // If the regex stops matching the codebase's naming, the guard below would
    // pass while checking nothing at all.
    expect(defs.size).toBeGreaterThanOrEqual(15);
    // The canonical home is the shared descriptor, which the Vue frontend also
    // imports. providerConfigs re-exports it for existing consumers.
    expect(defs.get('isGroqGptOssReasoningModel')).toEqual(['services/ai/descriptor/reasoningPredicates.js']);
  });

  it('every reasoning predicate lives in the shared descriptor', () => {
    // Anywhere else is by definition a copy the frontend cannot see.
    const strays = [...defs.entries()]
      .filter(([, files]) => !files.every((f) => f === 'services/ai/descriptor/reasoningPredicates.js'))
      .map(([name, files]) => `${name}: ${files.join(' , ')}`);
    expect(strays, 'define reasoning predicates in descriptor/reasoningPredicates.js so UI and wire share one answer').toEqual([]);
  });

  it('no predicate is defined in more than one module', () => {
    const dups = [...defs.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([name, files]) => `${name}: ${files.join(' , ')}`);
    expect(
      dups,
      'Import from providerConfigs.js instead of redefining — copies drift, and the drift is a silent no-op in production.'
    ).toEqual([]);
  });

  it('llmAdapters.js defines none of them (imports only)', () => {
    const inAdapter = [...defs.entries()]
      .filter(([, files]) => files.some((f) => f.endsWith('orchestrator/llmAdapters.js')))
      .map(([name]) => name);
    expect(inAdapter).toEqual([]);
  });
});
