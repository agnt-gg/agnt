// Inter-skill relationships + extraction provenance (SkillSmith-inspired,
// arXiv:2607.27497). Relations live inside the spec-legal free-form `metadata`
// frontmatter map — no new top-level keys, agentskills.io portability intact.
import { describe, it, expect } from 'vitest';

import {
  coerceMetadata,
  extractRelations,
  hasRelations,
  extractProvenance,
  validateRelationsMetadata,
  buildSupersededByIndex,
  buildActivationRelationsPayload,
  filterSupersededEntries,
  buildForgeProvenance,
  relationsFromCandidate,
} from './skillRelations.js';
import { parseSkillMd, serializeSkillMd } from './skillValidation.js';

describe('coerceMetadata', () => {
  it('passes objects through and parses JSON strings (DB rows)', () => {
    expect(coerceMetadata({ a: 1 })).toEqual({ a: 1 });
    expect(coerceMetadata('{"a":1}')).toEqual({ a: 1 });
  });

  it('rejects arrays, malformed JSON, and empties', () => {
    expect(coerceMetadata([1])).toBeNull();
    expect(coerceMetadata('not json')).toBeNull();
    expect(coerceMetadata('[1,2]')).toBeNull();
    expect(coerceMetadata(null)).toBeNull();
    expect(coerceMetadata(undefined)).toBeNull();
    expect(coerceMetadata(42)).toBeNull();
  });
});

describe('extractRelations', () => {
  it('extracts canonical kebab-case keys', () => {
    const rel = extractRelations({
      relations: {
        'composes-with': ['media-use', 'hyperframes-cli'],
        'depends-on': ['hyperframes-core'],
        supersedes: ['old-pipeline'],
      },
    });
    expect(rel).toEqual({
      composesWith: ['media-use', 'hyperframes-cli'],
      dependsOn: ['hyperframes-core'],
      supersedes: ['old-pipeline'],
    });
  });

  it('accepts camelCase aliases', () => {
    const rel = extractRelations({
      relations: { composesWith: ['a'], dependsOn: ['b'] },
    });
    expect(rel.composesWith).toEqual(['a']);
    expect(rel.dependsOn).toEqual(['b']);
  });

  it('promotes scalar values to single-element arrays', () => {
    const rel = extractRelations({ relations: { 'depends-on': 'hyperframes-core' } });
    expect(rel.dependsOn).toEqual(['hyperframes-core']);
  });

  it('drops invalid slugs and dedupes', () => {
    const rel = extractRelations({
      relations: {
        'composes-with': ['ok-skill', 'ok-skill', 'Bad Name', '--bad', '', 42, null],
      },
    });
    expect(rel.composesWith).toEqual(['ok-skill']);
  });

  it('handles JSON-string metadata (DB round-trip)', () => {
    const rel = extractRelations(JSON.stringify({ relations: { 'depends-on': ['core'] } }));
    expect(rel.dependsOn).toEqual(['core']);
  });

  it('returns empty arrays for missing/garbage relations', () => {
    const empty = { composesWith: [], dependsOn: [], supersedes: [] };
    expect(extractRelations(null)).toEqual(empty);
    expect(extractRelations({})).toEqual(empty);
    expect(extractRelations({ relations: 'nope' })).toEqual(empty);
    expect(extractRelations({ relations: ['nope'] })).toEqual(empty);
  });
});

describe('hasRelations', () => {
  it('detects presence and absence', () => {
    expect(hasRelations(extractRelations({ relations: { supersedes: ['x'] } }))).toBe(true);
    expect(hasRelations(extractRelations({}))).toBe(false);
    expect(hasRelations(null)).toBe(false);
  });
});

describe('extractProvenance', () => {
  it('extracts a full provenance block', () => {
    const prov = extractProvenance({
      provenance: {
        'source-trace': 'goal-123',
        extracted: '2026-08-03',
        rationale: 'Came from X; generalizes when Y',
        confidence: 0.82,
      },
    });
    expect(prov).toEqual({
      'source-trace': 'goal-123',
      extracted: '2026-08-03',
      rationale: 'Came from X; generalizes when Y',
      confidence: 0.82,
    });
  });

  it('accepts camelCase sourceTrace and preserves history arrays', () => {
    const prov = extractProvenance({
      provenance: { sourceTrace: 'g1', history: [{ version: 2 }] },
    });
    expect(prov['source-trace']).toBe('g1');
    expect(prov.history).toEqual([{ version: 2 }]);
  });

  it('drops out-of-range confidence and returns null when nothing valid', () => {
    expect(extractProvenance({ provenance: { confidence: 1.5 } })).toBeNull();
    expect(extractProvenance({ provenance: {} })).toBeNull();
    expect(extractProvenance({})).toBeNull();
    expect(extractProvenance(null)).toBeNull();
  });
});

