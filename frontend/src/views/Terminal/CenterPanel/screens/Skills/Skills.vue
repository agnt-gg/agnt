<!-- Skills.vue -->
<template>
  <BaseScreen
    ref="baseScreenRef"
    screenId="SkillsScreen"
    activeRightPanel="SkillsPanel"
    activeLeftPanel="SkillsPanel"
    :panelProps="panelProps"
    :leftPanelProps="leftPanelProps"
    :showInput="false"
    :terminalLines="terminalLines"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="skills-screen">
        <!-- Header -->
        <ScreenToolbar
          title="SKILLS"
          :count="filteredSkills.length"
          countLabel="skills"
          searchPlaceholder="Search skills..."
          :searchQuery="searchQuery"
          :currentLayout="'grid'"
          :layoutOptions="[]"
          :showCollapseToggle="false"
          :showHideEmpty="false"
          createLabel="New Skill"
          @update:searchQuery="(v) => (searchQuery = v)"
          @create="openCreateModal"
        >
          <template #extra-buttons>
            <button class="import-btn" @click="triggerImport" title="Import SKILL.md"><i class="fas fa-file-import"></i> Import</button>
          </template>
        </ScreenToolbar>
        <!-- Hidden file input for import (outside toolbar) -->
        <input ref="importFileInput" type="file" accept=".md" style="display: none" @change="handleImportFile" />

        <!-- Skills Grid -->
        <div v-if="filteredSkills.length > 0" class="skills-grid">
          <div
            v-for="skill in filteredSkills"
            :key="skill.id"
            class="skill-card"
            :class="{ selected: selectedSkill?.id === skill.id }"
            @click="selectSkill(skill)"
          >
            <div class="card-header">
              <span class="card-icon"><i :class="skill.icon || 'fas fa-puzzle-piece'"></i></span>
              <div class="card-title-block">
                <span class="card-name">{{ skill.name }}</span>
                <span class="card-category">{{ skill.category || 'general' }}</span>
              </div>
              <div class="card-actions">
                <button class="card-btn edit" @click.stop="openEditModal(skill)" title="Edit"><i class="fas fa-pen"></i></button>
                <button class="card-btn delete" @click.stop="confirmDelete(skill)" title="Delete"><i class="fas fa-trash"></i></button>
              </div>
            </div>
            <p class="card-description">{{ skill.description }}</p>
            <div v-if="skill.instructions" class="card-instructions">
              <span class="instructions-label">Instructions</span>
              <p class="instructions-preview">{{ truncate(skill.instructions, 150) }}</p>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="empty-state-container">
          <div class="empty-state">
            <i class="fas fa-brain"></i>
            <p>No skills found</p>
            <div class="empty-state-buttons">
              <button class="create-button" @click="openCreateModal"><i class="fas fa-plus"></i> Create Skill</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Create/Edit Modal -->
      <Teleport to="body">
        <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
          <div class="modal-content">
            <div class="modal-header">
              <h3>{{ isEditing ? 'Edit Skill' : 'Create Skill' }}</h3>
              <button class="modal-close" @click="closeModal"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label>Name <span class="required">*</span></label>
                <input v-model="form.name" class="form-input" placeholder="My Skill Name" />
              </div>
              <div class="form-group">
                <label>Description <span class="required">*</span></label>
                <textarea v-model="form.description" class="form-input" rows="2" placeholder="What does this skill do?"></textarea>
              </div>
              <div class="form-group">
                <label>Instructions</label>
                <textarea
                  v-model="form.instructions"
                  class="form-input mono"
                  rows="8"
                  placeholder="The prompt instructions injected into the agent's system prompt when this skill is assigned..."
                ></textarea>
                <span class="form-hint">These instructions are injected into the LLM context as behavioral directives.</span>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Icon</label>
                  <div class="icon-grid">
                    <button
                      v-for="ico in SKILL_ICONS"
                      :key="ico"
                      type="button"
                      class="icon-btn"
                      :class="{ active: form.icon === ico }"
                      @click="form.icon = ico"
                    >
                      <i :class="ico"></i>
                    </button>
                  </div>
                </div>
                <div class="form-group">
                  <label>Category</label>
                  <BaseSelect v-model="form.category" :options="categoryOptions" placeholder="Select category" :zIndex="10001" />
                </div>
              </div>
            </div>
            <div v-if="modalError" class="modal-error">
              <i class="fas fa-exclamation-triangle"></i> {{ modalError }}
            </div>
            <div class="modal-footer">
              <button class="modal-btn cancel" @click="closeModal">Cancel</button>
              <button class="modal-btn save" @click="saveSkill" :disabled="!form.name || !form.description || saving">
                <i v-if="saving" class="fas fa-spinner fa-spin"></i>
                {{ isEditing ? 'Update' : 'Create' }}
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
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

