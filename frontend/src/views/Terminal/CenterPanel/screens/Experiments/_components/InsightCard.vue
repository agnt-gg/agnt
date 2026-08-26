<template>
  <EntityCard
    root-class="insight-card"
    :status-class="insight.status"
    layout="fixed"
    :title="insight.title"
    :subtitle="formatCategory(insight.category)"
    :description="description"
    description-style="clamp"
    :show-description="true"
    :selected="selected"
    :actions="actions"
    @click="emit('click')"
    @action="emit"
  >
    <template #icon>
      <span class="card-icon" :class="categoryClass"><i :class="categoryIcon"></i></span>
    </template>

    <div class="card-meta">
      <span class="meta-item confidence">
        <span class="meta-bar"><span class="meta-fill" :style="{ width: insight.confidence * 100 + '%' }"></span></span>
        <span class="meta-value">{{ Math.round(insight.confidence * 100) }}%</span>
      </span>
      <span v-if="insight.occurrence_count > 1" class="meta-item occurrences">
        <i class="fas fa-layer-group"></i> {{ insight.occurrence_count }}x
      </span>
    </div>

    <div class="card-footer">
      <span class="status-badge" :class="insight.status">{{ insight.status }}</span>
      <span class="source-badge" :class="insight.source_type">
        <i :class="sourceIcon"></i> {{ formatSource(insight.source_type) }}
      </span>
      <span class="target-badge">
        <i :class="targetIcon"></i> {{ insight.target_type }}
      </span>
    </div>
  </EntityCard>
</template>

<script setup>
import { computed } from 'vue';
import EntityCard from '@/views/Terminal/_components/cards/EntityCard.vue';
import { safeTruncate } from '@/utils/safeTruncate.js';

const props = defineProps({
  insight: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});
const emit = defineEmits(['click', 'apply', 'reject', 'delete']);

const categoryIcons = {
  pattern: 'fas fa-thumbs-up',
  antipattern: 'fas fa-thumbs-down',
  prompt_refinement: 'fas fa-pen-fancy',
  skill_recommendation: 'fas fa-puzzle-piece',
  memory: 'fas fa-brain',
  bottleneck: 'fas fa-tachometer-alt',
  parameter_tune: 'fas fa-sliders-h',
  tool_preference: 'fas fa-wrench',
};

const sourceIcons = {
  agent_chat: 'fas fa-comments',
  goal: 'fas fa-bullseye',
  workflow: 'fas fa-project-diagram',
  tool_call: 'fas fa-wrench',
};

const targetIcons = {
  agent: 'fas fa-robot',
  skill: 'fas fa-puzzle-piece',
  workflow: 'fas fa-project-diagram',
  tool: 'fas fa-wrench',
};

const categoryIcon = categoryIcons[props.insight.category] || 'fas fa-lightbulb';
const categoryClass = props.insight.category || 'default';
const sourceIcon = sourceIcons[props.insight.source_type] || 'fas fa-circle';
const targetIcon = targetIcons[props.insight.target_type] || 'fas fa-cube';

const formatCategory = (c) => (c || '').replace(/_/g, ' ');
const formatSource = (s) => (s || '').replace(/_/g, ' ');

const description = computed(() => safeTruncate(props.insight.description, 120, '...'));

/** Apply and reject are only offered while the insight is still undecided. */
const actions = computed(() => [
  ...(props.insight.status === 'pending'
    ? [
        { name: 'apply', icon: 'fas fa-check', tooltip: 'Apply' },
        { name: 'reject', icon: 'fas fa-times', tooltip: 'Reject' },
      ]
    : []),
  { name: 'delete', icon: 'fas fa-trash', tooltip: 'Delete' },
]);
</script>

<style scoped>
/* Frame, header, actions and description live in _components/cards/EntityCard.vue */

/*
  The class is doubled deliberately. EntityCard's `.entity-card:hover` sets the
  `border-color` shorthand, which includes the left edge; at equal specificity
  the winner would come down to stylesheet injection order, so the decided-state
  stripe could vanish on hover. Doubling the class raises specificity and makes
  the stripe win everywhere, in every theme.
*/
.insight-card.insight-card.applied {
  border-left: 3px solid var(--color-green);
}
.insight-card.insight-card.rejected {
  border-left: 3px solid #ef4444;
  opacity: 0.7;
}

/* Icon tile, tinted per insight category */
.card-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85em;
  flex-shrink: 0;
}
.card-icon.pattern { background: rgba(var(--green-rgb), 0.15); color: var(--color-green); }
.card-icon.antipattern { background: rgba(239, 68, 68, 0.15); color: var(--color-red); }
.card-icon.prompt_refinement { background: rgba(168, 85, 247, 0.15); color: var(--status-purple-text); }
.card-icon.skill_recommendation { background: rgba(59, 130, 246, 0.15); color: var(--status-blue-text); }
.card-icon.memory { background: rgba(236, 72, 153, 0.15); color: var(--color-pink); }
.card-icon.bottleneck { background: rgba(245, 158, 11, 0.15); color: var(--status-amber-text); }
.card-icon.parameter_tune { background: rgba(20, 184, 166, 0.15); color: var(--color-blue); }
.card-icon.tool_preference { background: rgba(99, 102, 241, 0.15); color: var(--status-blue-text); }
.card-icon.default { background: rgba(150, 150, 150, 0.15); color: var(--color-text-muted); }

/* Confidence meta */
.card-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  color: var(--color-grey);
}
.meta-item.confidence { flex: 1; }
.meta-bar {
  flex: 1;
  height: 4px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 2px;
  overflow: hidden;
  max-width: 80px;
}
.meta-fill {
  display: block;
  height: 100%;
  background: var(--color-green);
  border-radius: 2px;
  transition: width 0.3s;
}
.meta-value {
  font-weight: 500;
  font-size: 0.9em;
  color: var(--color-text);
  min-width: 28px;
}
.meta-item.occurrences i {
  font-size: 0.85em;
  color: var(--color-grey);
}

/* Footer */
.card-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex-shrink: 0;
  margin-top: auto;
}
.status-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 500;
}
.status-badge.pending { background: rgba(245, 158, 11, 0.15); color: var(--status-amber-text); }
.status-badge.applied { background: rgba(var(--green-rgb), 0.15); color: var(--color-green); }
.status-badge.rejected { background: rgba(239, 68, 68, 0.15); color: var(--color-red); }
.status-badge.superseded { background: rgba(150, 150, 150, 0.15); color: var(--color-text-muted); }

.source-badge, .target-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.7em;
  display: flex;
  align-items: center;
  gap: 4px;
  text-transform: capitalize;
}
.source-badge {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-primary);
}
.source-badge.agent_chat { background: rgba(59, 130, 246, 0.1); color: var(--status-blue-text); }
.source-badge.goal { background: rgba(var(--green-rgb), 0.1); color: var(--color-green); }
.source-badge.workflow { background: rgba(168, 85, 247, 0.1); color: var(--status-purple-text); }
.source-badge.tool_call { background: rgba(245, 158, 11, 0.1); color: var(--status-amber-text); }
.target-badge {
  background: rgba(150, 150, 150, 0.1);
  color: var(--color-grey);
}
</style>
