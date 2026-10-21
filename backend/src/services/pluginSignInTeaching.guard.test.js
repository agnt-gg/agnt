/**
 * What AGNT teaches about plugin sign-ins, kept from drifting back.
 *
 * Reported 2026-10-21: Calendly shipped needing a sign-in that existed only on
 * its author's account. Every guide a plugin is built from said to "register
 * the provider first" (which creates exactly such a private sign-in) or to ask
 * for the key as a password parameter. Most plugins are built by Annie from a
 * chat request, so the teaching IS the implementation: it must say to use a
 * shared sign-in or bundle the sign-in in manifest.auth, and to read the
 * credential from params.__auth.token.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_MANIFEST_CONTRACT, PLUGIN_TOOL_CONTRACT } from './pluginContract.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO = path.resolve(BACKEND, '..');
const read = (relative) => fs.readFileSync(path.join(REPO, relative), 'utf8');

/** Everything a plugin is built from: the skill, the docs, the Forge and generator prompts. */
const TEACHING = [
  'backend/skills/agnt-plugin-builder/SKILL.md',
  'backend/skills/agnt-plugin-builder/references/manifest-schema.md',
  'backend/skills/agnt-plugin-builder/references/tool-templates.md',
  'backend/plugins/docs/PLUGIN-DEVELOPMENT.md',
  'backend/plugins/docs/PLUGIN-REFERENCE.md',
  'backend/plugins/docs/START-HERE-PLUGINS.md',
  'backend/plugins/dev/_TEMPLATE/README.md',
  'backend/src/services/orchestrator/system-prompts/plugin-forge-chat.js',
  'backend/src/services/PluginGenerator.js',
];

/** Advice that produced Calendly, or that puts keys where they leak. */
const BANNED = [
  [/register (the|a|your)? ?provider first/i, 'tells the author to create a server sign-in (private to their account)'],
  [/password[^\n]{0,60}(apiKey|api key|one-off keys|read it from `?params)/i, 'tells the author to take a key as a tool parameter'],
  [/services['", /]+auth['", /]+AuthManager\.js/, 'shows tools importing AuthManager instead of reading params.__auth.token'],
  [/Built-in provider(s| slugs)[^\n]*(gmail|spotify)/i, 'lists sign-ins as built-in that are not shared'],
];

describe('the plugin contract (Forge chat + generator)', () => {
  it('teaches the two connectable kinds of sign-in, and the live list', () => {
    expect(PLUGIN_MANIFEST_CONTRACT).toContain('SIGN-INS');
    expect(PLUGIN_MANIFEST_CONTRACT).toContain('"auth": [{');
    expect(PLUGIN_MANIFEST_CONTRACT).toContain('https://api.agnt.gg/auth/providers');
    expect(PLUGIN_MANIFEST_CONTRACT).toMatch(/NO\s+Authorization header/);
    expect(PLUGIN_MANIFEST_CONTRACT).toMatch(/never[^.]*create a sign-in on the AGNT server/i);
  });

  it('teaches reading the credential from params.__auth.token, not importing app code', () => {
    expect(PLUGIN_TOOL_CONTRACT).toContain('params.__auth?.token');
    expect(PLUGIN_TOOL_CONTRACT).not.toContain('AuthManager');
  });
});

describe('the skill, docs and prompts', () => {
  for (const file of TEACHING) {
    it(`${file} carries none of the advice that broke Calendly`, () => {
      const text = read(file);
      for (const [pattern, why] of BANNED) expect(pattern.test(text), `${file} ${why}: ${pattern}`).toBe(false);
    });
  }

  it('every guide that explains sign-ins points at manifest.auth and params.__auth', () => {
    for (const file of TEACHING.slice(0, 7)) {
      const text = read(file);
      expect(/manifest\.auth|"auth": \[|`auth` array|auth` entry/.test(text), `${file} must teach bundling a sign-in in manifest.auth`).toBe(true);
    }
    for (const file of ['backend/skills/agnt-plugin-builder/SKILL.md', 'backend/skills/agnt-plugin-builder/references/tool-templates.md', 'backend/plugins/docs/PLUGIN-DEVELOPMENT.md', 'backend/plugins/docs/PLUGIN-REFERENCE.md']) {
      expect(read(file), `${file} must teach params.__auth.token`).toContain('__auth');
    }
  });

  it('a pattern can actually catch the old advice (negative control)', () => {
    const old = "either register the provider first or just add a `password` input parameter to the tool and read it from `params` directly";
    expect(BANNED[0][0].test(old)).toBe(true);
    expect(BANNED[1][0].test(old)).toBe(true);
    expect(BANNED[2][0].test("path.join(APP_PATH, 'backend', 'src', 'services', 'auth', 'AuthManager.js')")).toBe(true);
  });
});