const SKILL_ICONS = [
  'fas fa-puzzle-piece',
  'fas fa-chart-bar',
  'fas fa-chart-line',
  'fas fa-chart-pie',
  'fas fa-table',
  'fas fa-hashtag',
  'fas fa-clock',
  'fas fa-rss',
  'fas fa-sticky-note',
  'fas fa-code',
  'fas fa-globe',
  'fas fa-database',
  'fas fa-server',
  'fas fa-bolt',
  'fas fa-fire',
  'fas fa-star',
  'fas fa-heart',
  'fas fa-shield-alt',
  'fas fa-rocket',
  'fas fa-brain',
  'fas fa-cube',
  'fas fa-cubes',
  'fas fa-cog',
  'fas fa-wrench',
  'fas fa-terminal',
  'fas fa-palette',
  'fas fa-image',
  'fas fa-video',
  'fas fa-music',
  'fas fa-bell',
  'fas fa-envelope',
  'fas fa-comments',
  'fas fa-users',
  'fas fa-robot',
  'fas fa-atom',
  'fas fa-flask',
  'fas fa-gem',
  'fas fa-crown',
  'fas fa-leaf',
  'fas fa-cloud',
];

const store = useStore();
const emit = defineEmits(['screen-change']);
const baseScreenRef = ref(null);
const simpleModal = ref(null);
const importFileInput = ref(null);

const terminalLines = ref(['Skills Manager initialized.']);
const searchQuery = ref('');
const selectedSkill = ref(null);
const selectedCategory = ref(null);
const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const saving = ref(false);
const modalError = ref('');

const form = ref({
  name: '',
  description: '',
  instructions: '',
  icon: 'fas fa-puzzle-piece',
  category: 'general',
});

const allSkills = computed(() => store.getters['skills/allSkills'] || []);

const panelProps = computed(() => ({
  selectedSkill: selectedSkill.value,
}));

const leftPanelProps = computed(() => ({
  allSkills: allSkills.value,
  selectedSkill: selectedSkill.value,
}));

const categoryOptions = computed(() => {
  const cats = store.getters['skills/skillCategories'] || [];
  return cats.map((cat) => ({
    value: cat,
    label: cat.charAt(0).toUpperCase() + cat.slice(1),
  }));
});

const filteredSkills = computed(() => {
  let result = allSkills.value;

  // Filter by category
  if (selectedCategory.value) {
    result = result.filter((s) => (s.category || 'general') === selectedCategory.value);
  }

  // Filter by search
  const q = searchQuery.value.toLowerCase();
  if (q) {
    result = result.filter(
      (s) => s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q),
    );
  }

  return result;
});

const initializeScreen = () => {
  store.dispatch('skills/fetchSkills');
};

const handlePanelAction = (action, payload) => {
  if (action === 'navigate') {
    emit('screen-change', payload);
  } else if (action === 'category-filter-changed') {
    selectedCategory.value = payload?.selectedCategory || null;
    selectedSkill.value = null;
  } else if (action === 'open-create-modal') {
    openCreateModal();
  } else if (action === 'open-edit-modal') {
    openEditModal(payload);
  } else if (action === 'export-skill') {
    exportSkill(payload);
  } else if (action === 'delete-skill') {
    confirmDelete(payload);
  }
};

