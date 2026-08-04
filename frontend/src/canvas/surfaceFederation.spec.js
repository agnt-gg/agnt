// surfaceFederation — one canvas chat, many widget windows.
//
// The two properties worth guarding are (1) the union of what many windows
// publish is BOUNDED and DETERMINISTIC, and (2) an event meant for one window
// cannot be applied by its sibling. Everything below is one of those two.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import {
  SURFACE_TAG,
  SURFACE_INSTANCE_KEY,
  SURFACE_WIDGET_KEY,
  provideSurfaceIdentity,
  publishSurfaceState,
  retractSurface,
  listSurfaces,
  clearSurfaces,
  useSurfaceContribution,
  useSurfaceAddressing,
  buildFederatedPageState,
  describeSurfaceBinding,
  resolveSurfaceDelivery,
  dispatchSurfaceEvent,
  isAddressedToSurface,
} from './surfaceFederation.js';
import { registerAllWidgets } from './widgets/index.js';
import { getWidget } from './widgetRegistry.js';

beforeEach(() => clearSurfaces());

describe('the surface registry', () => {
  it('holds what a window published, and drops it on retract', () => {
    publishSurfaceState('w_1', 'widget-forge', { widgetState: { id: 'cw_a' } });
    expect(listSurfaces()).toEqual([
      { instanceId: 'w_1', widgetId: 'widget-forge', state: { widgetState: { id: 'cw_a' } } },
    ]);
    retractSurface('w_1');
    expect(listSurfaces()).toEqual([]);
  });

  it('refuses an anonymous contribution — a surface with no window is unaddressable', () => {
    expect(publishSurfaceState(null, 'widget-forge', { widgetState: {} })).toBe(false);
    expect(listSurfaces()).toEqual([]);
  });

  it('treats a null state as a retraction rather than storing a hole', () => {
    publishSurfaceState('w_1', 'artifacts', { codeContext: {} });
    expect(publishSurfaceState('w_1', 'artifacts', null)).toBe(false);
    expect(listSurfaces()).toEqual([]);
  });
});

describe('buildFederatedPageState — the union, bounded', () => {
  it('merges surfaces that contribute DIFFERENT keys — this is the whole point', () => {
    const { merged } = buildFederatedPageState([
      { instanceId: 'w_1', widgetId: 'workflow-forge', state: { workflowState: { id: 'wf_9' } } },
      { instanceId: 'w_2', widgetId: 'artifacts', state: { codeContext: { openFilePath: '/a.html' } } },
    ]);
    expect(merged.workflowState).toEqual({ id: 'wf_9' });
    expect(merged.codeContext).toEqual({ openFilePath: '/a.html' });
  });

  it('admits only ONE blob per key — three workflow windows must not send three graphs', () => {
    const { merged, manifest } = buildFederatedPageState([
      { instanceId: 'w_1', widgetId: 'workflow-forge', state: { workflowState: { id: 'first' } } },
      { instanceId: 'w_2', widgetId: 'workflow-forge', state: { workflowState: { id: 'second' } } },
      { instanceId: 'w_3', widgetId: 'workflow-forge', state: { workflowState: { id: 'third' } } },
    ]);
    expect(merged.workflowState).toEqual({ id: 'first' });
    expect(manifest.map((m) => m.stateIncluded)).toEqual([true, false, false]);
  });

  it('still ANNOUNCES the windows it budgeted out, with what they lost', () => {
    const { manifest } = buildFederatedPageState([
      { instanceId: 'w_1', widgetId: 'workflow-forge', state: { workflowState: { id: 'a' } } },
      { instanceId: 'w_2', widgetId: 'workflow-forge', state: { workflowState: { id: 'b' } } },
    ]);
    expect(manifest).toHaveLength(2);
    expect(manifest[1]).toMatchObject({
      instanceId: 'w_2',
      stateIncluded: false,
      supersededKeys: ['workflowState'],
      // Still identifiable, so the model can inspect_canvas_widget it.
      bound: 'workflow b',
    });
  });

  it('marks exactly the first (most recently focused) surface as FOCUSED', () => {
    const { manifest } = buildFederatedPageState([
      { instanceId: 'w_1', widgetId: 'artifacts', state: { codeContext: {} } },
      { instanceId: 'w_2', widgetId: 'workflow-forge', state: { workflowState: { id: 'x' } } },
    ]);
    expect(manifest.map((m) => m.focused)).toEqual([true, false]);
  });

  it('takes display names from the canvas but the BINDING from the window itself', () => {
    const { manifest } = buildFederatedPageState(
      [{ instanceId: 'w_1', widgetId: 'workflow-forge', state: { workflowState: { id: 'wf_9' } } }],
      new Map([['w_1', 'Workflow Forge']]),
    );
    expect(manifest[0]).toMatchObject({ name: 'Workflow Forge', bound: 'workflow wf_9' });
  });

  it('skips anonymous or stateless entries instead of emitting a null window', () => {
    const { manifest } = buildFederatedPageState([
      { instanceId: null, widgetId: 'x', state: { a: 1 } },
      { instanceId: 'w_2', widgetId: 'y', state: null },
    ]);
    expect(manifest).toEqual([]);
  });

  it('survives no surfaces at all — a canvas holding only a conversation', () => {
    expect(buildFederatedPageState([])).toEqual({ merged: {}, manifest: [] });
    expect(buildFederatedPageState(undefined)).toEqual({ merged: {}, manifest: [] });
  });
});

