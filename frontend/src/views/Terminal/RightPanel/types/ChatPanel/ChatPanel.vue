<template>
  <!-- Selected state: the thing you clicked (a reference chip, a Working-now
       row, a toolbar pill). ✕ / Esc returns to the summary. -->
  <ArtifactInspector v-if="target?.kind === 'artifact'" :artifact="target.payload" @close="clear" @expand="$emit('panel-action', 'expand-artifact')" />
  <EntityInspector
    v-else-if="target"
    :kind="target.kind"
    :id="target.id"
    caption="This conversation"
    @close="clear"
    @action="onEntityAction"
  />

  <!-- Summary state: what THIS conversation is doing, mentioning, costing. -->
  <InspectorShell v-show="!target" caption="This conversation" :live="isStreaming" :closable="false">
    <!-- Only THIS conversation's work. The live card is the turn in flight;
         rows beneath it are other runs this thread owns (a sub-agent it
         spawned, a turn another device is streaming). Never another thread's
         — those are under "Other chats". Never an id — see runDisplay.js. -->
    <InspSection title="Working now">
      <div v-if="isStreaming" class="card is-live" @click="inspectLiveTurn">
        <div class="row">
          <span class="pulse"></span>
          <span class="nm">{{ activeAgentName || 'Annie' }} is working…</span>
          <span class="t" v-if="liveSince">{{ liveSince }}</span>
          <span class="spacer"></span>
          <button class="lnk danger" type="button" @click.stop="stopStreaming">stop</button>
        </div>
      </div>
      <div v-for="r in hereRuns.slice(0, 5)" :key="r.id" class="li" @click="inspectKind('trace', r.id)" v-tooltip="r.parentExecutionId ? 'Started by this conversation' : 'Run in this conversation'">
        <span class="pulse"></span>
        <span class="nm">{{ r.name }}</span>
        <span class="t">{{ age(r.startTime) }}</span>
      </div>
      <div v-if="!isStreaming && !hereRuns.length" class="muted">Nothing is running.</div>
    </InspSection>

    <!-- Work in flight in OTHER threads. Useful when you run many at once —
         but under its own heading, so "this conversation" stays true. Click
         to go there. -->
    <InspSection v-if="elsewhere.length" :title="`Other chats · ${elsewhere.length}`">
      <div
        v-for="b in elsewhere"
        :key="b.conversationId"
        class="li"
        :class="{ 'li-static': !b.outputId }"
        @click="goToConversation(b)"
        v-tooltip="b.outputId ? 'Open this chat' : 'Not saved yet'"
      >
        <span class="pulse dim"></span>
        <span class="nm"><span class="who">{{ b.speaker?.name || 'Annie' }}</span> · {{ b.title || 'Untitled chat' }}</span>
        <span class="t">{{ age(b.since) }}</span>
      </div>
    </InspSection>

    <InspSection title="Referenced" v-if="mentioned.length">
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
      <div :ref="contextHostReady" data-chat-context-host class="ctx-host"></div>
      <div v-if="!hasContext" class="muted">Appears after the first turn.</div>
    </InspSection>

    <!-- Click previews in place (you stay in the conversation); the small
         arrow, or the preview's own link, goes to the Files screen. -->
    <InspSection title="Artifacts" v-if="artifacts.length">
      <div v-for="a in artifacts" :key="a.href" class="li li-artifact" @click="previewArtifact(a)" v-tooltip="'Preview ' + a.name">
        <span class="tile k-artifact"><i class="fas fa-cube"></i></span>
        <span class="nm">{{ a.name }}</span>
        <button type="button" class="li-go" v-tooltip="'Open in Files'" @click.stop="openArtifact(a)"><i class="fas fa-external-link-alt"></i></button>
      </div>
    </InspSection>

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
import { computed } from 'vue';
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import InspectorShell from '@/views/_components/one/InspectorShell.vue';
import InspSection from '@/views/_components/one/InspSection.vue';
import EntityInspector from '@/views/_components/one/EntityInspector.vue';
import { useInspect } from '@/composables/useInspect.js';
import { collectEntityRefs, compileEntityMatchers, entityRegistryFromStore } from '@/utils/entityRefs.js';
import { extractMessageArtifacts } from '@/utils/messageArtifacts.js';
import ArtifactInspector from '@/views/_components/one/ArtifactInspector.vue';
import { artifactKind } from '@/utils/chatArtifacts.js';
import ArtifactPreview from '@/views/_components/one/ArtifactPreview.vue';
import { runningRunsForConversation, shortAge } from '@/utils/runDisplay.js';

const ICONS = { agent: 'fas fa-robot', workflow: 'fas fa-project-diagram', goal: 'fas fa-bullseye', trace: 'fas fa-stream', memory: 'fas fa-brain' };

