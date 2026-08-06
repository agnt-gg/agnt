// Cost reporting in the trace detail panel (PRD-122).
//
// This panel used to read agent_executions.estimated_cost, a column with no
// notion of how the user pays. On a Claude Max / Codex seat it therefore
// displayed a dollar figure for money that was never charged — presenting seat
// usage as a bill. The ledger is the only source that carries that distinction,
// so these tests pin the three states the row must tell apart:
//
//   charged   → real money, shown plainly
//   notional  → seat usage, shown but marked as such
//   unknown   → unpriceable model; NO figure, because a wrong number that looks
//               precise is worse than an absent one
//
// The old row also hid itself on a falsy cost, which made a genuinely-free run
// and an unpriced run look identical. $0.00 is an answer and must render.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import TracesPanel from './TracesPanel.vue';

const store = createStore({
  modules: {
    goals: { namespaced: true, getters: { isCreatingGoal: () => false }, actions: { createGoal: () => {} } },
    insights: { namespaced: true, actions: { fetchSourceInsights: () => [] } },
  },
});

const ledgerOf = (over = {}) => ({
  costUsd: 0,
  notionalUsd: 0,
  savedUsd: 0,
  notionalSavedUsd: 0,
  uncachedCostUsd: 0,
  notionalUncachedUsd: 0,
  unpricedCalls: 0,
  calls: 1,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
});

const executionOf = (over = {}) => ({
  id: 'exec-1',
  workflowName: 'Test Run',
  status: 'completed',
  startTime: '2026-08-01T10:00:00Z',
  endTime: '2026-08-01T10:01:00Z',
  creditsUsed: 12,
  isAgentExecution: true,
  ledger: null,
  tree: null,
  ...over,
});

const mountWith = (execution) => {
  const w = mount(TracesPanel, {
    props: { selectedExecutionId: 'exec-1', executions: [] },
    global: {
      plugins: [store],
      stubs: {
        Tooltip: { template: '<div><slot /></div>' },
        ResourcesSection: true,
        BoundedJson: true,
      },
    },
  });
  w.vm.updateSelectedExecution(execution);
  return w;
};

describe('the cost row tells charged, notional and unknown apart', () => {
  it('shows a charged cost plainly, with no subscription marker', async () => {
    const w = mountWith(executionOf({ ledger: ledgerOf({ costUsd: 0.4231, calls: 3 }) }));
    await w.vm.$nextTick();
    expect(w.text()).toContain('$0.4231');
    expect(w.find('.cost-tag').exists()).toBe(false);
  });

  it('marks seat usage as a subscription rather than presenting it as a bill', async () => {
    const w = mountWith(executionOf({ ledger: ledgerOf({ costUsd: 0, notionalUsd: 4.3999, calls: 1 }) }));
    await w.vm.$nextTick();
    expect(w.text()).toContain('$4.3999');
    expect(w.find('.cost-tag').text()).toContain('subscription');
  });

  it('shows NO cost when every call used an unpriceable model', async () => {
    // Unknown is not zero. Rendering "$0.00" here would assert something the
    // ledger cannot support.
    const w = mountWith(executionOf({ ledger: ledgerOf({ costUsd: 0, calls: 2, unpricedCalls: 2 }) }));
    await w.vm.$nextTick();
    expect(w.vm.costDisplay).toBeNull();
    expect(w.text()).toContain('2 call(s) — cost unknown');
  });

  it('still renders a genuine $0.00, which the old falsy check hid', async () => {
    const w = mountWith(executionOf({ ledger: ledgerOf({ costUsd: 0, notionalUsd: 0, calls: 1 }) }));
    await w.vm.$nextTick();
    expect(w.vm.costDisplay).not.toBeNull();
    expect(w.vm.costDisplay.value).toBe('$0.00');
  });

  it('falls back to the legacy column for runs that predate the ledger', async () => {
    // Historical rows have no ledger entries. Dropping their cost to nothing
    // would look like data loss rather than like history.
    const w = mountWith(executionOf({ ledger: null, estimatedCost: 1.2345 }));
    await w.vm.$nextTick();
    expect(w.vm.costDisplay.value).toBe('$1.2345');
  });
});

describe('savings follow the axis the run actually used', () => {
  it('reports charged savings for a metered run', async () => {
    const w = mountWith(executionOf({ ledger: ledgerOf({ costUsd: 1, savedUsd: 2.5, notionalSavedUsd: 99 }) }));
    await w.vm.$nextTick();
    expect(w.vm.ledgerSaved).toBe(2.5);
  });

  it('reports notional savings for a seat run, where charged savings are always zero', async () => {
    const w = mountWith(executionOf({ ledger: ledgerOf({ costUsd: 0, notionalUsd: 5, savedUsd: 0, notionalSavedUsd: 12.5 }) }));
    await w.vm.$nextTick();
    expect(w.vm.ledgerSaved).toBe(12.5);
  });
});

