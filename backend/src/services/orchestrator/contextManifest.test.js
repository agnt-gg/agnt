// Context manifest — the itemized inventory behind the monitoring panel.
//
// These pin the two things the old panel could not express: WHY each tool is
// present, and whether the cached prompt prefix survived the turn.
import { describe, it, expect } from 'vitest';
import { buildContextManifest } from './contextManifest.js';

const schema = (name, size = 200) => ({
  type: 'function',
  function: {
    name,
    description: 'x'.repeat(size),
    parameters: { type: 'object', properties: {} },
  },
});

const base = () => ({
  systemPrompt: 'SYSTEM PROMPT BODY',
  promptSections: [
    { id: 'memory', label: 'Memory', tokens: 1500, frozen: true },
    { id: 'skills', label: 'Skills catalog', tokens: 300, frozen: true },
    { id: 'workspace', label: 'Workspace context', tokens: 0, frozen: false },
  ],
  toolSchemas: [schema('discover_tools'), schema('web_search'), schema('generate_image')],
  toolProvenance: {
    discover_tools: { reason: 'default' },
    web_search: { reason: 'default' },
    generate_image: { reason: 'group', group: 'media' },
  },
  toolSurfaceMeta: { registryTotal: 296, mode: 'auto', groups: ['core', 'media'], deniedCount: 2 },
  contextResult: {
    systemTokens: 3000,
    toolTokens: 900,
    messagesTokens: 400,
    messages: [{}, {}, {}],
  },
});

describe('system prompt itemization', () => {
  it('lists dynamic sections and derives the static remainder', () => {
    const { manifest } = buildContextManifest(base());
    const ids = manifest.system.sections.map((s) => s.id);
    expect(ids).toContain('memory');
    expect(ids).toContain('skills');
    expect(ids).toContain('static');
    // Zero-token sections are omitted rather than shown as noise.
    expect(ids).not.toContain('workspace');
    // 3000 total - (1500 + 300) dynamic = 1200 of hand-written prompt.
    expect(manifest.system.sections.find((s) => s.id === 'static').tokens).toBe(1200);
  });

  it('sorts sections biggest-first so the offender is on top', () => {
    const { manifest } = buildContextManifest(base());
    const toks = manifest.system.sections.map((s) => s.tokens);
    expect([...toks].sort((a, b) => b - a)).toEqual(toks);
  });

  it('never reports a negative static remainder', () => {
    const input = base();
    input.contextResult.systemTokens = 100; // smaller than the sections
    const { manifest } = buildContextManifest(input);
    for (const s of manifest.system.sections) expect(s.tokens).toBeGreaterThanOrEqual(0);
  });
});

describe('tool provenance', () => {
  it('carries the reason each tool is loaded, and the group that pulled it', () => {
    const { manifest } = buildContextManifest(base());
    const byName = Object.fromEntries(manifest.tools.items.map((t) => [t.name, t]));
    expect(byName.discover_tools.reason).toBe('default');
    expect(byName.generate_image.reason).toBe('group');
    expect(byName.generate_image.group).toBe('media');
  });

  it('preserves send order (the cache-stable order), not alphabetical', () => {
    const { manifest } = buildContextManifest(base());
    expect(manifest.tools.items.map((t) => t.name)).toEqual([
      'discover_tools', 'web_search', 'generate_image',
    ]);
  });

  it('costs each tool individually', () => {
    const input = base();
    input.toolSchemas = [schema('small', 10), schema('huge', 4000)];
    const { manifest } = buildContextManifest(input);
    const [small, huge] = manifest.tools.items;
    expect(huge.tokens).toBeGreaterThan(small.tokens * 5);
  });
});

describe('not in context', () => {
  it('accounts for every registry tool that is not loaded', () => {
    const { manifest } = buildContextManifest(base());
    expect(manifest.tools.count).toBe(3);
    expect(manifest.tools.registryTotal).toBe(296);
    expect(manifest.tools.hiddenCount).toBe(293);
    expect(manifest.tools.deniedCount).toBe(2);
  });

  it('surfaces tools DROPPED by the budget cap — previously only a console.warn', () => {
    const input = base();
    input.capResult = { capped: true, hiddenCount: 18 };
    const { manifest } = buildContextManifest(input);
    expect(manifest.tools.droppedCount).toBe(18);
    // Dropped tools must not be double-counted as merely hidden.
    expect(manifest.tools.hiddenCount).toBe(296 - 3 - 18);
  });

  it('reports zero dropped when the cap did not engage', () => {
    const input = base();
    input.capResult = { capped: false, hiddenCount: 0 };
    expect(buildContextManifest(input).manifest.tools.droppedCount).toBe(0);
  });
});

describe('cache prefix stability', () => {
  it('first turn has no prior to compare against', () => {
    const { manifest } = buildContextManifest(base());
    expect(manifest.cache.prefixStable).toBe(true);
    expect(manifest.cache.first).toBe(true);
  });

  it('appending tools keeps the prefix stable', () => {
    const first = buildContextManifest(base());
    const input = base();
    input.toolSchemas = [...input.toolSchemas, schema('github_api')];
    input.toolProvenance.github_api = { reason: 'discovered' };
    const second = buildContextManifest({ ...input, prior: first.fingerprints });
    expect(second.manifest.cache.prefixStable).toBe(true);
    expect(second.manifest.cache.toolsAdded).toBe(1);
  });

  it('REORDERING tools breaks the prefix and is reported', () => {
    const first = buildContextManifest(base());
    const input = base();
    input.toolSchemas = [...input.toolSchemas].reverse();
    const second = buildContextManifest({ ...input, prior: first.fingerprints });
    expect(second.manifest.cache.prefixStable).toBe(false);
    expect(second.manifest.cache.toolsStable).toBe(false);
  });

  it('a changed system prompt breaks the prefix and names the section', () => {
    const first = buildContextManifest(base());
    const input = base();
    input.systemPrompt = 'SYSTEM PROMPT BODY (memory refreshed)';
    input.promptSections = input.promptSections.map((s) =>
      s.id === 'memory' ? { ...s, tokens: 2600 } : s
    );
    const second = buildContextManifest({ ...input, prior: first.fingerprints });
    expect(second.manifest.cache.prefixStable).toBe(false);
    expect(second.manifest.cache.systemStable).toBe(false);
    expect(second.manifest.cache.changedSections).toContain('memory');
  });

  it('an identical turn is fully stable', () => {
    const first = buildContextManifest(base());
    const second = buildContextManifest({ ...base(), prior: first.fingerprints });
    expect(second.manifest.cache.prefixStable).toBe(true);
    expect(second.manifest.cache.changedSections).toEqual([]);
  });
});

describe('robustness', () => {
  it('never throws on empty input', () => {
    const { manifest } = buildContextManifest();
    expect(manifest.tools.count).toBe(0);
    expect(manifest.system.total).toBe(0);
  });

  it('does not mutate its inputs', () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    buildContextManifest(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('reports message trimming', () => {
    const input = base();
    input.contextResult.wasManaged = true;
    input.contextResult.originalTokens = 50_000;
    input.contextResult.managedTokens = 37_600;
    const { manifest } = buildContextManifest(input);
    expect(manifest.messages.managed).toBe(true);
    expect(manifest.messages.reduction).toBe(12_400);
  });
});
