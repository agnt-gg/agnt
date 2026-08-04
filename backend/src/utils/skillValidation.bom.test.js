// A UTF-8 BOM used to defeat the ^--- frontmatter anchor in parseSkillMd.
// The failure was silent and actively misleading: the file fell through to the
// loose-format parser, invented a name from its H1, and reported a bogus
// "missing description" error — so a valid skill looked like a malformed one.
// Windows editors add BOMs on save, so this recurs until the parser tolerates it.
import { describe, it, expect } from 'vitest';
import { parseSkillMd } from './skillValidation.js';

const BOM = '\uFEFF';

const SKILL = `---
name: bom-skill
description: A skill whose file was saved with a byte order mark.
metadata:
  relations:
    depends-on:
      - other-skill
---

# BOM Skill

Body text.
`;

describe('parseSkillMd — UTF-8 BOM tolerance', () => {
  it('parses frontmatter identically with and without a BOM', () => {
    const clean = parseSkillMd(SKILL);
    const withBom = parseSkillMd(BOM + SKILL);

    expect(clean.errors).toEqual([]);
    expect(withBom.errors).toEqual([]);
    expect(withBom.frontmatter.name).toBe('bom-skill');
    expect(withBom.frontmatter.description).toBe(clean.frontmatter.description);
    expect(withBom.instructions).toBe(clean.instructions);
    expect(withBom.frontmatter.metadata).toEqual(clean.frontmatter.metadata);
  });

  it('does not leak the BOM into the parsed name', () => {
    const parsed = parseSkillMd(BOM + SKILL);
    expect(parsed.frontmatter.name.charCodeAt(0)).not.toBe(0xFEFF);
    expect(parsed.frontmatter.name).not.toContain(BOM);
  });

  it('regression: a BOM no longer forces the loose-format fallback', () => {
    // The exact pre-fix symptom — a name derived from the H1 plus a phantom
    // "no ## Description section found" error on a file that HAS a description.
    const parsed = parseSkillMd(BOM + SKILL);
    expect(parsed.frontmatter.name).not.toBe('bom-skill-heading');
    expect(parsed.errors.join(' ')).not.toMatch(/## Description/);
  });

  it('still parses genuinely loose-format files when a BOM is present', () => {
    const loose = `${BOM}# Some Skill\n\n## Description\nDoes a thing.\n`;
    const parsed = parseSkillMd(loose);
    expect(parsed.frontmatter.description).toBe('Does a thing.');
  });

  it('leaves a mid-document U+FEFF alone (only the leading one is a BOM)', () => {
    const parsed = parseSkillMd(SKILL.replace('Body text.', `Body${BOM}text.`));
    expect(parsed.errors).toEqual([]);
    expect(parsed.instructions).toContain(BOM);
  });
});
