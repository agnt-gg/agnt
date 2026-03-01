<template>
  <div class="ui-panel skills-panel">
    <!-- Selected Skill Details -->
    <div v-if="selectedSkill" class="panel-section selected-skill-section">
      <div class="selected-skill-header">
        <h2>Selected Skill Details</h2>
        <Tooltip text="Edit Skill" width="auto">
          <span class="edit-button-panel" @click="handleEdit">
            <i class="fas fa-edit"></i>
          </span>
        </Tooltip>
      </div>

      <div class="selected-skill-content">
        <div class="skill-details">
          <div class="detail-row main-detail">
            <span class="label"><i :class="selectedSkill.icon || 'fas fa-puzzle-piece'"></i> Name:</span>
            <span class="value name">{{ selectedSkill.name }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-tag"></i> Category:</span>
            <span class="value">{{ selectedSkill.category || 'general' }}</span>
          </div>
          <div class="detail-row description-display">
            <span class="label"><i class="fas fa-info-circle"></i> Desc:</span>
            <span class="value description">{{ selectedSkill.description || 'N/A' }}</span>
          </div>
          <div v-if="selectedSkill.allowed_tools" class="detail-row">
            <span class="label"><i class="fas fa-tools"></i> Tools:</span>
            <span class="value">{{ formatAllowedTools(selectedSkill.allowed_tools) }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-clock"></i> Created:</span>
            <span class="value">{{ formatDate(selectedSkill.created_at) }}</span>
          </div>
          <div v-if="selectedSkill.updated_at" class="detail-row">
            <span class="label"><i class="fas fa-sync"></i> Updated:</span>
            <span class="value">{{ formatDate(selectedSkill.updated_at) }}</span>
          </div>
        </div>

        <div v-if="selectedSkill.instructions" class="instructions-section">
          <h3>Instructions</h3>
          <pre class="skill-instructions">{{ selectedSkill.instructions }}</pre>
        </div>

        <div class="skill-actions">
          <BaseButton @click="handleExport" variant="primary" full-width>
            <i class="fas fa-file-export"></i>
            Export SKILL.md
          </BaseButton>
          <BaseButton @click="handleDelete" variant="danger" full-width>
            <i class="fas fa-trash"></i>
            Delete Skill
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Placeholder when no skill selected -->
    <div v-else class="panel-section placeholder-section">
      <p>Select a skill to view details.</p>
      <BaseButton variant="primary" class="create-skill-button" @click="$emit('panel-action', 'open-create-modal')">
        <i class="fas fa-plus"></i>
        Create New Skill
      </BaseButton>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'SkillsPanel',
  components: { BaseButton, ResourcesSection, Tooltip },
  props: {
    selectedSkill: {
      type: Object,
      default: null,
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const formatDate = (dateString) => {
      if (!dateString) return 'N/A';
      return new Date(dateString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    };

    const formatAllowedTools = (tools) => {
      if (!tools) return '';
      try {
        const parsed = JSON.parse(tools);
        if (Array.isArray(parsed)) return parsed.join(', ');
      } catch (e) {
        // not JSON
      }
      return tools;
    };

    const handleEdit = () => {
      if (props.selectedSkill) {
        emit('panel-action', 'open-edit-modal', props.selectedSkill);
      }
    };

    const handleExport = () => {
      if (props.selectedSkill) {
        emit('panel-action', 'export-skill', props.selectedSkill);
      }
    };

    const handleDelete = () => {
      if (props.selectedSkill) {
        emit('panel-action', 'delete-skill', props.selectedSkill);
      }
    };

    return {
      formatDate,
      formatAllowedTools,
      handleEdit,
      handleExport,
      handleDelete,
    };
  },
};
</script>

<style scoped>
.skills-panel {
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

.panel-section h2 {
  color: var(--color-primary);
  font-size: 1.1em;
  margin: 0;
}

.selected-skill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(var(--primary-rgb), 0.1);
  padding-bottom: 8px;
}

.selected-skill-header h2 {
  margin: 0;
  padding: 0;
  border: none;
}

.edit-button-panel {
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 0.9em;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
  line-height: 1;
}

.edit-button-panel:hover {
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.1);
}

.selected-skill-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skill-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.95em;
}

.detail-row .label {
  color: var(--color-text-muted);
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-row .label i {
  width: 14px;
  text-align: center;
  color: var(--color-primary);
}

.detail-row .value {
  color: var(--color-primary);
  text-align: right;
}

.detail-row .value.name {
  font-weight: bold;
  color: var(--color-text);
  font-size: 1.1em;
  text-wrap-mode: nowrap;
}

.main-detail {
  margin-bottom: 5px;
}

.detail-row.description-display .value.description {
  font-size: 0.9em;
  white-space: nowrap;
  text-align: right;
  color: var(--color-text-muted);
  flex-basis: 70%;
  line-height: 1.4;
  text-wrap: auto;
}

.detail-row.description-display .label {
  align-self: flex-start;
}

.instructions-section {
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 12px;
}

.instructions-section h3 {
  color: var(--color-grey);
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 8px 0;
}

.skill-instructions {
  font-family: 'Courier New', monospace;
  font-size: 0.8em;
  color: var(--color-text);
  background: rgba(0, 0, 0, 0.2);
  padding: 12px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
}

.skill-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed rgba(var(--primary-rgb), 0.2);
  padding-top: 12px;
}

.placeholder-section {
  text-align: center;
  color: var(--color-text);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  background: var(--color-darker-0);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: fit-content;
}

.placeholder-section p {
  font-style: italic;
  margin: 0 0 16px 0;
  padding: 0;
}

.create-skill-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
</style>
