<template>
  <EntityCard
    root-class="dataset-card"
    :title="dataset.name"
    :subtitle="dataset.source || 'manual'"
    :description="description"
    :selected="selected"
    :actions="actions"
    @click="emit('click')"
    @action="emit"
  >
    <template #icon>
      <span class="card-icon"><i class="fas fa-database"></i></span>
    </template>

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
  </EntityCard>
</template>

<script setup>
import { computed } from 'vue';
import EntityCard from '@/views/Terminal/_components/cards/EntityCard.vue';

const props = defineProps({
  dataset: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});
const emit = defineEmits(['click', 'delete']);

const actions = [{ name: 'delete', icon: 'fas fa-trash', tooltip: 'Delete' }];

const description = computed(() => {
  const text = props.dataset.description;
  if (!text) return '';
  return text.length > 120 ? text.substring(0, 120) + '...' : text;
});

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
/* Frame, header, actions and description live in _components/cards/EntityCard.vue */

.card-icon {
  font-size: 1.5em;
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
  color: var(--status-purple-text);
}
.source-badge.historical {
  background: rgba(59, 130, 246, 0.15);
  color: var(--status-blue-text);
}
.source-badge.golden {
  background: rgba(245, 158, 11, 0.15);
  color: var(--status-amber-text);
}
.source-badge.manual {
  background: rgba(150, 150, 150, 0.15);
  color: var(--color-text-muted);
}
.card-date {
  font-size: 0.75em;
  color: var(--color-grey);
}
</style>
