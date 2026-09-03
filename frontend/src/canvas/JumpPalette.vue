<template>
  <Teleport to="body">
    <div v-if="open" class="jp-scrim" @mousedown.self="close" data-tour-id="jump.palette">
      <div class="jp" role="dialog" aria-label="Jump to anything">
        <div class="jp-input-row">
          <i class="fas fa-search jp-input-icon"></i>
          <input
            ref="inputRef"
            v-model="query"
            class="jp-input"
            type="text"
            spellcheck="false"
            placeholder="Jump to a screen, open a thing, or ask Annie…"
            @keydown="onKey"
          />
          <kbd class="jp-kbd">esc</kbd>
        </div>

        <div class="jp-results" ref="listRef">
          <template v-if="index.groups.length">
            <div v-for="g in index.groups" :key="g.id" class="jp-group">
              <div class="jp-group-label">{{ g.label }}</div>
              <button
                v-for="item in g.items"
                :key="item.id"
                class="jp-row"
                :class="{ sel: flat[selected]?.id === item.id }"
                :data-jump-id="item.id"
                @mouseenter="selected = flat.findIndex((r) => r.id === item.id)"
                @click="run(item)"
              >
                <span class="jp-ic"><i :class="item.icon"></i></span>
                <span class="jp-label">{{ item.label }}</span>
                <span v-if="item.hint" class="jp-hint">{{ item.hint }}</span>
                <kbd v-if="item.kbd" class="jp-kbd">{{ item.kbd }}</kbd>
              </button>
            </div>
          </template>
          <button v-else-if="index.fallthrough" class="jp-row sel jp-ask" @click="run(index.fallthrough)">
            <span class="jp-ic jp-ic-ask"><i :class="index.fallthrough.icon"></i></span>
            <span class="jp-label">{{ index.fallthrough.label }}</span>
            <kbd class="jp-kbd">↵</kbd>
          </button>
          <div v-else class="jp-empty">Type to search screens, agents, workflows, goals and chats.</div>
        </div>

        <div class="jp-foot">
          <span><kbd class="jp-kbd">↑↓</kbd> move</span>
          <span><kbd class="jp-kbd">↵</kbd> open</span>
          <span><kbd class="jp-kbd">⇧↵</kbd> go to screen</span>
          <span class="jp-foot-right">no match → sent to Annie</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
// JumpPalette — ⌘K. The router when you do not know which rail row owns a
// thing. Index is built by jumpIndex.js from the stores that are already
// loaded; this file only renders and dispatches.
import { computed, nextTick, ref, watch } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import { ALL_SECTIONS } from './sections.js';
import { buildJumpIndex, flatten } from './jumpIndex.js';

export default {
  name: 'JumpPalette',
  emits: ['navigate'],
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const query = ref('');
    const selected = ref(0);
    const inputRef = ref(null);
    const listRef = ref(null);

    const open = computed(() => store.getters['shell/jumpOpen']);

    const index = computed(() =>
      buildJumpIndex({
        sections: ALL_SECTIONS,
        agents: store.getters['agents/allAgents'] || [],
        workflows: store.getters['workflows/allWorkflows'] || [],
        goals: store.getters['goals/allGoals'] || [],
        chats: (store.getters['contentOutputs/visibleOutputs'] || []).slice(0, 40),
        approvals: (store.getters['insights/escalatedInsights'] || []).length,
        hasProvider: !!store.state.aiProvider?.selectedProvider,
        query: query.value,
      }),
    );
    const flat = computed(() => flatten(index.value));

    watch(query, () => {
      selected.value = 0;
    });
    watch(open, async (v) => {
      if (v) {
        query.value = '';
        selected.value = 0;
        await nextTick();
        inputRef.value?.focus();
      }
    });

    const close = () => store.dispatch('shell/closeJump');

    const scrollSelectedIntoView = () => {
      const row = flat.value[selected.value];
      if (!row || !listRef.value) return;
      const el = listRef.value.querySelector(`[data-jump-id="${CSS.escape(row.id)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    };

    const run = (item, { shift = false } = {}) => {
      const a = item.action;
      close();
      switch (a.type) {
        case 'screen':
          emit('navigate', a.screen, a.opts || {});
          break;
        case 'inspect':
          // ⇧↵ goes to the screen and selects; ↵ does the same today — the
          // right panel on that screen swaps to the entity. (A future in-place
          // inspector without navigation is what ⇧ is reserved to distinguish.)
          store.dispatch('shell/inspect', { kind: a.kind, id: a.id, screen: a.screen });
          emit('navigate', a.screen, { select: { kind: a.kind, id: a.id } });
          break;
        case 'chat':
          router.push(`/chat?content-id=${a.id}`);
          break;
        case 'new-chat':
          router.push('/chat');
          window.dispatchEvent(new CustomEvent('trigger-new-chat'));
          break;
        case 'route':
          router.push(a.path);
          break;
        case 'ask':
          emit('navigate', 'ChatScreen', {});
          // Chat.vue listens and drops the text into the composer / sends it.
          window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text: a.text, send: !shift } }));
          break;
        default:
          break;
      }
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        selected.value = Math.min(flat.value.length - 1, selected.value + 1);
        scrollSelectedIntoView();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selected.value = Math.max(0, selected.value - 1);
        scrollSelectedIntoView();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = flat.value[selected.value];
        if (row) run(row, { shift: e.shiftKey });
      }
    };

    return { open, query, selected, inputRef, listRef, index, flat, onKey, run, close };
  },
};
</script>

<style scoped>
.jp-scrim {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(var(--color-background-rgb, 16, 16, 31), 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
}
.jp {
  width: min(640px, calc(100vw - 32px));
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  /* Modals ALWAYS use --color-popup. Never the page background. */
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  box-shadow: 0 40px 100px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}
.jp-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.jp-input-icon {
  color: var(--color-text-muted);
  font-size: 13px;
}
.jp-input {
  flex: 1;
  background: none;
  border: 0;
  outline: 0;
  color: var(--color-text);
  font: inherit;
  font-size: 15px;
  font-weight: 300;
  padding: 15px 0;
}
.jp-input::placeholder {
  color: var(--color-text-dull, #767888);
}
.jp-results {
  overflow: auto;
  padding: 6px;
  flex: 1;
  min-height: 0;
}
.jp-group-label {
  font-size: 9.5px;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  padding: 8px 10px 4px;
}
.jp-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 0;
  background: none;
  color: var(--color-text);
  font: inherit;
  font-size: 13px;
  font-weight: 300;
  text-align: left;
  cursor: pointer;
}
.jp-row.sel {
  background: rgba(var(--primary-rgb), 0.1);
}
.jp-ic {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
  font-size: 11px;
  flex: 0 0 auto;
}
.jp-ic-ask {
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.35);
}
.jp-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jp-hint {
  font-size: 10.5px;
  color: var(--color-text-dull, #767888);
  white-space: nowrap;
}
.jp-kbd {
  font-size: 10px;
  padding: 1px 5px;
  border: 1px solid var(--terminal-border-color);
  border-bottom-width: 2px;
  border-radius: 4px;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.03);
  font-family: inherit;
}
.jp-empty {
  padding: 18px 12px;
  color: var(--color-text-dull, #767888);
  font-size: 12.5px;
  text-align: center;
}
.jp-foot {
  display: flex;
  gap: 14px;
  padding: 8px 14px;
  border-top: 1px solid var(--terminal-border-color);
  font-size: 10.5px;
  color: var(--color-text-dull, #767888);
}
.jp-foot-right {
  margin-left: auto;
}
</style>
