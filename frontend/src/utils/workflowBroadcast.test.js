import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dispatchWorkflowUpdated, isAddressedToWorkflow, WORKFLOW_UPDATED_EVENT } from './workflowBroadcast.js';

// Minimal window/CustomEvent stand-ins so this runs under the default node
// environment as well as jsdom.
function installFakeWindow() {
  const dispatched = [];
  const priorWindow = globalThis.window;
  const priorCustomEvent = globalThis.CustomEvent;

  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
  }

  globalThis.window = { dispatchEvent: (evt) => (dispatched.push(evt), true) };

  return {
    dispatched,
    restore() {
      globalThis.window = priorWindow;
      globalThis.CustomEvent = priorCustomEvent;
    },
  };
}

describe('isAddressedToWorkflow — cross-workflow clobber guard', () => {
  it('REFUSES an update for a different workflow (the data-loss bug)', () => {
    expect(isAddressedToWorkflow({ id: 'wf-A', nodes: [] }, 'wf-B')).toBe(false);
  });

  it('accepts an update for the workflow currently on the canvas', () => {
    expect(isAddressedToWorkflow({ id: 'wf-A', nodes: [] }, 'wf-A')).toBe(true);
  });

  it('accepts onto an empty canvas — nothing to clobber (new-workflow-from-chat)', () => {
    expect(isAddressedToWorkflow({ id: 'wf-A', nodes: [] }, null)).toBe(true);
    expect(isAddressedToWorkflow({ id: 'wf-A', nodes: [] }, undefined)).toBe(true);
    expect(isAddressedToWorkflow({ id: 'wf-A', nodes: [] }, '')).toBe(true);
  });

  it('REFUSES an unaddressed payload — it cannot be verified', () => {
    expect(isAddressedToWorkflow({ nodes: [] }, 'wf-B')).toBe(false);
    expect(isAddressedToWorkflow({ id: null, nodes: [] }, 'wf-B')).toBe(false);
    expect(isAddressedToWorkflow({ id: '', nodes: [] }, 'wf-B')).toBe(false);
  });

  it('REFUSES junk payloads', () => {
    expect(isAddressedToWorkflow(null, 'wf-B')).toBe(false);
    expect(isAddressedToWorkflow(undefined, 'wf-B')).toBe(false);
    expect(isAddressedToWorkflow('wf-A', 'wf-B')).toBe(false);
  });

  it('does not treat distinct ids as equal via coercion', () => {
    expect(isAddressedToWorkflow({ id: '0' }, 0)).toBe(true); // 0 => empty canvas
    expect(isAddressedToWorkflow({ id: '1' }, '01')).toBe(false);
  });
});

describe('dispatchWorkflowUpdated — producer stamps the target id', () => {
  let fake;
  beforeEach(() => {
    fake = installFakeWindow();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    fake.restore();
    vi.restoreAllMocks();
  });

  it('stamps the authoritative id onto the detail', () => {
    const ok = dispatchWorkflowUpdated('wf-A', { id: 'stale-id', nodes: [1], edges: [] });
    expect(ok).toBe(true);
    expect(fake.dispatched).toHaveLength(1);
    expect(fake.dispatched[0].type).toBe(WORKFLOW_UPDATED_EVENT);
    expect(fake.dispatched[0].detail.id).toBe('wf-A');
    expect(fake.dispatched[0].detail.nodes).toEqual([1]);
  });

  it('falls back to the state id when no explicit target is given', () => {
    dispatchWorkflowUpdated(null, { id: 'wf-C', nodes: [] });
    expect(fake.dispatched[0].detail.id).toBe('wf-C');
  });

  it('refuses to dispatch an unaddressed update', () => {
    expect(dispatchWorkflowUpdated(null, { nodes: [] })).toBe(false);
    expect(fake.dispatched).toHaveLength(0);
  });

  it('refuses junk state', () => {
    expect(dispatchWorkflowUpdated('wf-A', null)).toBe(false);
    expect(dispatchWorkflowUpdated('wf-A', 'nope')).toBe(false);
    expect(fake.dispatched).toHaveLength(0);
  });

  it('round-trips: what the producer emits, the matching canvas accepts and others refuse', () => {
    dispatchWorkflowUpdated('wf-A', { id: 'wf-A', nodes: [] });
    const { detail } = fake.dispatched[0];
    expect(isAddressedToWorkflow(detail, 'wf-A')).toBe(true);
    expect(isAddressedToWorkflow(detail, 'wf-B')).toBe(false);
  });
});