describe('describeSurfaceBinding — what is this window showing?', () => {
  it.each([
    [{ workflowState: { id: 'wf_1' } }, 'workflow wf_1'],
    [{ widgetState: { id: 'cw_1' } }, 'widget cw_1'],
    [{ codeContext: { openFilePath: '/tmp/a.html' } }, 'file /tmp/a.html'],
    [{ toolState: { id: 't_1' } }, 'tool t_1'],
    [{ agentState: { id: 'a_1' } }, 'agent a_1'],
  ])('reads %o', (state, expected) => {
    expect(describeSurfaceBinding(state)).toBe(expected);
  });

  it('returns null for the unsaved placeholders rather than inventing an object', () => {
    expect(describeSurfaceBinding({ widgetState: { id: 'widget-forge' } })).toBeNull();
    expect(describeSurfaceBinding({ toolState: { id: 'default' } })).toBeNull();
    expect(describeSurfaceBinding({ agentState: { id: 'agent-chat' } })).toBeNull();
    expect(describeSurfaceBinding({ codeContext: { openFilePath: null } })).toBeNull();
    expect(describeSurfaceBinding(null)).toBeNull();
  });
});

describe('resolveSurfaceDelivery — which window applies this event?', () => {
  it.each([
    ['widget-field-updated', 'widget-forge', 'chat-sse-event'],
    ['widget-stream-done', 'widget-forge', 'chat-sse-event'],
    ['agent-updated', 'agent-forge', 'chat-sse-event'],
    ['tool-field-updated', 'tool-forge', 'chat-sse-event'],
    ['file_written', 'artifacts', 'code-file-written'],
  ])('%s -> %s', (type, widgetId, eventName) => {
    expect(resolveSurfaceDelivery(type)).toMatchObject({ widgetId, eventName });
  });

  it('does NOT route workflow events — that path is socket-driven and id-addressed', () => {
    // Re-adding a `workflow-` prefix route would wrap these into
    // `chat-sse-event`, which WorkflowForge does not listen for. Breaking a
    // working path for the sake of symmetry is the failure this pins.
    expect(resolveSurfaceDelivery('workflow-updated')).toBeNull();
  });

  it('returns null for anything nothing consumes', () => {
    expect(resolveSurfaceDelivery('conversation_started')).toBeNull();
    expect(resolveSurfaceDelivery('')).toBeNull();
    expect(resolveSurfaceDelivery(undefined)).toBeNull();
  });
});

