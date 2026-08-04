/**
 * The skill documentation must describe the skill API that exists.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * docContract.test.js pins the STRUCTURAL claims of the API docs — which mounts
 * exist, which routes need credentials, which env vars are real. Nothing pinned
 * the RESPONSE SHAPES, and they drifted exactly the way everything unchecked
 * drifts:
 *
 *   `GET /api/skills/discovered` was documented as returning entries with
 *   `dirPath` and `frontmatter`, and `source: "user|project"`. It returns
 *   neither of those fields, and `source` is always the literal `"filesystem"`
 *   (the user/project distinction is `scope`). An integrator following the doc
 *   would read `entry.frontmatter.metadata` and get `undefined` forever, with
 *   nothing to tell them the doc was wrong rather than their code.
 *
 * A documented field name is a promise. This walks the REAL objects the service
 * builds and compares them against the JSON examples in the doc, in both
 * directions — a documented-but-absent field is a lie, and a real-but-
 * undocumented field is a gap.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('../models/SkillModel.js', () => ({
  default: { createOrUpdate: vi.fn(), findAll: vi.fn(async () => []) },
}));

import SkillDiscoveryService from '../services/SkillDiscoveryService.js';
import { RELATION_KEYS } from '../utils/skillRelations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DOC_PATH = path.join(REPO, 'docs/_API-DOCUMENTATION.md');

let doc = '';
let discoverySection = '';
let skillsSection = '';
let root;

/** Text of the `## <name>` section that declares the given base path. */
function sectionForBasePath(text, basePath) {
  for (const part of text.split(/^## /m)) {
    const m = part.match(/Base path:\s*`([^`]+)`/);
    if (m && m[1].replace(/\/$/, '') === basePath) return part;
  }
  return '';
}

/** Every ```json fence in a section, parsed. Unparseable fences are a failure. */
function jsonFences(section) {
  const out = [];
  for (const m of section.matchAll(/```json\r?\n([\s\S]*?)```/g)) {
    const body = m[1];
    if (body.includes('...')) continue; // deliberate elision, e.g. { "skill": { ... } }
    out.push({ raw: body, value: JSON.parse(body) });
  }
  return out;
}

function writeSkill(name, content) {
  const dir = path.join(root, '.agnt', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
}

/**
 * The body of a `#### <heading>` block inside the relations subsection, stopping
 * at the next heading of any level. Assertions scoped to a specific table
 * cannot be satisfied by prose elsewhere in the section.
 */
function relationsSubBlock(heading) {
  const section = doc.split(/^### Skill relations and provenance/m)[1];
  if (!section) return '';
  const after = section.split(new RegExp(`^#### ${heading}`, 'm'))[1];
  return after ? after.split(/^#{2,4} /m)[0] : '';
}

const relationTable = () => relationsSubBlock('Relation types');
const provenanceTable = () => relationsSubBlock('Provenance fields');

beforeAll(async () => {
  doc = fs.readFileSync(DOC_PATH, 'utf8');
  discoverySection = sectionForBasePath(doc, '/api/skills/discovered');
  skillsSection = sectionForBasePath(doc, '/api/skills');

  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-docs-'));
  writeSkill(
    'documented-skill',
    '---\nname: documented-skill\ndescription: A skill used to sample the real response shape.\n' +
      'metadata:\n  relations:\n    depends-on:\n      - other-skill\n---\n\n# Documented\n'
  );
  // Unloadable on purpose: produces a real parseFailures record to compare against.
  writeSkill('unparseable-skill', '# No Frontmatter\n\n## Overview\nNothing parseable here.\n');

  await SkillDiscoveryService.setProjectRoot(root);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('skill API documentation contract', () => {
  it('found both skill sections and a live sample to compare against', () => {
    // Guards the guard: every assertion below is vacuous if these are empty.
    expect(discoverySection, 'no "Base path: `/api/skills/discovered`" section').toBeTruthy();
    expect(skillsSection, 'no "Base path: `/api/skills`" section').toBeTruthy();
    // The table matchers below are scoped; if scoping returns nothing they pass
    // on an empty string and prove nothing.
    expect(relationTable(), 'no "Relation types" table found').toBeTruthy();
    expect(provenanceTable(), 'no "Provenance fields" table found').toBeTruthy();
    expect(SkillDiscoveryService.getSkill('documented-skill')).toBeTruthy();
    expect(SkillDiscoveryService.getParseFailures().length).toBeGreaterThan(0);
  });

  it('the documented catalog entry has exactly the fields the service returns', () => {
    const real = SkillDiscoveryService.getSkillCatalog().find((s) => s.name === 'documented-skill');
    expect(real, 'temp skill missing from the real catalog').toBeTruthy();

    const example = jsonFences(discoverySection).find((f) => Array.isArray(f.value.skills) && f.value.skills[0]);
    expect(example, 'no catalog JSON example found in the discovery section').toBeTruthy();

    const documented = Object.keys(example.value.skills[0]).sort();
    const actual = Object.keys(real).sort();

    expect(
      documented.filter((k) => !actual.includes(k)),
      'Documented catalog fields that the service does NOT return'
    ).toEqual([]);
    expect(
      actual.filter((k) => !documented.includes(k)),
      'Catalog fields the service returns that are NOT documented'
    ).toEqual([]);
  });

  it('documents source as the literal the service emits, not the scope values', () => {
    // The specific lie this file was written for: `source` never carried the
    // user/project distinction, but the doc said "user|project".
    const real = SkillDiscoveryService.getSkillCatalog()[0];
    expect(real.source).toBe('filesystem');
    expect(discoverySection).not.toMatch(/"source":\s*"user\|project"/);
    expect(discoverySection).toMatch(/"source":\s*"filesystem"/);
  });

  it('the documented parseFailures record matches the real one', () => {
    const real = SkillDiscoveryService.getParseFailures().find((f) => f.name === 'unparseable-skill');
    expect(real, 'unparseable skill produced no failure record').toBeTruthy();

    const example = jsonFences(discoverySection).find(
      (f) => Array.isArray(f.value.parseFailures) && f.value.parseFailures[0]
    );
    expect(example, 'parseFailures is documented without a worked example').toBeTruthy();

    expect(Object.keys(example.value.parseFailures[0]).sort()).toEqual(Object.keys(real).sort());
  });

  it('documents every relation type the parser actually supports', () => {
    // Scoped to the reference TABLE, not the whole subsection. Asserting a bare
    // backticked mention anywhere in the block is vacuous: renaming the
    // `supersedes` table row still passed, because the prose two paragraphs
    // down says "declares that it `supersedes` it". (Caught by control ND2.)
    for (const key of RELATION_KEYS) {
      expect(
        relationTable(),
        `relation type has no row in the "Relation types" table: ${key}`
      ).toMatch(new RegExp(`^\\|\\s*\`${key}\`\\s*\\|`, 'm'));
    }
    for (const field of ['source-trace', 'extracted', 'rationale', 'confidence', 'history']) {
      expect(
        provenanceTable(),
        `provenance field has no row in the "Provenance fields" table: ${field}`
      ).toMatch(new RegExp(`^\\|\\s*\`${field}\`\\s*\\|`, 'm'));
    }
  });

  it('documents no relation type the parser would silently ignore', () => {
    // The reverse lie: a documented relation type that extractRelations drops.
    const rows = [...relationTable().matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]);
    expect(rows.length, 'no rows parsed from the relation table').toBeGreaterThan(0);
    expect(
      rows.filter((r) => !RELATION_KEYS.includes(r)),
      'Documented relation types that skillRelations does not implement'
    ).toEqual([]);
  });

  it('documents the two catalog behaviours relations actually drive', () => {
    const block = doc.split(/^### Skill relations and provenance/m)[1].split(/^## /m)[0];
    // Both are observable in the prompt, so a consumer will hit them.
    expect(block, 'the [needs: ...] catalog annotation is undocumented').toContain('[needs: hyperframes-core]');
    expect(block, 'supersession catalog filtering is undocumented').toMatch(/omitted from the catalog/i);
    // The non-obvious half of the rule: an absent successor must not orphan.
    expect(block).toMatch(/successor is absent/i);
  });

  it('warns that metadata is a string on /api/skills and an object on discovery', () => {
    // The single most likely integration bug: same field name, two encodings.
    const block = doc.split(/^### Skill relations and provenance/m)[1].split(/^## /m)[0];
    expect(block).toMatch(/JSON \*\*string\*\*/);
    expect(block).toMatch(/\*\*object\*\*/);
  });

  it('every ```json example in both skill sections is parseable', () => {
    // A malformed example is copy-pasted straight into a caller's code.
    expect(() => jsonFences(discoverySection)).not.toThrow();
    expect(() => jsonFences(skillsSection)).not.toThrow();
    expect(jsonFences(discoverySection).length).toBeGreaterThan(2);
  });

  it('same-page anchors used in the skill sections resolve to real headings', () => {
    const slug = (h) =>
      h.trim().toLowerCase().replace(/[`*_~]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    const headings = new Set([...doc.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map((m) => slug(m[1])));
    expect(headings.size).toBeGreaterThan(50);

    const broken = [];
    let checked = 0;
    for (const section of [discoverySection, skillsSection]) {
      for (const m of section.matchAll(/\]\(#([\w-]+)\)/g)) {
        checked++;
        if (!headings.has(m[1])) broken.push(m[1]);
      }
    }
    expect(checked, 'no same-page anchors parsed — the matcher is broken').toBeGreaterThan(0);
    expect(broken, `Anchors with no matching heading:\n  ${broken.join('\n  ')}`).toEqual([]);
  });
});
