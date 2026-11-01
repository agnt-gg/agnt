import { describe, it, expect } from 'vitest';
import { startWorkflow } from './tools.js';
import AGNT from '../../libs/agnt2.js';

// Bravo, 2026-10-31: trigger_workflow on "Dice Roll" reported "Request failed with status code 409";
// the workflow was simply already running on its timer. And get_execution_logs always 404'd: it called
// /executions/:id/logs, a route that does not exist.
const httpError = (status, data) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

describe('workflow tools', { timeout: 30000 }, () => {
  it('a workflow that is already running is reported as such, not as a failure', async () => {
    const workflows = { activate: async () => { throw httpError(409, { code: 'ALREADY_ACTIVE' }); } };
    expect(await startWorkflow(workflows, 'wf-1')).toMatchObject({ alreadyActive: true, workflowId: 'wf-1', message: expect.stringMatching(/already running/) });
  });

  it('any other failure still fails', async () => {
    for (const error of [httpError(409, { code: 'SOMETHING_ELSE' }), httpError(500, {}), new Error('ECONNREFUSED')]) {
      await expect(startWorkflow({ activate: async () => { throw error; } }, 'wf-1')).rejects.toBe(error);
    }
  });

  it('get_execution_logs asks for the execution itself, the route that exists', async () => {
    const agnt = new AGNT('token');
    let asked;
    agnt.executions.client = { get: async (url) => { asked = url; return { data: { id: 'ex-1' } }; } };
    expect(await agnt.executions.getLogs('ex-1')).toEqual({ id: 'ex-1' });
    expect(asked).toBe('/executions/ex-1');
  });
});
