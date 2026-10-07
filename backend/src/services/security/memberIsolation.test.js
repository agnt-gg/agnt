import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isNonOwnerMember, memberRefusal } from './memberIsolation.js';
import { withTeamExecution } from '../authorization/TeamExecutionContext.js';

const ENV = ['AGNT_TENANT_SLUG', 'AGNT_TENANT_OWNER', 'AGNT_TENANT_MEMBERS', 'AGNT_AUTH_MODE'];
const saved = {};

function businessTenant() {
  process.env.AGNT_TENANT_SLUG = 'bravo';
  process.env.AGNT_TENANT_OWNER = 'owner-1';
  process.env.AGNT_TENANT_MEMBERS = 'owner-1,member-2';
}

describe('memberIsolation', () => {
  beforeEach(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
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
