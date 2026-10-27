import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BILLING, isHostedMember, isAiProvider, canLendToMember, assertMemberCanUseProvider,
  fileSettingsStore, useSettingsStore, memberAiBilling, setMemberAiBilling, teamPaysForMembers,
  sharedSubscriptions, sharesSubscription, setSharedSubscriptions,
} from './memberAi.js';

const hosted = (owner = 'owner-1') => { vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', owner); };
let dir;
const file = () => path.join(dir, 'member-ai.json');
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'member-ai-')); useSettingsStore(fileSettingsStore(file())); });
afterEach(() => { vi.unstubAllEnvs(); useSettingsStore(null); fs.rmSync(dir, { recursive: true, force: true }); });

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

describe("what a member may use of the owner's", () => {
  it('lends ordinary AI keys while the team pays, never once each member pays', () => {
    for (const p of ['openai', 'anthropic', 'groq', 'openrouter', 'kimi', 'deepseek']) expect(canLendToMember(p), p).toBe(true);
    setMemberAiBilling('member');
    expect(canLendToMember('openai')).toBe(false);
  });
  it('lends a subscription only when the owner shares it, whoever pays for keys', () => {
    for (const p of ['kimi-code', 'claude-code', 'openai-codex']) expect(canLendToMember(p), p).toBe(false);
    setSharedSubscriptions(['claude-code', 'kimi-code']);
    setMemberAiBilling('member');
    expect(canLendToMember('claude-code')).toBe(true);
    expect(canLendToMember('kimi-code')).toBe(true);
    expect(canLendToMember('openai-codex')).toBe(false);
  });
  it('never lends connected apps', () => {
    for (const p of ['gmail', 'github', 'google', 'agnt']) expect(isAiProvider(p), p).toBe(false);
    expect(canLendToMember('github')).toBe(false);
  });
  it('lets members use Claude Code and Codex (their own sign-in), other instance logins only when shared', () => {
    expect(() => assertMemberCanUseProvider('claude-code')).not.toThrow();
    expect(() => assertMemberCanUseProvider('openai-codex')).not.toThrow();
    expect(() => assertMemberCanUseProvider('gemini-cli')).toThrow(/owner\u2019s sign-in/);
    setSharedSubscriptions(['gemini-cli']);
    expect(() => assertMemberCanUseProvider('gemini-cli')).not.toThrow();
    expect(() => assertMemberCanUseProvider('my-custom-llm')).toThrow(/Custom providers/);
    expect(() => assertMemberCanUseProvider('agnt')).not.toThrow();
  });
});

describe("the owner's choices", () => {
  it('default to the team paying and nothing shared', () => {
    expect(memberAiBilling()).toBe(BILLING.TEAM);
    expect(teamPaysForMembers()).toBe(true);
    expect([...sharedSubscriptions()]).toEqual([]);
  });
  it('are remembered together on disk', () => {
    setMemberAiBilling('member');
    setSharedSubscriptions(['openai-codex']);
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    expect(saved).toMatchObject({ billing: 'member', sharedSubscriptions: ['openai-codex'] });
    expect(sharesSubscription('openai-codex')).toBe(true);
    expect(teamPaysForMembers()).toBe(false);
  });
  it('reject unknown values, and a damaged file reads as the defaults', () => {
    expect(() => setMemberAiBilling('everyone')).toThrow(/team.*member/);
    expect(() => setSharedSubscriptions(['gmail'])).toThrow(/subscriptions/);
    fs.writeFileSync(file(), '{not json');
    expect(memberAiBilling()).toBe(BILLING.TEAM);
    expect([...sharedSubscriptions()]).toEqual([]);
  });
});
