// Folder skills leaked between accounts because seven callers read the
// process-wide discovery map directly. The scoped *For(userId) methods are now
// the only door; this fails the day a new caller walks around them.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = path.join(SRC, 'services', 'SkillDiscoveryService.js');

// Unscoped reads. `\b` stops getSkill from matching getSkillFor, and so on.
const UNSCOPED = /\b(?:SkillDiscoveryService|Discovery)\s*\.\s*(getSkillCatalog|getSkillContent|getSkill|listResources|readResource|getSupersededBy|getParseFailures|skills)\b/g;

function productionFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') productionFiles(full, out); continue; }
    if (/\.(m?js)$/.test(entry.name) && !/\.(test|spec)\.m?js$/.test(entry.name) && full !== OWNER) out.push(full);
  }
  return out;
}

const files = productionFiles(SRC).map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));

describe('folder skills are read per account', () => {
  it('no production code reads the discovery map without an account', () => {
    const offenders = [];
    for (const { file, text } of files) {
      for (const match of text.matchAll(UNSCOPED)) {
        const line = text.slice(0, match.index).split('\n').length;
        offenders.push(`${path.relative(SRC, file)}:${line} ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ANTI-VACUITY: the pattern catches the calls that leaked, and spares the scoped ones', () => {
    const leaked = ['Discovery.getSkillContent(skill_name)', 'SkillDiscoveryService.getSkillCatalog()',
      'SkillDiscoveryService.skills.values()', 'SkillDiscoveryService.getSkill(slug)'];
    for (const call of leaked) expect(call.match(UNSCOPED), call).not.toBeNull();
    for (const call of ['Discovery.getSkillContentFor(n, u)', 'SkillDiscoveryService.getSkillFor(n, u)',
      'SkillDiscoveryService.getParseFailuresFor(u)']) expect(call.match(UNSCOPED), call).toBeNull();
  });

  it('ANTI-VACUITY: the scan actually reaches the callers', () => {
    const callers = files.filter(({ text }) => /SkillDiscoveryService/.test(text)).map(({ file }) => path.basename(file));
    for (const name of ['SkillService.js', 'tools.js', 'chatConfigs.js', 'OrchestratorService.js', 'SkillDiscoveryRoutes.js', 'HarnessScanner.js']) {
      expect(callers).toContain(name);
    }
  });

  it('a database skill id is not a credential: /skill and agent-assigned skills check the owner', () => {
    // findById / findByIds are unscoped by design (eight internal callers), so
    // the two prompt-injection paths must apply findAll's rule themselves.
    const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(read('services/OrchestratorService.js')).toMatch(/dbSkill && \(dbSkill\.user_id === userId \|\| dbSkill\.is_builtin\)/);
    expect(read('services/orchestrator/chatConfigs.js')).toMatch(/records\.filter\(\(s\) => s\.user_id === userId \|\| s\.is_builtin\)/);
  });
});
