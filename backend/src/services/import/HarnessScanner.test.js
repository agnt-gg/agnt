import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Fixtures are built on a real temp filesystem rather than mocked, because
 * every bug this scanner can have is a filesystem bug: a path that does not
 * exist, a directory without the file that makes it a skill, a template nobody
 * filled in. A mocked `fs` would agree with whatever the code believes.
 */

let TMP;
let HOME;

const write = (rel, content) => {
  const target = path.join(HOME, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
};

const skill = (rel, name) => write(`${rel}/SKILL.md`, `---\nname: ${name}\ndescription: test skill\n---\n\n# ${name}\n`);

/** Load the scanner fresh so its module-level state cannot leak between tests. */
async function loadScanner() {
  vi.resetModules();
  vi.doMock('../SkillDiscoveryService.js', () => ({ default: { getSkillCatalog: () => [] } }));
  vi.doMock('../../models/SkillModel.js', () => ({ default: { findAll: async () => [] } }));
  const mod = await import('./HarnessScanner.js');
  return mod.default;
}

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-scan-'));
  HOME = path.join(TMP, 'home');
  fs.mkdirSync(HOME, { recursive: true });
  vi.spyOn(os, 'homedir').mockReturnValue(HOME);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('../SkillDiscoveryService.js');
  vi.doUnmock('../../models/SkillModel.js');
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('HarnessScanner.detect — finding tools', () => {
  it('finds nothing on a machine with no other AI tools', async () => {
    const Scanner = await loadScanner();
    const result = await Scanner.detect({ env: {} });
    expect(result.sources).toEqual([]);
    expect(result.totals.skillsImportable).toBe(0);
  });

  it('finds each installed harness', async () => {
    skill('.hermes/skills/alpha', 'alpha');
    skill('.claude/skills/beta', 'beta');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    expect(sources.map((s) => s.id).sort()).toEqual(['claude', 'hermes']);
  });

  it('honours the environment variable that relocates a harness home', async () => {
    // HERMES_HOME is documented and the installer honours it, so a scanner
    // that only looks in ~/.hermes silently reports nothing for those users.
    const relocated = path.join(TMP, 'elsewhere');
    fs.mkdirSync(path.join(relocated, 'skills'), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(relocated, 'skills', 'moved', 'SKILL.md')), { recursive: true });
    fs.writeFileSync(path.join(relocated, 'skills', 'moved', 'SKILL.md'),
      '---\nname: moved\ndescription: d\n---\n', 'utf8');

    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: { HERMES_HOME: relocated } });
    const hermes = sources.find((s) => s.id === 'hermes');
    expect(hermes.skills.names).toContain('moved');
  });
});

describe('HarnessScanner.detect — what counts as a skill', () => {
  it('ignores a directory with no SKILL.md', async () => {
    skill('.hermes/skills/real', 'real');
    fs.mkdirSync(path.join(HOME, '.hermes/skills/not-a-skill'), { recursive: true });
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    expect(sources[0].skills.names).toEqual(['real']);
  });

  it("ignores a tool's own dot-directories", async () => {
    // Codex keeps a `.system` folder beside the user's skills; it is not one.
    skill('.codex/skills/mine', 'mine');
    skill('.codex/skills/.system', 'system');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    expect(sources[0].skills.names).toEqual(['mine']);
  });

  it('counts a skill once when several tools hold the same one', async () => {
    // The normal case, not the exception: these files are usually the same
    // skill synced across tools. Offering it twice would import it twice.
    skill('.hermes/skills/shared', 'shared');
    skill('.claude/skills/shared', 'shared');
    const Scanner = await loadScanner();
    const { sources, totals } = await Scanner.detect({ env: {} });
    expect(totals.skillsImportable).toBe(1);
    const offering = sources.filter((s) => s.skills.importable > 0);
    expect(offering).toHaveLength(1);
  });

  it('still reports how many each tool has, separately from what is new', async () => {
    skill('.hermes/skills/shared', 'shared');
    skill('.claude/skills/shared', 'shared');
    const Scanner = await loadScanner();
    const { sources, totals } = await Scanner.detect({ env: {} });
    // Both tools SEE one; only one of them can contribute it.
    expect(sources.every((s) => s.skills.total === 1)).toBe(true);
    expect(totals.skillsSeen).toBe(2);
  });

  it('does not offer a skill AGNT already has on disk', async () => {
    // The check that must work without a userId: this is what stops the
    // wizard promising nine skills and then importing two.
    skill('.agnt/skills/already', 'already');
    skill('.hermes/skills/already', 'already');
    skill('.hermes/skills/genuinely-new', 'genuinely-new');
    const Scanner = await loadScanner();
    const { sources, totals } = await Scanner.detect({ env: {} });
    const hermes = sources.find((s) => s.id === 'hermes');
    expect(hermes.skills.names).toEqual(['genuinely-new']);
    expect(totals.skillsImportable).toBe(1);
  });
});

