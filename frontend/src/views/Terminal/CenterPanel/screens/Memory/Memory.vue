<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="MemoryScreen"
    activeLeftPanel="MemoryPanel"
    activeRightPanel="MemoryPanel"
    :leftPanelProps="leftPanelProps"
    :panelProps="rightPanelProps"
    :showInput="false"
    @panel-action="handlePanelAction"
    @screen-change="(s) => emit('screen-change', s)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="memory-screen">
        <ScreenToolbar
          title="MEMORY"
          :count="filteredMemories.length"
          countLabel="memories"
          searchPlaceholder="Search memories..."
          :searchQuery="searchQuery"
          :currentLayout="currentLayout"
          :layoutOptions="['grid', 'table']"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          createLabel="Add Memory"
          @update:searchQuery="(v) => (searchQuery = v)"
          @update:layout="(v) => (currentLayout = v)"
          @create="showAddModal = true"
        />

        <!-- Filter tabs -->
        <div class="tab-bar">
          <div class="view-tabs">
            <button
              v-for="tab in typeTabs"
              :key="tab.value"
              class="view-tab"
              :class="{ active: activeTypeFilter === tab.value }"
              @click="activeTypeFilter = tab.value"
            >
              <i :class="tab.icon"></i> {{ tab.label }}
              <span class="tab-count">{{ getTypeCount(tab.value) }}</span>
            </button>
          </div>
          <div class="tab-sep"></div>
          <div class="view-tabs">
            <button
              v-for="tab in agentTabs"
              :key="tab.value"
              class="view-tab"
              :class="{ active: activeAgentFilter === tab.value }"
              @click="activeAgentFilter = tab.value"
            >
              <i :class="tab.icon"></i> {{ tab.label }}
              <span class="tab-count">{{ getAgentCount(tab.value) }}</span>
            </button>
          </div>
          <button
            v-if="hasOrphaned"
            class="clear-orphaned-btn"
            @click="clearOrphaned"
            title="Delete all memories from deleted agents"
          >
            <i class="fas fa-broom"></i> Clear Deleted
          </button>
        </div>

        <!-- Grid Layout -->
        <div v-if="filteredMemories.length > 0 && currentLayout === 'grid'" class="memory-grid">
          <div
            v-for="mem in filteredMemories"
            :key="mem.id"
            class="memory-card"
            :class="{ selected: selectedMemory?.id === mem.id }"
            @click="selectMemory(mem)"
          >
            <div class="memory-card-header">
              <span class="memory-type-badge" :class="mem.memory_type">{{ mem.memory_type }}</span>
              <span class="memory-agent" :class="{ unknown: !getAgentName(mem.agent_id) }">
                <i :class="getAgentName(mem.agent_id) ? 'fas fa-robot' : 'fas fa-ghost'"></i>
                {{ getAgentName(mem.agent_id) || 'Deleted Agent' }}
              </span>
            </div>
            <div class="memory-content">{{ mem.content }}</div>
            <div class="memory-card-footer">
              <span class="memory-meta">
                <i class="fas fa-eye"></i> {{ mem.access_count || 0 }}
              </span>
              <span class="memory-meta">
                <i class="fas fa-signal"></i> {{ (mem.relevance_score || 1).toFixed(1) }}
              </span>
              <span class="memory-meta">{{ formatDate(mem.updated_at || mem.created_at) }}</span>
              <div class="memory-actions" @click.stop>
                <button class="mem-btn edit" @click="openEditModal(mem)" title="Edit"><i class="fas fa-pen"></i></button>
                <button class="mem-btn delete" @click="confirmDelete(mem)" title="Delete"><i class="fas fa-trash"></i></button>
              </div>
            </div>
          </div>
        </div>

        <!-- Table Layout -->
        <div v-if="filteredMemories.length > 0 && currentLayout === 'table'" class="memory-table-container">
          <table class="memory-table">
            <thead>
              <tr>
                <th>Content</th>
                <th>Type</th>
                <th>Agent</th>
                <th>Relevance</th>
                <th>Used</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="mem in filteredMemories"
                :key="mem.id"
                :class="{ selected: selectedMemory?.id === mem.id }"
                @click="selectMemory(mem)"
              >
                <td class="content-cell">{{ truncate(mem.content, 120) }}</td>
                <td><span class="memory-type-badge" :class="mem.memory_type">{{ mem.memory_type }}</span></td>
                <td class="agent-cell" :class="{ unknown: !getAgentName(mem.agent_id) }">
                  <i :class="getAgentName(mem.agent_id) ? 'fas fa-robot' : 'fas fa-ghost'"></i>
                  {{ getAgentName(mem.agent_id) || 'Deleted Agent' }}
                </td>
                <td class="score-cell">{{ (mem.relevance_score || 1).toFixed(1) }}</td>
                <td class="count-cell">{{ mem.access_count || 0 }}x</td>
                <td>{{ formatDate(mem.updated_at || mem.created_at) }}</td>
                <td class="actions-cell" @click.stop>
                  <button class="mem-btn edit" @click="openEditModal(mem)"><i class="fas fa-pen"></i></button>
                  <button class="mem-btn delete" @click="confirmDelete(mem)"><i class="fas fa-trash"></i></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Empty State -->
        <div v-if="filteredMemories.length === 0" class="empty-state-container">
          <div class="empty-state">
            <i class="fas fa-database"></i>
            <p>No memories found</p>
            <span class="empty-hint">Memories are automatically extracted from agent conversations, or you can add them manually.</span>
            <button class="create-button" @click="showAddModal = true"><i class="fas fa-plus"></i> Add Memory</button>
          </div>
        </div>
      </div>

      <!-- Add/Edit Memory Modal -->
      <Teleport to="body">
        <div v-if="showAddModal || showEditModal" class="modal-overlay" @click.self="closeModals">
          <div class="modal-content">
            <div class="modal-header">
              <h3>{{ showEditModal ? 'Edit Memory' : 'Add Memory' }}</h3>
              <button class="modal-close" @click="closeModals"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label>Agent</label>
                <select v-model="memoryForm.agentId" class="form-input" :disabled="showEditModal">
                  <option value="orchestrator">Global (Orchestrator)</option>
                  <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
                </select>
              </div>
              <div class="form-group">
                <label>Type</label>
                <select v-model="memoryForm.memoryType" class="form-input">
                  <option value="fact">Fact</option>
                  <option value="preference">Preference</option>
                  <option value="correction">Correction</option>
                  <option value="context">Context</option>
                  <option value="pattern">Pattern</option>
                  <option value="tool_insight">Tool Insight</option>
                  <option value="workflow_insight">Workflow Insight</option>
                  <option value="prompt_guidance">Prompt Guidance</option>
                </select>
              </div>
              <div class="form-group">
                <label>Content <span class="required">*</span></label>
                <textarea v-model="memoryForm.content" class="form-input" rows="4" placeholder="e.g., User prefers concise code examples in Python"></textarea>
              </div>
              <div v-if="showEditModal" class="form-group">
                <label>Relevance Score</label>
                <input v-model.number="memoryForm.relevanceScore" type="number" class="form-input" step="0.1" min="0" max="2" />
              </div>
            </div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="closeModals">Cancel</button>
              <button class="modal-btn save" :disabled="!canSave || saving" @click="saveMemory">
                <i :class="saving ? 'fas fa-spinner fa-spin' : 'fas fa-check'"></i>
                {{ saving ? 'Saving...' : 'Save' }}
              </button>
            </div>
          </div>
        </div>
      </Teleport>

      <SimpleModal ref="simpleModal" />
    </template>
  </BaseScreen>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '@/views/Terminal/CenterPanel/BaseScreen.vue';
