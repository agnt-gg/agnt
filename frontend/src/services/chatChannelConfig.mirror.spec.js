/**
 * The frontend's per-channel tool defaults MUST cover the backend's canonical
 * TOOL_GROUPS.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * chatChannelConfig.js keeps a hand-written mirror of the backend's tool
 * groups, and the backend treats whatever the frontend sends as a STRICT
 * WHITELIST: a curated 6-name list covers ~2% of the registry, nowhere near
 * the 0.95 FULL_COVERAGE_AUTO_THRESHOLD that would degrade it to discovery
 * mode. So a tool that exists in the backend group but is missing from this
 * mirror is registered, dispatchable, documented — and unreachable. There is
 * no error. The tool is simply never offered on the surface it was built for.
 *
 * That is not hypothetical. It rotted twice:
 *   - `list_widgets` shipped into the backend widget group; Widget Forge chat
 *     still could not answer "what widgets do I have?"
 *   - `grep_files` / `glob_files` shipped into the backend artifact group to
 *     replace ~9,900 shell greps; the Artifacts chat could not call either.
 * Both times a comment said "mirror the change here". A comment is not a
 * mechanism, which is the whole point of this file.
 *
 * The assertion is COVERAGE, not equality: the frontend legitimately adds
 * cross-cutting tools (get_agnt_api, mcp_client) that are not part of the
 * backend group. Every backend tool must be present; extras are fine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSpecialtyToolNames, resolveChannelEnabledTools } from './chatChannelConfig.js';

/** Walk up until the backend file is found, so this works from any vitest root. */
function findBackendToolSelector() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'backend/src/services/orchestrator/toolSelector.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('could not locate backend/src/services/orchestrator/toolSelector.js');
}

/** Comments are stripped first — an assertion must never be satisfied by prose. */
function parseBackendToolGroups() {
  const raw = fs.readFileSync(findBackendToolSelector(), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const decl = src.match(/export const TOOL_GROUPS\s*=\s*\{/);
  if (!decl) throw new Error('TOOL_GROUPS not found in toolSelector.js');

  const body = src.slice(decl.index + decl[0].length);
  let depth = 1;
  let end = 0;
  for (; end < body.length; end++) {
    if (body[end] === '{') depth++;
    else if (body[end] === '}') { depth--; if (depth === 0) break; }
  }

  const groups = {};
  const groupRe = /(\w+)\s*:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = groupRe.exec(body.slice(0, end)))) {
    groups[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  return groups;
}

/** Channel type -> the backend group whose tools that surface must be able to call. */
const CHANNEL_TO_BACKEND_GROUP = {
  agent: 'agent_management',
  workflow: 'workflow_authoring',
  tool: 'tool_authoring',
  widget: 'widget_authoring',
  artifact: 'artifact_code',
};

describe('frontend channel defaults mirror the backend tool groups', () => {
  const groups = parseBackendToolGroups();

  it('parses the backend groups (guards against a vacuous pass)', () => {
    // If the parser silently returned {}, every coverage test below would pass
    // for the wrong reason.
    expect(Object.keys(groups).length).toBeGreaterThan(5);
    for (const group of Object.values(CHANNEL_TO_BACKEND_GROUP)) {
      expect(groups[group], `backend group "${group}" missing`).toBeDefined();
      expect(groups[group].length).toBeGreaterThan(0);
    }
  });

  for (const [channelType, backendGroup] of Object.entries(CHANNEL_TO_BACKEND_GROUP)) {
    it(`${channelType} chat can call every tool in ${backendGroup}`, () => {
      const specialty = getSpecialtyToolNames(`${channelType}:some-id`) || [];
      const missing = (groups[backendGroup] || []).filter((t) => !specialty.includes(t));
      expect(
        missing,
        `${missing.join(', ')} exist in backend group "${backendGroup}" but are absent from ` +
        `SIDEBAR_DEFAULTS.${channelType}, so they are unreachable from that chat surface`,
      ).toEqual([]);
    });
  }

  it('specifically covers the tools that rotted before', () => {
    expect(getSpecialtyToolNames('artifact:s1')).toEqual(expect.arrayContaining(['grep_files', 'glob_files']));
    expect(getSpecialtyToolNames('widget:w1')).toEqual(expect.arrayContaining(['list_widgets']));
  });
});

describe('specialty tools survive a saved channel config', () => {
  beforeEach(() => localStorage.clear());

  // This union is what makes the mirror fix reach EXISTING users with no
  // migration: a channel saved before a tool existed still gets it, because
  // specialty is re-applied on every read rather than frozen at seed time.
  it('unions specialty over a user-saved list', () => {
    localStorage.setItem(
      'agnt_chat_channel_configs',
      JSON.stringify({ 'artifact:s1': { enabledTools: ['read_file'] } }),
    );
    const resolved = resolveChannelEnabledTools('artifact:s1');
    expect(resolved).toEqual(expect.arrayContaining(['grep_files', 'glob_files']));
    expect(resolved).toContain('read_file');
  });

  it('still honours an explicit "all tools" choice', () => {
    localStorage.setItem(
      'agnt_chat_channel_configs',
      JSON.stringify({ 'artifact:s1': { enabledTools: 'auto' } }),
    );
    // undefined = "let the backend use its own lazy discovery default"
    expect(resolveChannelEnabledTools('artifact:s1')).toBeUndefined();
  });

  it('a fresh channel gets specialty plus the memory defaults', () => {
    const resolved = resolveChannelEnabledTools('artifact:brand-new');
    expect(resolved).toEqual(expect.arrayContaining(['grep_files', 'glob_files', 'recall']));
  });
});