describe('run tree', () => {
  it('stays hidden for a plain run with no spawned work', async () => {
    const w = mountWith(executionOf({ ledger: ledgerOf({ costUsd: 1 }), tree: null }));
    await w.vm.$nextTick();
    expect(w.find('.run-tree').exists()).toBe(false);
  });

  it('lists children and totals the subtree', async () => {
    const w = mountWith(
      executionOf({
        ledger: ledgerOf({ costUsd: 1 }),
        tree: {
          rootExecutionId: 'exec-1',
          nodes: [
            { id: 'exec-1', parentExecutionId: null, agentName: 'Orchestrator', origin: 'chat', ledger: ledgerOf({ costUsd: 1 }) },
            { id: 'exec-2', parentExecutionId: 'exec-1', agentName: 'Researcher', origin: 'agent', ledger: ledgerOf({ costUsd: 2 }) },
          ],
          unattached: [],
          subtree: { costUsd: 3, notionalUsd: 0, savedUsd: 0, notionalSavedUsd: 0, unpricedCalls: 0, calls: 2 },
        },
      })
    );
    await w.vm.$nextTick();
    expect(w.findAll('.tree-node')).toHaveLength(2);
    expect(w.find('.tree-total').text()).toContain('$3.0000');
  });

  it('includes goal work that has no execution row of its own', async () => {
    // Goal tasks and evaluations bill against the tree without appearing in
    // agent_executions. A tree walked over that table alone would silently
    // under-report, which is the defect the ledger exists to prevent.
    const w = mountWith(
      executionOf({
        ledger: ledgerOf({ costUsd: 1 }),
        tree: {
          rootExecutionId: 'exec-1',
          nodes: [{ id: 'exec-1', parentExecutionId: null, agentName: 'Orchestrator', origin: 'chat', ledger: ledgerOf({ costUsd: 1 }) }],
          unattached: [{ origin: 'goal_task', originId: 'goal-9', costUsd: 4, notionalUsd: 0, calls: 12 }],
          subtree: { costUsd: 5, notionalUsd: 0, savedUsd: 0, notionalSavedUsd: 0, unpricedCalls: 0, calls: 13 },
        },
      })
    );
    await w.vm.$nextTick();
    expect(w.text()).toContain('Goal tasks');
    expect(w.find('.tree-total').text()).toContain('$5.0000');
  });

  it('names an unattached row by its own origin, not by what it is not', async () => {
    // REGRESSION: this list was labelled
    //   u.origin === 'goal_task' ? 'Goal tasks' : 'Goal evaluation'
    // so it reported anything that was not a goal task AS a goal evaluation.
    // It is defined as "ledger rows with no execution of their own", which
    // already admits insight and system rows.
    const w = mountWith(
      executionOf({
        ledger: ledgerOf({ costUsd: 1 }),
        tree: {
          rootExecutionId: 'exec-1',
          nodes: [{ id: 'exec-1', parentExecutionId: null, agentName: 'Orchestrator', origin: 'chat', ledger: ledgerOf({ costUsd: 1 }) }],
          unattached: [{ origin: 'insight', originId: 'ins-3', costUsd: 2, notionalUsd: 0, calls: 3 }],
          subtree: { costUsd: 3, notionalUsd: 0, savedUsd: 0, notionalSavedUsd: 0, unpricedCalls: 0, calls: 4 },
        },
      })
    );
    await w.vm.$nextTick();
    expect(w.text()).toContain('Insights');
    expect(w.text()).not.toContain('Goal evaluation');
  });

  it('names each node’s origin instead of printing the column value', async () => {
    // REGRESSION: `{{ node.origin }}` printed `workflow_node` into the tree.
    const w = mountWith(
      executionOf({
        ledger: ledgerOf({ costUsd: 1 }),
        tree: {
          rootExecutionId: 'exec-1',
          nodes: [
            { id: 'exec-1', parentExecutionId: null, agentName: 'Orchestrator', origin: 'orchestrator', ledger: ledgerOf({ costUsd: 1 }) },
            { id: 'exec-2', parentExecutionId: 'exec-1', agentName: 'Node', origin: 'workflow_node', ledger: ledgerOf({ costUsd: 1 }) },
          ],
          unattached: [],
          subtree: { costUsd: 2, notionalUsd: 0, savedUsd: 0, notionalSavedUsd: 0, unpricedCalls: 0, calls: 2 },
        },
      })
    );
    await w.vm.$nextTick();
    const origins = w.findAll('.tree-origin').map((n) => n.text());
    expect(origins).toEqual(['Orchestrator', 'Workflow runs']);
  });
});
