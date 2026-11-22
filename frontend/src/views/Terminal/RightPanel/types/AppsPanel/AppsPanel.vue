<template>
  <!-- Studio's Apps screen: the one create button, then what needs you and what else
       the section can do. Every row is a page action (AppsScreen runs it). -->
  <div class="apps-panel">
    <PanelActionBar :create-label="right.create.label" @panel-action="(action) => action === 'create' && $emit('panel-action', 'apps-act', { action: right.create.action })" />

    <section class="apps-panel-section" data-testid="apps-panel-needs">
      <h3>Needs you</h3>
      <p v-if="!right.needs.length" class="apps-panel-empty"><i class="fas fa-check-circle" aria-hidden="true"></i>Everything is working.</p>
      <button v-for="row in right.needs" :key="row.id" type="button" class="apps-panel-row is-bad" :data-fix="row.id" @click="$emit('panel-action', 'apps-fix', { id: row.id })">
        <span class="apps-panel-name">{{ row.name }}<small>{{ row.problem }}</small></span>
        <span class="apps-panel-cta">{{ row.cta }}</span>
      </button>
    </section>

    <section v-if="right.more.length" class="apps-panel-section">
      <h3>More</h3>
      <button v-for="row in right.more" :key="row.id" type="button" class="apps-panel-row" :data-action="row.id" @click="$emit('panel-action', 'apps-act', { action: row.id })">
        <span class="apps-panel-name">{{ row.name }}</span>
        <span class="apps-panel-cta">{{ row.cta }}</span>
      </button>
    </section>
  </div>
</template>

<script>
import PanelActionBar from '@/views/Terminal/_components/panels/PanelActionBar.vue';

export default {
  name: 'AppsPanel',
  components: { PanelActionBar },
  props: {
    /** studioPanels(summary).right */
    right: { type: Object, default: () => ({ create: { action: 'add', label: 'Add connection' }, needs: [], more: [] }) },
  },
  emits: ['panel-action'],
};
</script>

<style scoped>
/* The shape of Tools' right panel (its "Needs a connection" list). */
.apps-panel { display: flex; flex-direction: column; gap: 16px; height: 100%; min-height: 0; color: var(--color-text); }
.apps-panel-section h3 { margin: 0 0 8px; font-size: 10px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-text-muted); }
.apps-panel-empty { margin: 0; font-size: 12.5px; color: var(--color-text-muted); }
.apps-panel-empty i { margin-right: 6px; color: var(--text-green); }
.apps-panel-row {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; margin-bottom: 6px;
  border: 1px solid var(--terminal-border-color); border-radius: 9px; background: none;
  color: var(--color-text); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
}
.apps-panel-row:hover,
.apps-panel-row:focus-visible { border-color: rgba(var(--primary-rgb), 0.45); outline: none; }
.apps-panel-row.is-bad { border-color: rgba(var(--red-rgb), 0.35); }
.apps-panel-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.apps-panel-name small { font-size: 11px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.apps-panel-cta { flex-shrink: 0; font-size: 11px; color: var(--color-primary); }
.apps-panel-row.is-bad .apps-panel-cta { color: var(--color-red); }
</style>