describe('addressed delivery', () => {
  it('stamps the target window onto the payload', () => {
    const seen = [];
    const listener = (e) => seen.push(e.detail);
    window.addEventListener('chat-sse-event', listener);
    dispatchSurfaceEvent('w_7', 'chat-sse-event', { eventType: 'widget-saved' });
    window.removeEventListener('chat-sse-event', listener);
    expect(seen[0]).toEqual({ eventType: 'widget-saved', [SURFACE_TAG]: 'w_7' });
  });

  it('leaves the payload unstamped when there is no such window open', () => {
    const seen = [];
    const listener = (e) => seen.push(e.detail);
    window.addEventListener('code-file-written', listener);
    dispatchSurfaceEvent(null, 'code-file-written', { path: '/a' });
    window.removeEventListener('code-file-written', listener);
    expect(seen[0]).toEqual({ path: '/a' });
    expect(seen[0]).not.toHaveProperty(SURFACE_TAG);
  });

  it('accepts unstamped events everywhere — every pre-existing producer keeps working', () => {
    expect(isAddressedToSurface({ path: '/a' }, 'w_1')).toBe(true);
    expect(isAddressedToSurface({ path: '/a' }, null)).toBe(true);
    expect(isAddressedToSurface(undefined, 'w_1')).toBe(true);
  });

  it('accepts a stamp that names me', () => {
    expect(isAddressedToSurface({ [SURFACE_TAG]: 'w_1' }, 'w_1')).toBe(true);
  });

  it('REFUSES a stamp that names my sibling — the two-forge-windows bug', () => {
    expect(isAddressedToSurface({ [SURFACE_TAG]: 'w_2' }, 'w_1')).toBe(false);
    // …including the standalone screen sitting behind the canvas.
    expect(isAddressedToSurface({ [SURFACE_TAG]: 'w_2' }, null)).toBe(false);
  });
});

// ── composables, mounted for real ────────────────────────────────────────

const Screen = defineComponent({
  props: { value: { type: Object, default: () => ({ widgetState: { id: 'cw_a' } }) } },
  setup(props) {
    const federated = useSurfaceContribution(() => props.value);
    const { instanceId, accepts } = useSurfaceAddressing();
    return { federated, instanceId, accepts };
  },
  render: () => h('div'),
});

const Window = defineComponent({
  props: { instanceId: { type: String, default: 'w_1' }, widgetId: { type: String, default: 'widget-forge' } },
  setup(props, { slots }) {
    provideSurfaceIdentity(props.instanceId, props.widgetId);
    return () => slots.default?.();
  },
});

