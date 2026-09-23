// Real SQLite and ExecutionModel/PayloadStore; no live backend/database/provider.
import { it, expect, vi, beforeAll, afterAll } from 'vitest';
vi.mock('../models/database/index.js', async () => { const { default: sqlite } = await import('sqlite3'); return { default: new sqlite.Database(':memory:'), dbRunWithRetry: fn => fn() }; });
vi.mock('../tools/ToolConfig.js', () => ({ default: { triggers: {} } }));
vi.mock('../services/auth/AuthManager.js', () => ({ default: {} }));
vi.mock('./CustomToolExecutor.js', () => ({ default: class {
    } }));
const m = vi.hoisted(() => ({ output: null }));
vi.mock('../plugins/PluginManager.js', () => ({ default: { loadTool: async () => ({ default: { execute: async () => m.output } }), getPluginToolSchema: () => ({}) } }));
vi.mock('../services/security/SecurityPolicyService.js', () => ({ default: { getEffectivePolicy: async () => ({ policy: { outputScanning: 'enforce' } }) } }));
vi.mock('../services/security/nopeService.js', () => ({ resolvePolicyCredentialDecision: () => 'audit', scanOutput: x => ({ ...x, response: '[REDACTED]' }), sanitizeArguments: x => x, selectWorkflowSecurityArgs: (t, r, p) => p, checkAction: async () => ({ allowed: true, policy: { outputScanning: 'enforce' } }) }));
vi.mock('../models/LlmCallModel.js', () => ({ default: { summaryForOrigin: async () => null } }));
import db from '../models/database/index.js';
import ExecutionModel from '../models/ExecutionModel.js';
import NodeExecutor from './NodeExecutor.js';
const sql = (s, p = []) => new Promise((r, j) => db.run(s, p, e => e ? j(e) : r()));
beforeAll(async () => {
    await sql('CREATE TABLE workflow_executions (id TEXT, workflow_id TEXT, user_id TEXT, workflow_name TEXT, start_time TEXT, end_time TEXT, status TEXT, log TEXT)');
    await sql('CREATE TABLE node_executions (id TEXT, execution_id TEXT, node_id TEXT, status TEXT, input TEXT, output TEXT, start_time TEXT, end_time TEXT, error TEXT, credits_used REAL, input_tokens INTEGER, output_tokens INTEGER)');
    await sql("INSERT INTO workflow_executions VALUES ('run','workflow','u','Fixture',NULL,NULL,'running','')");
});
afterAll(async () => { await new Promise(r => db.close(r)); });
it.each(['needs_review', 'cancelled'])('Given %s receipt Then actual execution readback retains failed calls and error status', async (outcome) => {
    const engine = { userId: 'u', currentExecutionId: 'run', outputs: {}, errors: {}, workflow: {}, parameterResolver: { resolveParameters: x => x }, emit: () => { } };
    m.output = { success: false, outcome, error: 'review required', response: 'PRIVATE_FIXTURE', toolExecutions: [{ callId: 'child', disposition: 'unknown', detail: 'fixture '.repeat(1000) }], execution: { unresolvedCalls: ['child'], childTerminationVerified: false } };
    const result = await new NodeExecutor(engine).executeNode({ id: outcome, type: 'persist-fixture', category: 'action', parameters: {} }, {});
    const detail = await ExecutionModel.getExecutionDetails('run');
    const node = detail.nodeExecutions.find(x => x.node_id === outcome);
    expect(node.status).toBe('error');
    expect(node.error).toBe('review required');
    expect(node.output).toEqual(result);
    expect(node.output.execution.unresolvedCalls).toEqual(['child']);
    expect(node.output.response).toBe('[REDACTED]');
    expect(JSON.stringify(detail)).not.toContain('PRIVATE_FIXTURE');
});