import ScreenToolbar from '@/views/Terminal/_components/ScreenToolbar.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

const store = useStore();
const emit = defineEmits(['screen-change']);
const simpleModal = ref(null);

// State
const searchQuery = ref('');
const currentLayout = ref('grid');
const activeTypeFilter = ref('all');
const activeAgentFilter = ref('all');
const selectedMemory = ref(null);
const showAddModal = ref(false);
const showEditModal = ref(false);
const saving = ref(false);

const memoryForm = ref({
  agentId: 'orchestrator',
  memoryType: 'fact',
  content: '',
  relevanceScore: 1.0,
});

// Data
const memories = computed(() => store.getters['insights/agentMemories'] || []);
const agents = computed(() => store.getters['agents/allAgents'] || []);

// Build agent name lookup
const agentNameMap = computed(() => {
  const map = {};
  for (const a of agents.value) {
    map[a.id] = a.name;
  }
  return map;
});

const getAgentName = (agentId) => {
  if (!agentId || agentId === 'orchestrator' || agentId === '__orchestrator__') return 'Orchestrator';
  return agentNameMap.value[agentId] || null;
};

// Unique agents in memories for filter tabs
const agentTabs = computed(() => {
  const tabs = [{ value: 'all', label: 'All Agents', icon: 'fas fa-globe' }];
  const seen = new Set();
  let hasUnknown = false;
  for (const mem of memories.value) {
    const id = mem.agent_id;
    if (seen.has(id)) continue;
    seen.add(id);
    const name = getAgentName(id);
    if (name) {
      tabs.push({ value: id, label: name, icon: id === 'orchestrator' || id === '__orchestrator__' ? 'fas fa-brain' : 'fas fa-robot' });
    } else {
      hasUnknown = true;
    }
  }
  if (hasUnknown) {
    tabs.push({ value: '__unknown__', label: 'Deleted Agents', icon: 'fas fa-ghost' });
  }
  return tabs;
});

