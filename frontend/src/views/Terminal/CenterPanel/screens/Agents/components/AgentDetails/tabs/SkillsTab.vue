<template>
  <div class="tab-pane skills">
    <h3 class="section-title"><i class="fas fa-brain"></i> Agent Skills</h3>
    <div v-if="assignedSkillRecords.length > 0" class="skills-list">
      <div class="skills-grid">
        <div v-for="skill in assignedSkillRecords" :key="skill.id" class="skill-card">
          <div class="skill-header">
            <span class="skill-icon">{{ skill.icon || '🧩' }}</span>
            <div class="skill-info">
              <span class="skill-name">{{ skill.name }}</span>
              <span class="skill-category">{{ skill.category || 'general' }}</span>
            </div>
          </div>
          <p class="skill-description">{{ skill.description }}</p>
          <div v-if="skill.instructions" class="skill-instructions">
            <span class="instructions-label">Instructions:</span>
            <p class="instructions-text">{{ truncate(skill.instructions, 120) }}</p>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty-state">
      <i class="fas fa-brain"></i>
      <p>No skills assigned to this agent.</p>
      <p class="empty-hint">Assign skills in the Configure tab to give this agent specialized capabilities.</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useStore } from 'vuex';

const store = useStore();

const props = defineProps({
  selectedAgent: {
    type: Object,
    required: true,
  },
});

const assignedSkillRecords = computed(() => {
  const skillIds = props.selectedAgent.assignedSkills || [];
  if (skillIds.length === 0) return [];
  const allSkills = store.getters['skills/allSkills'] || [];
  return skillIds
    .map((id) => allSkills.find((s) => s.id === id))
    .filter(Boolean);
});

const truncate = (text, maxLen) => {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
};
</script>

<style scoped>
.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

h3.section-title {
  font-size: 1em;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
}

.section-title i {
  color: var(--color-green);
}

.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.skill-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 8px;
  padding: 14px;
  transition: border-color 0.2s;
}
.skill-card:hover {
  border-color: rgba(var(--green-rgb), 0.4);
}

.skill-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.skill-icon {
  font-size: 1.4em;
}

.skill-info {
  display: flex;
  flex-direction: column;
}

.skill-name {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.95em;
}

.skill-category {
  font-size: 0.75em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.skill-description {
  font-size: 0.85em;
  color: var(--color-grey);
  margin: 0;
  line-height: 1.4;
}

.skill-instructions {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.15);
}

.instructions-label {
  font-size: 0.75em;
  color: var(--color-green);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.instructions-text {
  font-size: 0.8em;
  color: var(--color-grey);
  margin: 4px 0 0;
  font-family: 'Courier New', monospace;
  line-height: 1.4;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--color-grey);
  text-align: center;
  gap: 8px;
}
.empty-state i {
  font-size: 2em;
  color: rgba(var(--green-rgb), 0.3);
  margin-bottom: 8px;
}
.empty-hint {
  font-size: 0.85em;
  opacity: 0.7;
}
</style>
