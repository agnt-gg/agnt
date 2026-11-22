<template>
  <!-- Team files with AI: may Annie and agents use teamspace Files. The team owner changes it. -->
  <section v-if="state.team && setting" class="focused-edit-block" data-testid="team-files-ai">
    <div class="focused-edit-block-head"><h3>Team files with AI</h3></div>
    <div class="focused-edit-card">
      <div class="focused-edit-row">
        <span class="focused-edit-label">Annie and agents</span>
        <CustomSelect
          :model-value="setting.mode"
          :options="OPTIONS"
          :disabled="!setting.canChange || saving"
          aria-label="Team files with AI"
          @update:model-value="change"
        />
      </div>
      <p class="tf-muted">
        Their file tools see each teamspace you are in as Teamspaces/&lt;name&gt; in your files, with what you can do there:
        people who can edit a teamspace can change its files, viewers only read them. Your own files stay private.
        <template v-if="!setting.canChange"> Only the team owner can change this.</template>
      </p>
    </div>
    <p v-if="error" class="tf-error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { useStore } from 'vuex';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { useTeam, teamApi } from '@/views/One/team/useTeam.js';

const OPTIONS = [
  { value: 'write', label: 'Read and change team files' },
  { value: 'read', label: 'Read team files only' },
  { value: 'off', label: 'Off' },
];
const { state } = useTeam(useStore());
const setting = ref(null);
const saving = ref(false);
const error = ref('');

async function load() {
  if (!state.team) return;
  try { setting.value = await teamApi.aiFiles(); } catch (e) { error.value = e.message; }
}
async function change(mode) {
  if (!mode || mode === setting.value?.mode) return;
  saving.value = true;
  error.value = '';
  try { setting.value = await teamApi.setAiFiles(mode); } catch (e) { error.value = e.message; } finally { saving.value = false; }
}
onMounted(load);
watch(() => state.team?.id, load);
</script>

<style scoped>
.tf-muted { color: var(--color-text-muted); font-size: 13px; margin: 8px 14px 12px; }
.tf-error { color: var(--color-red); font-size: 13px; margin-top: 8px; }
</style>
