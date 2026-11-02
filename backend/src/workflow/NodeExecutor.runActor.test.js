import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// A teammate's teamspace workflow is stored under the workspace principal (engine.userId) but runs as the
// teammate (engine.actorId): every node's gate and tool actor must be the teammate, so memberIsolation
// sandboxes it. Custom tools are judged by what they execute, not by their unprofiled names.
const mocks = vi.hoisted(() => ({ gate: [], inside: [], findAllByUserId: vi.fn(async () => []) }));
vi.mock('../models/database/index.js', () => ({ default: { run: vi.fn() }, dbRunWithRetry: (fn) => fn() }));
vi.mock('../models/ExecutionModel.js', () => ({ default: { createNodeExecution: vi.fn(), updateNodeExecution: vi.fn() } }));
vi.mock('../models/CustomToolModel.js', () => ({ default: { findAllByUserId: mocks.findAllByUserId } }));
vi.mock('./CustomToolExecutor.js', async () => {
  const { currentToolActor, currentToolAuthorization } = await import('../services/security/toolRunAuthority.js');
  return { default: class { execute() { mocks.inside.push({ actor: currentToolActor(), authorization: currentToolAuthorization() }); return { success: true }; } } };
});
vi.mock('../tools/ToolConfig.js', () => ({ default: { triggers: {}, actions: {} } }));
vi.mock('../services/auth/AuthManager.js', () => ({ default: {} }));
vi.mock('../plugins/PluginManager.js', () => ({ default: { loadTool: async () => { throw new Error('no plugin'); }, getPluginToolSchema: () => ({}) } }));
vi.mock('../services/security/SecurityPolicyService.js', () => ({ default: { getEffectivePolicy: async () => ({ policy: {} }) } }));
vi.mock('../services/security/nopeService.js', () => ({
  resolvePolicyCredentialDecision: () => 'audit', scanOutput: (x) => x, sanitizeArguments: (x) => x, stripSensitiveParams: (x) => x,
  selectWorkflowSecurityArgs: (type, raw, resolved) => resolved,
  checkAction: async (action) => { mocks.gate.push(action); return { allowed: true, policy: {} }; },
}));
vi.mock('../models/LlmCallModel.js', () => ({ default: { summaryForOrigin: async () => null } }));
const { default: NodeExecutor } = await import('./NodeExecutor.js');

const engine = (actorId) => ({
  userId: 'scope:w', actorId, get runActor() { return this.actorId || this.userId; },
  currentExecutionId: 'run-1', outputs: {}, errors: {}, workflow: {}, parameterResolver: { resolveParameters: (x) => x }, emit: () => {},
});
const customNode = { id: 'n1', type: 'my-tool', category: 'custom', parameters: { instructions: 'x' } };

beforeEach(() => {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo');
  vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1');
  vi.stubEnv('AGNT_TENANT_MEMBERS', 'owner-1,member-2');
  vi.stubEnv('JWT_SECRET', 'x'.repeat(64));
  mocks.gate.length = 0; mocks.inside.length = 0;
  for (const level of ['log', 'warn', 'error']) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("a teammate's teamspace workflow node", () => {
  it('is gated and executed as the teammate, with a run-scoped token for that teammate', async () => {
    mocks.findAllByUserId.mockResolvedValue([{ type: 'my-tool', base: 'CODE_JS', code: 'return 1' }]);
    await new NodeExecutor(engine('member-2')).executeNode(customNode, {});
    expect(mocks.gate.map((g) => g.userId)).toEqual(['member-2']);
    expect(mocks.inside[0].actor).toBe('member-2');
    expect(mocks.inside[0].authorization).toMatch(/^Bearer agnt-tool\./);
  });

  it('judges a custom tool by what it runs: code as execute-javascript, AI as a model call', async () => {
    mocks.findAllByUserId.mockResolvedValue([{ type: 'my-tool', base: 'CODE_JS', code: 'return 1' }]);
    await new NodeExecutor(engine('member-2')).executeNode(customNode, {});
    mocks.findAllByUserId.mockResolvedValue([{ type: 'my-tool', base: 'AI' }]);
    await new NodeExecutor(engine('member-2')).executeNode(customNode, {});
    expect(mocks.gate.map((g) => g.toolName)).toEqual(['execute-javascript', 'generate-with-ai-llm']);
  });

  it("with nobody recorded (the owner's own workflow) it acts as the workspace, without a token", async () => {
    mocks.findAllByUserId.mockResolvedValue([{ type: 'my-tool', base: 'AI' }]);
    await new NodeExecutor(engine(null)).executeNode(customNode, {});
    expect(mocks.gate.map((g) => g.userId)).toEqual(['scope:w']);
    expect(mocks.inside[0]).toEqual({ actor: 'scope:w', authorization: null });
  });
});
