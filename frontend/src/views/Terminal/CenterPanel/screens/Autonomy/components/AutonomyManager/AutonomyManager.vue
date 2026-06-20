<template>
  <div class="autonomy-manager">
    <div class="manager-header">
      <h3>Autonomy &amp; Escalation Inbox</h3>
      <p class="subtitle">Router decides per insight: direct apply, sandbox-gated, or escalate to you.</p>
    </div>

    <!-- Policy -->
    <div class="policy-card">
      <div class="policy-head">
        <div class="policy-title">
          <i class="fas fa-robot"></i>
          <span>Autonomy Router</span>
          <label class="toggle">
            <input type="checkbox" :checked="enabled" @change="toggleEnabled($event.target.checked)" />
            <span class="track"><span class="thumb"></span></span>
            <span class="toggle-label">{{ enabled ? 'ON' : 'OFF' }}</span>
          </label>
        </div>
        <div class="policy-hint">When OFF, all insights stay <code>pending</code> for manual review.</div>
      </div>

      <div class="policy-grid">
        <label class="field">
          <span class="field-label">Min confidence</span>
          <input type="number" step="0.05" min="0" max="1" v-model.number="draft.minConfidence" @change="commitDraft" class="field-input" />
        </label>
        <label class="field">
          <span class="field-label">Min Δ (gate)</span>
          <input type="number" step="0.01" min="0" v-model.number="draft.minDelta" @change="commitDraft" class="field-input" />
        </label>
        <label class="field">
          <span class="field-label">Max blast radius</span>
          <input type="number" step="0.05" min="0" max="1" v-model.number="draft.maxBlastRadius" @change="commitDraft" class="field-input" />
        </label>
        <label class="field">
          <span class="field-label">Require gate above</span>
          <input type="number" step="0.05" min="0" max="1" v-model.number="draft.requireGateAbove" @change="commitDraft" class="field-input" />
        </label>
        <label class="field">
          <span class="field-label">Daily budget</span>
          <input type="number" min="0" v-model.number="draft.dailyBudget" @change="commitDraft" class="field-input" />
        </label>
      </div>

      <div class="categories-section">
        <span class="field-label">Allowed categories</span>
        <div class="cat-chips">
          <label v-for="c in availableCategories" :key="c" class="cat-chip" :class="{ on: (draft.allowedCategories || []).includes(c) }">
            <input type="checkbox" :checked="(draft.allowedCategories || []).includes(c)" @change="toggleCategory(c)" />
            <span>{{ c }}</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Escalation Inbox -->
    <div class="inbox-head">
      <span class="inbox-title">Escalation Inbox</span>
      <span class="inbox-count">{{ escalated.length }}</span>
      <button class="btn ghost" :disabled="sweeping" @click="sweep">
        <i class="fas fa-sync" :class="{ 'fa-spin': sweeping }"></i>
        {{ sweeping ? 'Sweeping…' : 'Sweep now' }}
      </button>
    </div>

    <div v-if="!escalated.length" class="empty-state">
      <i class="fas fa-inbox"></i>
      <div>Nothing escalated.</div>
      <div class="hint">Insights land here when the router declines to auto-apply (low confidence, over budget, high blast radius, or disallowed category).</div>
    </div>

    <div v-else class="inbox-list">
      <div v-for="i in escalated" :key="i.id" class="inbox-row">
        <div class="row-main">
          <div class="row-title">
            <span class="target-chip">{{ i.target_type }}{{ i.target_id ? ':' + (i.target_id || '').slice(0, 10) : '' }}</span>
            <span class="cat">{{ i.category }}</span>
            <span class="title">{{ i.title }}</span>
            <span class="reason">{{ i.autonomy_reason }}</span>
          </div>
          <div class="row-desc">{{ i.description }}</div>
          <div class="row-meta">
            <span>confidence: {{ ((i.confidence || 0) * 100).toFixed(0) }}%</span>
            <span v-if="i.blast_radius != null">blast: {{ (i.blast_radius * 100).toFixed(0) }}%</span>
            <span>{{ formatDate(i.created_at) }}</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="icon-btn" title="Apply manually" @click="apply(i.id)">
            <i class="fas fa-check"></i>
          </button>
          <button class="icon-btn" title="Re-route through router" @click="route(i.id)">
            <i class="fas fa-route"></i>
          </button>
          <button class="icon-btn danger" title="Reject" @click="reject(i.id)">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>
    <SimpleModal ref="simpleModalRef" />
  </div>
