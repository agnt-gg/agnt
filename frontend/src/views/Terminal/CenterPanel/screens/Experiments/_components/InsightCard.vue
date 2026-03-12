<template>
  <div class="insight-card" :class="{ selected, [insight.status]: true }" @click="$emit('click')">
    <div class="card-header">
      <span class="card-icon" :class="categoryClass"><i :class="categoryIcon"></i></span>
      <div class="card-title-block">
        <span class="card-name">{{ insight.title }}</span>
        <span class="card-category">{{ formatCategory(insight.category) }}</span>
      </div>
      <div class="card-actions">
        <Tooltip v-if="insight.status === 'pending'" text="Apply">
          <button class="card-btn apply" @click.stop="$emit('apply')">
            <i class="fas fa-check"></i>
          </button>
        </Tooltip>
        <Tooltip v-if="insight.status === 'pending'" text="Reject">
          <button class="card-btn reject" @click.stop="$emit('reject')">
            <i class="fas fa-times"></i>
          </button>
        </Tooltip>
        <Tooltip text="Delete">
          <button class="card-btn delete" @click.stop="$emit('delete')">
            <i class="fas fa-trash"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <p class="card-description">{{ truncate(insight.description, 120) }}</p>

    <div class="card-meta">
      <span class="meta-item confidence">
        <span class="meta-bar"><span class="meta-fill" :style="{ width: (insight.confidence * 100) + '%' }"></span></span>
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
  </div>
</template>

<script setup>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const props = defineProps({
  insight: { type: Object, required: true },
  selected: { type: Boolean, default: false },
});
defineEmits(['click', 'apply', 'reject', 'delete']);

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
const truncate = (text, max) => (!text ? '' : text.length > max ? text.slice(0, max) + '...' : text);
</script>

<style scoped>
.insight-card {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
  height: 120px;
  display: flex;
  flex-direction: column;
}
.insight-card:hover {
  border-color: rgba(var(--green-rgb), 0.4);
  background: rgba(0, 0, 0, 0.25);
}
.insight-card.selected {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.05);
}
.insight-card.applied {
  border-left: 3px solid var(--color-green);
}
.insight-card.rejected {
  border-left: 3px solid #ef4444;
  opacity: 0.7;
}

/* Header */
.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  flex-shrink: 0;
}
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
.card-icon.antipattern { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.card-icon.prompt_refinement { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
.card-icon.skill_recommendation { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.card-icon.memory { background: rgba(236, 72, 153, 0.15); color: #ec4899; }
.card-icon.bottleneck { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.card-icon.parameter_tune { background: rgba(20, 184, 166, 0.15); color: #14b8a6; }
.card-icon.tool_preference { background: rgba(99, 102, 241, 0.15); color: #6366f1; }
.card-icon.default { background: rgba(150, 150, 150, 0.15); color: #999; }

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
.insight-card:hover .card-actions { opacity: 1; }
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
.card-btn:hover { color: var(--color-text); background: rgba(var(--green-rgb), 0.2); }
.card-btn.apply:hover { color: var(--color-green); border-color: rgba(var(--green-rgb), 0.4); background: rgba(var(--green-rgb), 0.15); }
.card-btn.reject:hover { color: #f59e0b; border-color: rgba(245, 158, 11, 0.3); background: rgba(245, 158, 11, 0.1); }
.card-btn.delete:hover { color: var(--color-red); border-color: rgba(255, 77, 79, 0.3); background: rgba(255, 77, 79, 0.1); }

/* Description */
.card-description {
  font-size: 0.85em;
  color: var(--color-grey);
  margin: 0 0 8px;
  line-height: 1.4;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

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
.status-badge.pending { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.status-badge.applied { background: rgba(var(--green-rgb), 0.15); color: var(--color-green); }
.status-badge.rejected { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.status-badge.superseded { background: rgba(150, 150, 150, 0.15); color: #999; }

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
.source-badge.agent_chat { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
.source-badge.goal { background: rgba(var(--green-rgb), 0.1); color: var(--color-green); }
.source-badge.workflow { background: rgba(168, 85, 247, 0.1); color: #a855f7; }
.source-badge.tool_call { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
.target-badge {
  background: rgba(150, 150, 150, 0.1);
  color: var(--color-grey);
}
</style>