const selectSkill = (skill) => {
  selectedSkill.value = selectedSkill.value?.id === skill.id ? null : skill;
};

const openCreateModal = () => {
  isEditing.value = false;
  editingId.value = null;
  modalError.value = '';
  form.value = { name: '', description: '', instructions: '', icon: 'fas fa-puzzle-piece', category: 'general' };
  showModal.value = true;
};

const openEditModal = (skill) => {
  isEditing.value = true;
  editingId.value = skill.id;
  modalError.value = '';
  form.value = {
    name: skill.name || '',
    description: skill.description || '',
    instructions: skill.instructions || '',
    icon: skill.icon || 'fas fa-puzzle-piece',
    category: skill.category || 'general',
  };
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
};

const saveSkill = async () => {
  modalError.value = '';

  if (!form.value.name?.trim() || !form.value.description?.trim()) {
    modalError.value = 'Name and description are required.';
    return;
  }

  saving.value = true;
  try {
    const wasEditing = isEditing.value;
    const wasEditingId = editingId.value;

    if (wasEditing) {
      await store.dispatch('skills/updateSkill', { id: wasEditingId, skill: { ...form.value } });
      terminalLines.value.push(`[Skills] Updated skill "${form.value.name}".`);
    } else {
      const result = await store.dispatch('skills/createSkill', { ...form.value });
      terminalLines.value.push(`[Skills] Created skill "${form.value.name}".`);
      // Select newly created skill
      if (result?.skill) {
        selectedSkill.value = result.skill;
      }
    }

    closeModal();

    // Refresh selected skill if it was edited
    if (wasEditing && selectedSkill.value?.id === wasEditingId) {
      selectedSkill.value = allSkills.value.find((s) => s.id === wasEditingId) || null;
    }
  } catch (err) {
    modalError.value = err.message || 'Failed to save skill.';
    terminalLines.value.push(`[Skills] Error: ${err.message}`);
  } finally {
    saving.value = false;
  }
};

