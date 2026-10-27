import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isNonOwnerMember, memberRefusal } from './memberIsolation.js';
import { withTeamExecution } from '../authorization/TeamExecutionContext.js';
import { isMemberSafePluginEntry, setMemberSafePluginTools } from './memberSafePlugins.js';

const ENV = ['AGNT_TENANT_SLUG', 'AGNT_TENANT_OWNER', 'AGNT_TENANT_MEMBERS', 'AGNT_AUTH_MODE'];
const saved = {};

function businessTenant() {
  process.env.AGNT_TENANT_SLUG = 'bravo';
  process.env.AGNT_TENANT_OWNER = 'owner-1';
  process.env.AGNT_TENANT_MEMBERS = 'owner-1,member-2';
}

describe('memberIsolation', () => {
  beforeEach(() => { setMemberSafePluginTools([]); for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('a desktop install has no members: nobody is refused anything', () => {
    expect(isNonOwnerMember('anyone')).toBe(false);
    expect(memberRefusal('execute_shell_command', { command: 'ls' }, 'anyone')).toBeNull();
  });

  it('the owner of a shared instance keeps every tool', () => {
    businessTenant();
    for (const tool of ['execute_shell_command', 'execute_javascript_code', 'read_file', 'write_file', 'database-operation', 'some_plugin_tool']) {
      expect(memberRefusal(tool, {}, 'owner-1')).toBeNull();
    }
  });

  it('a member is refused everything that runs code, touches files or queries the database', () => {
    businessTenant();
    const refused = [
      ['execute_shell_command', { command: 'cat /app/data/secrets/ENCRYPTION_KEY' }],
      ['execute_javascript_code', { code: '1' }],
      ['execute-python', { code: '1' }],
      ['read_file', { path: '/app/data/agnt.db' }],
      ['list_files', { path: '/app/data' }],
      ['write_file', { path: 'x', content: 'y' }],
      ['database-operation', { operation: 'select' }],
      ['file_operations', { operation: 'copy', path: 'a', destination: 'b' }],
      ['file-system-operation', { operation: 'readFile', rootDirectory: '/app/data', path: 'secrets' }],
    ];
    for (const [tool, args] of refused) {
      expect(memberRefusal(tool, args, 'member-2'), tool).toMatch(/only its owner may use it/);
    }
  });

  it('fail-closed: a tool with no declared capabilities (plugin, MCP, custom) is refused to a member', () => {
    businessTenant();
    expect(memberRefusal('mcp__filesystem__read', { path: '/' }, 'member-2')).toMatch(/no declared capabilities/);
  });

  it('a member keeps chat-side tools: web, memory, images, email, sub-chats', () => {
    businessTenant();
    for (const tool of ['web_search', 'web_scrape', 'save_agent_memory', 'recall', 'generate_image', 'send_email', 'start_chat']) {
      expect(memberRefusal(tool, {}, 'member-2'), tool).toBeNull();
    }
  });

  it('a member keeps the AGNT platform tools and the cloud sandbox (they act on the member\'s own authority, or off this machine)', () => {
    businessTenant();
    for (const tool of ['agnt_agents', 'agnt_workflows', 'agnt_tools', 'agnt_goals', 'agnt_chat', 'agnt_auth', 'sandbox_run', 'record_memory_use']) {
      expect(memberRefusal(tool, { operation: 'list', command: 'python3 x.py' }, 'member-2'), tool).toBeNull();
    }
  });

  it('a member is still refused the local browser, CLI agents and custom tools (they reach this machine)', () => {
    businessTenant();
    for (const tool of ['browser', 'codex_exec', 'cursor_exec', 'execute_custom_agnt_tool']) {
      expect(memberRefusal(tool, {}, 'member-2'), tool).toMatch(/only its owner may use it/);
    }
  });

  it('a member may call an official, verified, clean plugin tool in either spelling, and no other plugin tool', () => {
    businessTenant();
    setMemberSafePluginTools(['gmail-api']);
    expect(memberRefusal('gmail-api', {}, 'member-2')).toBeNull();
    expect(memberRefusal('gmail_api', {}, 'member-2')).toBeNull();
    expect(memberRefusal('github_api', {}, 'member-2')).toMatch(/no declared capabilities/);
    setMemberSafePluginTools([]);
    expect(memberRefusal('gmail_api', {}, 'member-2')).toMatch(/no declared capabilities/);
  });

  it('member-safe plugins are exactly official + verified + scanned clean of anything but network', () => {
    const ok = { trustTier: 'official', integrityState: 'verified', detectedCapabilities: [] };
    expect(isMemberSafePluginEntry(ok)).toBe(true);
    expect(isMemberSafePluginEntry({ ...ok, detectedCapabilities: ['network'] })).toBe(true);
    for (const capability of ['filesystem', 'spawn-process', 'env-access', 'dynamic-eval', 'dynamic-import']) {
      expect(isMemberSafePluginEntry({ ...ok, detectedCapabilities: ['network', capability] }), capability).toBe(false);
    }
    expect(isMemberSafePluginEntry({ ...ok, trustTier: 'community' })).toBe(false);
    expect(isMemberSafePluginEntry({ ...ok, integrityState: 'unverified' })).toBe(false);
    expect(isMemberSafePluginEntry({ ...ok, scanFailed: true })).toBe(false);
    expect(isMemberSafePluginEntry({ trustTier: 'official', integrityState: 'verified' })).toBe(false);
    expect(isMemberSafePluginEntry(null)).toBe(false);
  });

  it('no caller id (the instance\'s own background work) is not treated as a member', () => {
    businessTenant();
    expect(memberRefusal('execute_shell_command', { command: 'ls' }, undefined)).toBeNull();
    expect(memberRefusal('execute_shell_command', { command: 'ls' }, '  ')).toBeNull();
  });

  it('an owner-approved shared run keeps what the owner allowlisted for it', () => {
    businessTenant();
    const inRun = withTeamExecution({ teamId: 't', principalId: 'p', actorId: 'member-2' },
      () => memberRefusal('execute_shell_command', { command: 'ls' }, 'member-2'));
    expect(inRun).toBeNull();
    // ...and only inside it.
    expect(memberRefusal('execute_shell_command', { command: 'ls' }, 'member-2')).not.toBeNull();
  });

  it('an owner named by email cannot be told apart by id, so nobody is locked out', () => {
    process.env.AGNT_AUTH_MODE = 'verify-remote';
    process.env.AGNT_TENANT_OWNER = 'owner@example.com';
    process.env.AGNT_TENANT_MEMBERS = 'owner@example.com,member@example.com';
    expect(isNonOwnerMember('any-id')).toBe(false);
  });
});
