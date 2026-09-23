/**
 * Every Vite alias that points OUTSIDE frontend/ must be copied into the
 * Docker frontend build stage.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * `@llm` aliases onto ../backend/src/services/ai/descriptor so the backend and
 * the frontend share one description of which models can reason. Correct, and
 * free for the desktop build — electron-builder already ships that tree.
 *
 * The Dockerfile's frontend stage copies ONLY frontend/. So the alias resolved
 * to a path that did not exist in the build context and every Docker build
 * after that commit died:
 *
 *   [vite:load-fallback] Could not load
 *   /app/backend/src/services/ai/descriptor/reasoningPredicates.js
 *   (imported by src/store/app/aiProvider.js): ENOENT
 *
 * Nothing caught it. The desktop build was fine, `npm run build` on a dev
 * machine was fine, and the whole frontend suite was fine, because all three
 * have the entire repository on disk. ONLY the container has a restricted
 * build context, and nothing tested the container. Docker is the self-hosting
 * story, so "broken only in Docker" means broken for every self-hoster.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SHAPE
 * ---------------------------------------------------------------------------
 * The failure is a mismatch between two files that cannot see each other:
 * build/aliases.js says where code comes from, the Dockerfile says what gets
 * copied. Asserting one COPY line would fix today's instance and miss the next
 * alias. So this derives the requirement from the alias map itself — add an
 * alias pointing outside frontend/ and forget the Dockerfile, and this fails
 * by construction rather than by someone having remembered to add a case.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND TIME, WITHOUT AN ALIAS
 * ---------------------------------------------------------------------------
 * The same bug came back on 2026-09-11 through a plain relative import:
 *
 *   import { reconcileCompactedTranscript }
 *     from '../../../../backend/src/utils/compactedTranscript.js';
 *
 * No alias, so the guard above had nothing to derive from, and the container
 * build died the same way — Could not resolve "../../../../backend/..." — for
 * a day and a half before anyone tried to build the image. So the requirement
 * is now derived from BOTH sources of truth: the alias map, and the relative
 * imports actually present in bundled frontend source, followed transitively
 * so a copied file that itself reaches further out is caught too.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { aliases } from './aliases.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(FRONTEND_ROOT, '..');

const DOCKERFILES = ['Dockerfile'];

/** Aliases whose target is not inside frontend/ — the ones Docker must be told about. */
function externalAliases() {
  return Object.entries(aliases).filter(([, target]) => {
    const rel = path.relative(FRONTEND_ROOT, target);
    return rel.startsWith('..');
  });
}

const SOURCE_ROOT = path.join(FRONTEND_ROOT, 'src');
const BUNDLED_EXT = /\.(js|mjs|ts|vue)$/;
const TEST_FILE = /\.(spec|test)\.[jt]s$/;
/** `from '...'`, `import '...'`, `import('...')`, `require('...')` — relative specifiers only. */
const RELATIVE_IMPORT = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

function isOutsideFrontend(file) {
  return path.relative(FRONTEND_ROOT, file).startsWith('..');
}

/** Every bundled source file under frontend/src — tests excluded, they never enter the container. */
function bundledSourceFiles(dir = SOURCE_ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) bundledSourceFiles(full, out);
    else if (BUNDLED_EXT.test(entry.name) && !TEST_FILE.test(entry.name)) out.push(full);
  }
  return out;
}

