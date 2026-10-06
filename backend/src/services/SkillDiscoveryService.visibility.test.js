// Folder skills were one map per process, so every account listed, searched and
// activated every skill on disk. These pin the per-account view every caller
// outside the class now goes through.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../models/SkillModel.js', () => ({ default: { createOrUpdate: vi.fn(), findAll: vi.fn(async () => []) } }));

import { SkillDiscoveryService } from './SkillDiscoveryService.js';

let root;
let service;
let grants;
let adopted;

const discovered = (name, { client = 'agnt', scope = 'user', supersedes } = {}) => {
  const dirPath = path.join(root, client, name);
  fs.mkdirSync(path.join(dirPath, 'references'), { recursive: true });
  fs.writeFileSync(path.join(dirPath, 'references', 'notes.md'), `${name} notes`, 'utf8');
  return {
    name, displayName: name, description: `${name} description`, instructions: `${name} instructions`,
    frontmatter: { metadata: supersedes ? { relations: { supersedes: [supersedes] } } : {} },
    dirPath, skillMdPath: path.join(dirPath, 'SKILL.md'), scope, client, priority: 0, trusted: true,
  };
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-visibility-'));
  grants = new Map([['alice', new Set(['alices-skill', 'shared-by-name'])], ['bob', new Set(['bobs-skill'])]]);
  adopted = [];
  service = new SkillDiscoveryService();
  service.access = {
    adoptUnseen: async (names) => { adopted.push(...names); },
    namesFor: async (userId) => new Set(grants.get(userId) || []),
    isHomeOwner: async (userId) => userId === 'alice',
  };
  service.builtinNames = new Set(['frontend-design', 'shared-by-name']);
  service.skills = new Map([
    ['frontend-design', discovered('frontend-design')],
    ['alices-skill', discovered('alices-skill', { supersedes: 'frontend-design' })],
    ['bobs-skill', discovered('bobs-skill', { client: 'claude' })],
    // A built-in's name in somebody else's folder is their file, not ours.
    ['shared-by-name', discovered('shared-by-name', { client: 'claude' })],
  ]);
  service.parseFailures = [
    { name: 'alices-skill', path: 'a', errors: ['x'], skipped: false, at: 'now' },
    { name: 'secret-broken-skill', path: 'b', errors: ['y'], skipped: true, at: 'now' },
  ];
});

const names = (skills) => skills.map((s) => s.name).sort();

describe('SkillDiscoveryService: one scan, a separate view per account', () => {
  it('shows shipped built-ins to everyone and owned skills only to their owners', async () => {
    expect(names(await service.visibleSkills('alice'))).toEqual(['alices-skill', 'frontend-design', 'shared-by-name']);
    expect(names(await service.visibleSkills('bob'))).toEqual(['bobs-skill', 'frontend-design']);
    expect(names(await service.visibleSkills('carol'))).toEqual(['frontend-design']);
    expect(names(await service.visibleSkills(undefined))).toEqual(['frontend-design']);
  });

  it('adopts what it finds before deciding, and never offers a built-in for adoption', async () => {
    await service.visibleSkills('bob');
    expect(adopted.sort()).toEqual(['alices-skill', 'bobs-skill', 'shared-by-name']);
  });

  it("will not hand another account's skill to activate_skill, /skill or the discovery routes", async () => {
    expect(await service.getSkillContentFor('alices-skill', 'bob')).toBeNull();
    expect(await service.getSkillFor('alices-skill', 'bob')).toBeNull();
    expect(await service.listResourcesFor('alices-skill', 'bob')).toBeNull();
    expect(await service.readResourceFor('alices-skill', 'references/notes.md', 'bob')).toBeNull();

    expect((await service.getSkillContentFor('alices-skill', 'alice')).instructions).toBe('alices-skill instructions');
    expect(await service.readResourceFor('alices-skill', 'references/notes.md', 'alice')).toBe('alices-skill notes');
    expect((await service.getSkillContentFor('frontend-design', 'bob')).name).toBe('frontend-design');
  });

  it('builds the catalog from the visible set', async () => {
    const catalog = await service.getSkillCatalogFor('bob');
    expect(catalog.map((c) => c.name).sort()).toEqual(['bobs-skill', 'frontend-design']);
    expect(catalog[0]).toMatchObject({ source: 'filesystem' });
  });

  it("does not name another account's skill as a superseding hint", async () => {
    expect(await service.getSupersededByFor('frontend-design', 'alice')).toEqual(['alices-skill']);
    expect(await service.getSupersededByFor('frontend-design', 'bob')).toEqual([]);
  });

  it('shows every parse failure to the instance owner and only their own to anyone else', async () => {
    expect((await service.getParseFailuresFor('alice')).map((f) => f.name)).toEqual(['alices-skill', 'secret-broken-skill']);
    expect(await service.getParseFailuresFor('bob')).toEqual([]);
    expect(await service.getParseFailuresFor(undefined)).toEqual([]);
  });

  it('fails closed to the built-ins when ownership cannot be read', async () => {
    service.access.namesFor = async () => { throw new Error('database is locked'); };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(names(await service.visibleSkills('alice'))).toEqual(['frontend-design']);
    expect(await service.getSkillContentFor('alices-skill', 'alice')).toBeNull();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