const TYPE_TAB_DEFS = [
  { value: 'all', label: 'All', icon: 'fas fa-layer-group', always: true },
  { value: 'fact', label: 'Facts', icon: 'fas fa-info-circle' },
  { value: 'preference', label: 'Preferences', icon: 'fas fa-sliders-h' },
  { value: 'correction', label: 'Corrections', icon: 'fas fa-exclamation-triangle' },
  { value: 'context', label: 'Context', icon: 'fas fa-bookmark' },
  { value: 'pattern', label: 'Patterns', icon: 'fas fa-project-diagram' },
  { value: 'tool_insight', label: 'Tools', icon: 'fas fa-wrench' },
  { value: 'workflow_insight', label: 'Workflows', icon: 'fas fa-sitemap' },
  { value: 'prompt_guidance', label: 'Guidance', icon: 'fas fa-lightbulb' },
];
const typeTabs = computed(() =>
  TYPE_TAB_DEFS.filter(t => t.always || memories.value.some(m => m.memory_type === t.value))
);

const getTypeCount = (type) => type === 'all' ? memories.value.length : memories.value.filter(m => m.memory_type === type).length;
const isUnknownAgent = (agentId) => {
  const name = getAgentName(agentId);
  return !name;
};
const hasOrphaned = computed(() => memories.value.some(m => isUnknownAgent(m.agent_id)));
const getAgentCount = (agentId) => {
  if (agentId === 'all') return memories.value.length;
  if (agentId === '__unknown__') return memories.value.filter(m => isUnknownAgent(m.agent_id)).length;
  return memories.value.filter(m => m.agent_id === agentId).length;
};

const filteredMemories = computed(() => {
  let result = memories.value;
  if (activeTypeFilter.value !== 'all') result = result.filter(m => m.memory_type === activeTypeFilter.value);
  if (activeAgentFilter.value === '__unknown__') result = result.filter(m => isUnknownAgent(m.agent_id));
  else if (activeAgentFilter.value !== 'all') result = result.filter(m => m.agent_id === activeAgentFilter.value);
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    result = result.filter(m => m.content?.toLowerCase().includes(q) || m.memory_type?.toLowerCase().includes(q));
  }
  return [...result].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
});

const canSave = computed(() => memoryForm.value.content?.trim());

const formatDate = (d) => {
  if (!d) return '-';
  const diff = Date.now() - new Date(d);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(d).toLocaleDateString();
};

const truncate = (text, max) => (!text ? '' : text.length > max ? text.slice(0, max) + '...' : text);

const selectMemory = (mem) => {
  selectedMemory.value = selectedMemory.value?.id === mem.id ? null : mem;
};

const openEditModal = (mem) => {
  memoryForm.value = {
    id: mem.id,
    agentId: mem.agent_id,
    memoryType: mem.memory_type,
    content: mem.content,
    relevanceScore: mem.relevance_score || 1.0,
  };
  showEditModal.value = true;
};

const closeModals = () => {
  showAddModal.value = false;
  showEditModal.value = false;
  memoryForm.value = { agentId: '', memoryType: 'fact', content: '', relevanceScore: 1.0 };
};

