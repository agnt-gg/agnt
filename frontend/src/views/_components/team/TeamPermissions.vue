<template>
  <!-- Only whoever may change the rules sees this; everyone else learns a rule
       from the refusal that names it. -->
  <section v-if="view && view.canEdit" class="team-permissions" aria-label="Team permissions">
    <div class="intro">
      <h3>Team permissions</h3>
      <p>What teammates can do in this team. You always can do everything.</p>
    </div>

    <div class="presets" role="radiogroup" aria-label="Preset">
      <label v-for="preset in PRESETS" :key="preset.value" class="preset" :class="{ active: view.policy.preset === preset.value }">
        <input type="radio" name="team-permission-preset" :value="preset.value" :checked="view.policy.preset === preset.value" :disabled="busy" @change="save({ preset: preset.value })" />
        <span><strong>{{ preset.label }}</strong><small>{{ preset.detail }}</small></span>
      </label>
    </div>

    <table class="grid">
      <thead><tr><th scope="col"></th><th scope="col">Admins</th><th scope="col">Members</th></tr></thead>
      <tbody>
        <tr v-for="(label, key) in view.catalog" :key="key">
          <th scope="row">{{ label }}</th>
          <td v-for="role in ROLES" :key="role">
            <input type="checkbox" :aria-label="`${label} for ${role}s`" :checked="view.policy.roles[role][key]" :disabled="busy" @change="save({ roles: { [role]: { [key]: $event.target.checked } } })" />
          </td>
        </tr>
      </tbody>
    </table>

    <label v-if="view.role === 'owner'" class="delegate">
      <input type="checkbox" :checked="view.policy.adminsCanEdit" :disabled="busy" @change="save({ adminsCanEdit: $event.target.checked })" />
      Let admins change these
    </label>
    <p class="note">Running code inside this instance, and reading its files, stays owner-only whatever you choose here; teammates run code in the secure cloud sandbox.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue';
import { API_CONFIG } from '@/tt.config.js';

const props = defineProps({ teamId: { type: String, default: '' } });

const ROLES = ['admin', 'member'];
const PRESETS = [
  { value: 'open', label: 'Open', detail: 'Teammates can do everything.' },
  { value: 'careful', label: 'Careful', detail: 'Build and run; no code, plugins or outside triggers.' },
  { value: 'locked', label: 'Locked', detail: 'Members only run what is shared with them.' },
];

const view = ref(null);
const busy = ref(false);
const error = ref('');

async function request(options = {}) {
  const response = await fetch(API_CONFIG.BASE_URL + '/teams/' + encodeURIComponent(props.teamId) + '/policy', {
    ...options,
    headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || ''), 'Content-Type': 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || 'Could not load team permissions'), { code: body.code });
  return body;
}

async function load() {
  view.value = null;
  error.value = '';
  if (!props.teamId) return;
  try { view.value = await request(); } catch { /* an older cloud, or not this person's to edit: show nothing */ }
}

/** One change at a time, against the revision we last saw; a newer change elsewhere is reloaded, not overwritten. */
async function save(change) {
  if (!view.value) return;
  busy.value = true;
  error.value = '';
  try {
    view.value = await request({ method: 'PUT', body: JSON.stringify({ ...change, revision: view.value.revision }) });
  } catch (failure) {
    if (failure.code === 'policy_stale') { await load(); error.value = 'Someone else just changed these. Here is the latest; try again.'; }
    else error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

watch(() => props.teamId, load, { immediate: true });
defineExpose({ save, load });
</script>

<style scoped>
.team-permissions { display: flex; flex-direction: column; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--terminal-border-color); }
.intro h3 { margin: 0 0 4px; font-size: 14px; }
.intro p, .note { margin: 0; color: var(--color-text-muted); font-size: 13px; line-height: 1.5; }
.presets { display: flex; gap: 10px; flex-wrap: wrap; }
.preset { display: flex; gap: 10px; align-items: flex-start; flex: 1 1 180px; padding: 12px 14px; border: 1px solid var(--terminal-border-color); border-radius: 12px; cursor: pointer; }
.preset.active { border-color: rgba(var(--primary-rgb), .45); }
.preset input, .grid input, .delegate input { accent-color: var(--color-primary); }
.preset input { margin-top: 3px; }
.preset span { display: flex; flex-direction: column; gap: 2px; }
.preset strong { font-size: 13px; }
.preset small { font-size: 12px; color: var(--color-text-muted); line-height: 1.45; }
.grid { border-collapse: collapse; font-size: 13px; width: 100%; max-width: 560px; }
.grid th, .grid td { padding: 6px 8px; border-bottom: 1px solid var(--terminal-border-color); }
.grid thead th { font-weight: 600; color: var(--color-text-muted); font-size: 12px; text-align: center; }
.grid tbody th { font-weight: 400; text-align: left; }
.grid td { text-align: center; width: 90px; }
.delegate { display: flex; gap: 8px; align-items: center; font-size: 13px; cursor: pointer; }
.error { margin: 0; font-size: 12px; color: var(--color-red, #ff6b6b); }
</style>
