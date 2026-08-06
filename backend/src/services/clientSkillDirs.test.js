import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Which tools' skill folders AGNT reads.
 *
 * THIS LIST IS THE FEATURE. A user's skills from Claude Code, Codex, Cursor,
 * Hermes, OpenClaw or Gemini CLI work in AGNT because this scan finds them —
 * not because anything was imported. Dropping an entry does not break a test
 * elsewhere and does not raise an error; it just silently stops finding that
 * tool's skills, which is indistinguishable from the user not having any.
 *
 * Asserted against the source text because the list is a module-level constant
 * inside a service that opens databases and walks the filesystem on import.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'SkillDiscoveryService.js');
const source = fs.readFileSync(SRC, 'utf8');

const dirsInList = () => {
  const match = source.match(/const CLIENT_SKILL_DIRS = \[([\s\S]*?)\];/);
  if (!match) throw new Error('CLIENT_SKILL_DIRS declaration not found');
  return match[1].match(/'([^']+)'/g).map((q) => q.slice(1, -1));
};

/** Every tool we claim to read, and why it is in the list. */
const REQUIRED = [
  ['.agnt/skills', 'AGNT itself'],
  ['.claude/skills', 'Claude Code'],
  ['.codex/skills', 'Codex'],
  ['.cursor/skills', 'Cursor'],
  ['.hermes/skills', 'Hermes'],
  ['.openclaw/skills', 'OpenClaw'],
  ['.gemini/skills', 'Gemini CLI'],
  ['.agents/skills', 'the cross-client standard directory'],
];

describe('agent skill directories AGNT scans', () => {
  it('anti-vacuity: the list parses and is not empty', () => {
    expect(dirsInList().length).toBeGreaterThanOrEqual(REQUIRED.length);
  });

  it.each(REQUIRED)('scans %s — %s', (dir) => {
    expect(dirsInList()).toContain(dir);
  });

  it('lists each directory once', () => {
    const dirs = dirsInList();
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it('keeps AGNT in the list, since its own skills are found the same way', () => {
    // Removing it would hide every bootstrapped builtin.
    expect(dirsInList()).toContain('.agnt/skills');
  });
});
