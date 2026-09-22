import { describe, it, expect, vi } from 'vitest';

/**
 * A trigger that EXISTS but fails to set up must leave the workflow in
 * 'error' with the message on the node — not fall through to the legacy
 * ToolConfig setup and report 'listening' as if it were armed.
 */
vi.mock('../tools/library/triggers/webhook-listener.js', () => ({
  default: { setup: vi.fn(async () => { throw new Error("Your plan's webhook endpoints are all in use."); }) },
}));
vi.mock('../tools/ToolConfig.js', () => ({
  default: { triggers: { 'webhook-listener': { setup: vi.fn(async () => {}) } } },
}));

describe('trigger setup failure', () => {
  it('records the error and does not fall back to ToolConfig', async () => {
    const { default: WorkflowEngine } = await import('./WorkflowEngine.js');
    const ToolConfig = (await import('../tools/ToolConfig.js')).default;
    const engine = Object.create(WorkflowEngine.prototype);
    Object.assign(engine, {
      workflow: { nodes: [{ id: 'hook', text: 'Webhook Listener', type: 'webhook-listener', category: 'trigger', parameters: {} }] },
      errors: {},
      isListening: true,
      emit: vi.fn(),
      _updateNodeError(id, e) { this.errors[id] = e; },
      _updateWorkflowStatus: vi.fn(async () => {}),
    });
    await engine._setupTriggerListeners();
    expect(engine.errors.hook).toMatch(/webhook endpoints are all in use/);
    expect(ToolConfig.triggers['webhook-listener'].setup).not.toHaveBeenCalled();
    expect(engine._updateWorkflowStatus).toHaveBeenLastCalledWith('error');
    expect(engine.isListening).toBe(false);
  });
});
