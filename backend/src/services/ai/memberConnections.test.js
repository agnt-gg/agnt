/**
 * A team member's own Claude Code / Codex sign-in on a hosted instance runs on
 * the real connection code, with its store and files in the member's vault.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { createManagedConnection, getConnection } from './connectionRuntime.js';
import { memberConnection, subscriptionConnectionFor, forgetMemberConnections, parseDocument } from './memberConnections.js';
import { useSettingsStore } from '../auth/memberAi.js';

function fakeVault(initial = {}) {
  const rows = { ...initial };
  const calls = [];
  return {
    rows, calls,
    read: async (member, provider) => rows[`${member}/${provider}`] ?? null,
    write: async (member, provider, text) => { calls.push(['write', member, provider]); rows[`${member}/${provider}`] = text; },
    remove: async (member, provider) => { calls.push(['remove', member, provider]); delete rows[`${member}/${provider}`]; },
  };
}
const http = { post: vi.fn(async () => ({ status: 200, data: {} })), get: vi.fn(async () => ({ status: 200, data: {} })) };
const create = (id, deps) => createManagedConnection(id, { ...deps, httpClient: http });
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;

let settings;
beforeEach(() => {
  forgetMemberConnections();
  settings = {};
  useSettingsStore({ read: () => settings, write: (value) => { settings = value; } });
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo');
  vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
});
afterEach(() => { vi.unstubAllEnvs(); useSettingsStore(null); forgetMemberConnections(); });

describe("a member's own Claude Code sign-in", () => {
  it('is kept in their vault, never on the instance', async () => {
    const vault = fakeVault();
    const connection = await memberConnection('member-2', 'claude-code', { vault, create });
    const result = await connection.saveManualToken('sk-ant-api03-member-token');
    expect(result.success).toBe(true);
    await connection.flushVault();
    const doc = JSON.parse(vault.rows['member-2/claude-code']);
    expect(doc.store.claudeAiOauth.accessToken).toBe('sk-ant-api03-member-token');
    expect(connection.describeCredential().credPath).toBe('vault:claude-code');
    expect(await connection.getAccessToken()).toBe('sk-ant-api03-member-token');
    expect(getConnection('claude-code').getAccessTokenSync()).not.toBe('sk-ant-api03-member-token');
  });

  it('comes back from the vault after a restart, and is not another member\u2019s', async () => {
    const vault = fakeVault();
    await (await memberConnection('member-2', 'claude-code', { vault, create })).saveManualToken('sk-ant-api03-member-token');
    forgetMemberConnections();
    expect(await (await memberConnection('member-2', 'claude-code', { vault, create })).getAccessToken()).toBe('sk-ant-api03-member-token');
    expect(await (await memberConnection('member-3', 'claude-code', { vault, create })).getAccessToken()).toBeNull();
  });

  it('signing out clears only their vault copy', async () => {
    const vault = fakeVault();
    const connection = await memberConnection('member-2', 'claude-code', { vault, create });
    await connection.saveManualToken('sk-ant-api03-member-token');
    await connection.logout();
    await connection.flushVault();
    expect(vault.calls.at(-1)).toEqual(['remove', 'member-2', 'claude-code']);
    expect(vault.rows['member-2/claude-code']).toBeUndefined();
  });

  it('a bare token saved as an ordinary key still works', () => {
    expect(parseDocument('sk-ant-oat01-abc', 'claude-code').store.claudeAiOauth.accessToken).toBe('sk-ant-oat01-abc');
    expect(parseDocument('not json', 'openai-codex')).toEqual({ v: 1, store: null, files: {} });
  });
});

describe("a member's own Codex sign-in", () => {
  it('reads its tokens from the member\u2019s vault document', async () => {
    const access = jwt({ exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-member' } });
    const authPath = path.join('/agnt-member-vault', '.codex', 'auth.json');
    const vault = fakeVault({ 'member-2/openai-codex': JSON.stringify({ v: 1, store: null, files: { [authPath]: { tokens: { access_token: access, refresh_token: 'r1' } } } }) });
    const connection = await memberConnection('member-2', 'openai-codex', { vault, create });
    expect(connection.getOAuthToken()).toBe(access);
    expect(connection.getChatGptAccountId()).toBe('acct-member');
    await connection.logout();
    await connection.flushVault();
    expect(vault.calls.at(-1)).toEqual(['remove', 'member-2', 'openai-codex']);
  });
});

describe('which connection a call uses', () => {
  it('a desktop and the owner use the instance\u2019s own', async () => {
    expect(await subscriptionConnectionFor('owner-1', 'claude-code', { vault: fakeVault(), create })).toBe(getConnection('claude-code'));
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    expect(await subscriptionConnectionFor('anyone', 'claude-code', { vault: fakeVault(), create })).toBe(getConnection('claude-code'));
  });

  it('a member not signed in gets nothing unless the owner shares theirs', async () => {
    const vault = fakeVault();
    expect(await subscriptionConnectionFor('member-2', 'claude-code', { vault, create })).toBeNull();
    settings = { sharedSubscriptions: ['claude-code'] };
    expect(await subscriptionConnectionFor('member-2', 'claude-code', { vault, create })).toBe(getConnection('claude-code'));
  });

  it('a member signed in uses their own, even when the owner shares', async () => {
    settings = { sharedSubscriptions: ['claude-code'] };
    const vault = fakeVault({ 'member-2/claude-code': JSON.stringify({ v: 1, store: { claudeAiOauth: { accessToken: 'sk-ant-api03-own' } }, files: {} }) });
    const chosen = await subscriptionConnectionFor('member-2', 'claude-code', { vault, create });
    expect(chosen).not.toBe(getConnection('claude-code'));
    expect(await chosen.getAccessToken()).toBe('sk-ant-api03-own');
  });
});