describe('useSurfaceContribution — inside a window vs standalone', () => {
  it('is INERT standalone, so no sidebar screen changes behaviour', () => {
    const wrapper = mount(Screen);
    expect(wrapper.vm.federated).toBe(false);
    expect(wrapper.vm.instanceId).toBeNull();
    expect(listSurfaces()).toEqual([]);
  });

  it('publishes immediately inside a window', () => {
    mount(Window, { slots: { default: () => h(Screen) } });
    expect(listSurfaces()).toEqual([
      { instanceId: 'w_1', widgetId: 'widget-forge', state: { widgetState: { id: 'cw_a' } } },
    ]);
  });

  it('republishes when the screen state moves', async () => {
    const value = ref({ widgetState: { id: 'first' } });
    const Host = defineComponent({
      setup: () => () => h(Window, null, { default: () => h(Screen, { value: value.value }) }),
    });
    mount(Host);
    expect(listSurfaces()[0].state.widgetState.id).toBe('first');
    value.value = { widgetState: { id: 'second' } };
    await new Promise((r) => setTimeout(r, 0));
    expect(listSurfaces()[0].state.widgetState.id).toBe('second');
  });

  it('retracts on unmount — a closed window stops costing prompt tokens', () => {
    const wrapper = mount(Window, { slots: { default: () => h(Screen) } });
    expect(listSurfaces()).toHaveLength(1);
    wrapper.unmount();
    expect(listSurfaces()).toEqual([]);
  });

  it('keeps two windows of the SAME widget distinct', () => {
    mount(Window, {
      props: { instanceId: 'w_1' },
      slots: { default: () => h(Screen, { value: { widgetState: { id: 'a' } } }) },
    });
    mount(Window, {
      props: { instanceId: 'w_2' },
      slots: { default: () => h(Screen, { value: { widgetState: { id: 'b' } } }) },
    });
    expect(listSurfaces().map((s) => [s.instanceId, s.state.widgetState.id])).toEqual([
      ['w_1', 'a'],
      ['w_2', 'b'],
    ]);
  });

  it('gives a screen an `accepts` bound to ITS window', () => {
    const wrapper = mount(Window, { props: { instanceId: 'w_1' }, slots: { default: () => h(Screen) } });
    const screen = wrapper.findComponent(Screen);
    expect(screen.vm.accepts({ [SURFACE_TAG]: 'w_1' })).toBe(true);
    expect(screen.vm.accepts({ [SURFACE_TAG]: 'w_2' })).toBe(false);
    expect(screen.vm.accepts({})).toBe(true);
  });
});

describe('routes ↔ real widget registry integrity', () => {
  beforeEach(() => registerAllWidgets());

  it('every routed widget exists and DECLARES the events it is sent', () => {
    for (const type of ['widget-field-updated', 'agent-updated', 'tool-field-updated', 'file_written']) {
      const route = resolveSurfaceDelivery(type);
      const widget = getWidget(route.widgetId);
      expect(widget, `route target ${route.widgetId} is not a registered widget`).toBeTruthy();
      expect(widget.contributes?.events, `${route.widgetId} declares no events`).toContain(type);
    }
  });

  it('every widget that declares state also declares it in a shape the merge understands', () => {
    for (const widget of ['workflow-forge', 'tool-forge', 'agent-forge', 'widget-forge', 'artifacts']) {
      const c = getWidget(widget)?.contributes;
      expect(c, `${widget} declares no contributes`).toBeTruthy();
      expect(Array.isArray(c.state) && c.state.length > 0).toBe(true);
      expect(Array.isArray(c.events)).toBe(true);
    }
  });

  it('workflow-forge deliberately declares NO events (socket path, id-addressed)', () => {
    expect(getWidget('workflow-forge').contributes.events).toEqual([]);
  });
});

describe('screens actually call the composable (source guards)', () => {
  // A contract nobody invokes is a comment. These fail if a screen is
  // refactored in a way that silently drops it from the federation.
  const files = import.meta.glob(
    [
      '/src/views/Terminal/CenterPanel/screens/WorkflowForge/WorkflowForge.vue',
      '/src/views/Terminal/CenterPanel/screens/WidgetForge/WidgetForge.vue',
      '/src/views/Terminal/CenterPanel/screens/ToolForge/ToolForge.vue',
      '/src/views/Terminal/CenterPanel/screens/AgentForge/AgentForge.vue',
      '/src/views/Terminal/CenterPanel/screens/Artifacts/Artifacts.vue',
    ],
    { query: '?raw', import: 'default', eager: true },
  );

  it.each(Object.keys(files))('%s publishes its contribution', (path) => {
    expect(files[path]).toContain('useSurfaceContribution(');
  });

  it.each([
    '/src/views/Terminal/CenterPanel/screens/WidgetForge/WidgetForge.vue',
    '/src/views/Terminal/CenterPanel/screens/AgentForge/AgentForge.vue',
    '/src/views/Terminal/CenterPanel/screens/Artifacts/Artifacts.vue',
  ])('%s guards its window listener against sibling-addressed events', (path) => {
    expect(files[path]).toMatch(/if \(!acceptsSurfaceEvent\(/);
  });
});