/** Resolve a relative specifier the way the bundler will, tolerating an omitted extension. */
function resolveSpecifier(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.ts`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return base; // does not exist; reported by the on-disk check below
}

/**
 * Files outside frontend/ that the bundle reaches, each with the importer
 * that first pulled it in. Followed transitively: a copied helper that
 * itself imports further into backend/ needs those files copied too.
 */
function externalImports() {
  const found = new Map(); // external file -> importer
  const queue = bundledSourceFiles();
  const seen = new Set(queue);

  while (queue.length) {
    const file = queue.shift();
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const target = resolveSpecifier(file, match[1]);
      if (!isOutsideFrontend(target)) continue;
      if (!found.has(target)) found.set(target, file);
      if (!seen.has(target) && fs.existsSync(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...found.entries()];
}

/** Is `contextPath` (repo-relative, POSIX) covered by a COPY in the frontend stage? */
function copiedInStage(stage, contextPath) {
  return stage
    .split(/\r?\n/)
    .filter((line) => /^\s*COPY\s/i.test(line) && !/^\s*#/.test(line))
    .some((line) => {
      const args = line.trim().split(/\s+/).slice(1).filter((a) => !a.startsWith('--'));
      const sources = args.slice(0, -1);
      return sources.some((src) => {
        const s = src.replace(/^\.\//, '').replace(/\/$/, '');
        return contextPath === s || contextPath.startsWith(`${s}/`);
      });
    });
}

/** The frontend build stage: from `FROM ... AS frontend-builder` to the next FROM. */
function frontendStage(dockerfile) {
  const src = fs.readFileSync(path.join(REPO_ROOT, dockerfile), 'utf8');
  const start = src.search(/^FROM .* AS frontend-builder/m);
  if (start === -1) return null;
  const rest = src.slice(start + 1);
  const nextFrom = rest.search(/^FROM /m);
  return nextFrom === -1 ? rest : rest.slice(0, nextFrom);
}

describe('docker build context covers every external Vite alias', () => {
  it('ANTI-VACUITY: there is at least one alias pointing outside frontend/', () => {
    // If this ever legitimately becomes zero the guard below passes trivially,
    // and a future alias would reintroduce the bug silently. Fail loudly here
    // instead so the reason for the change is examined.
    expect(
      externalAliases().length,
      'No alias points outside frontend/. If that is deliberate, delete this spec ' +
        'rather than leaving a guard that asserts nothing.'
    ).toBeGreaterThan(0);
  });

  it('ANTI-VACUITY: both Dockerfiles actually have a frontend-builder stage to scan', () => {
    for (const df of DOCKERFILES) {
      expect(frontendStage(df), `${df} has no frontend-builder stage`).toBeTruthy();
    }
  });

  it.each(DOCKERFILES)('%s copies every external alias target into the frontend stage', (df) => {
    const stage = frontendStage(df);
    const missing = [];

    for (const [name, target] of externalAliases()) {
      // Path as it appears in the build context, e.g.
      // backend/src/services/ai/descriptor
      const contextPath = path.relative(REPO_ROOT, target).split(path.sep).join('/');

      // A COPY whose SOURCE is that path or a parent of it. Splitting on
      // whitespace rather than regex-escaping the path keeps this readable and
      // avoids a pattern that silently stops matching when a path gains a dot.
      if (!copiedInStage(stage, contextPath)) missing.push(`${name} -> ${contextPath}`);
    }

    expect(
      missing,
      `${df} does not copy these alias targets into the frontend-builder stage, so\n` +
        `\`npm run build\` inside the container will fail with vite:load-fallback ENOENT.\n` +
        `Add, before RUN npm run build:\n` +
        missing.map((m) => `  COPY ${m.split(' -> ')[1]} /app/${m.split(' -> ')[1]}`).join('\n')
    ).toEqual([]);
  });

  it('the alias targets exist on disk (a copied path that is wrong is still broken)', () => {
    for (const [name, target] of externalAliases()) {
      expect(fs.existsSync(target), `${name} points at ${target}, which does not exist`).toBe(true);
    }
  });
});

describe('docker build context covers every relative import that leaves frontend/', () => {
  it('ANTI-VACUITY: the scanner sees bundled source and at least one external import', () => {
    expect(bundledSourceFiles().length).toBeGreaterThan(100);
    // If this ever legitimately becomes zero, delete this block rather than
    // leaving a guard that asserts nothing.
    expect(
      externalImports().length,
      'No bundled frontend file imports anything outside frontend/. If that is deliberate, remove this block.'
    ).toBeGreaterThan(0);
  });

  it('ANTI-VACUITY: the import matcher recognises every shape the source uses', () => {
    const shapes = [
      `import { a } from '../../../backend/src/x.js';`,
      `import '../../backend/src/y.js';`,
      `const m = await import('../../../../backend/src/z.js');`,
      `const n = require('../../backend/src/w.js');`,
      `import { b } from "../../../backend/src/v.js";`,
    ];
    for (const shape of shapes) {
      expect([...shape.matchAll(RELATIVE_IMPORT)].length, shape).toBe(1);
    }
    // Bare specifiers and aliases are not this scanner's business.
    expect([...`import x from 'vue'; import y from '@llm/descriptor';`.matchAll(RELATIVE_IMPORT)].length).toBe(0);
  });

  it('every external import target exists on disk', () => {
    for (const [target, importer] of externalImports()) {
      expect(fs.existsSync(target), `${path.relative(REPO_ROOT, importer)} imports ${target}, which does not exist`).toBe(
        true
      );
    }
  });

  it.each(DOCKERFILES)('%s copies every external import target into the frontend stage', (df) => {
    const stage = frontendStage(df);
    const missing = [];

    for (const [target, importer] of externalImports()) {
      const contextPath = path.relative(REPO_ROOT, target).split(path.sep).join('/');
      if (!copiedInStage(stage, contextPath)) {
        missing.push(`${path.relative(FRONTEND_ROOT, importer).split(path.sep).join('/')} -> ${contextPath}`);
      }
    }

    expect(
      missing,
      `${df} does not copy these files into the frontend-builder stage, so \`npm run build\`\n` +
        `inside the container fails with: Could not resolve "../../backend/...".\n` +
        `Add, before RUN npm run build (one file each — never backend/ wholesale):\n` +
        missing.map((m) => `  COPY ${m.split(' -> ')[1]} /app/${m.split(' -> ')[1]}`).join('\n')
    ).toEqual([]);
  });
});
