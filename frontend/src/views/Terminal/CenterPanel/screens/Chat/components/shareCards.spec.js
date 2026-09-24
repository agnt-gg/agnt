import { describe, it, expect } from 'vitest';
import { shareTarget } from './shareCards.js';

const call = (name, args, result, extra = {}) => ({ name, args: JSON.stringify(args), result: JSON.stringify(result), ...extra });

describe('shareTarget', () => {
  it('offers the workflow Annie just created', () => {
    const t = shareTarget(call('agnt_workflows', { operation: 'create_workflow', workflow_definition: JSON.stringify({ name: 'Daily brief' }) },
      { success: true, operation: 'create_workflow', result: { workflowId: 'wf_1' } }));
    expect(t).toEqual({ kind: 'workflow', id: 'wf_1', name: 'Daily brief' });
  });

  it('reads nested and flat create responses alike', () => {
    expect(shareTarget(call('agnt_agents', { operation: 'create_agent', agent_data: { name: 'Scout' } },
      { success: true, result: { agent: { id: 'ag_9', name: 'Scout' } } }))).toEqual({ kind: 'agent', id: 'ag_9', name: 'Scout' });
    expect(shareTarget(call('agnt_tools', { operation: 'create_tool', tool_definition: JSON.stringify({ title: 'Summarize' }) },
      { success: true, result: { id: 't_3' } }))).toEqual({ kind: 'tool', id: 't_3', name: 'Summarize' });
  });

  it('stays silent for reads, failures, errors and unknown shapes', () => {
    expect(shareTarget(call('agnt_workflows', { operation: 'list_workflows' }, { success: true, result: [{ id: 'x' }] }))).toBeNull();
    expect(shareTarget(call('agnt_workflows', { operation: 'create_workflow' }, { success: false, error: 'bad' }))).toBeNull();
    expect(shareTarget(call('agnt_workflows', { operation: 'create_workflow' }, { success: true, result: { ok: 1 } }))).toBeNull();
    expect(shareTarget(call('agnt_workflows', { operation: 'create_workflow' }, { success: true, result: { id: 'w' } }, { error: 'boom' }))).toBeNull();
    expect(shareTarget(call('web_search', { query: 'x' }, { id: 'nope' }))).toBeNull();
    expect(shareTarget({ name: 'agnt_agents', args: '{"operation":"create_ag', result: undefined })).toBeNull();
    expect(shareTarget(null)).toBeNull();
  });
});