</template>

<script>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

const AVAILABLE_CATEGORIES = [
  'memory',
  'prompt_refinement',
  'tool_preference',
  'skill_recommendation',
  'pattern',
  'antipattern',
  'contract_proposal',
  'bottleneck',
  'parameter_tune',
];

export default {
  name: 'AutonomyManager',
  components: { SimpleModal },
  setup() {
    const store = useStore();
    const simpleModalRef = ref(null);
    const settings = computed(() => store.getters['insights/evolutionSettings']);
    const autonomy = computed(() => store.getters['insights/autonomySettings']);
    const escalated = computed(() => store.getters['insights/escalatedInsights']);
    const error = computed(() => store.getters['insights/error']);
    const enabled = computed(() => autonomy.value?.enabled || false);

    const draft = reactive({
      minConfidence: 0.7,
      minDelta: 0.05,
      maxBlastRadius: 0.5,
      requireGateAbove: 0.45,
      dailyBudget: 20,
      allowedCategories: ['memory', 'prompt_refinement', 'tool_preference', 'contract_proposal', 'skill_recommendation', 'pattern', 'antipattern'],
    });

    watch(autonomy, (a) => {
      if (!a) return;
      Object.assign(draft, a);
    }, { immediate: true });

    const commitDraft = async () => {
      try { await store.dispatch('insights/updateEvolutionSettings', { autonomy: { ...draft } }); } catch (e) { /* surfaced */ }
    };
    const toggleEnabled = async (val) => {
      try { await store.dispatch('insights/updateEvolutionSettings', { autonomy: { ...draft, enabled: val } }); } catch (e) { /* surfaced */ }
    };
    const toggleCategory = (c) => {
      const list = new Set(draft.allowedCategories || []);
      if (list.has(c)) list.delete(c); else list.add(c);
      draft.allowedCategories = [...list];
      commitDraft();
    };
    const sweeping = ref(false);
    const sweep = async () => {
      if (sweeping.value) return;
      sweeping.value = true;
      try {
        const summary = await store.dispatch('insights/routeAllPending');
        const lines = [
          `Processed: ${summary?.processed ?? 0}`,
          `Direct apply: ${summary?.direct ?? 0}`,
          `Gated: ${summary?.gated ?? 0}`,
          `Escalated: ${summary?.escalated ?? 0}`,
        ];
        if (summary?.errors) lines.push(`Errors: ${summary.errors}`);
        await simpleModalRef.value?.showModal({
          title: 'Sweep complete',
          message: lines.join(' • '),
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (e) { /* surfaced */ } finally {
        sweeping.value = false;
      }
    };
    const apply = async (id) => { try { await store.dispatch('insights/applyInsight', id); } catch (e) { /* surfaced */ } };
    const route = async (id) => { try { await store.dispatch('insights/routeInsight', id); } catch (e) { /* surfaced */ } };
    const reject = async (id) => { try { await store.dispatch('insights/rejectInsight', id); } catch (e) { /* surfaced */ } };

    const formatDate = (s) => {
      if (!s) return '—';
      try { return new Date(s).toLocaleString(); } catch { return s; }
    };

    onMounted(async () => {
      await store.dispatch('insights/fetchEvolutionSettings');
      await store.dispatch('insights/fetchInsights', { status: 'pending', limit: 200 });
    });

    return {
      simpleModalRef,
      settings, autonomy, escalated, error, enabled, draft, sweeping,
      availableCategories: AVAILABLE_CATEGORIES,
      commitDraft, toggleEnabled, toggleCategory, sweep, apply, route, reject, formatDate,
    };
  },
};
</script>

<style scoped>
.autonomy-manager { display: flex; flex-direction: column; gap: 20px; }
.manager-header h3 { color: var(--color-light-green); font-size: 1.2em; font-weight: 500; margin: 0 0 4px 0; }
.subtitle { color: var(--color-text-muted); font-size: 0.85em; opacity: 0.8; margin: 0; }

.policy-card {
  background: var(--color-darker-1); border: 1px solid var(--terminal-border-color);
  border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 16px;
}
.policy-head { display: flex; flex-direction: column; gap: 4px; }
.policy-title { display: flex; align-items: center; gap: 10px; font-size: 1.05em; font-weight: 500; }
.policy-title i { color: var(--color-primary); }
.policy-hint { font-size: 0.85em; color: var(--color-text-muted); }
.policy-hint code { background: var(--color-darker-2); padding: 1px 4px; border-radius: 3px; font-family: var(--font-family-mono); }

.toggle { margin-left: auto; display: flex; align-items: center; gap: 8px; cursor: pointer; }
.toggle input { display: none; }
.toggle .track { width: 40px; height: 22px; background: var(--color-darker-2); border-radius: 11px; position: relative; transition: background 0.2s; }
.toggle .thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; background: var(--color-text-muted); border-radius: 50%; transition: transform 0.2s, background 0.2s; }
.toggle input:checked + .track { background: rgba(var(--green-rgb), 0.4); }
.toggle input:checked + .track .thumb { transform: translateX(18px); background: var(--color-green); }
.toggle-label { font-family: var(--font-family-mono); font-size: 0.85em; color: var(--color-text-muted); }

.policy-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-size: 0.8em; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.3px; }
.field-input {
  background: var(--color-darker-2); border: 1px solid var(--terminal-border-color);
  color: var(--color-text); padding: 8px 12px; border-radius: 6px; font-family: var(--font-family-mono);
}

.categories-section { display: flex; flex-direction: column; gap: 8px; }
.cat-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cat-chip {
  display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 16px;
  border: 1px solid var(--terminal-border-color); background: var(--color-darker-2);
  font-size: 0.8em; cursor: pointer; color: var(--color-text-muted);
}
.cat-chip input { display: none; }
.cat-chip.on { background: rgba(var(--primary-rgb), 0.15); color: var(--color-primary); border-color: rgba(var(--primary-rgb), 0.4); }

.inbox-head { display: flex; align-items: center; gap: 12px; }
.inbox-title { font-size: 1.05em; font-weight: 500; }
.inbox-count {
  background: rgba(var(--orange-rgb), 0.15); color: var(--color-orange);
  padding: 2px 10px; border-radius: 12px; font-family: var(--font-family-mono); font-size: 0.85em;
}
.btn.ghost {
  margin-left: auto; background: transparent; border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted); padding: 6px 12px; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; font-size: 0.85em;
}
.btn.ghost:hover { background: rgba(var(--primary-rgb), 0.1); color: var(--color-primary); }

