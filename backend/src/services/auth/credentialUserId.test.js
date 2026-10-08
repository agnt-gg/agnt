import { describe, it, expect, afterEach, vi } from 'vitest';
import { credentialUserId, isPermittedUser, hostedWorkflowRunRefusal } from './tenantOwnership.js';
import { isNonOwnerMember } from '../security/memberIsolation.js';

// Reported on a Business instance (2026-10-08): the owner could not start a workflow,
// create a goal, or open Schedules ("Upgrade required"), because every check keyed to
// the team workspace's storage principal (`scope:…`) treated it as nobody.
afterEach(() => vi.unstubAllEnvs());
const hosted = (owner = 'owner-1') => { vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', owner); vi.stubEnv('AGNT_TENANT_MEMBERS', ''); };

describe('credentialUserId', () => {
  it('a team workspace principal acts with the instance owner\u2019s identity on a hosted instance', () => {
    hosted();
    expect(credentialUserId('scope:5a8e')).toBe('owner-1');
  });
  it('leaves every person, and every desktop install, unchanged', () => {
    hosted();
    expect(credentialUserId('member-2')).toBe('member-2');
    expect(credentialUserId(undefined)).toBe(undefined);
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    expect(credentialUserId('scope:5a8e')).toBe('scope:5a8e');
  });
  it('never resolves to an owner named only by email', () => {
    hosted('owner@example.com');
    expect(credentialUserId('scope:5a8e')).toBe('scope:5a8e');
  });
});

// Reported 2026-10-08: a Business owner's timer workflow fired every minute and every fire died
// with "Shared workflow requires its approved execution principal": no run, no output, no error shown.
describe('hostedWorkflowRunRefusal', () => {
  it('a team workspace workflow runs (as the owner) on a hosted instance', () => {
    hosted();
    expect(hostedWorkflowRunRefusal('scope:5a8e')).toBeNull();
  });
  it('the owner\'s own workflows run; a member\'s personal ones still do not', () => {
    hosted();
    expect(hostedWorkflowRunRefusal('owner-1')).toBeNull();
    expect(hostedWorkflowRunRefusal('member-2')).toMatch(/approved shared execution principal/);
  });
  it('a scope that cannot resolve to an owner still needs a published team run', () => {
    hosted('owner@example.com');
    expect(hostedWorkflowRunRefusal('scope:5a8e')).toMatch(/approved execution principal/);
    expect(hostedWorkflowRunRefusal('scope:5a8e', true)).toBeNull();
  });
  it('desktop installs always run', () => {
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    expect(hostedWorkflowRunRefusal('anyone')).toBeNull();
  });
});

describe('what the workspace principal may do', () => {
  it('is admitted on its own instance; a stranger still is not', () => {
    hosted();
    expect(isPermittedUser('scope:5a8e')).toBe(true);
    expect(isPermittedUser('stranger')).toBe(false);
  });
  it('is not a non-owner member, so shared workflows keep code tools; real members still are', () => {
    hosted();
    expect(isNonOwnerMember('scope:5a8e')).toBe(false);
    expect(isNonOwnerMember('member-2')).toBe(true);
  });
});
