/**
 * A tool that calls AGNT's own API calls THIS backend's port.
 *
 * Reported 2026-10-21: AGNT One runs its backend on PORT=3398. The agnt_*
 * tools (libs/agnt2.js), every goal tool and the custom-tool loader had
 * http://localhost:3333 written in, so in AGNT One they reached the OTHER
 * AGNT on the machine: trigger_workflow answered "Workflow not found" for a
 * workflow AGNT One had just saved, and with that AGNT closed they failed.
 * The rest of the backend already wrote `process.env.PORT || 3333`; this
 * keeps a literal 3333 from coming back. Comments may still mention it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); // backend/src
const LITERAL = /(?:localhost|127\.0\.0\.1):3333\b/;

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...sourceFiles(full)); }
    else if (/\.(c|m)?js$/.test(entry.name) && !/\.(test|spec)\.(c|m)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Hard-coded own-API addresses in code (comments blanked, line numbers kept). */
export function hardCodedSelfCalls(file) {
  const code = fs.readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  return code.split('\n').flatMap((line, i) => (LITERAL.test(line) ? [`${path.relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 120)}`] : []));
}

describe("calls to AGNT's own API use this backend's port", () => {
  it('no literal localhost:3333 in code', () => {
    const found = sourceFiles(SRC).flatMap(hardCodedSelfCalls);
    expect(found, `\nUse \`http://localhost:\${process.env.PORT || 3333}\`:\n${found.join('\n')}\n`).toEqual([]);
  });

  it('can see one (negative control), and ignores comments', () => {
    const probe = path.join(SRC, '..', `.port-probe-${process.pid}.js`);
    fs.writeFileSync(probe, "// docs: http://localhost:3333/api\nconst u = 'http://localhost:3333/api';\n");
    try {
      expect(hardCodedSelfCalls(probe)).toHaveLength(1);
      expect(hardCodedSelfCalls(probe)[0]).toMatch(/:2 /);
    } finally {
      fs.unlinkSync(probe);
    }
  });

  it('the agnt_* client defaults to the running port', async () => {
    const before = process.env.PORT;
    process.env.PORT = '3398';
    try {
      const { default: AGNT } = await import('../../libs/agnt2.js');
      expect(new AGNT('token').baseURL).toBe('http://localhost:3398/api');
    } finally {
      if (before === undefined) delete process.env.PORT; else process.env.PORT = before;
    }
  });
});
