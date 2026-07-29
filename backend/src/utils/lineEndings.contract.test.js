/**
 * Source-contract guard for line-ending handling.
 *
 * WHY A SOURCE TEST AND NOT ONLY UNIT TESTS
 * -----------------------------------------
 * The original defect was never bad logic. `edit_file` had correct EOL handling
 * from 2026-07-25 and every one of its unit tests passed for four months while
 * `write_file`, the file-explorer save route, the workflow file node, the MCP
 * server and `file_operations` all quietly corrupted the same files. Correct
 * logic wired into ONE of six call paths is indistinguishable, from a unit
 * test's point of view, from correct logic wired into all six.
 *
 * So this asserts REACHABILITY: every text write boundary routes through
 * `prepareWrite`, and no new one appears without doing the same. Same family as
 * routeSecurity.test.js and toolArgGuard.wiring.test.js.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, '..', '..');
const SRC = path.join(BACKEND, 'src');

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/**
 * Remove comments so a guard cannot fire on prose ABOUT the thing it forbids.
 *
 * Both halves of this file explain why `os.EOL` is wrong, which means a naive
 * scan flags the explanation. Quote- and template-aware because a line-comment
 * stripper that ignores string literals eats the `//` in every URL and silently
 * truncates the code it was supposed to inspect.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Every boundary that writes caller-supplied text.
 *
 * `mustNotContain` pins the exact pre-fix expression, so reverting a call site
 * fails here loudly instead of silently regressing to whole-file rewrites.
 */
const BOUNDARIES = [
  {
    rel: 'services/orchestrator/codeTools.js',
    what: 'write_file tool',
    mustContain: [/await prepareWrite\(absPath, content\)/, /await writeFileAtomic\(absPath, finalContent\)/],
    // Anchored on `await` so this does not match writeFileAtomic's own
    // declaration, whose parameters are legitimately named (absPath, content).
    mustNotContain: [/await writeFileAtomic\(absPath, content\)/],
  },
  {
    rel: 'services/orchestrator/codeTools.js',
    what: 'edit_file tool',
    mustContain: [/prepareWrite\(absPath, updatedContent, \{ existing: currentContent \}\)/],
    mustNotContain: [],
  },
  {
    rel: 'services/orchestrator/tools.js',
    what: 'file_operations write',
    mustContain: [/isTextEncoding[\s\S]{0,200}prepareWrite\(filePath, content\)/, /fs\.writeFile\(filePath, toWrite, encoding\)/],
    mustNotContain: [/fs\.writeFile\(filePath, content, encoding\)/],
  },
  {
    rel: 'routes/FileSystemRoutes.js',
    what: 'file explorer save',
    mustContain: [/prepareWrite\(absPath, content \|\| ''\)/, /fs\.writeFile\(absPath, prepared\.content/],
    mustNotContain: [/fs\.writeFile\(absPath, content \|\| '', 'utf-8'\)/],
  },
  {
    rel: 'tools/library/utilities/file-system-operation.js',
    what: 'workflow file node — writeFile',
    mustContain: [/prepareWrite\(fullPath, content\)/, /fs\.writeFile\(fullPath, written\.content/],
    mustNotContain: [/fs\.writeFile\(fullPath, content, 'utf8'\)/],
  },
  {
    rel: 'tools/library/utilities/file-system-operation.js',
    what: 'workflow file node — appendFile',
    mustContain: [/prepareWrite\(fullPath, content, \{ mode: 'append' \}\)/, /fs\.appendFile\(fullPath, appended\.content/],
    mustNotContain: [/fs\.appendFile\(fullPath, content, 'utf8'\)/],
  },
  {
    rel: 'tools/library/mcp/servers/filesystem-mcp.js',
    what: 'filesystem MCP server',
    mustContain: [/prepareWrite\(args\.path, args\.content\)/, /fs\.writeFile\(args\.path, prepared\.content/],
    mustNotContain: [/fs\.writeFile\(args\.path, args\.content, 'utf-8'\)/],
  },
];

describe('every text write boundary routes through prepareWrite', () => {
  for (const b of BOUNDARIES) {
    it(`${b.what} (${b.rel})`, () => {
      const src = read(b.rel);
      expect(src, `${b.rel} must import prepareWrite`).toMatch(
        /import \{[^}]*prepareWrite[^}]*\} from '[^']*utils\/lineEndings\.js'/
      );
      for (const re of b.mustContain) {
        expect(src, `${b.what}: expected ${re}`).toMatch(re);
      }
      for (const re of b.mustNotContain) {
        expect(src, `${b.what}: pre-fix expression still present: ${re}`).not.toMatch(re);
      }
    });
  }
});

// ---------------------------------------------------------------- discovery ---

const WATCH = ['routes', 'tools', 'services', 'plugins', 'utils'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

/**
 * Files allowed to write a `content`-named argument without the helper.
 * Every entry needs a reason. An entry that no longer matches anything is
 * itself a failure, so this list cannot rot into a rubber stamp.
 */
const ALLOWLIST = [
  // (empty — every current boundary is routed)
];

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (/\.(m?js|cjs)$/.test(e.name) && !/\.(test|spec)\.js$/.test(e.name)) acc.push(full);
  }
  return acc;
}

