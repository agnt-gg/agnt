import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A custom node with no definition fails closed.
 *
 * When the custom_tools row is gone — deleted tool, wrong user, imported
 * workflow — the executor used to warn and carry on with an empty definition.
 * The AI base then called the model describing a tool that does not exist, and
 * the node reported success for work nothing had done.
 *
 * Nodes carrying their own inline definition are a supported mode and must keep
 * running, so both halves are pinned here.
 */

const mocks = vi.hoisted(() => ({
  findAllByUserId: vi.fn(async () => []),
  execute: vi.fn(async () => ({ success: true })),
  createNodeExecution: vi.fn(),
  updateNodeExecution: vi.fn(),
}));

vi.mock('../models/database/index.js', () => ({ default: { run: vi.fn() }, dbRunWithRetry: (fn) => fn() }));
vi.mock('../models/ExecutionModel.js', () => ({
  default: { createNodeExecution: mocks.createNodeExecution, updateNodeExecution: mocks.updateNodeExecution },
}));
vi.mock('../models/CustomToolModel.js', () => ({ default: { findAllByUserId: mocks.findAllByUserId } }));
vi.mock('./CustomToolExecutor.js', () => ({ default: class { execute(...args) { return mocks.execute(...args); } } }));
vi.mock('../tools/ToolConfig.js', () => ({ default: { triggers: {}, actions: {} } }));
vi.mock('../services/auth/AuthManager.js', () => ({ default: {} }));
vi.mock('../plugins/PluginManager.js', () => ({ default: { loadTool: async () => { throw new Error('no plugin'); }, getPluginToolSchema: () => ({}) } }));
vi.mock('../services/security/SecurityPolicyService.js', () => ({ default: { getEffectivePolicy: async () => ({ policy: {} }) } }));
vi.mock('../services/security/nopeService.js', () => ({
  resolvePolicyCredentialDecision: () => 'audit',
  scanOutput: (x) => x,
  sanitizeArguments: (x) => x,
  stripSensitiveParams: (x) => x,
  selectWorkflowSecurityArgs: (type, raw, resolved) => resolved,
  checkAction: async () => ({ allowed: true, policy: {} }),
}));
vi.mock('../models/LlmCallModel.js', () => ({ default: { summaryForOrigin: async () => null } }));

const { default: NodeExecutor } = await import('./NodeExecutor.js');

const makeEngine = () => ({
  userId: 'user-1',
  currentExecutionId: 'run-1',
  outputs: {},
  errors: {},
  workflow: {},
  parameterResolver: { resolveParameters: (x) => x },
  emit: () => {},
});

const customNode = (overrides = {}) => ({
  id: 'node-1',
  type: 'deleted-tool',
  category: 'custom',
  parameters: { instructions: 'do the thing' },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAllByUserId.mockResolvedValue([]);
  mocks.execute.mockResolvedValue({ success: true });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('NodeExecutor — custom node with no definition', () => {
  it('does not dispatch the tool when there is no row and no inline code', async () => {
    const result = await new NodeExecutor(makeEngine()).executeNode(customNode(), {});

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toContain('deleted-tool');
  });

  it('names the missing definition so the node can be triaged', async () => {
    const result = await new NodeExecutor(makeEngine()).executeNode(customNode(), {});

    expect(result.error).toMatch(/custom tool definition not found/i);
  });

  it('still runs a node that carries its own inline definition', async () => {
    const node = customNode({ code: 'return 1;', base: 'Code' });

    const result = await new NodeExecutor(makeEngine()).executeNode(node, {});

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0]).toMatchObject({ code: 'return 1;' });
    expect(result.success).toBe(true);
  });

  it('still runs a node whose definition is in the database', async () => {
    mocks.findAllByUserId.mockResolvedValue([{ type: 'deleted-tool', base: 'Code', code: 'return 2;' }]);

    const result = await new NodeExecutor(makeEngine()).executeNode(customNode(), {});

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.execute.mock.calls[0][0]).toMatchObject({ code: 'return 2;' });
    expect(result.success).toBe(true);
  });
});
