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
      const copied = stage
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

      if (!copied) missing.push(`${name} -> ${contextPath}`);
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