export default {
  name: 'ChatPanel',
  components: { InspectorShell, InspSection, EntityInspector, ArtifactInspector },
  props: {
    /** From Chat.vue via rightPanelProps. All optional. */
    contextHostReady: { type: Function, default: () => {} },
    participants: { type: Array, default: () => [] },
    hasContext: { type: Boolean, default: false },
    toolsEnabledCount: { type: Number, default: null },
    toolsTotalCount: { type: Number, default: null },
    conversationTitle: { type: String, default: '' },
    activeAgentName: { type: String, default: '' },
    /**
     * The messages the user can actually SEE. Must come from the screen, not
     * from `store.state.chat.messages` — that array also holds the mirrored
     * agent-side conversation, which Chat.vue hides from the main transcript.
     * Reading it directly listed agents from other threads as if this
     * conversation had named them.
     */
    messages: { type: Array, default: () => [] },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const { target, clear, inspect } = useInspect(['artifact', 'agent', 'workflow', 'goal', 'trace', 'execution', 'memory', 'running', 'autonomy']);
    const router = useRouter();
    const { target, clear, inspect } = useInspect(['agent', 'workflow', 'goal', 'trace', 'execution', 'memory', 'running', 'autonomy']);

    const isStreaming = computed(() => !!store.state.chat?.isStreaming);
    const isSaving = computed(() => !!store.state.chat?.isSaving);
    const activeConversationId = computed(() => store.state.chat?.activeConversationId || null);
    const activeConversation = computed(() => (activeConversationId.value ? store.state.chat?.conversations?.[activeConversationId.value] : null) || null);
    const liveRuns = computed(() => activeConversation.value?.liveRuns || []);
    const executions = computed(() => store.getters['executionHistory/getExecutions'] || []);

    // The live card IS this tab's running turn(s); listing them again below
    // it would show one piece of work twice.
    const liveRootIds = computed(() => (isStreaming.value ? liveRuns.value.filter((r) => r.status === 'running').map((r) => r.executionId) : []));
    const hereRuns = computed(() =>
      runningRunsForConversation({
        liveRuns: liveRuns.value,
        history: executions.value,
        conversationId: activeConversationId.value,
        hideExecutionIds: liveRootIds.value,
      }),
    );
    // Relative ages ("4m") are read off a clock that ticks, or a long turn
    // reads "now" for its entire duration. 30s is the label's own resolution.
    const clock = ref(Date.now());
    let clockTimer = null;
    onMounted(() => { clockTimer = setInterval(() => { clock.value = Date.now(); }, 30000); });
    onBeforeUnmount(() => { if (clockTimer) clearInterval(clockTimer); });

    const liveSince = computed(() => {
      const running = liveRuns.value.filter((r) => r.status === 'running');
      if (!running.length) return '';
      return shortAge(Math.min(...running.map((r) => r.startedAt || clock.value)), clock.value);
    });
    const elsewhere = computed(() => (store.getters['chat/busyConversations'] || []).filter((b) => b.conversationId !== activeConversationId.value));

    // The history snapshot is fetched once at boot (Terminal.vue) and
    // otherwise only when the Runs screen asks. Runs another device or a
    // sub-agent started only reach this panel through it, so refresh when the
    // conversation on screen changes and when its turn ends — bounded by user
    // action, throttled by the store.
    const refreshHistory = (force = false) => {
      store.dispatch('executionHistory/fetchExecutions', force ? { forceRefresh: true } : undefined).catch(() => {});
    };
    onMounted(() => refreshHistory());
    watch(activeConversationId, () => refreshHistory());
    watch(isStreaming, (now, before) => {
      if (before && !now) refreshHistory(true);
    });

    const escalatedCount = computed(() => (store.getters['insights/escalatedInsights'] || []).length);
    const modelLabel = computed(() => store.state.aiProvider?.selectedModel || '');
    const toolsLabel = computed(() => {
      if (props.toolsEnabledCount == null) return 'choose';
      return props.toolsTotalCount ? `${props.toolsEnabledCount} of ${props.toolsTotalCount}` : String(props.toolsEnabledCount);
    });

    // Entities this conversation refers to, from the visible transcript and
    // the same registry that draws the chips. Compiled separately so a
    // streaming reply re-scans the tail without recompiling ~200 matchers.
    const matchers = computed(() => compileEntityMatchers(entityRegistryFromStore(store)));
    const mentioned = computed(() => collectEntityRefs(props.messages, matchers.value));

    // Files this thread produced: every real file:/// link in an assistant
    // message, newest first.
    const artifacts = computed(() => {
      const msgs = props.messages || [];
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
    // The live card is THIS turn: open its trace once the stream has named
    // it. Before that (the first moments of a turn) fall back to the
    // cross-thread running list, which is at least never wrong.
    function inspectLiveTurn() {
      const id = liveRootIds.value[0];
      inspect(id ? 'trace' : 'running', id ? `agent-${id}` : null);
    }
    function kindIcon(kind) {
      return ICONS[kind] || 'fas fa-cube';
    }
    function age(d) {
      return shortAge(d, clock.value);
    }
    function goToConversation(b) {
      if (!b?.outputId) return;
      router.push(`/chat?content-id=${b.outputId}`).catch(() => {});
    }
    function saveNow() {
      store.dispatch('chat/autosaveConversation', { debounce: false });
    }
    function stopStreaming() {
      emit('panel-action', 'stop-streaming');
    }
    function previewArtifact(a) {
      inspect('artifact', a.href, { screen:'ChatScreen', payload:{...a,id:a.href,kind:artifactKind(a.name)} });
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

    return { target, clear, isStreaming, isSaving, running, escalatedCount, modelLabel, toolsLabel, mentioned, artifacts, inspectKind, kindIcon, when, saveNow, stopStreaming, previewArtifact, openArtifact, onEntityAction };
    return { target, clear, isStreaming, isSaving, hereRuns, liveSince, elsewhere, escalatedCount, modelLabel, toolsLabel, mentioned, artifacts, inspectKind, inspectLiveTurn, kindIcon, age, goToConversation, saveNow, stopStreaming, preview, previewArtifact, openArtifact, onEntityAction };
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
/* Other threads' activity is real but not this conversation's: quieter dot. */
.pulse.dim {
  opacity: 0.55;
  box-shadow: none;
}
.who {
  font-weight: 600;
}
.li-static {
  cursor: default;
}
.li-static:hover .nm {
  color: inherit;
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