describe('HarnessScanner.detect — persona', () => {
  it('reads a persona and reports where it came from', async () => {
    write('.hermes/SOUL.md', 'You are Hermes Agent, direct and useful.');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    expect(sources[0].persona.available).toBe(true);
    expect(sources[0].persona.origins).toEqual(['SOUL.md']);
  });

  it("joins OpenClaw's operating rules onto its persona", async () => {
    // AGENTS.md is the behavioural spec and the most valuable non-obvious
    // thing in an OpenClaw install; SOUL.md alone imports voice without rules.
    write('.openclaw/workspace/SOUL.md', 'Be genuinely helpful.');
    write('.openclaw/workspace/AGENTS.md', 'Always run tests before claiming done.');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    const openclaw = sources.find((s) => s.id === 'openclaw');
    expect(openclaw.persona.origins).toEqual(['SOUL.md', 'AGENTS.md']);
  });

  it('refuses an unedited bootstrap template', async () => {
    // Importing this hands the user a persona describing a form they never
    // filled in, which is worse than importing nothing.
    write('.openclaw/workspace/SOUL.md', '# IDENTITY\n\n- **Name:**\n  _(pick something you like)_\n');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    const openclaw = sources.find((s) => s.id === 'openclaw');
    expect(openclaw.persona.available).toBe(false);
  });

  it('refuses a whitespace-only persona', async () => {
    write('.hermes/SOUL.md', '   \n\n  ');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    expect(sources[0].persona.available).toBe(false);
  });

  it('resolves the OpenClaw workspace from the environment', async () => {
    const custom = path.join(TMP, 'ocws');
    fs.mkdirSync(custom, { recursive: true });
    fs.writeFileSync(path.join(custom, 'SOUL.md'), 'Custom workspace persona.', 'utf8');
    fs.mkdirSync(path.join(HOME, '.openclaw'), { recursive: true });

    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: { OPENCLAW_WORKSPACE_DIR: custom } });
    const openclaw = sources.find((s) => s.id === 'openclaw');
    expect(openclaw.persona.available).toBe(true);
  });
});

describe('HarnessScanner.detect — memories', () => {
  it('splits a delimited memory file into separate memories', async () => {
    write('.hermes/memories/USER.md', 'First thing.\n§\nSecond thing.\n§\nThird thing.');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    expect(sources[0].memories.count).toBe(3);
  });

  it('treats a file with no delimiter as one memory, not zero', async () => {
    write('.openclaw/workspace/MEMORY.md', 'The user prefers concise answers.');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    const openclaw = sources.find((s) => s.id === 'openclaw');
    expect(openclaw.memories.count).toBe(1);
  });

  it('reports zero for a missing memory file rather than failing', async () => {
    // A fresh OpenClaw has no MEMORY.md at all. Honest zero beats an error.
    skill('.openclaw/skills/x', 'x');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    const openclaw = sources.find((s) => s.id === 'openclaw');
    expect(openclaw.memories.count).toBe(0);
  });

  it('drops empty blocks between delimiters', async () => {
    write('.hermes/memories/USER.md', 'Real.\n§\n\n§\n   \n§\nAlso real.');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    expect(sources[0].memories.count).toBe(2);
  });
});

describe('HarnessScanner.detect — resilience', () => {
  it('survives a harness home that is a file, not a directory', async () => {
    fs.writeFileSync(path.join(HOME, '.hermes'), 'not a directory', 'utf8');
    const Scanner = await loadScanner();
    const result = await Scanner.detect({ env: {} });
    expect(result.sources.find((s) => s.id === 'hermes')).toBeUndefined();
  });

  it('survives a harness with no skills directory', async () => {
    write('.hermes/SOUL.md', 'A persona but no skills.');
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    expect(sources[0].skills.total).toBe(0);
    expect(sources[0].persona.available).toBe(true);
  });

  it('reads nothing it cannot afford to — an enormous persona is skipped', async () => {
    write('.hermes/SOUL.md', 'x'.repeat(300 * 1024));
    const Scanner = await loadScanner();
    const { sources } = await Scanner.detect({ env: {} });
    expect(sources[0].persona.available).toBe(false);
  });
});
