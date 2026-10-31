<template>
  <div>
    <div class="board-bar">
      <span class="fill"></span>
      <label v-if="canWrite" class="primary" style="cursor: pointer; display: inline-flex; width: auto; flex: none"><MkIcon name="up" size="sm" />Upload<input type="file" hidden @change="upload" /></label>
    </div>
    <ul class="list">
      <li v-if="!files.length" class="empty">{{ loading ? 'Loading…' : error || 'No files yet.' }}</li>
      <li v-for="f in files" :key="f.name">
        <button type="button" class="r" @click="download(f)">
          <span class="r-icon"><MkIcon name="file" size="sm" /></span>
          <span class="r-text"><strong>{{ f.name }}</strong><small>{{ size(f.bytes) }} · {{ ago(f.modifiedAt) }}</small></span>
          <span class="scope team sm"><MkIcon name="users" size="sm" />{{ spaceName }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import { teamFiles } from './useTeam.js';
import { ago } from './teamModel.js';

const props = defineProps({ teamId: { type: String, required: true }, workspaceId: { type: String, required: true }, spaceName: { type: String, default: '' } });
const emit = defineEmits(['loaded']);
const ctx = inject('teamCtx');
const files = ref([]);
const loading = ref(true);
const error = ref('');
const canWrite = computed(() => ctx.canWrite.value);
const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');

async function load() {
  try { files.value = await teamFiles.list(props.teamId, props.workspaceId); error.value = ''; emit('loaded', files.value); }
  catch (e) { error.value = e.status === 403 ? 'Files are not available to you in this teamspace.' : e.message; }
  finally { loading.value = false; }
}
async function upload(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  // One plain name: the server refuses folders, '..', ':' and backslashes anyway.
  const name = file.name.replace(/[\\/:\0]/g, '-').replace(/^\.+/, '') || 'file';
  try { await teamFiles.upload(props.teamId, props.workspaceId, name, file); ctx.toast(`${name} is in ${props.spaceName}.`); await load(); }
  catch (e) { ctx.toast(e.message); }
}
async function download(f) {
  try {
    const blob = await teamFiles.download(props.teamId, props.workspaceId, f.name);
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: f.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { ctx.toast(e.message); }
}
watch(() => props.workspaceId, () => { loading.value = true; load(); });
onMounted(load);
</script>
