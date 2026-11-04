import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The agnt-plugin-builder skill ships to every install (builtinSkillBootstrap copies backend/skills into
// ~/.agnt/skills). It used to give one developer's absolute paths as "fixed on the user's machine" and to
// say a plugin MUST be created in the AGNT repo's backend/plugins/dev to build, so every agent put user
// plugins into AGNT's source tree. A user's plugin belongs in their own workspace.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SKILL = fs.readFileSync(path.join(REPO_ROOT, 'backend/skills/agnt-plugin-builder/SKILL.md'), 'utf8');

describe('agnt-plugin-builder skill: where a plugin lives', () => {
  it('names no machine-specific path', () => {
    expect(SKILL).not.toMatch(/[A-Z]:\\Users\\/);
    expect(SKILL).not.toMatch(/\/Users\/[A-Za-z]/);
    expect(SKILL).not.toMatch(/fixed on the user's machine/i);
  });

  it('puts a user plugin in the workspace, resolved per account', () => {
    expect(SKILL).toContain('<workspace>/plugins/<plugin-name>/');
    expect(SKILL).toContain('/filesystem/settings');
    expect(SKILL).toContain('/plugins/build-generated');
  });

  it('never tells an agent to create a plugin in backend/plugins/dev', () => {
    expect(SKILL).not.toMatch(/MUST live here/i);
    expect(SKILL).not.toMatch(/always create in `?dev\/?`?/i);
    expect(SKILL).toMatch(/Never create a user's plugin in the AGNT repository's `backend\/plugins\/dev\/`/);
  });
});