const saveMemory = async () => {
  if (!canSave.value || saving.value) return;
  saving.value = true;
  try {
    if (showEditModal.value) {
      await store.dispatch('insights/updateAgentMemory', {
        id: memoryForm.value.id,
        content: memoryForm.value.content,
        memoryType: memoryForm.value.memoryType,
        relevanceScore: memoryForm.value.relevanceScore,
      });
    } else {
      await store.dispatch('insights/addAgentMemory', {
        agentId: memoryForm.value.agentId,
        memoryType: memoryForm.value.memoryType,
        content: memoryForm.value.content,
      });
    }
    closeModals();
    loadMemories();
  } catch (err) {
    console.error('Failed to save memory:', err);
  } finally {
    saving.value = false;
  }
};

const confirmDelete = async (mem) => {
  const confirmed = await simpleModal.value?.showModal({
    title: 'Delete Memory?',
    message: `Delete this memory? "${truncate(mem.content, 80)}"`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    showCancel: true,
    confirmClass: 'btn-danger',
  });
  if (confirmed) {
    try {
      await store.dispatch('insights/deleteAgentMemory', { id: mem.id });
      if (selectedMemory.value?.id === mem.id) selectedMemory.value = null;
      loadMemories();
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  }
};

const clearOrphaned = async () => {
  const count = getAgentCount('__unknown__');
  const confirmed = await simpleModal.value?.showModal({
    title: 'Clear Deleted Agent Memories?',
    message: `Remove ${count} memories from agents that no longer exist?`,
    confirmText: 'Clear All',
    cancelText: 'Cancel',
    showCancel: true,
    confirmClass: 'btn-danger',
  });
  if (confirmed) {
    try {
      await store.dispatch('insights/deleteOrphanedMemories');
      activeAgentFilter.value = 'all';
      loadMemories();
    } catch (err) {
      console.error('Failed to clear orphaned memories:', err);
    }
  }
};

// Panel props
const leftPanelProps = computed(() => ({
  activeType: activeTypeFilter.value,
  activeAgent: activeAgentFilter.value,
}));

const rightPanelProps = computed(() => ({
  selectedMemory: selectedMemory.value,
}));

const handlePanelAction = (action, data) => {
  if (action === 'navigate') emit('screen-change', data);
  else if (action === 'filter-type') activeTypeFilter.value = data;
  else if (action === 'filter-agent') activeAgentFilter.value = data;
  else if (action === 'add-memory') showAddModal.value = true;
  else if (action === 'clear-orphaned') clearOrphaned();
  else if (action === 'edit-memory') openEditModal(data);
  else if (action === 'delete-memory') confirmDelete(data);
};

const loadMemories = () => {
  store.dispatch('insights/fetchAllMemories');
};

const initializeScreen = () => {
  loadMemories();
  store.dispatch('agents/fetchAgents');
};

onMounted(() => initializeScreen());
</script>

<style scoped>
.memory-screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-height: 0;
  position: relative;
}

/* Tab bar */
.tab-bar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
  gap: 4px;
  flex-wrap: wrap;
}
.tab-sep {
  width: 1px;
  height: 20px;
  background: var(--terminal-border-color);
  margin: 0 8px;
}
.view-tabs {
  display: flex;
  gap: 2px;
}
.view-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-grey);
  cursor: pointer;
  font-size: 0.8em;
  transition: all 0.2s;
  white-space: nowrap;
}
.view-tab:hover {
  background: rgba(var(--green-rgb), 0.05);
  border-color: rgba(var(--green-rgb), 0.3);
}
.view-tab.active {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}
.tab-count {
  background: var(--color-darker-0);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 0.85em;
}
.clear-orphaned-btn {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 4px;
  color: #ef4444;
  cursor: pointer;
  font-size: 0.8em;
  white-space: nowrap;
  transition: all 0.2s;
}
.clear-orphaned-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

/* Grid */
.memory-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  align-content: start;
}

.memory-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.memory-card:hover {
  border-color: rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.03);
}
.memory-card.selected {
  border-color: rgba(var(--green-rgb), 0.5);
  background: rgba(var(--green-rgb), 0.06);
}

