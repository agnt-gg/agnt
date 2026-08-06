/**
 * The UI must have an EXPLICIT name for every origin the backend can write,
 * and no rendered origin may ever be a raw database token.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `llm_calls.origin` grew from 6 values to 13 when the chat surfaces were
 * split apart. The dashboard's label map was not updated, and because its
 * fallback was `ORIGIN_LABELS[b] || b` there was no error, no warning and no
 * missing row — the new origins simply rendered as their column values. The
 * result was a single list reading:
 *
 *     Chat · orchestrator · Workflows · Agents · Goal evaluation · widget · workflow
 *
 * Half sentence case, half snake_case identifiers, and "Workflows" sitting two
 * rows above "workflow" as if they were the same thing spelled twice.
 *
 * A comment saying "keep these in sync" is not a mechanism. This is:
 *   - membership   — every backend origin has its OWN entry (not a fallback)
 *   - shape        — every label starts with a capital and contains no `_`
 *   - distinctness — no two origins share a label, so a mismatch can't hide
 *   - fallback     — an unknown origin is still humanised, never passed through
 *
 * Each assertion is paired with a count check. "All X satisfy P" is worthless
 * if the X-finder silently found nothing.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN_LABELS, originLabel } from './originLabels.js';

/** Walk up until the backend file is found, so this works from any vitest root. */
function findBackendLlmCallModel() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'backend/src/models/LlmCallModel.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate backend/src/models/LlmCallModel.js');
}

/** Comments are stripped first — an assertion must never be satisfied by prose. */
function backendOrigins() {
  const raw = fs.readFileSync(findBackendLlmCallModel(), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const readArray = (name) => {
    const decl = src.match(new RegExp(`export const ${name}\\s*=\\s*Object\\.freeze\\(\\[`));
    if (!decl) throw new Error(`${name} not found in LlmCallModel.js`);
    const body = src.slice(decl.index + decl[0].length);
    const end = body.indexOf(']');
    if (end === -1) throw new Error(`${name} array is unterminated`);
    return [...body.slice(0, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };

  // ORIGINS spreads CHAT_SURFACE_ORIGINS, which a literal-only scan cannot see.
  return [...new Set([...readArray('CHAT_SURFACE_ORIGINS'), ...readArray('ORIGINS')])];
}

describe('origin label vocabulary mirrors the backend', () => {
  it('finds a plausible number of backend origins (anti-vacuity)', () => {
    const origins = backendOrigins();
    expect(origins.length).toBeGreaterThanOrEqual(13);
    // The two arrays that must both have been parsed, one from each.
    expect(origins).toContain('orchestrator'); // CHAT_SURFACE_ORIGINS
    expect(origins).toContain('workflow_node'); // ORIGINS
  });

  it('gives every backend origin its own explicit label', () => {
    const missing = backendOrigins().filter((o) => !Object.hasOwn(ORIGIN_LABELS, o));
    expect(missing).toEqual([]);
  });

  it('has no label for an origin the backend cannot write', () => {
    const known = new Set(backendOrigins());
    const extra = Object.keys(ORIGIN_LABELS).filter((k) => !known.has(k));
    expect(extra).toEqual([]);
  });

  it('renders every origin as a capitalised phrase, never a raw token', () => {
    const origins = backendOrigins();
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      const label = originLabel(origin);
      expect(label, origin).not.toBe(origin);
      expect(label, origin).toMatch(/^[A-Z]/);
      expect(label, origin).not.toMatch(/_/);
    }
  });

  it('names every origin distinctly', () => {
    const labels = backendOrigins().map((o) => originLabel(o));
    expect(labels.length).toBeGreaterThanOrEqual(13);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('distinguishes the Workflow Forge surface from workflow runs', () => {
    // These two rows sit adjacent on the dashboard and are different things.
    expect(originLabel('workflow')).not.toBe(originLabel('workflow_node'));
  });
});

describe('originLabel fallback', () => {
  it('humanises an origin that is not in the map', () => {
    expect(originLabel('some_new_forge')).toBe('Some new forge');
    expect(originLabel('mcp-bridge')).toBe('Mcp bridge');
    expect(originLabel('spaced  out')).toBe('Spaced out');
  });

  it('never returns the raw token for an unknown snake_case origin', () => {
    expect(originLabel('another_surface')).not.toBe('another_surface');
  });

  it('leaves an already-capitalised unknown value alone', () => {
    expect(originLabel('Mystery')).toBe('Mystery');
  });

  it('returns Unknown for absent or blank input rather than an empty label', () => {
    expect(originLabel(null)).toBe('Unknown');
    expect(originLabel(undefined)).toBe('Unknown');
    expect(originLabel('')).toBe('Unknown');
    expect(originLabel('   ')).toBe('Unknown');
    expect(originLabel('__')).toBe('Unknown');
  });
});
