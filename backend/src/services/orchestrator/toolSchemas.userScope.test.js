/**
 * Every read of the tool registry says whose tools it wants.
 *
 * Plugins and Tool Forge tools belong to an account. getAvailableToolSchemas
 * keeps them only for a caller that passes the account's userId; a caller
 * that passes nothing silently gets the built-ins alone. That silence shipped
 * twice:
 *   - issue #64: workflow and goal agents ran without their custom tools;
 *   - 2026-10-20: discover_tools reported every installed plugin as missing
 *     (Atlas Cloud), and the mid-turn load of a discovered tool loaded none.
 * Each time the fix threaded userId through one caller. This holds them all:
 * a call site must pass `userId` (`userId: null` is allowed, as a deliberate,
 * visible choice for a caller that genuinely has no user).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); // backend/src

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...sourceFiles(full));
    } else if (/\.(c|m)?js$/.test(entry.name) && !/\.(test|spec)\.(c|m)?js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Real calls only: `await getAvailableToolSchemas(...)` or `(...).getAvailableToolSchemas(...)`, not prose or the definition. */
function callSites(file) {
  const text = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const sites = [];
  const re = /(?:await\s+|\)\s*\.\s*)getAvailableToolSchemas\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(text))) {
    const line = text.slice(0, match.index).split('\n').length;
    sites.push({ where: `${path.relative(SRC, file)}:${line}`, args: match[1].trim() });
  }
  return sites;
}

const SITES = sourceFiles(SRC).flatMap(callSites);

describe('tool registry reads are scoped to a user', () => {
  it('finds the call sites (anti-vacuity)', () => {
    // discover_tools browse + load, the chat surface, the mid-turn load, the
    // agent runtime, the tools route, the agent generator, the LLM node.
    expect(SITES.length).toBeGreaterThanOrEqual(8);
  });

  it('every call passes userId', () => {
    const unscoped = SITES.filter((site) => !/\buserId\b/.test(site.args)).map((site) => `${site.where}  getAvailableToolSchemas(${site.args})`);
    expect(unscoped, `\nPass { userId } (or userId: null on purpose):\n${unscoped.join('\n')}\n`).toEqual([]);
  });

  it('can see an unscoped call (negative control)', () => {
    const tmp = path.join(SRC, '..', `.userScope-probe-${process.pid}.js`);
    fs.writeFileSync(tmp, 'async function x() { return await getAvailableToolSchemas(); }\n');
    try {
      expect(callSites(tmp)).toEqual([{ where: `${path.relative(SRC, tmp)}:1`, args: '' }]);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