.memory-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.memory-type-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 500;
  text-transform: capitalize;
}
.memory-type-badge.fact {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}
.memory-type-badge.preference {
  background: rgba(168, 85, 247, 0.15);
  color: #a855f7;
}
.memory-type-badge.correction {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}
.memory-type-badge.context {
  background: rgba(107, 114, 128, 0.15);
  color: #9ca3af;
}
.memory-type-badge.pattern {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}
.memory-type-badge.tool_insight {
  background: rgba(236, 72, 153, 0.15);
  color: #ec4899;
}
.memory-type-badge.workflow_insight {
  background: rgba(14, 165, 233, 0.15);
  color: #0ea5e9;
}
.memory-type-badge.prompt_guidance {
  background: rgba(250, 204, 21, 0.15);
  color: #facc15;
}

.memory-agent {
  font-size: 0.75em;
  color: var(--color-grey);
  display: flex;
  align-items: center;
  gap: 4px;
}
.memory-agent i {
  font-size: 0.85em;
}

.memory-content {
  font-size: 0.85em;
  color: var(--color-text);
  line-height: 1.5;
  word-break: break-word;
  flex: 1;
}

.memory-card-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.75em;
}

.memory-meta {
  color: var(--color-grey);
  display: flex;
  align-items: center;
  gap: 3px;
}
.memory-meta i {
  font-size: 0.85em;
}

.memory-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.mem-btn {
  background: none;
  border: 1px solid transparent;
  color: var(--color-grey);
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.7em;
  transition: all 0.15s;
}
.mem-btn.edit:hover {
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.3);
}
.mem-btn.delete:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

/* Table */
.memory-table-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 16px;
}
.memory-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9em;
}
.memory-table th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--color-grey);
  font-weight: 600;
  font-size: 0.85em;
  text-transform: uppercase;
}
.memory-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--color-text);
}
.memory-table tr {
  cursor: pointer;
  transition: background 0.15s;
}
.memory-table tr:hover {
  background: rgba(var(--green-rgb), 0.03);
}
.memory-table tr.selected {
  background: rgba(var(--green-rgb), 0.08);
}
.content-cell {
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-cell {
  white-space: nowrap;
  color: var(--color-grey);
  font-size: 0.9em;
}
.agent-cell i {
  margin-right: 4px;
  font-size: 0.85em;
}
.agent-cell.unknown,
.memory-agent.unknown {
  opacity: 0.5;
  font-style: italic;
}
.score-cell {
  font-family: monospace;
  font-weight: 500;
}
.count-cell {
  font-family: monospace;
  color: var(--color-grey);
}
.actions-cell {
  display: flex;
  gap: 4px;
}

/* Empty State */
.empty-state-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.empty-state {
  text-align: center;
  color: var(--color-grey);
}
.empty-state i {
  font-size: 3em;
  display: block;
  opacity: 0.5;
}
.empty-state p {
  margin: 16px 0 4px;
  font-size: 1.1em;
}
.empty-hint {
  font-size: 0.85em;
  color: var(--color-grey);
  opacity: 0.7;
  display: block;
  margin-bottom: 16px;
}
.create-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 1px dashed var(--color-duller-navy);
  padding: 10px 20px;
  border-radius: 6px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.95em;
  transition: all 0.2s ease;
}
.create-button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.modal-content {
  background: var(--terminal-bg);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 540px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}
.modal-header h3 {
  margin: 0;
  font-size: 1em;
  color: var(--color-text);
}
.modal-close {
  background: none;
  border: none;
  color: var(--color-grey);
  cursor: pointer;
  font-size: 1em;
}
.modal-close:hover {
  color: var(--color-text);
}
.modal-body {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.form-group label {
  font-size: 0.85em;
  color: var(--color-grey);
}
.required {
  color: var(--color-red);
}
.form-input {
  padding: 8px 10px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color) !important;
  border-radius: 4px !important;
  color: var(--color-text);
  font-size: 0.9em;
  font-family: inherit;
  height: auto !important;
  width: 100%;
  box-sizing: border-box;
}
.form-input:focus {
  outline: none;
  border-color: var(--color-primary) !important;
}
textarea.form-input {
  resize: vertical;
  min-height: 80px;
}
select.form-input {
  cursor: pointer;
}
select.form-input option {
  background: var(--terminal-bg);
  color: var(--color-text);
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--terminal-border-color);
}
.modal-btn {
  padding: 8px 18px;
  border-radius: 4px;
  font-size: 0.85em;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.modal-btn.cancel {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-text);
}
.modal-btn.save {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border: none;
  font-weight: 600;
}
.modal-btn.save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.modal-btn.save:not(:disabled):hover {
  opacity: 0.85;
}
</style>
