import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BILLING, isHostedMember, isAiProvider, isLendable, assertMemberCanUseProvider,
  fileBillingStore, useBillingStore, memberAiBilling, setMemberAiBilling, teamPaysForMembers,
} from './memberAi.js';

const hosted = (owner = 'owner-1') => { vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', owner); };
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'member-ai-')); useBillingStore(fileBillingStore(path.join(dir, 'member-ai.json'))); });
afterEach(() => { vi.unstubAllEnvs(); useBillingStore(null); fs.rmSync(dir, { recursive: true, force: true }); });

describe('who is a hosted member', () => {
  it('is nobody on a desktop', () => {
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    expect(isHostedMember('anyone')).toBe(false);
  });
  it('is everyone but the owner on a hosted instance', () => {
    hosted();
    expect(isHostedMember('owner-1')).toBe(false);
    expect(isHostedMember('member-2')).toBe(true);
  });
  it('fails closed when no owner is configured', () => {
    hosted('');
    expect(isHostedMember('member-2')).toBe(true);
  });
});

describe('which providers a member may use', () => {
  it('lends ordinary AI model providers', () => {
    for (const p of ['openai', 'anthropic', 'groq', 'openrouter', 'kimi', 'deepseek']) expect(isLendable(p), p).toBe(true);
  });
  it('never lends a subscription or an instance CLI login', () => {
    for (const p of ['kimi-code', 'claude-code', 'openai-codex', 'gemini-cli', 'cursor-cli']) expect(isLendable(p), p).toBe(false);
  });
  it('treats connected apps and AGNT Models as not AI-key providers', () => {
    for (const p of ['gmail', 'github', 'google', 'agnt']) expect(isAiProvider(p), p).toBe(false);
  });
  it('refuses instance CLI logins and custom providers outright, allows the rest', () => {
    expect(() => assertMemberCanUseProvider('claude-code')).toThrow(/signs in on this instance as its owner/);
    expect(() => assertMemberCanUseProvider('my-custom-llm')).toThrow(/Custom providers/);
    expect(() => assertMemberCanUseProvider('openai')).not.toThrow();
    expect(() => assertMemberCanUseProvider('kimi-code')).not.toThrow();
    expect(() => assertMemberCanUseProvider('agnt')).not.toThrow();
  });
});

describe("the owner's choice", () => {
  it('defaults to the team paying', () => {
    expect(memberAiBilling()).toBe(BILLING.TEAM);
    expect(teamPaysForMembers()).toBe(true);
  });
  it('remembers "each member pays" across reads, on disk', () => {
    expect(setMemberAiBilling('member')).toBe(BILLING.MEMBER);
    expect(teamPaysForMembers()).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'member-ai.json'), 'utf8')).billing).toBe('member');
  });
  it('rejects anything else, and a damaged file reads as the default', () => {
    expect(() => setMemberAiBilling('everyone')).toThrow(/team.*member/);
    fs.writeFileSync(path.join(dir, 'member-ai.json'), '{not json');
    expect(memberAiBilling()).toBe(BILLING.TEAM);
  });
});
