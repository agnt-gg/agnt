<template>
  <div class="dataset-card" :class="{ selected }" @click="$emit('click')">
    <div class="card-header">
      <span class="card-icon"><i class="fas fa-database"></i></span>
      <div class="card-title-block">
        <span class="card-name">{{ dataset.name }}</span>
        <span class="card-category">{{ dataset.source || 'manual' }}</span>
      </div>
      <div class="card-actions">
        <Tooltip text="Delete">
          <button class="card-btn delete" @click.stop="$emit('delete')"><i class="fas fa-trash"></i></button>
        </Tooltip>
      </div>
    </div>
    <p v-if="dataset.description" class="card-description">{{ dataset.description?.length > 120 ? dataset.description.substring(0, 120) + '...' : dataset.description }}</p>
    <div class="card-stats">
      <div class="stat">
        <span class="stat-value">{{ dataset.items?.length || dataset.example_count || 0 }}</span>
        <span class="stat-label">examples</span>
      </div>
      <div v-if="dataset.skill_name" class="stat">
        <span class="stat-value"><i class="fas fa-puzzle-piece"></i></span>
        <span class="stat-label">{{ dataset.skill_name }}</span>
      </div>
      <div v-if="dataset.category" class="stat">
        <span class="stat-value"><i class="fas fa-tag"></i></span>
        <span class="stat-label">{{ dataset.category }}</span>
      </div>
    </div>
    <div class="card-footer">
      <span class="source-badge" :class="dataset.source || 'manual'">{{ dataset.source || 'manual' }}</span>
      <span v-if="dataset.created_at" class="card-date">{{ formatDate(dataset.created_at) }}</span>
    </div>
  </div>
</template>

<script setup>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

defineProps({ dataset: { type: Object, required: true }, selected: { type: Boolean, default: false } });
defineEmits(['click', 'delete']);

const formatDate = (d) => {
  if (!d) return '';
  const diff = Date.now() - new Date(d);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(d).toLocaleDateString();
};
</script>

<style scoped>
/* Card */
.dataset-card {
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
.dataset-card:hover {
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(0, 0, 0, 0.25);
}
.dataset-card.selected {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
}

/* Header */
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
  min-width: 0;
}
.card-name {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.95em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-category {
  font-size: 0.7em;
  color: var(--color-grey);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Actions */
.card-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.dataset-card:hover .card-actions {
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

/* Description */
.card-description {
  font-size: 0.85em;
  color: var(--color-grey);
  margin: 0 0 8px;
  line-height: 1.4;
}

/* Stats */
.card-stats {
  border-top: 1px dashed rgba(var(--green-rgb), 0.15);
  padding-top: 8px;
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}
.stat {
  display: flex;
  align-items: center;
  gap: 4px;
}
.stat-value {
  font-size: 0.7em;
  color: var(--color-green);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
.stat-value i {
  font-size: 1em;
  color: var(--color-grey);
}
.stat-label {
  font-size: 0.75em;
  color: var(--color-grey);
}

/* Footer */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.source-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 500;
}
.source-badge.synthetic {
  background: rgba(168, 85, 247, 0.15);
  color: #a855f7;
}
.source-badge.historical {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}
.source-badge.golden {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}
.source-badge.manual {
  background: rgba(150, 150, 150, 0.15);
  color: #999;
}
.card-date {
  font-size: 0.75em;
  color: var(--color-grey);
}
</style>