/** Second argument of a call, up to the depth-0 comma. */
function secondArg(src, openParen) {
  let depth = 0, i = openParen, argStart = -1, commas = 0;
  for (; i < src.length && i < openParen + 800; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) break; }
    else if (c === ',' && depth === 1) {
      commas++;
      if (commas === 1) argStart = i + 1;
      else if (commas === 2) return src.slice(argStart, i).trim();
    }
  }
  return argStart === -1 ? '' : src.slice(argStart, i).trim();
}

function findUnroutedWrites() {
  const found = [];
  for (const w of WATCH) {
    for (const file of walk(path.join(SRC, w))) {
      const src = stripComments(fs.readFileSync(file, 'utf8'));
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (ALLOWLIST.includes(rel)) continue;
      const routed = /from '[^']*utils\/lineEndings\.js'/.test(src);
      if (routed) continue;

      const re = /\bfs\.(?:promises\.)?(writeFile|appendFile)(?:Sync)?\s*\(/g;
      let m;
      while ((m = re.exec(src))) {
        const arg = secondArg(src, m.index + m[0].length - 1);
        if (!/\bcontent\b/i.test(arg)) continue;
        found.push(`${rel}:${src.slice(0, m.index).split('\n').length} -> ${m[1]}(_, ${arg.slice(0, 50)})`);
      }
    }
  }
  return found;
}

describe('no write path bypasses the helper', () => {
  it('finds no unrouted caller-supplied text write', () => {
    expect(findUnroutedWrites()).toEqual([]);
  });

  it('the detector actually detects — negative control', () => {
    // A matcher that passes because it matches nothing is worse than no
    // matcher, so prove the shape it is looking for is one it would catch.
    const sample = "const x = 1;\nawait fs.writeFile(p, content, 'utf-8');\n";
    const hits = [];
    const re = /\bfs\.(?:promises\.)?(writeFile|appendFile)(?:Sync)?\s*\(/g;
    let m;
    while ((m = re.exec(sample))) {
      const arg = secondArg(sample, m.index + m[0].length - 1);
      if (/\bcontent\b/i.test(arg)) hits.push(arg);
    }
    expect(hits).toEqual(['content']);
  });

  it('every allowlist entry still exists and still needs the exemption', () => {
    for (const rel of ALLOWLIST) {
      expect(fs.existsSync(path.join(SRC, rel)), `stale allowlist entry: ${rel}`).toBe(true);
    }
  });
});

// ------------------------------------------------------------------ os.EOL ---

describe('line endings are never taken from the host OS', () => {
  it('no write path uses os.EOL', () => {
    // AGNT runs in Docker against bind-mounted Windows checkouts and against a
    // remote Linux backend over the Connection feature. In both, the process OS
    // and the file's OS routinely disagree, so os.EOL is wrong by construction.
    const offenders = [];
    for (const w of WATCH) {
      for (const file of walk(path.join(SRC, w))) {
        const src = stripComments(fs.readFileSync(file, 'utf8'));
        if (/\bos\.EOL\b/.test(src)) {
          offenders.push(path.relative(SRC, file).split(path.sep).join('/'));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the helper itself derives everything from file bytes', () => {
    const src = stripComments(read('utils/lineEndings.js'));
    expect(src).not.toMatch(/\bos\.EOL\b/);
    expect(src).not.toMatch(/require\(['"]os['"]\)|from ['"]os['"]/);
  });

  it('stripComments does not eat code, strings or URLs — negative control', () => {
    // A stripper that over-deletes turns every scan above into a vacuous pass.
    const sample = [
      "const url = 'http://example.com/a//b';",
      'const t = `a ${x} // not a comment`;',
      'const re = "/* also not a comment */";',
      'code(); // real comment',
      '/* block */ after();',
      'const esc = \'it\\\'s // fine\';',
    ].join('\n');
    const out = stripComments(sample);
    expect(out).toContain("'http://example.com/a//b'");
    expect(out).toContain('// not a comment');
    expect(out).toContain('/* also not a comment */');
    expect(out).toContain('code();');
    expect(out).toContain('after();');
    expect(out).toContain("// fine");
    expect(out).not.toContain('real comment');
    expect(out).not.toContain('/* block */');
  });

  it('stripComments removes prose that names the forbidden symbol', () => {
    expect(stripComments('/* never use os.EOL here */\nconst a = 1;')).not.toMatch(/os\.EOL/);
    expect(stripComments('const a = os.EOL;')).toMatch(/os\.EOL/);
  });
});
