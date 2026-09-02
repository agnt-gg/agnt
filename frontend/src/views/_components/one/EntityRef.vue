<template>
  <button type="button" class="entity-ref-btn" :class="'kind-' + kind" :title="hint" @click="onClick">
    <i v-if="icon" :class="icon"></i>
    <slot>{{ label }}</slot>
  </button>
</template>

<script>
/**
 * EntityRef — a chip for a thing Annie (or a panel) refers to.
 *   click     → inspect it in the right panel (shell/inspect)
 *   ⇧ + click → go to its screen with it selected
 * Rendered-HTML mentions use the same behaviour via `bindEntityRefClicks`.
 */
import { useStore } from 'vuex';
import { ENTITY_SCREENS } from '@/utils/entityRefs.js';

const ICONS = {
  agent: 'fas fa-robot',
  workflow: 'fas fa-project-diagram',
  goal: 'fas fa-bullseye',
  trace: 'fas fa-stream',
  execution: 'fas fa-stream',
  memory: 'fas fa-brain',
  chat: 'fas fa-comments',
  tool: 'fas fa-wrench',
  skill: 'fas fa-graduation-cap',
  plugin: 'fas fa-puzzle-piece',
  widget: 'fas fa-shapes',
  connector: 'fas fa-plug',
  artifact: 'fas fa-cube',
};

/** Dispatch an inspect (or ⇧ navigate) for an entity. Shared with rendered-HTML refs. */
export function activateEntityRef(store, { kind, id, screen, payload }, { shift = false } = {}) {
  const target = { kind, id, screen: screen || ENTITY_SCREENS[kind], payload };
  store.dispatch('shell/inspect', target);
  if (shift && target.screen) {
    window.dispatchEvent(new CustomEvent('agnt:navigate', { detail: { screen: target.screen, opts: { select: { kind, id } } } }));
  }
}

/**
 * Delegate clicks on `.entity-ref` spans inside a rendered-HTML container.
 * Returns an unbind function.
 */
export function bindEntityRefClicks(el, store) {
  if (!el) return () => {};
  const handler = (e) => {
    const ref = e.target.closest?.('.entity-ref');
    if (!ref || !el.contains(ref)) return;
    e.preventDefault();
    e.stopPropagation();
    activateEntityRef(store, { kind: ref.dataset.kind, id: ref.dataset.id, screen: ref.dataset.screen }, { shift: e.shiftKey });
  };
  el.addEventListener('click', handler);
  return () => el.removeEventListener('click', handler);
}

export default {
  name: 'EntityRef',
  props: {
    kind: { type: String, required: true },
    id: { type: [String, Number], default: null },
    label: { type: String, default: '' },
    screen: { type: String, default: '' },
    payload: { type: Object, default: null },
    showIcon: { type: Boolean, default: false },
  },
  emits: ['inspect'],
  setup(props, { emit }) {
    const store = useStore();
    const icon = props.showIcon ? ICONS[props.kind] || '' : '';
    const hint = `Click to inspect · ⇧-click to open ${props.kind}`;
    const onClick = (e) => {
      activateEntityRef(store, { kind: props.kind, id: props.id, screen: props.screen, payload: props.payload }, { shift: e.shiftKey });
      emit('inspect', { kind: props.kind, id: props.id });
    };
    return { icon, hint, onClick };
  },
};
</script>

<style>
/* Global (not scoped): rendered-HTML mentions carry the same class. */
.entity-ref,
.entity-ref-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: inherit;
  font-size: 0.92em;
  line-height: 1.3;
  color: #7fe8b4;
  background: rgba(var(--green-rgb, 25, 239, 131), 0.09);
  border: 0;
  border-bottom: 1px dotted rgba(var(--green-rgb, 25, 239, 131), 0.5);
  border-radius: 4px;
  padding: 0 5px;
  cursor: pointer;
  white-space: nowrap;
  vertical-align: baseline;
}
.entity-ref:hover,
.entity-ref-btn:hover {
  background: rgba(var(--green-rgb, 25, 239, 131), 0.18);
  color: var(--color-green);
}
.entity-ref[data-kind='workflow'],
.entity-ref-btn.kind-workflow {
  color: #8de9f7;
  background: rgba(18, 224, 255, 0.09);
  border-bottom-color: rgba(18, 224, 255, 0.5);
}
.entity-ref[data-kind='goal'],
.entity-ref-btn.kind-goal {
  color: #f2dd7a;
  background: rgba(255, 215, 0, 0.09);
  border-bottom-color: rgba(255, 215, 0, 0.5);
}
.entity-ref[data-kind='memory'],
.entity-ref-btn.kind-memory {
  color: #f0a0c8;
  background: rgba(229, 61, 143, 0.1);
  border-bottom-color: rgba(229, 61, 143, 0.5);
}
.entity-ref[data-kind='trace'],
.entity-ref[data-kind='execution'],
.entity-ref-btn.kind-trace,
.entity-ref-btn.kind-execution {
  color: #b892ff;
  background: rgba(125, 61, 229, 0.12);
  border-bottom-color: rgba(125, 61, 229, 0.5);
}
.entity-ref.is-selected,
.entity-ref-btn.is-selected {
  outline: 1px solid var(--color-green);
}
</style>
