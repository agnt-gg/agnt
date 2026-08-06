import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The importer writes to the user's disk and database, so these tests are
 * about what it must never do: overwrite something that already exists, leave
 * half an import behind when a step fails, or write outside AGNT's own folder.
 */

let TMP;
let HOME;
let calls;

const write = (rel, content) => {
  const target = path.join(HOME, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
};

const skill = (rel, name) =>
  write(`${rel}/SKILL.md`, `---\nname: ${name}\ndescription: test\n---\n\n# ${name}\n`);

/**
 * @param {object} [opts]
 * @param {(content: string) => boolean} [opts.rejectSkill]
 *        Which SKILL.md the registration step should refuse. Modelled on the
 *        real failure — `parseSkillMd` rejecting malformed frontmatter — rather
 *        than on a broken file, because a directory that has no readable
 *        SKILL.md is never offered as a skill in the first place.
 */
async function loadImporter({ rejectSkill = null } = {}) {
  vi.resetModules();
  calls = { skills: [], agents: [], memories: [], rescans: 0 };

  vi.doMock('../SkillDiscoveryService.js', () => ({
    default: {
      getSkillCatalog: () => [],
      discoverAll: async () => { calls.rescans += 1; },
    },
  }));
  vi.doMock('../../models/SkillModel.js', () => ({ default: { findAll: async () => [] } }));
  vi.doMock('../SkillService.js', () => ({
    importSkillFromMd: async (content) => {
      if (rejectSkill?.(content)) throw new Error('Invalid SKILL.md');
      calls.skills.push(content);
      return { id: 'skill-1', slug: 's', warnings: [] };
    },
  }));
  vi.doMock('../AgentImportService.js', () => ({
    importAgent: async (payload) => {
      calls.agents.push(payload);
      return { id: 'agent-1', missingRefs: [] };
    },
  }));
  vi.doMock('../../models/AgentMemoryModel.js', () => ({
    default: {
      create: async (row) => { calls.memories.push(row); return 'mem-1'; },
    },
  }));

  const mod = await import('./HarnessImporter.js');
  return mod.default;
}

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-import-'));
  HOME = path.join(TMP, 'home');
  fs.mkdirSync(HOME, { recursive: true });
  vi.spyOn(os, 'homedir').mockReturnValue(HOME);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const agntSkill = (name) => path.join(HOME, '.agnt', 'skills', name);

describe('HarnessImporter — skills', () => {
  it('copies a skill into AGNT and registers it', async () => {
    skill('.hermes/skills/alpha', 'alpha');
    write('.hermes/skills/alpha/scripts/run.sh', 'echo hi');

    const Importer = await loadImporter();
    const result = await Importer.run({ skills: ['hermes'] }, 'user-1', { env: {} });

    expect(fs.existsSync(path.join(agntSkill('alpha'), 'SKILL.md'))).toBe(true);
    // The whole tree, not just the manifest — a skill's scripts are the skill.
    expect(fs.existsSync(path.join(agntSkill('alpha'), 'scripts', 'run.sh'))).toBe(true);
    expect(calls.skills).toHaveLength(1);
    expect(result.imported.skills).toBe(1);
  });

  it('never overwrites a skill AGNT already has', async () => {
    write('.agnt/skills/alpha/SKILL.md', 'MINE — do not clobber');
    skill('.hermes/skills/alpha', 'alpha');

    const Importer = await loadImporter();
    await Importer.run({ skills: ['hermes'] }, 'user-1', { env: {} });

    expect(fs.readFileSync(path.join(agntSkill('alpha'), 'SKILL.md'), 'utf8'))
      .toBe('MINE — do not clobber');
  });

  it('refuses a destination that exists but the scan did not know about', async () => {
    /**
     * The test above passes without the importer's own check, because the
     * SCANNER already filters out anything in AGNT's skills folder — so the
     * importer never reaches that name. It proves the first line of defence
     * and says nothing about the second.
     *
     * This is the case only the second one catches: a directory the scan does
     * not count as a skill, because it has no SKILL.md, but which is
     * nonetheless sitting on the path we are about to write to. A half-created
     * folder from an interrupted run looks exactly like this.
     */
    fs.mkdirSync(path.join(agntSkill('alpha'), 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(agntSkill('alpha'), 'scripts', 'keep.sh'), 'precious', 'utf8');
    skill('.hermes/skills/alpha', 'alpha');

    const Importer = await loadImporter();
    const result = await Importer.run({ skills: ['hermes'] }, 'user-1', { env: {} });

    expect(fs.readFileSync(path.join(agntSkill('alpha'), 'scripts', 'keep.sh'), 'utf8')).toBe('precious');
    expect(fs.existsSync(path.join(agntSkill('alpha'), 'SKILL.md'))).toBe(false);
    expect(result.imported.skills).toBe(0);
    expect(result.items.find((i) => i.name === 'alpha').status).toBe('skipped');
  });

  it('removes the copied files when registering the skill fails', async () => {
    // A directory with no row is invisible in the UI, so a half-import is
    // worse than none: the user sees nothing and the name is now taken.
    skill('.hermes/skills/alpha', 'alpha');

    const Importer = await loadImporter({ rejectSkill: () => true });
    const result = await Importer.run({ skills: ['hermes'] }, 'user-1', { env: {} });

    expect(fs.existsSync(agntSkill('alpha'))).toBe(false);
    expect(result.imported.skills).toBe(0);
    expect(result.failures).toHaveLength(1);
  });

  it('keeps going after one skill fails', async () => {
    // Importing five things and hitting one bad file should leave four things
    // and one honest line — not zero things and a stack trace.
    skill('.hermes/skills/alpha', 'alpha');
    skill('.hermes/skills/beta', 'beta');

    const Importer = await loadImporter({ rejectSkill: (md) => md.includes('name: alpha') });
    const result = await Importer.run({ skills: ['hermes'] }, 'user-1', { env: {} });

    expect(result.imported.skills).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].name).toBe('alpha');
    // The one that worked is intact; the one that failed left nothing behind.
    expect(fs.existsSync(agntSkill('beta'))).toBe(true);
    expect(fs.existsSync(agntSkill('alpha'))).toBe(false);
  });

  it('ignores a directory whose SKILL.md is not a readable file', async () => {
    // Never offered, so never a failure either — it is simply not a skill.
    skill('.hermes/skills/beta', 'beta');
    fs.mkdirSync(path.join(HOME, '.hermes/skills/alpha/SKILL.md'), { recursive: true });

    const Importer = await loadImporter();
    const result = await Importer.run({ skills: ['hermes'] }, 'user-1', { env: {} });

    expect(result.imported.skills).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it('refreshes the catalog so an imported skill is visible immediately', async () => {
    skill('.hermes/skills/alpha', 'alpha');
    const Importer = await loadImporter();
    await Importer.run({ skills: ['hermes'] }, 'user-1', { env: {} });
    expect(calls.rescans).toBe(1);
  });

  it('does not rescan when nothing was copied', async () => {
    const Importer = await loadImporter();
    await Importer.run({ skills: ['hermes'] }, 'user-1', { env: {} });
    expect(calls.rescans).toBe(0);
  });

  it("skips the source tool's own bookkeeping files", async () => {
    skill('.hermes/skills/alpha', 'alpha');
    write('.hermes/skills/alpha/.usage.json', '{"runs":4}');
    const Importer = await loadImporter();
    await Importer.run({ skills: ['hermes'] }, 'user-1', { env: {} });
    expect(fs.existsSync(path.join(agntSkill('alpha'), '.usage.json'))).toBe(false);
  });
});

describe('HarnessImporter — persona', () => {
  it('creates an agent from the persona', async () => {
    write('.hermes/SOUL.md', 'You are Hermes Agent.');
    const Importer = await loadImporter();
    const result = await Importer.run({ personas: ['hermes'] }, 'user-1', { env: {} });

    expect(calls.agents).toHaveLength(1);
    expect(calls.agents[0].systemPrompt).toContain('You are Hermes Agent.');
    expect(result.imported.agents).toBe(1);
  });

  it('leaves provider and model empty so the agent can actually run', async () => {
    // The source tool's model names an account AGNT may not have. Empty means
    // "use whatever the user just connected", which is the one we know works.
    write('.hermes/SOUL.md', 'A persona.');
    const Importer = await loadImporter();
    await Importer.run({ personas: ['hermes'] }, 'user-1', { env: {} });
    expect(calls.agents[0].provider).toBe('');
    expect(calls.agents[0].model).toBe('');
  });

  it('creates nothing when the persona is an unedited template', async () => {
    write('.openclaw/workspace/SOUL.md', '- **Name:**\n  _(pick something you like)_');
    const Importer = await loadImporter();
    const result = await Importer.run({ personas: ['openclaw'] }, 'user-1', { env: {} });
    expect(calls.agents).toHaveLength(0);
    expect(result.imported.agents).toBe(0);
  });
});

describe('HarnessImporter — memories', () => {
  it('writes each memory separately', async () => {
    write('.hermes/memories/USER.md', 'One.\n§\nTwo.');
    const Importer = await loadImporter();
    const result = await Importer.run({ memories: ['hermes'] }, 'user-1', { env: {} });
    expect(calls.memories).toHaveLength(2);
    expect(result.imported.memories).toBe(2);
  });

  it('attaches memories to the agent from the same import when there is one', async () => {
    write('.hermes/SOUL.md', 'A persona.');
    write('.hermes/memories/USER.md', 'One.');
    const Importer = await loadImporter();
    await Importer.run({ personas: ['hermes'], memories: ['hermes'] }, 'user-1', { env: {} });
    expect(calls.memories[0].agentId).toBe('agent-1');
  });

  it('falls back to the orchestrator when no agent was imported', async () => {
    // The assistant the user is about to talk to — where they would expect
    // their old notes to surface.
    write('.hermes/memories/USER.md', 'One.');
    const Importer = await loadImporter();
    await Importer.run({ memories: ['hermes'] }, 'user-1', { env: {} });
    expect(calls.memories[0].agentId).toBe('orchestrator');
  });

  it('types an imported memory as context, not as something the user said', async () => {
    write('.hermes/memories/USER.md', 'One.');
    const Importer = await loadImporter();
    await Importer.run({ memories: ['hermes'] }, 'user-1', { env: {} });
    expect(calls.memories[0].memoryType).toBe('context');
  });
});

describe('HarnessImporter — refusing what was not offered', () => {
  it('imports nothing from a harness the user did not tick', async () => {
    skill('.hermes/skills/alpha', 'alpha');
    write('.hermes/SOUL.md', 'A persona.');
    const Importer = await loadImporter();
    const result = await Importer.run({ skills: [], personas: [], memories: [] }, 'user-1', { env: {} });
    expect(result.imported).toEqual({ skills: 0, agents: 0, memories: 0 });
    expect(fs.existsSync(agntSkill('alpha'))).toBe(false);
  });

  it('ignores a harness id that is not a real harness', async () => {
    // The selection arrives from a browser. Nothing here may be used as a
    // path, so a forged id can only ever match nothing.
    const Importer = await loadImporter();
    const result = await Importer.run(
      { skills: ['../../etc', 'not-a-tool'] }, 'user-1', { env: {} },
    );
    expect(result.imported.skills).toBe(0);
    expect(result.failures).toEqual([]);
  });

  it('requires a user', async () => {
    const Importer = await loadImporter();
    await expect(Importer.run({ skills: ['hermes'] }, null, { env: {} })).rejects.toThrow(/userId/);
  });
});
