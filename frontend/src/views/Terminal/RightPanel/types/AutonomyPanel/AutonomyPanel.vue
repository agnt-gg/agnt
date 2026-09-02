<template>
  <ListSummaryPanel
    caption="Autonomy"
    overview-title="Approval queue"
    :stats="stats"
    hint="Everything Annie was not allowed to do on her own waits here. Approve applies it; reject discards it."
    :actions="actions"
  >
    <div v-if="!escalated.length" class="au-empty">Nothing is waiting for you.</div>
    <div v-for="ins in escalated" :key="ins.id" class="au-card">
      <div class="au-row">
        <span class="au-tag">{{ ins.insight_type || ins.type || 'change' }}</span>
        <span class="au-title">{{ ins.title || ins.summary || 'Untitled' }}</span>
      </div>
      <div v-if="ins.description" class="au-desc">{{ ins.description }}</div>
      <div class="au-row au-actions">
        <button type="button" class="au-btn" @click="reject(ins)">Reject</button>
        <button type="button" class="au-btn pri" @click="approve(ins)">Approve</button>
      </div>
    </div>
  </ListSummaryPanel>
</template>

<script>
/**
 * AutonomyPanel (right) — the approval queue beside the policy screen. The
 * screen had no right panel (fell back to Chat's); the queue is the thing you
 * came here to clear.
 */
import { computed } from 'vue';
import { useStore } from 'vuex';
import ListSummaryPanel from '@/views/_components/one/ListSummaryPanel.vue';

export default {
  name: 'AutonomyPanel',
  components: { ListSummaryPanel },
  emits: ['panel-action'],
  setup() {
    const store = useStore();
    const escalated = computed(() => store.getters['insights/escalatedInsights'] || []);
    const stats = computed(() => {
      const all = store.getters['insights/allInsights'] || [];
      return [
        { label: 'Waiting', value: escalated.value.length, live: escalated.value.length > 0 },
        { label: 'Pending', value: store.getters['insights/pendingCount'] || 0 },
        { label: 'Applied', value: all.filter((i) => i.status === 'applied').length },
        { label: 'Rejected', value: all.filter((i) => i.status === 'rejected').length },
      ];
    });
    const actions = [{ label: 'Route all pending', onClick: () => store.dispatch('insights/routeAllPending') }];
    const approve = (ins) => store.dispatch('insights/applyInsight', ins.id);
    const reject = (ins) => store.dispatch('insights/rejectInsight', ins.id);
    return { escalated, stats, actions, approve, reject };
  },
};
</script>

<style scoped>
.au-empty {
  color: var(--color-text-muted);
  font-size: 12px;
}
.au-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 215, 0, 0.25);
  border-radius: 10px;
  padding: 10px;
  margin-bottom: 8px;
}
.au-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.au-actions {
  margin-top: 8px;
  gap: 6px;
}
.au-tag {
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 215, 0, 0.1);
  color: var(--color-yellow, #ffd700);
  flex: 0 0 auto;
}
.au-title {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.au-desc {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--color-text-muted);
  line-height: 1.45;
}
.au-btn {
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
.au-btn.pri {
  background: var(--color-green);
  color: #04120a;
  border-color: var(--color-green);
  font-weight: 600;
}
</style>
