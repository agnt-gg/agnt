import { it, expect } from 'vitest';
import fs from 'fs';
import { teamRunOutcome, unansweredReason } from './runOutcome.js';
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

it('a chat turn whose only reply is the provider error went unanswered, and says why', () => {
  expect(unansweredReason({ ...providerError, toolCalls: [] })).toBe('429 Your account is not active');
  expect(unansweredReason({ recoveredFromError: true })).toBe('Provider request failed');
});

it('a real reply, or a turn that went on to use tools, was answered', () => {
  expect(unansweredReason({ responseMessage: { content: 'hi' }, toolCalls: [] })).toBeNull();
  expect(unansweredReason({ ...providerError, toolCalls: [{ id: 't1' }] })).toBeNull();
  expect(unansweredReason(null)).toBeNull();
});

it('the chat records an unanswered turn as a failed run with its reason', () => {
  const orchestrator = fs.readFileSync(new URL('../OrchestratorService.js', import.meta.url), 'utf8');
  expect(orchestrator).toMatch(/unansweredTurnError = unansweredReason\(_r0\);/);
  expect(orchestrator).toMatch(/const finalStatus = streamErrorForLogging \|\| unansweredTurnError \? 'failed' : 'completed';/);
  expect(orchestrator).toMatch(/streamErrorForLogging \? streamErrorForLogging\.message : unansweredTurnError,/);
});

it('on a card, the provider error is reported as a failure, never sent for approval', async () => {
  const states = []; const approvals = [];
  const spaces = { setAgentState: async (...args) => states.push(args[3]), requestApproval: async (...args) => approvals.push(args) };
  const outcome = await runAgentOnTask({ spaces, teamId: 't', workspaceId: 'w', taskId: 'k', agentId: 'a', input: 'go', execute: async () => teamRunOutcome(providerError) });
  expect(outcome).toEqual({ ok: false, error: 'I could not run: 429 Your account is not active' });
  expect(approvals).toEqual([]);
  expect(states.at(-1)).toMatchObject({ state: 'blocked', comment: 'I could not run: 429 Your account is not active' });
});
