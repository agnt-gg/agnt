<template>
  <div class="ui-panel memory-panel">
    <!-- ═══ SELECTED MEMORY DETAILS ═══ -->
    <template v-if="selectedMemory">
      <div class="panel-section">
        <div class="selected-header">
          <h2>{{ truncate(selectedMemory.content, 60) }}</h2>
          <span class="type-badge" :class="selectedMemory.memory_type">{{ formatType(selectedMemory.memory_type) }}</span>
        </div>

        <!-- Core Info -->
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">Agent</span>
            <span class="detail-value">
              <i :class="agentIcon"></i>
              {{ agentName }}
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Type</span>
            <span class="detail-value type-val" :class="selectedMemory.memory_type">{{ formatType(selectedMemory.memory_type) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Relevance</span>
            <span class="detail-value">
              <span class="conf-inline">
                <span class="conf-bar-sm"><span class="conf-fill-sm" :style="{ width: ((selectedMemory.relevance_score || 1) / 2 * 100) + '%' }"></span></span>
                {{ (selectedMemory.relevance_score || 1).toFixed(1) }}
              </span>
            </span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Used</span>
            <span class="detail-value">{{ selectedMemory.access_count || 0 }}x</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Created</span>
            <span class="detail-value">{{ formatDate(selectedMemory.created_at) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Updated</span>
            <span class="detail-value">{{ formatDate(selectedMemory.updated_at) }}</span>
          </div>
        </div>

        <!-- Full Content -->
        <div class="sub-section">
          <h3><i class="fas fa-align-left"></i> Content</h3>
          <p class="description-text">{{ selectedMemory.content }}</p>
        </div>

        <!-- Source -->
        <div v-if="selectedMemory.source_conversation_id" class="sub-section">
          <h3><i class="fas fa-link"></i> Source</h3>
          <div class="origin-list">
            <div class="origin-item">
              <i class="fas fa-comments"></i>
              <span class="origin-label">Conversation</span>
              <span class="origin-value">{{ selectedMemory.source_conversation_id.substring(0, 12) }}...</span>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="panel-actions">
          <BaseButton @click="$emit('panel-action', 'edit-memory', selectedMemory)" variant="primary" full-width>
            <i class="fas fa-pen"></i> Edit Memory
          </BaseButton>
          <BaseButton @click="$emit('panel-action', 'delete-memory', selectedMemory)" variant="danger" full-width>
            <i class="fas fa-trash"></i> Delete
          </BaseButton>
        </div>
      </div>
    </template>

    <!-- ═══ PLACEHOLDER ═══ -->
    <template v-else>
      <div class="panel-section placeholder-section">
        <i class="fas fa-database"></i>
        <p>Select a memory to view details.</p>
      </div>
    </template>

    <ResourcesSection />
  </div>
</template>

<script>
import { computed } from 'vue';
import { useStore } from 'vuex';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';

export default {
  name: 'MemoryPanel',
  components: { BaseButton, ResourcesSection },
  props: {
    selectedMemory: { type: Object, default: null },
  },
  emits: ['panel-action'],
  setup(props) {
    const store = useStore();
    const agents = computed(() => store.getters['agents/allAgents'] || []);

    const agentNameMap = computed(() => {
      const map = {};
      for (const a of agents.value) map[a.id] = a.name;
      return map;
    });

    const agentName = computed(() => {
      const id = props.selectedMemory?.agent_id;
      if (!id || id === 'orchestrator' || id === '__orchestrator__') return 'Orchestrator';
      return agentNameMap.value[id] || 'Deleted Agent';
    });

    const agentIcon = computed(() => {
      const id = props.selectedMemory?.agent_id;
      if (!id || id === 'orchestrator' || id === '__orchestrator__') return 'fas fa-brain';
      return agentNameMap.value[id] ? 'fas fa-robot' : 'fas fa-ghost';
    });

    const formatType = (t) => (t || '').replace(/_/g, ' ');

    const formatDate = (d) => {
      if (!d) return '-';
      const diff = Date.now() - new Date(d);
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const truncate = (text, max) => (!text ? '' : text.length > max ? text.slice(0, max) + '...' : text);

    return { agentName, agentIcon, formatType, formatDate, truncate };
  },
};
</script>

<style scoped>
.memory-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  min-height: 0;
}

.panel-section {
  border-radius: 0px;
  padding: 15px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color-light);
}

/* Header */
.selected-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(var(--primary-rgb), 0.1);
}
.selected-header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: 1em;
  font-weight: 600;
  word-break: break-word;
  line-height: 1.3;
}
.type-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7em;
  font-weight: 500;
  text-transform: capitalize;
  white-space: nowrap;
  flex-shrink: 0;
}
.type-badge.fact { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.type-badge.preference { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
.type-badge.correction { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.type-badge.context { background: rgba(107, 114, 128, 0.15); color: #9ca3af; }
.type-badge.pattern { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.type-badge.tool_insight { background: rgba(236, 72, 153, 0.15); color: #ec4899; }
.type-badge.workflow_insight { background: rgba(14, 165, 233, 0.15); color: #0ea5e9; }
.type-badge.prompt_guidance { background: rgba(250, 204, 21, 0.15); color: #facc15; }

/* Detail grid */
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 4px;
}
.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.detail-label {
  font-size: 0.65em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.detail-value {
  font-size: 0.85em;
  color: var(--color-text);
  word-break: break-word;
  display: flex;
  align-items: center;
  gap: 5px;
  text-transform: capitalize;
}
.detail-value i { font-size: 0.9em; color: var(--color-grey); }

/* Type colors in detail */
.type-val.fact { color: #3b82f6; }
.type-val.preference { color: #a855f7; }
.type-val.correction { color: #f59e0b; }
.type-val.pattern { color: #22c55e; }
.type-val.tool_insight { color: #ec4899; }
.type-val.workflow_insight { color: #0ea5e9; }
.type-val.prompt_guidance { color: #facc15; }

/* Confidence inline */
.conf-inline {
  display: flex;
  align-items: center;
  gap: 6px;
}
.conf-bar-sm {
  width: 50px;
  height: 4px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 2px;
  overflow: hidden;
}
.conf-fill-sm {
  display: block;
  height: 100%;
  background: var(--color-green);
  border-radius: 2px;
}

/* Sub-sections */
.sub-section {
  border-top: 1px dashed rgba(var(--primary-rgb), 0.15);
  padding-top: 12px;
  margin-top: 12px;
}
.sub-section h3 {
  color: var(--color-grey);
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.sub-section h3 i {
  color: var(--color-green);
  font-size: 0.9em;
}

.description-text {
  margin: 0;
  color: var(--color-text);
  font-size: 0.85em;
  line-height: 1.5;
  word-break: break-word;
}

/* Source Origin */
.origin-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.origin-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  font-size: 0.82em;
}
.origin-item i {
  color: var(--color-grey);
  width: 14px;
  text-align: center;
  font-size: 0.9em;
  flex-shrink: 0;
}
.origin-label {
  color: var(--color-grey);
  min-width: 70px;
  flex-shrink: 0;
}
.origin-value {
  color: var(--color-text);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Actions */
.panel-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.15);
  padding-top: 12px;
  margin-top: 12px;
}

/* Placeholder */
.placeholder-section {
  text-align: center;
  color: var(--color-text-muted);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  background: var(--color-darker-0);
}
.placeholder-section i {
  font-size: 2em;
  opacity: 0.4;
  display: block;
  margin-bottom: 12px;
}
.placeholder-section p {
  font-style: italic;
  margin: 0;
  font-size: 0.9em;
}
</style>
