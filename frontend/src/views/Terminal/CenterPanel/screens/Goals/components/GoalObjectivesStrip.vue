<template>
  <!-- The few objectives the goals serve: each one filters the board. Hidden until there is one, except its add button. -->
  <section class="objectives" aria-label="Objectives" data-testid="objectives">
    <div
      v-for="objective in objectives"
      :key="objective.id"
      class="objective"
      :class="{ 'is-on': active === objective.id }"
      role="button"
      tabindex="0"
      :aria-pressed="String(active === objective.id)"
      :data-objective="objective.id"
      @click="toggle(objective.id)"
      @keydown.enter.self="toggle(objective.id)"
      @keydown.space.self.prevent="toggle(objective.id)"
    >
      <div class="objective-top">
        <span class="objective-kicker">Objective</span>
        <button type="button" class="objective-edit" :aria-label="`Edit ${objective.title}`" @click.stop="startEdit(objective)"><i class="fas fa-pen" aria-hidden="true"></i></button>
      </div>
      <h4 class="objective-title">{{ objective.title }}</h4>
      <div class="objective-row">
        <span v-if="objective.target || objective.current">
          <template v-if="objective.current">Now <b>{{ objective.current }}</b></template><template v-if="objective.current && objective.target"> of </template><template v-if="objective.target">{{ objective.current ? '' : 'Target ' }}{{ objective.target }}</template>
        </span>
        <span class="objective-goals">{{ objective.done }} of {{ objective.goals }} {{ objective.goals === 1 ? 'goal' : 'goals' }} done</span>
      </div>
      <div class="objective-track" :aria-label="`${objectiveProgress(objective)}% of its goals done`"><span :style="{ width: objectiveProgress(objective) + '%' }"></span></div>
    </div>

    <button
      v-if="objectives.length && unlinked"
      type="button"
      class="objective objective-unlinked"
      :class="{ 'is-on': active === NO_OBJECTIVE }"
      :aria-pressed="String(active === NO_OBJECTIVE)"
      data-testid="objectives-unlinked"
      @click="toggle(NO_OBJECTIVE)"
    >
      <b>{{ unlinked }} {{ unlinked === 1 ? 'goal serves' : 'goals serve' }}</b> no objective
      <span class="objective-show">{{ active === NO_OBJECTIVE ? 'Show all' : 'Show them' }}</span>
    </button>

    <form v-if="editing" class="objective objective-form" data-testid="objective-form" @submit.prevent="save">
      <input v-model="draft.title" class="objective-input" maxlength="120" placeholder="Objective, e.g. Grow trial sign-ups 20%" aria-label="Objective" required />
      <input v-model="draft.target" class="objective-input" maxlength="120" placeholder="Target, e.g. +20% by Dec 31" aria-label="Target" />
      <input v-model="draft.current" class="objective-input" maxlength="120" placeholder="Where it stands now, e.g. +12%" aria-label="Where it stands now" />
      <div class="objective-actions">
        <button type="submit" class="objective-save" :disabled="!draft.title.trim()">Save</button>
        <button type="button" class="objective-cancel" @click="editing = null">Cancel</button>
        <button v-if="editing !== 'new'" type="button" class="objective-retire" @click="retire">Retire</button>
      </div>
    </form>
    <button v-else type="button" class="objective-add" data-testid="objective-add" @click="startEdit(null)"><i class="fas fa-plus" aria-hidden="true"></i> Objective</button>
  </section>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { NO_OBJECTIVE, objectiveProgress } from '../goalObjectives.js';

const props = defineProps({
  objectives: { type: Array, default: () => [] },
  unlinked: { type: Number, default: 0 },
  active: { type: String, default: null },
});
const emit = defineEmits(['filter', 'create', 'update', 'retire']);
const editing = ref(null);
const draft = reactive({ title: '', target: '', current: '' });

const toggle = (id) => emit('filter', props.active === id ? null : id);
function startEdit(objective) {
  Object.assign(draft, { title: objective?.title || '', target: objective?.target || '', current: objective?.current || '' });
  editing.value = objective ? objective.id : 'new';
}
function save() {
  const input = { title: draft.title.trim(), target: draft.target.trim(), current: draft.current.trim() };
  if (!input.title) return;
  if (editing.value === 'new') emit('create', input);
  else emit('update', editing.value, input);
  editing.value = null;
}
function retire() {
  emit('retire', editing.value);
  editing.value = null;
}
</script>

<style scoped>
.objectives { display: flex; flex-wrap: wrap; align-items: stretch; gap: 10px; margin: 4px 0 14px; }
.objective { display: flex; flex-direction: column; gap: 6px; flex: 1 1 220px; max-width: 340px; padding: 12px 14px; border: 1px solid var(--terminal-border-color); border-radius: var(--border-radius-md); background: var(--color-darker-0); color: var(--text-primary); text-align: left; cursor: pointer; font: inherit; }
.objective:hover { border-color: var(--border-strong); }
.objective.is-on { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.14); }
.objective-top { display: flex; align-items: center; justify-content: space-between; }
.objective-kicker { font-size: var(--font-size-xs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
.objective-edit { border: 0; background: transparent; padding: 2px 4px; color: var(--text-tertiary); cursor: pointer; }
.objective-edit:hover { color: var(--text-primary); }
.objective-title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.25; }
.objective-row { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: var(--font-size-sm); color: var(--text-secondary); }
.objective-row b { color: var(--text-primary); font-weight: 600; }
.objective-track { height: 6px; border-radius: 3px; background: var(--surface-active); overflow: hidden; margin-top: auto; }
.objective-track span { display: block; height: 100%; border-radius: 3px; background: var(--color-primary); }
.objective-unlinked { flex: 0 1 190px; justify-content: center; border-style: dashed; font-size: var(--font-size-sm); color: var(--text-secondary); }
.objective-unlinked b { color: var(--text-primary); }
.objective-show { color: var(--color-primary); font-weight: 600; }
.objective-form { cursor: default; gap: 8px; }
.objective-input { width: 100%; box-sizing: border-box; padding: 6px 8px; border: 1px solid var(--terminal-border-color); border-radius: var(--border-radius-sm); background: transparent; color: var(--text-primary); font: inherit; font-size: var(--font-size-sm); }
.objective-input:focus { outline: none; border-color: var(--color-primary); }
.objective-actions { display: flex; gap: 8px; align-items: center; }
.objective-save, .objective-cancel, .objective-retire { padding: 4px 10px; border-radius: var(--border-radius-sm); font: inherit; font-size: var(--font-size-sm); cursor: pointer; }
.objective-save { border: 1px solid var(--color-primary); background: transparent; color: var(--color-primary); }
.objective-save:disabled { opacity: 0.5; cursor: default; }
.objective-cancel { border: 1px solid var(--terminal-border-color); background: transparent; color: var(--text-secondary); }
.objective-retire { margin-left: auto; border: 0; background: transparent; color: var(--text-tertiary); }
.objective-retire:hover { color: var(--color-red); }
.objective-add { align-self: center; padding: 8px 12px; border: 1px dashed var(--terminal-border-color); border-radius: var(--border-radius-md); background: transparent; color: var(--text-secondary); font: inherit; font-size: var(--font-size-sm); cursor: pointer; }
.objective-add:hover { border-color: var(--border-strong); color: var(--text-primary); }
</style>