const confirmDelete = async (skill) => {
  const confirmed = await simpleModal.value?.showModal({
    title: 'Delete Skill?',
    message: `Are you sure you want to delete "${skill.name}"? This cannot be undone. Agents with this skill assigned will lose it.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    showCancel: true,
    confirmClass: 'btn-danger',
  });

  if (confirmed) {
    try {
      await store.dispatch('skills/deleteSkill', skill.id);
      terminalLines.value.push(`[Skills] Deleted skill "${skill.name}".`);
      if (selectedSkill.value?.id === skill.id) selectedSkill.value = null;
    } catch (err) {
      terminalLines.value.push(`[Skills] Error deleting: ${err.message}`);
    }
  }
};

// Export skill as SKILL.md
const exportSkill = async (skill) => {
  try {
    const content = await store.dispatch('skills/exportSkillMd', skill.id);
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${skill.name}.SKILL.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    terminalLines.value.push(`[Skills] Exported "${skill.name}" as SKILL.md.`);
  } catch (err) {
    terminalLines.value.push(`[Skills] Export error: ${err.message}`);
  }
};

// Import SKILL.md
const triggerImport = () => {
  importFileInput.value?.click();
};

const handleImportFile = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const content = await file.text();
    await store.dispatch('skills/importSkillMd', content);
    terminalLines.value.push(`[Skills] Imported skill from "${file.name}".`);
  } catch (err) {
    terminalLines.value.push(`[Skills] Import error: ${err.message}`);
  }

  // Reset file input
  event.target.value = '';
};

const truncate = (text, maxLen) => {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

onMounted(() => {
  store.dispatch('skills/fetchSkills');
});
</script>

<style scoped>
.skills-screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  min-height: 0;
  position: relative;
}

/* Header */
.skills-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.header-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.header-title i {
  color: var(--color-green);
}
.header-count {
  font-size: 0.8em;
  color: var(--color-grey);
  background: rgba(var(--green-rgb), 0.1);
  padding: 2px 8px;
  border-radius: 10px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.search-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 8px;
  color: var(--color-grey);
  font-size: 0.8em;
}
.search-input {
  padding: 6px 28px 6px 28px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  color: var(--color-text);
  font-size: 0.85em;
  width: 200px;
}
.search-input::placeholder {
  color: var(--color-grey);
}
.clear-search {
  position: absolute;
  right: 6px;
  background: none;
  border: none;
  color: var(--color-grey);
  cursor: pointer;
  font-size: 0.8em;
}
.create-btn {
  padding: 8px 16px;
  background: var(--color-green);
  color: #000 !important;
  border: 2px solid var(--color-green);
  border-radius: 6px;
  font-size: 0.9em;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: opacity 0.2s;
  z-index: 5;
}
.create-btn i {
  color: #000 !important;
}
.create-btn:hover {
  opacity: 0.85;
}

/* Grid */
.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  align-content: start;
}

/* Card */
.skill-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  overflow: hidden;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.skill-card:hover {
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(0, 0, 0, 0.25);
}
.skill-card.selected {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
}
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.card-icon {
  font-size: 1.5em;
}
.card-title-block {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.card-name {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.95em;
}
.card-category {
  font-size: 0.7em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.skill-card:hover .card-actions {
  opacity: 1;
}
.card-btn {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-grey);
  width: 28px;
  height: 28px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75em;
  transition: all 0.15s;
}
.card-btn:hover {
  color: var(--color-text);
  background: rgba(var(--green-rgb), 0.2);
}
.card-btn.delete:hover {
  color: var(--color-red);
  border-color: rgba(255, 77, 79, 0.3);
  background: rgba(255, 77, 79, 0.1);
}
.card-description {
  font-size: 0.85em;
  color: var(--color-grey);
  margin: 0 0 8px;
  line-height: 1.4;
}
.card-instructions {
  border-top: 1px dashed rgba(var(--green-rgb), 0.15);
  padding-top: 8px;
}
.instructions-label {
  font-size: 0.7em;
  color: var(--color-green);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.instructions-preview {
  font-size: 0.8em;
  color: var(--color-grey);
  margin: 4px 0 0;
  font-family: 'Courier New', monospace;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
}

/* Import Button */
.import-btn {
  padding: 6px 14px;
  background: rgba(var(--primary-rgb), 0.1);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  border-radius: 4px;
  color: var(--color-primary);
  font-size: 0.85em;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s;
}
.import-btn:hover {
  background: rgba(var(--primary-rgb), 0.2);
  border-color: var(--color-primary);
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
  color: var(--color-text-muted);
}

.empty-state i {
  font-size: 3em;
  display: block;
  opacity: 0.5;
}

.empty-state p {
  margin: 16px 0;
  font-size: 1.1em;
}

.empty-state-buttons {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
}

.create-button {
  display: flex;
  align-items: center;
  justify-content: center;
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

.create-button i {
  font-size: 0.8em;
}

/* Icon Grid */
.icon-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 1px;
}

.icon-btn {
  aspect-ratio: 1;
  background: none;
  border: 1px solid var(--terminal-border-color);
  border-radius: 3px;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  padding: 0;
}

.icon-btn:hover {
  color: var(--color-text);
  border-color: var(--terminal-border-color);
}

.icon-btn.active {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(var(--green-rgb), 0.08);
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
}
.form-input.mono {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}
.form-input:focus {
  outline: none;
  border-color: var(--color-primary) !important;
}
.form-hint {
  font-size: 0.75em;
  color: var(--color-grey);
  opacity: 0.7;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
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
.modal-error {
  padding: 8px 12px;
  margin: 0 20px;
  background: rgba(255, 77, 79, 0.1);
  border: 1px solid rgba(255, 77, 79, 0.3);
  border-radius: 4px;
  color: var(--color-red, #ff4d4f);
  font-size: 0.85em;
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
