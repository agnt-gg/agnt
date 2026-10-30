<template>
  <div>
    <div class="board-bar">
      <span class="mk-muted">Docs everyone in {{ spaceName }} can read and edit. Every save is kept as a version.</span>
      <span class="fill"></span>
      <button v-if="canWrite" type="button" class="btn" @click="pickerOpen = !pickerOpen"><i class="fas fa-share" aria-hidden="true"></i>Share one of my files</button>
      <button v-if="canWrite" type="button" class="primary" @click="create"><i class="fas fa-plus" aria-hidden="true"></i>New doc</button>
    </div>
    <div v-if="pickerOpen" class="banner" style="display: block">
      <p style="margin: 0 0 8px">Pick a private file. A copy goes into {{ spaceName }}; your private original stays yours.</p>
      <p v-if="!privateFiles.length" class="mk-muted">{{ loadingFiles ? 'Loading…' : 'You have no private files yet.' }}</p>
      <ul v-else class="list">
        <li v-for="f in privateFiles" :key="f.id">
          <button type="button" class="r" @click="share(f)"><span class="r-icon"><i class="far fa-file-alt" aria-hidden="true"></i></span><span class="r-text"><strong>{{ f.title || 'Untitled' }}</strong><small>Private to you</small></span><span class="tag">Share copy</span></button>
        </li>
      </ul>
    </div>
    <ul class="list">
      <li v-if="!docs.length" class="empty">{{ loading ? 'Loading…' : 'No docs yet. Start one, or share one of your files.' }}</li>
      <li v-for="d in docs" :key="d.id">
        <button type="button" class="r" @click="$emit('open-doc', d.id)">
          <span class="r-icon"><i class="far fa-file-alt" aria-hidden="true"></i></span>
          <span class="r-text"><strong>{{ d.name }}</strong><small>Edited by {{ who(d.updatedBy) }} · {{ ago(d.updatedAt) }} · version {{ d.revision }}</small></span>
          <span class="scope"><i class="fas fa-users" aria-hidden="true"></i>{{ spaceName }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { teamApi } from './useTeam.js';
import { ago, nameOf } from './teamModel.js';

const props = defineProps({ workspaceId: { type: String, required: true }, spaceName: { type: String, default: '' } });
const emit = defineEmits(['open-doc']);
const ctx = inject('teamCtx');

const docs = ref([]);
const loading = ref(true);
const pickerOpen = ref(false);
const files = ref([]);
const loadingFiles = ref(false);
const canWrite = computed(() => ctx.canWrite.value);
const who = (id) => nameOf({ kind: 'person', id }, { people: ctx.people.value, me: ctx.me.value });
// Saved chats are content outputs too; only documents are offered here.
const privateFiles = computed(() => files.value.filter((f) => typeof f.content === 'string' && !/^\s*[[{]/.test(f.content)).slice(0, 50));

async function load() {
  try { docs.value = await teamApi.docs(props.workspaceId); } catch (e) { ctx.toast(e.message); } finally { loading.value = false; }
}
async function create() {
  const name = await ctx.prompt({ title: 'New doc', message: `Everyone in ${props.spaceName} can see it.`, placeholder: 'Q4 plan', confirmText: 'Create' });
  if (!name || !name.trim()) return;
  try { const doc = await teamApi.createDoc(props.workspaceId, name.trim(), ''); emit('open-doc', doc.id); } catch (e) { ctx.toast(e.message); }
}
async function loadFiles() {
  loadingFiles.value = true;
  try {
    // Private-in-team API: always the caller's own files, never the team's.
    const response = await fetch(API_CONFIG.BASE_URL + '/content-outputs', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || '') } });
    const list = await response.json().catch(() => []);
    files.value = Array.isArray(list) ? list : Array.isArray(list?.outputs) ? list.outputs : [];
  } catch (e) { ctx.toast('Could not load your files: ' + e.message); } finally { loadingFiles.value = false; }
}
async function share(file) {
  try {
    const doc = await teamApi.createDoc(props.workspaceId, file.title || 'Shared file', file.content || '');
    pickerOpen.value = false;
    ctx.toast(`A copy is in ${props.spaceName}. Your original stays private.`);
    emit('open-doc', doc.id);
  } catch (e) { ctx.toast(e.message); }
}

watch(pickerOpen, (open) => { if (open && !files.value.length) loadFiles(); });
watch(() => props.workspaceId, () => { loading.value = true; load(); });
watch(() => ctx.version.value, () => { const s = ctx.lastSignal.value; if (!s || (s.workspaceId === props.workspaceId && s.kind === 'docs')) load(); });
onMounted(load);
</script>
