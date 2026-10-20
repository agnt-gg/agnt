/**
 * The code and shell tools run IN the workspace folder, so it must exist.
 *
 * Reported 2026-10-20 from AGNT One: the chat's first execute_javascript_code
 * failed with "Failed to start subprocess: spawn node ENOENT". Node was fine;
 * the working directory was not there. A new install's workspace (<data>/
 * projects) is returned by getWorkspaceRootPath but never created, and spawn
 * reports a missing cwd as the COMMAND being missing. Every new install hit
 * it until something else happened to create the folder.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// vi.mock is hoisted above every statement, so its data must be too.
const { ROOT } = vi.hoisted(() => {
  process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
  const nodeFs = require('node:fs');
  const nodeOs = require('node:os');
  const nodePath = require('node:path');
  return { ROOT: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'agnt-workspace-root-')) };
});
vi.mock('../../utils/PathManager.js', async (importOriginal) => {
  const original = (await importOriginal()).default;
  const redirected = { projects: path.join(ROOT, 'projects'), 'code-settings.json': path.join(ROOT, 'code-settings.json') };
  // A plain object, not a spread: getPath may live on the prototype.
  return { default: new Proxy(original, { get: (target, key) => (key === 'getPath' ? (name, ...rest) => redirected[name] || target.getPath(name, ...rest) : Reflect.get(target, key)) }) };
});

import { getWorkspaceRootPath } from './codeTools.js';
import { TOOLS } from './tools.js';

const PROJECTS = path.join(ROOT, 'projects');

beforeEach(() => fs.rmSync(PROJECTS, { recursive: true, force: true }));
afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('the workspace folder a tool runs in', () => {
  it('a new install has none yet (anti-vacuity)', () => {
    expect(fs.existsSync(PROJECTS)).toBe(false);
  });

  it('getWorkspaceRootPath creates it', async () => {
    expect(await getWorkspaceRootPath()).toBe(PROJECTS);
    expect(fs.statSync(PROJECTS).isDirectory()).toBe(true);
  });

  it('THE REPORTED BUG: execute_javascript_code runs on a new install', async () => {
    const out = JSON.parse(await TOOLS.execute_javascript_code.execute({ code: 'console.log("ran in " + process.cwd())' }));
    expect(out.error).toBeUndefined();
    expect(out.success).toBe(true);
    expect(path.resolve(out.stdout.replace(/^ran in /, ''))).toBe(path.resolve(PROJECTS));
  });
});