.empty-state { padding: 32px; text-align: center; color: var(--color-text-muted); border: 1px dashed var(--terminal-border-color); border-radius: 8px; }
.empty-state i { font-size: 2em; opacity: 0.4; display: block; margin-bottom: 8px; }
.hint { font-size: 0.85em; opacity: 0.7; margin-top: 4px; }

.inbox-list { display: flex; flex-direction: column; gap: 8px; }
.inbox-row {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 12px;
  background: var(--color-darker-1); border: 1px solid var(--terminal-border-color);
  border-left: 3px solid var(--color-orange);
  border-radius: 8px; padding: 12px 16px;
}
.row-main { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.row-title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.target-chip {
  font-family: var(--font-family-mono); font-size: 0.8em;
  background: rgba(var(--blue-rgb), 0.1); color: var(--color-blue);
  padding: 2px 8px; border-radius: 4px;
}
.cat { font-size: 0.8em; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.3px; }
.title { font-weight: 500; color: var(--color-text); flex: 1; min-width: 0; }
.reason {
  font-family: var(--font-family-mono); font-size: 0.75em;
  background: rgba(var(--orange-rgb), 0.1); color: var(--color-orange);
  padding: 2px 6px; border-radius: 3px;
}
.row-desc { font-size: 0.9em; color: var(--color-text-muted); }
.row-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.8em; color: var(--color-text-muted); }
.row-actions { display: flex; gap: 6px; }
.icon-btn {
  background: transparent; border: 1px solid var(--terminal-border-color); color: var(--color-text-muted);
  width: 32px; height: 32px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.icon-btn:hover { background: rgba(var(--primary-rgb), 0.1); color: var(--color-primary); border-color: var(--color-primary); }
.icon-btn.danger:hover { background: rgba(var(--red-rgb), 0.1); color: var(--color-red); border-color: var(--color-red); }
.error-banner { color: var(--color-red); padding: 8px 12px; border: 1px solid rgba(var(--red-rgb), 0.3); border-radius: 6px; }
</style>
