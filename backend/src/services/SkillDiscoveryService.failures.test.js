// A skill that fails to parse used to vanish from the catalog with nothing but
// a console.warn — no API, no UI, no signal. That silence is why two broken
// skills sat unnoticed for months. Parse failures are now recorded per scan
// and exposed via getParseFailures().
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../models/SkillModel.js', () => ({ default: { createOrUpdate: vi.fn(), findAll: vi.fn(async () => []) } }));

import SkillDiscoveryService from './SkillDiscoveryService.js';

let root;

function writeSkill(name, content) {
  const dir = path.join(root, '.agnt', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-failures-'));

  writeSkill('good-skill', '---\nname: good-skill\ndescription: A loadable skill.\n---\n\n# Good\n');
  // Valid frontmatter, saved with a BOM — must load despite it.
  writeSkill('bom-skill', '\uFEFF---\nname: bom-skill\ndescription: Saved with a byte order mark.\n---\n\n# BOM\n');
  // No frontmatter and no ## Description — genuinely unloadable.
  writeSkill('broken-skill', '# Broken Skill\n\n## Overview\nNo description section anywhere.\n');

  await SkillDiscoveryService.setProjectRoot(root);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const failureFor = (name) => SkillDiscoveryService.getParseFailures().find((f) => f.name === name);

describe('SkillDiscoveryService — parse failure visibility', () => {
  it('loads a valid skill and reports no failure for it', () => {
    expect(SkillDiscoveryService.getSkill('good-skill')).toBeTruthy();
    expect(failureFor('good-skill')).toBeUndefined();
  });

  it('loads a BOM-prefixed skill with its real name (root fix, end to end)', () => {
    const skill = SkillDiscoveryService.getSkill('bom-skill');
    expect(skill).toBeTruthy();
    expect(skill.description).toBe('Saved with a byte order mark.');
    expect(failureFor('bom-skill')).toBeUndefined();
  });

  it('records an unloadable skill instead of dropping it silently', () => {
    const failure = failureFor('broken-skill');
    expect(failure).toBeTruthy();
    expect(failure.skipped).toBe(true);
    expect(failure.path).toContain('broken-skill');
    expect(failure.errors.length).toBeGreaterThan(0);
    expect(failure.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // It is genuinely absent from the catalog — the record is the only signal.
    expect(SkillDiscoveryService.getSkill('broken-skill')).toBeFalsy();
  });

  it('getParseFailures returns a copy callers cannot mutate', () => {
    const before = SkillDiscoveryService.getParseFailures().length;
    SkillDiscoveryService.getParseFailures().push({ name: 'injected' });
    expect(SkillDiscoveryService.getParseFailures().length).toBe(before);
  });

  it('rebuilds the failure list on rescan rather than accumulating', async () => {
    const first = SkillDiscoveryService.getParseFailures().length;
    expect(first).toBeGreaterThan(0);
    await SkillDiscoveryService.discoverAll();
    expect(SkillDiscoveryService.getParseFailures().length).toBe(first);
    expect(failureFor('broken-skill')).toBeTruthy();
  });

  it('clears the failure once the underlying file is repaired', async () => {
    writeSkill('broken-skill', '---\nname: broken-skill\ndescription: Now repaired.\n---\n\n# Fixed\n');
    await SkillDiscoveryService.discoverAll();
    expect(failureFor('broken-skill')).toBeUndefined();
    expect(SkillDiscoveryService.getSkill('broken-skill')).toBeTruthy();
  });
});