describe('validateRelationsMetadata', () => {
  it('accepts a well-formed block silently', () => {
    expect(validateRelationsMetadata({
      relations: { 'depends-on': ['core'], 'composes-with': ['other'] },
      provenance: { rationale: 'x' },
    })).toEqual([]);
  });

  it('warns on unknown relation types', () => {
    const warnings = validateRelationsMetadata({ relations: { 'conflicts-with': ['x'] } });
    expect(warnings.some((w) => w.includes('conflicts-with'))).toBe(true);
  });

  it('warns on invalid slugs', () => {
    const warnings = validateRelationsMetadata({ relations: { 'depends-on': ['Bad Slug!'] } });
    expect(warnings.some((w) => w.includes('invalid skill slug'))).toBe(true);
  });

  it('flags dangling targets when knownSlugs provided', () => {
    const warnings = validateRelationsMetadata(
      { relations: { 'depends-on': ['ghost-skill'] } },
      ['real-skill']
    );
    expect(warnings.some((w) => w.includes('unknown skill "ghost-skill"'))).toBe(true);
  });

  it('does not flag known targets', () => {
    expect(validateRelationsMetadata(
      { relations: { 'depends-on': ['real-skill'] } },
      ['real-skill']
    )).toEqual([]);
  });

  it('warns when relations/provenance are not maps', () => {
    expect(validateRelationsMetadata({ relations: 'x' }).length).toBe(1);
    expect(validateRelationsMetadata({ provenance: 'x' }).length).toBe(1);
  });

  it('returns nothing for metadata without relations/provenance', () => {
    expect(validateRelationsMetadata({ category: 'general' })).toEqual([]);
    expect(validateRelationsMetadata(null)).toEqual([]);
  });
});

describe('buildSupersededByIndex', () => {
  it('indexes across both filesystem (frontmatter.metadata) and DB (metadata) shapes', () => {
    const index = buildSupersededByIndex([
      { name: 'new-fs', frontmatter: { metadata: { relations: { supersedes: ['old-a'] } } } },
      { name: 'new-db', metadata: JSON.stringify({ relations: { supersedes: ['old-a', 'old-b'] } }) },
      { name: 'unrelated', metadata: null },
    ]);
    expect(index.get('old-a')).toEqual(['new-fs', 'new-db']);
    expect(index.get('old-b')).toEqual(['new-db']);
    expect(index.has('unrelated')).toBe(false);
  });
});

describe('buildActivationRelationsPayload', () => {
  it('returns null when there is nothing to say', () => {
    expect(buildActivationRelationsPayload({
      relations: extractRelations({}),
    })).toBeNull();
  });

  it('tells the model to activate missing dependencies', () => {
    const payload = buildActivationRelationsPayload({
      relations: extractRelations({ relations: { 'depends-on': ['hyperframes-core'] } }),
      activatedSkills: new Set(),
    });
    expect(payload.depends_on).toEqual(['hyperframes-core']);
    expect(payload.relations_note).toContain('"hyperframes-core"');
    expect(payload.relations_note).toContain('activate it too');
  });

  it('does not nag about already-activated dependencies', () => {
    const payload = buildActivationRelationsPayload({
      relations: extractRelations({ relations: { 'depends-on': ['core'], 'composes-with': ['side'] } }),
      activatedSkills: new Set(['core']),
    });
    expect(payload.depends_on).toEqual(['core']);
    expect(payload.relations_note).not.toContain('activate it too');
    expect(payload.relations_note).toContain('Composes well with: side');
  });

  it('surfaces supersedes and superseded_by warnings', () => {
    const payload = buildActivationRelationsPayload({
      relations: extractRelations({ relations: { supersedes: ['legacy'] } }),
      supersededBy: ['shinier-skill'],
    });
    expect(payload.supersedes).toEqual(['legacy']);
    expect(payload.superseded_by).toEqual(['shinier-skill']);
    expect(payload.relations_note).toContain('prefer this skill over those');
    expect(payload.relations_note).toContain('WARNING');
  });
});

