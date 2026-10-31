<template>
  <!-- Who may add plugins on this shared instance. Owner only; every default is the strict one. -->
  <section v-if="state.hosted && state.canEdit && policy" class="focused-edit-block" data-testid="plugin-policy">
    <div class="focused-edit-block-head"><h3>Plugins</h3></div>
    <p class="pp-muted" style="margin: 0 0 10px">Members can always add official plugins that only use the internet. Anything else comes to you as a request on Home.</p>
    <div class="focused-edit-card">
      <div class="focused-edit-row" style="align-items: flex-start">
        <span class="focused-edit-label">Pre-approved</span>
        <div style="flex: 1; min-width: 0">
          <div class="pp-chips">
            <span v-for="name in policy.preApproved" :key="name" class="pp-chip">{{ label(name) }}<button type="button" :aria-label="`Remove ${label(name)}`" :disabled="saving" @click="remove(name)">×</button></span>
            <span v-if="!policy.preApproved.length" class="pp-muted">None. Members ask for these.</span>
          </div>
          <CustomSelect :model-value="''" :options="addable" placeholder="Pre-approve a plugin…" aria-label="Pre-approve a plugin" :disabled="saving || !addable.length" @update:model-value="add" />
        </div>
      </div>
      <div class="focused-edit-row">
        <span class="focused-edit-label">Admins decide</span>
        <label class="pp-check"><input type="checkbox" :checked="policy.adminsCanApprove" :disabled="saving" data-testid="admins-can-approve" @change="save({ adminsCanApprove: $event.target.checked })" />Admins can approve plugin requests too</label>
      </div>
      <div class="focused-edit-row">
        <span class="focused-edit-label">All official</span>
        <label class="pp-check"><input type="checkbox" :checked="policy.membersAllOfficial" :disabled="saving" data-testid="members-all-official" @change="save({ membersAllOfficial: $event.target.checked })" />Members can add any official AGNT plugin, even ones that reach this instance’s files or keys</label>
      </div>
    </div>
    <p v-if="error" class="pp-error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { usePluginRequests } from '@/composables/usePluginRequests.js';

const plugins = usePluginRequests();
const state = plugins.state;
const policy = computed(() => state.policy);
const catalog = ref([]);
const saving = ref(false);
const error = ref('');
const names = computed(() => new Map(catalog.value.map((p) => [p.name, p.displayName || p.title || p.name])));
const label = (name) => names.value.get(name) || name;
const addable = computed(() => catalog.value.filter((p) => !(policy.value?.preApproved || []).includes(p.name)).map((p) => ({ value: p.name, label: p.displayName || p.title || p.name })));

async function save(patch) {
  saving.value = true;
  error.value = '';
  try { await plugins.setPolicy(patch); } catch (e) { error.value = e.message; } finally { saving.value = false; }
}
const add = (name) => name && save({ preApproved: [...policy.value.preApproved, name] });
const remove = (name) => save({ preApproved: policy.value.preApproved.filter((n) => n !== name) });

onMounted(async () => {
  try {
    await plugins.loadPolicy();
    if (!state.canEdit) return;
    catalog.value = await plugins.catalog();
  } catch (e) { console.warn('[plugin policy]', e.message); }
});
</script>

<style scoped>
.pp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.pp-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; border: 1px solid var(--terminal-border-color); border-radius: 999px; font-size: 12.5px; }
.pp-chip button { border: 0; background: transparent; color: var(--color-text-muted); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 4px; }
.pp-muted { color: var(--color-text-muted); font-size: 13px; }
.pp-error { color: var(--color-red); font-size: 13px; margin-top: 8px; }
.pp-check { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; cursor: pointer; }
</style>
