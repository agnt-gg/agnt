<template>
  <!-- Selected state: the thing you clicked (a reference chip, a Working-now
       row, a toolbar pill). ✕ / Esc returns to the summary. -->
  <EntityInspector
    v-if="target"
    :kind="target.kind"
    :id="target.id"
    caption="This conversation"
    @close="clear"
    @action="onEntityAction"
  />

  <!-- Summary state: what THIS conversation is doing, mentioning, costing. -->
  <InspectorShell v-else caption="This conversation" :live="isStreaming" :closable="false">
    <InspSection title="Working now">
      <div v-if="isStreaming" class="card is-live" @click="inspectKind('running')">
        <div class="row">
          <span class="pulse"></span>
          <span class="nm">{{ activeAgentName || 'Annie' }} is working…</span>
          <span class="spacer"></span>
          <button class="lnk danger" type="button" @click.stop="stopStreaming">stop</button>
        </div>
      </div>
      <div v-for="r in running.slice(0, 3)" :key="r.id" class="li" @click="inspectKind('trace', r.id)">
        <span class="pulse"></span>
        <span class="nm">{{ r.title || r.name || r.workflow_name || r.id }}</span>
        <span class="t">{{ when(r.started_at || r.created_at) }}</span>
      </div>
      <div v-if="!isStreaming && !running.length" class="muted">Nothing is running.</div>
    </InspSection>

    <InspSection title="Mentioned" v-if="mentioned.length">
      <div v-for="m in mentioned" :key="m.kind + ':' + m.id" class="li" @click="inspectKind(m.kind, m.id)">
        <span class="tile" :class="'k-' + m.kind"><i :class="kindIcon(m.kind)"></i></span>
        <span class="nm">{{ m.name }}</span>
        <span class="t">{{ m.kind }}</span>
      </div>
    </InspSection>

    <InspSection v-if="escalatedCount" title="Awaiting approval">
      <div class="li" @click="inspectKind('autonomy')">
        <span class="tile k-goal"><i class="fas fa-user-shield"></i></span>
        <span class="nm">{{ escalatedCount }} action{{ escalatedCount === 1 ? '' : 's' }} waiting for you</span>
        <span class="t">autonomy</span>
      </div>
    </InspSection>

    <!-- Context & cost: the ContextTiles family, teleported here by Chat.vue
         with all its data intact. Absent until the conversation has produced a
         measurement (same rule as before). -->
    <InspSection title="Context & cost">
      <div id="agnt-insp-context" class="ctx-host"></div>
      <div v-if="!hasContext" class="muted">Appears after the first turn.</div>
    </InspSection>

    <!-- Click previews in place (you stay in the conversation); the small
         arrow, or the preview's own link, goes to the Outputs screen. -->
    <InspSection title="Artifacts" v-if="artifacts.length">
      <div v-for="a in artifacts" :key="a.href" class="li li-artifact" @click="previewArtifact(a)" v-tooltip="'Preview ' + a.name">
        <span class="tile k-artifact"><i class="fas fa-cube"></i></span>
        <span class="nm">{{ a.name }}</span>
        <button type="button" class="li-go" v-tooltip="'Open in Outputs'" @click.stop="openArtifact(a)"><i class="fas fa-external-link-alt"></i></button>
      </div>
    </InspSection>
    <ArtifactPreview ref="preview" @open-in-outputs="openArtifact" />

    <InspSection title="This chat">
      <div class="li" @click="$emit('panel-action', 'open-provider-selector')">
        <span class="nm w300">Model</span>
        <span class="t">{{ modelLabel || 'none' }}</span>
      </div>
      <div class="li" v-if="participants.length">
        <span class="nm w300">Agents in this chat</span>
        <span class="t">Annie + {{ participants.length }}</span>
      </div>
      <div class="li" @click="$emit('panel-action', 'open-tool-selector')">
        <span class="nm w300">Tools</span>
        <span class="t">{{ toolsLabel }}</span>
      </div>
      <div class="li" v-if="conversationTitle">
        <span class="nm w300">Saved as</span>
        <span class="t clamp">{{ conversationTitle }}</span>
      </div>
    </InspSection>

    <template #footer>
      <button class="btn sm" type="button" :disabled="isSaving" @click="saveNow">{{ isSaving ? 'Saving…' : 'Save chat' }}</button>
      <button class="btn sm" type="button" @click="$emit('panel-action', 'new-chat')">New chat</button>
      <button class="btn sm" type="button" @click="$emit('panel-action', 'open-in-workspace')">Open in workspace</button>
    </template>
  </InspectorShell>
