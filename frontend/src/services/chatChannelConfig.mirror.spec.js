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
import {
  getSpecialtyToolNames,
  resolveChannelEnabledTools,
  isSavedAgentChannel,
  AGENT_FORGE_CHANNEL_KEY,
} from './chatChannelConfig.js';

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

/**
 * A REPRESENTATIVE channel key -> the backend group that surface must reach.
 *
 * Keyed by a real channel key rather than by bare type because the `agent:`
 * prefix covers two different surfaces: `agent:agent-chat` is the AgentForge
 * BUILDER (which needs the agent-management tools) while `agent:<uuid>` is a
 * chat WITH a saved agent (whose tools come from its own assignedTools, and
 * which must NOT be handed the authoring set — see isSavedAgentChannel).
 */
const CHANNEL_TO_BACKEND_GROUP = {
  [AGENT_FORGE_CHANNEL_KEY]: 'agent_management',
  'workflow:some-id': 'workflow_authoring',
  'tool:some-id': 'tool_authoring',
  'widget:some-id': 'widget_authoring',
  'artifact:some-id': 'artifact_code',
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

  for (const [channelKey, backendGroup] of Object.entries(CHANNEL_TO_BACKEND_GROUP)) {
    it(`${channelKey} can call every tool in ${backendGroup}`, () => {
      const specialty = getSpecialtyToolNames(channelKey) || [];
      const missing = (groups[backendGroup] || []).filter((t) => !specialty.includes(t));
      expect(
        missing,
        `${missing.join(', ')} exist in backend group "${backendGroup}" but are absent from ` +
        `the specialty set for "${channelKey}", so they are unreachable from that chat surface`,
      ).toEqual([]);
    });
  }

  it('specifically covers the tools that rotted before', () => {
    expect(getSpecialtyToolNames('artifact:s1')).toEqual(expect.arrayContaining(['grep_files', 'glob_files']));
    expect(getSpecialtyToolNames('widget:w1')).toEqual(expect.arrayContaining(['list_widgets']));
  });
});

// ---------------------------------------------------------------------------
// The `agent:` prefix is TWO surfaces, and conflating them silently disarms an
// agent. The backend intersects enabledTools with the agent's allowed set
// (chatConfigs.js getSavedAgentToolSchemas, restricted mode), so sending the
// AgentForge authoring list for `agent:<uuid>` would leave that agent holding
// only the universal primitives — no error, the tools just are not offered.
// ---------------------------------------------------------------------------

describe('a saved-agent chat is not the AgentForge builder', () => {
  beforeEach(() => localStorage.clear());

  it('classifies the two channels apart', () => {
    expect(isSavedAgentChannel('agent:0e8d-uuid')).toBe(true);
    expect(isSavedAgentChannel(AGENT_FORGE_CHANNEL_KEY)).toBe(false);
    expect(isSavedAgentChannel('workflow:w1')).toBe(false);
    expect(isSavedAgentChannel(null)).toBe(false);
  });

  it('gives a saved agent NO specialty set', () => {
    expect(getSpecialtyToolNames('agent:0e8d-uuid')).toBeNull();
  });

  it('says nothing at all about a saved agent\'s tools', () => {
    // undefined = "no client opinion" = the agent's own assignedTools stand.
    expect(resolveChannelEnabledTools('agent:0e8d-uuid')).toBeUndefined();
  });

  it('does not leak the orchestrator\'s legacy global list onto a saved agent', () => {
    localStorage.setItem('agnt_enabled_tools', JSON.stringify(['execute_shell_command']));
    expect(resolveChannelEnabledTools('agent:0e8d-uuid')).toBeUndefined();
    // NEGATIVE CONTROL: that legacy list is still honoured where it belongs.
    expect(resolveChannelEnabledTools('orchestrator:default')).toEqual(['execute_shell_command']);
  });

  it('still honours a list the user explicitly saved for this agent', () => {
    localStorage.setItem(
      'agnt_chat_channel_configs',
      JSON.stringify({ 'agent:0e8d-uuid': { enabledTools: ['web_search'] } }),
    );
    expect(resolveChannelEnabledTools('agent:0e8d-uuid')).toEqual(['web_search']);
  });

  it('leaves the AgentForge builder fully armed', () => {
    expect(resolveChannelEnabledTools(AGENT_FORGE_CHANNEL_KEY))
      .toEqual(expect.arrayContaining(['generate_agent', 'modify_agent', 'list_agents']));
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
