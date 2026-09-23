// Integration of #131 task evidence, #139 workflow-agent outcomes, and #138
// failure persistence. Real loop/NodeExecutor/SQLite; no real model or user data.
import { it, expect, vi, beforeAll, afterAll } from 'vitest';
vi.mock('../models/database/index.js', async () => {
  const { default: sqlite } = await import('sqlite3');
  return { default: new sqlite.Database(':memory:'), dbRunWithRetry: fn => fn() };
});
vi.mock('../tools/ToolConfig.js', () => ({ default: { triggers: {} } }));
vi.mock('../services/auth/AuthManager.js', () => ({ default: {} }));
vi.mock('./CustomToolExecutor.js', () => ({ default: class {} }));
vi.mock('../services/orchestrator/tools.js', () => ({ getAvailableToolSchemas: async () => [] }));
vi.mock('../services/orchestrator/toolSelector.js', () => ({ getToolsForCategories: () => [] }));
vi.mock('../services/orchestrator/providerToolCompat.js', () => ({ stripProviderIncompatibleTools: schemas => schemas }));
const fixture = vi.hoisted(() => ({ result: null }));
vi.mock('../plugins/PluginManager.js', () => ({ default: {
  loadTool: async () => ({ default: { execute: async () => fixture.result } }),
  getPluginToolSchema: () => ({}),
} }));
vi.mock('../services/security/SecurityPolicyService.js', () => ({ default: {
  getEffectivePolicy: async () => ({ policy: { outputScanning: 'enforce' } }),
} }));
vi.mock('../services/security/nopeService.js', () => ({
  resolvePolicyCredentialDecision: () => 'audit', scanOutput: value => value,
  sanitizeArguments: value => value, selectWorkflowSecurityArgs: (_type, _raw, parameters) => parameters,
  checkAction: async () => ({ allowed: true, policy: { outputScanning: 'enforce' } }),
}));
vi.mock('../models/LlmCallModel.js', () => ({ default: { summaryForOrigin: async () => null } }));
import db from '../models/database/index.js';
import ExecutionModel from '../models/ExecutionModel.js';
import NodeExecutor from './NodeExecutor.js';
import { runAgentConversation, workflowCancellation } from '../tools/library/actions/agentConversationLoop.js';

const sql = (query, args = []) => new Promise((resolve, reject) => db.run(query, args, error => error ? reject(error) : resolve()));
beforeAll(async () => {
  await sql('CREATE TABLE workflow_executions (id TEXT, workflow_id TEXT, user_id TEXT, workflow_name TEXT, start_time TEXT, end_time TEXT, status TEXT, log TEXT)');
  await sql('CREATE TABLE node_executions (id TEXT, execution_id TEXT, node_id TEXT, status TEXT, input TEXT, output TEXT, start_time TEXT, end_time TEXT, error TEXT, credits_used REAL, input_tokens INTEGER, output_tokens INTEGER)');
  await sql("INSERT INTO workflow_executions VALUES ('integration-run','workflow','u','Combined fixture',NULL,NULL,'running','')");
});
afterAll(async () => { await new Promise(resolve => db.close(resolve)); });

it.each([
  { name: 'failed child followed by optimistic prose', child: { success: false, error: 'Fixture failed' }, text: 'All done.', expected: 'needs_review' },
  { name: 'successful child followed by explicit blocked status', child: { success: true }, text: 'Status: blocked\nMissing approval.', expected: 'needs_review' },
])('$name survives actual workflow persistence as a failure', async ({ name, child, text, expected }) => {
  const cancellation = workflowCancellation({ stopRequested: false });
  let modelCalls = 0;
  const adapter = {
    call: async () => ++modelCalls === 1
      ? { responseMessage: { role: 'assistant', content: null }, toolCalls: [{ id: 'call-1', function: { name: 'fixture_child', arguments: '{}' } }] }
      : { responseMessage: { role: 'assistant', content: text }, toolCalls: [] },
    formatToolResults: results => results,
  };
  try {
    fixture.result = await runAgentConversation({ adapter, messages: [], schemas: [{ function: { name: 'fixture_child' } }], context: {},
      cancellation, dispatch: async () => JSON.stringify(child) });
    expect(fixture.result.success).toBe(false);
    expect(fixture.result.outcome).toBe(expected);
    const engine = { userId: 'u', currentExecutionId: 'integration-run', outputs: {}, errors: {}, workflow: {}, parameterResolver: { resolveParameters: value => value }, emit: () => {} };
    const result = await new NodeExecutor(engine).executeNode({ id: name, type: 'integration-fixture', category: 'action', parameters: {} }, {});
    const detail = await ExecutionModel.getExecutionDetails('integration-run');
    const node = detail.nodeExecutions.find(row => row.node_id === name);
    expect(node.status).toBe('error');
    expect(node.output).toEqual(result);
    expect(node.output.outcome).toBe(expected);
    expect(node.output.success).toBe(false);
    expect(node.output.toolExecutions[0].result).toEqual(child);
    expect(engine.outputs[name]).toEqual(node.output);
    expect(modelCalls).toBe(2);
  } finally { cancellation.dispose(); }
});
