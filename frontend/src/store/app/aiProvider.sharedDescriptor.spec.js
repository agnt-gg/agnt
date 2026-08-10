import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as shared from '@llm/reasoningPredicates.js';
import { inferReasoningControl } from './aiProvider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The frontend reads provider capability from the SHARED DESCRIPTOR.
 *
 * This store used to redefine twenty predicates, under a comment asking the
 * next person to keep the regexes in sync with the backend by hand. They had
 * already diverged in two ways that reached users:
 *
 *   - a narrower OpenRouter/Anthropic match than the wire accepts, so the
 *     reasoning control was hidden for models that support it;
 *   - an on/off toggle offered for GLM-5.2, which takes high/max and has no
 *     off at all.
 *
 * Both are fixed by consuming one module. These tests keep it that way.
 */

describe('the store consumes the shared descriptor', () => {
  const SRC = fs.readFileSync(path.join(__dirname, 'aiProvider.js'), 'utf8');

  it('imports the predicates rather than defining them', () => {
    expect(SRC).toMatch(/from '@llm\/reasoningPredicates\.js'/);
  });

  it('defines no reasoning predicate of its own', () => {
    // Anything matching this shape here is, by construction, a copy the
    // backend cannot see.
    const local = [...SRC.matchAll(/^\s*function\s+((?:is|supports)[A-Z]\w*(?:ReasoningModel|Toggle|Thinking\w*|ReasoningEffort))\s*\(/gm)].map((m) => m[1]);
    expect(local).toEqual([]);
  });

  it('keeps no mirrored copy of the Anthropic regexes', () => {
    expect(SRC).not.toMatch(/ANTHROPIC_VERSIONED_REASONING_RE\s*=/);
    expect(SRC).not.toMatch(/MIRROR of backend/);
  });

  it('ANTI-VACUITY: the shared module really is the one being imported', () => {
    expect(typeof shared.isGroqQwenReasoningModel).toBe('function');
    // The un-drifted definition: startsWith, not an exact-id list.
    expect(shared.isGroqQwenReasoningModel('qwen/qwen3-14b')).toBe(true);
    expect(shared.isGroqQwenReasoningModel('qwen/qwen3-32b')).toBe(true);
  });
});

describe('controls the store now derives correctly', () => {
  it('GLM-5.2 gets the effort control it actually accepts, not an on/off toggle', () => {
    const control = inferReasoningControl('zai', 'glm-5.2');
    expect(control).toBeTruthy();
    expect(control.kind).toBe('effort');
    expect(control.options.map((o) => o.value)).toEqual(['default', 'high', 'max']);
  });

  it('the 1M-context GLM-5.2 variant resolves the same way', () => {
    expect(inferReasoningControl('zai', 'glm-5.2[1m]')?.kind).toBe('effort');
  });

  it('older GLM keeps the legacy toggle', () => {
    const control = inferReasoningControl('zai', 'glm-4.6');
    expect(control?.kind).toBe('toggle');
    expect(control.options.map((o) => o.value)).toEqual(['default', 'off']);
  });

  it('a Groq model the old exact-match list missed now offers a control', () => {
    expect(inferReasoningControl('groq', 'qwen/qwen3-14b')).toBeTruthy();
    expect(inferReasoningControl('groq', 'openai/gpt-oss-safeguard-20b')).toBeTruthy();
  });

  it('a non-reasoning model still gets nothing', () => {
    expect(inferReasoningControl('groq', 'llama-3.3-70b-versatile')).toBeNull();
  });
});
