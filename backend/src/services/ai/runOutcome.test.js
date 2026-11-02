import { it, expect } from 'vitest';
import { teamRunOutcome } from './runOutcome.js';
import { runAgentOnTask } from '../TeamSpaceAgents.js';

// bravo, Nov 2026: a provider error (429 billing, 404 model) came back as the reply, flagged
// recoveredFromError, and a card posted it as the agent's work and asked for approval.
const providerError = { content: '⚠️ **API Error:** 429 Your account is not active', recoveredFromError: true, recoveredError: '429 Your account is not active' };

it('a provider error is a failed run that says why', () => {
  expect(teamRunOutcome(providerError)).toEqual({ status: 'failed', result: { ...providerError, error: '429 Your account is not active' } });
});

it('real replies and existing failure shapes are unchanged', () => {
  expect(teamRunOutcome({ success: true, content: 'card ok' })).toEqual({ status: 'completed', result: { success: true, content: 'card ok' } });
  expect(teamRunOutcome({ success: false, error: 'boom' }).status).toBe('failed');
  expect(teamRunOutcome({ error: 'boom', recoveredFromError: true, recoveredError: 'x' }).result.error).toBe('boom');
});

it('on a card, the provider error is reported as a failure, never sent for approval', async () => {
  const states = []; const approvals = [];
  const spaces = { setAgentState: async (...args) => states.push(args[3]), requestApproval: async (...args) => approvals.push(args) };
  const outcome = await runAgentOnTask({ spaces, teamId: 't', workspaceId: 'w', taskId: 'k', agentId: 'a', input: 'go', execute: async () => teamRunOutcome(providerError) });
  expect(outcome).toEqual({ ok: false, error: 'I could not run: 429 Your account is not active' });
  expect(approvals).toEqual([]);
  expect(states.at(-1)).toMatchObject({ state: 'blocked', comment: 'I could not run: 429 Your account is not active' });
});