describe('filterSupersededEntries', () => {
  it('drops entries superseded by a PRESENT successor', () => {
    const { entries, excluded } = filterSupersededEntries([
      { name: 'old-pipeline', description: 'legacy' },
      { name: 'new-pipeline', description: 'shiny', metadata: { relations: { supersedes: ['old-pipeline'] } } },
    ]);
    expect(entries.map((e) => e.name)).toEqual(['new-pipeline']);
    expect(excluded).toEqual(['old-pipeline']);
  });

  it('keeps entries whose successor is absent (never orphan a capability)', () => {
    const { entries, excluded } = filterSupersededEntries([
      { name: 'old-pipeline', description: 'legacy' },
      { name: 'unrelated', description: 'x', metadata: { relations: { supersedes: ['something-not-here'] } } },
    ]);
    expect(entries.length).toBe(2);
    expect(excluded).toEqual([]);
  });

  it('ignores self-supersession', () => {
    const { entries } = filterSupersededEntries([
      { name: 'weird', description: 'x', metadata: { relations: { supersedes: ['weird'] } } },
    ]);
    expect(entries.length).toBe(1);
  });

  it('handles empty input', () => {
    expect(filterSupersededEntries([]).entries).toEqual([]);
    expect(filterSupersededEntries(null).entries).toEqual([]);
  });
});

describe('buildForgeProvenance / relationsFromCandidate', () => {
  it('builds provenance from a candidate with rationale + confidence', () => {
    const prov = buildForgeProvenance(
      { rationale: '  From trace X; works when Y.  ', confidence: 0.82 },
      'goal-abc'
    );
    expect(prov['source-trace']).toBe('goal-abc');
    expect(prov.extracted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prov.rationale).toBe('From trace X; works when Y.');
    expect(prov.confidence).toBe(0.82);
  });

  it('omits rationale/confidence when the judge left them out', () => {
    const prov = buildForgeProvenance({}, 'goal-abc');
    expect(prov['source-trace']).toBe('goal-abc');
    expect(prov.rationale).toBeUndefined();
    expect(prov.confidence).toBeUndefined();
  });

  it('normalizes candidate relatedSkills to canonical kebab keys', () => {
    const rel = relationsFromCandidate({
      relatedSkills: { composesWith: ['media-use'], dependsOn: [], supersedes: ['old-one'] },
    });
    expect(rel).toEqual({ 'composes-with': ['media-use'], supersedes: ['old-one'] });
  });

  it('returns null when candidate declares no valid relations', () => {
    expect(relationsFromCandidate({ relatedSkills: { composesWith: [] } })).toBeNull();
    expect(relationsFromCandidate({ relatedSkills: null })).toBeNull();
    expect(relationsFromCandidate({})).toBeNull();
    expect(relationsFromCandidate(null)).toBeNull();
  });
});

describe('SKILL.md round-trip (parse → serialize → parse)', () => {
  const md = `---
name: hyperframes-cli
description: Use the HyperFrames CLI development loop for renders.
metadata:
  relations:
    depends-on:
      - hyperframes-core
    composes-with:
      - media-use
  provenance:
    source-trace: goal-123
    extracted: "2026-08-03"
    rationale: Extracted from render loop trace; generalizes to any batch render.
    confidence: 0.82
---

# HyperFrames CLI

Do the thing.
`;

  it('preserves relations and provenance through a full round-trip', () => {
    const parsed = parseSkillMd(md);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);

    const rel = extractRelations(parsed.frontmatter.metadata);
    expect(rel.dependsOn).toEqual(['hyperframes-core']);
    expect(rel.composesWith).toEqual(['media-use']);

    const serialized = serializeSkillMd({
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      metadata: parsed.frontmatter.metadata,
      instructions: parsed.instructions,
    });
    const reparsed = parseSkillMd(serialized);
    expect(reparsed.errors).toEqual([]);

    expect(extractRelations(reparsed.frontmatter.metadata)).toEqual(rel);
    expect(extractProvenance(reparsed.frontmatter.metadata)).toEqual(
      extractProvenance(parsed.frontmatter.metadata)
    );
    expect(reparsed.instructions).toBe(parsed.instructions);
  });

  it('parseSkillMd warns (not errors) on malformed relation blocks', () => {
    const bad = md.replace('depends-on:', 'conflicts-with:');
    const parsed = parseSkillMd(bad);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings.some((w) => w.includes('conflicts-with'))).toBe(true);
  });

  it('DB-shape metadata (JSON string) survives serializeSkillMd', () => {
    const serialized = serializeSkillMd({
      name: 'db-skill',
      description: 'A DB-backed skill.',
      metadata: JSON.stringify({ relations: { 'depends-on': ['core'] } }),
      instructions: 'Body.',
    });
    const reparsed = parseSkillMd(serialized);
    expect(extractRelations(reparsed.frontmatter.metadata).dependsOn).toEqual(['core']);
  });
});