</template>

<script>
/**
 * ChatPanel (right) — "This conversation".
 *
 * Replaces the Active Workflows · Integration Health · Resources block that
 * drew on every screen regardless of what was beside it. Those blocks did not
 * vanish: Active Workflows lives on Workflows (left summary) and Dashboard;
 * Integration Health on Connectors; Resources under Settings › About and in
 * the Jump palette.
 */
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import InspectorShell from '@/views/_components/one/InspectorShell.vue';
import InspSection from '@/views/_components/one/InspSection.vue';
import EntityInspector from '@/views/_components/one/EntityInspector.vue';
import { useInspect } from '@/composables/useInspect.js';
import { compileEntityMatchers, entityRegistryFromStore } from '@/utils/entityRefs.js';
import { extractMessageArtifacts } from '@/utils/messageArtifacts.js';
import ArtifactPreview from '@/views/_components/one/ArtifactPreview.vue';

const RUNNING = new Set(['running', 'executing', 'in_progress', 'active']);
const ICONS = { agent: 'fas fa-robot', workflow: 'fas fa-project-diagram', goal: 'fas fa-bullseye', trace: 'fas fa-stream', memory: 'fas fa-brain' };

export default {
  name: 'ChatPanel',
  components: { InspectorShell, InspSection, EntityInspector, ArtifactPreview },
  props: {
    /** From Chat.vue via rightPanelProps. All optional. */
    participants: { type: Array, default: () => [] },
    hasContext: { type: Boolean, default: false },
    toolsEnabledCount: { type: Number, default: null },
    toolsTotalCount: { type: Number, default: null },
    conversationTitle: { type: String, default: '' },
    activeAgentName: { type: String, default: '' },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const { target, clear, inspect } = useInspect(['agent', 'workflow', 'goal', 'trace', 'execution', 'memory', 'running', 'autonomy']);

    const isStreaming = computed(() => !!store.state.chat?.isStreaming);
    const isSaving = computed(() => !!store.state.chat?.isSaving);
    const executions = computed(() => store.getters['executionHistory/getExecutions'] || []);
    const running = computed(() => executions.value.filter((e) => RUNNING.has(String(e.status || '').toLowerCase())));
    const escalatedCount = computed(() => (store.getters['insights/escalatedInsights'] || []).length);
    const modelLabel = computed(() => store.state.aiProvider?.selectedModel || '');
    const toolsLabel = computed(() => {
      if (props.toolsEnabledCount == null) return 'choose';
      return props.toolsTotalCount ? `${props.toolsEnabledCount} of ${props.toolsTotalCount}` : String(props.toolsEnabledCount);
    });

    // Entities this conversation mentions, from the messages themselves and
    // the same registry that draws the chips. Unique, most recent first.
    const mentioned = computed(() => {
      const msgs = store.state.chat?.messages || [];
      const matchers = compileEntityMatchers(entityRegistryFromStore(store));
      if (!matchers.length || !msgs.length) return [];
      const seen = new Map();
      for (let i = msgs.length - 1; i >= 0 && seen.size < 8; i--) {
        const text = typeof msgs[i]?.content === 'string' ? msgs[i].content : '';
        if (!text) continue;
        for (const { entity, re } of matchers) {
          const key = `${entity.kind}:${entity.id}`;
          if (seen.has(key)) continue;
          re.lastIndex = 0;
          if (re.test(text)) seen.set(key, entity);
        }
      }
      return [...seen.values()];
    });

    // Files this thread produced: every real file:/// link in an assistant
    // message, newest first.
    const artifacts = computed(() => {
      const msgs = store.state.chat?.messages || [];
      const out = new Map();
      for (const m of msgs) {
        if (m?.role !== 'assistant') continue;
        for (const a of extractMessageArtifacts(m.content)) {
          if (!out.has(a.href)) out.set(a.href, a);
        }
      }
      return [...out.values()].slice(-8).reverse();
    });

    function inspectKind(kind, id) {
      inspect(kind, id ?? null);
    }
    function kindIcon(kind) {
      return ICONS[kind] || 'fas fa-cube';
    }
    function when(d) {
      if (!d) return '';
      const diff = (Date.now() - new Date(d).getTime()) / 1000;
      if (!Number.isFinite(diff)) return '';
      if (diff < 60) return 'now';
      if (diff < 3600) return `${Math.floor(diff / 60)}m`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
      return `${Math.floor(diff / 86400)}d`;
    }
    function saveNow() {
      store.dispatch('chat/autosaveConversation', { debounce: false });
    }
    function stopStreaming() {
      emit('panel-action', 'stop-streaming');
    }
    const preview = ref(null);
    function previewArtifact(a) {
      preview.value?.show(a);
    }
    function openArtifact(a) {
      emit('panel-action', 'open-artifact', a);
    }
    function onEntityAction(action, payload) {
      if (action === 'open-forge') emit('panel-action', 'edit-workflow', payload.id);
      else if (action === 'edit-agent') emit('panel-action', 'edit-agent', payload.id);
      else if (action === 'apply-insight') store.dispatch('insights/applyInsight', payload.id);
      else if (action === 'reject-insight') store.dispatch('insights/rejectInsight', payload.id);
      else emit('panel-action', action, payload);
    }

    return { target, clear, isStreaming, isSaving, running, escalatedCount, modelLabel, toolsLabel, mentioned, artifacts, inspectKind, kindIcon, when, saveNow, stopStreaming, preview, previewArtifact, openArtifact, onEntityAction };
  },
};
</script>

