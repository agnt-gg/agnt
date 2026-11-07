import { describe, it, expect, afterEach } from 'vitest';
import bridge from './WorkflowProcessBridge.js';
import RestartManager from '../services/RestartManager.js';

// Measured on a Windows update test: the update was ready 34s after launch, before the
// workflow process had been spawned, and "Restart to update" was refused as "can't tell"
// (busy source workflows unavailable: Workflow process is not available).
describe('workflow busy report', () => {
  const saved = { process: bridge.workflowProcess, ready: bridge.isReady, readyPromise: bridge.readyPromise };
  afterEach(() => {
    bridge.workflowProcess = saved.process;
    bridge.isReady = saved.ready;
    bridge.readyPromise = saved.readyPromise;
  });

  it('no workflow process yet: nothing is running', async () => {
    bridge.workflowProcess = null;
    bridge.isReady = false;
    bridge.readyPromise = null;
    expect(await bridge.busyReport()).toEqual({ running: 0 });
  });

  it('a process that exists but is not ready still cannot be judged', async () => {
    bridge.workflowProcess = { send: () => true };
    bridge.isReady = false;
    bridge.readyPromise = null;
    await expect(bridge.busyReport()).rejects.toMatchObject({ code: 'WORKFLOW_PROCESS_UNAVAILABLE', reason: 'not-ready' });
  });

  it('so an update before the spawn is not refused for workflows', async () => {
    bridge.workflowProcess = null;
    bridge.isReady = false;
    bridge.readyPromise = null;
    const previous = { ...RestartManager.busySources };
    try {
      RestartManager.busySources = { goals: async () => 0, chats: async () => 0, tools: async () => 0, workflows: null };
      RestartManager.attach({ server: null, workflowBridge: bridge });
      const report = await RestartManager.busyReport();
      expect(report.workflows).toBe(0);
      expect(report.unknown).not.toContain('workflows');
    } finally {
      RestartManager.busySources = previous;
    }
  });
});
