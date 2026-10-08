import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { broadcastToUser } from './realtimeSync.js';

// Reported 2026-10-08 on a Business instance: team workflows ran, but every status/output event
// went to `user:scope:…` (0 clients), so the owner's workflow page never showed a run.
let emitted;
beforeEach(() => {
  emitted = [];
  global.io = { sockets: { adapter: { rooms: new Map() } }, to: (rooms) => ({ emit: (event, data) => emitted.push({ rooms, event, data }) }) };
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { delete global.io; vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('a team workspace event also reaches the instance owner', () => {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
  broadcastToUser('scope:5a8e', 'workflow:status_changed', { id: 'wf' });
  expect(emitted[0].rooms).toEqual(['user:scope:5a8e', 'user:owner-1']);
});

it('a person\'s events, and every desktop event, go to that person only', () => {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
  broadcastToUser('member-2', 'chat:content_delta', {});
  vi.stubEnv('AGNT_TENANT_SLUG', '');
  broadcastToUser('scope:5a8e', 'workflow:status_changed', {});
  expect(emitted.map((e) => e.rooms)).toEqual(['user:member-2', 'user:scope:5a8e']);
});