<style scoped>
.muted {
  color: var(--color-text-muted);
  font-size: 12px;
}
.card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
}
.card.is-live {
  border-color: rgba(18, 224, 255, 0.3);
  background: linear-gradient(180deg, rgba(18, 224, 255, 0.06), rgba(18, 224, 255, 0.015));
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.spacer {
  flex: 1;
}
.nm {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 500;
}
.nm.w300 {
  font-weight: 300;
}
.li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 0;
  border-bottom: 1px solid var(--terminal-border-color);
  cursor: pointer;
  min-width: 0;
}
.li:last-child {
  border-bottom: 0;
}
.li:hover .nm {
  color: var(--color-green);
}
/* Small "go to Outputs" affordance on artifact rows; the row itself previews. */
.li-go {
  margin-left: auto;
  border: 0;
  background: none;
  color: var(--color-text-dull, #767888);
  font-size: 10px;
  padding: 3px 5px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
}
.li:hover .li-go {
  opacity: 1;
}
.li-go:hover {
  color: var(--color-text);
  background: rgba(255, 255, 255, 0.06);
}
.t {
  font-size: 10px;
  color: var(--color-text-dull, #767888);
  white-space: nowrap;
}
.t.clamp {
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 11px;
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}
.k-agent {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.28);
}
.k-workflow {
  color: var(--color-blue, #12e0ff);
  border-color: rgba(18, 224, 255, 0.26);
}
.k-goal {
  color: var(--color-yellow, #ffd700);
  border-color: rgba(255, 215, 0, 0.26);
}
.k-trace {
  color: var(--color-indigo);
  border-color: rgba(125, 61, 229, 0.32);
}
.k-memory {
  color: var(--color-pink);
  border-color: rgba(229, 61, 143, 0.26);
}
.k-artifact {
  color: var(--color-orange);
  border-color: rgba(255, 143, 90, 0.3);
}
.pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-blue, #12e0ff);
  box-shadow: 0 0 6px var(--color-blue, #12e0ff);
  flex: 0 0 auto;
}
.lnk {
  border: 0;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}
.lnk.danger {
  color: var(--color-red);
}
.btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--terminal-border-color);
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.ctx-host:empty {
  display: none;
}
.ctx-host :deep(.monitoring-panel) {
  margin: 0;
}
</style>
