<template>
  <div>
    <div class="board-bar">
      <span class="fill"></span>
      <button v-if="canWrite" type="button" class="btn" @click="newDoc"><MkIcon name="doc" size="sm" />New doc</button>
      <label v-if="canWrite" class="primary" style="cursor: pointer; display: inline-flex; width: auto; flex: none"><MkIcon name="up" size="sm" />Upload<input type="file" hidden @change="upload" /></label>
    </div>
    <!-- One list: the teamspace's docs (edited here, versioned) and its uploaded files. -->
    <ul class="list">
      <li v-if="!rows.length" class="empty">{{ loading ? 'Loading…' : error || 'No files yet. Upload one, or start a doc.' }}</li>
      <li v-for="r in rows" :key="r.key">
        <button type="button" class="r" @click="r.open()">
          <span class="r-icon"><MkIcon :name="r.doc ? 'doc' : 'file'" size="sm" /></span>
          <span class="r-text"><strong>{{ r.name }}</strong><small>{{ r.meta }}</small></span>
          <span class="scope team sm"><MkIcon name="users" size="sm" />{{ spaceName }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted } from 'vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import { teamApi, teamFiles } from './useTeam.js';
import { ago, nameOf } from './teamModel.js';

const props = defineProps({ teamId: { type: String, required: true }, workspaceId: { type: String, required: true }, spaceName: { type: String, default: '' } });
const emit = defineEmits(['loaded', 'open-doc']);
const ctx = inject('teamCtx');
const files = ref([]);
const docs = ref([]);
const loading = ref(true);
const error = ref('');
const canWrite = computed(() => ctx.canWrite.value);
const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
const who = (id) => nameOf({ kind: 'person', id }, { people: ctx.people.value, me: ctx.me.value });
const rows = computed(() => [
  ...docs.value.map((d) => ({ key: 'd:' + d.id, doc: true, name: d.name, at: d.updatedAt, meta: `Doc · ${who(d.updatedBy)} · edited ${ago(d.updatedAt)}`, open: () => emit('open-doc', d.id) })),
  ...files.value.map((f) => ({ key: 'f:' + f.name, doc: false, name: f.name, at: f.modifiedAt, meta: `${size(f.bytes)} · ${ago(f.modifiedAt)}`, open: () => download(f) })),
].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))));

async function load() {
  const [f, d] = await Promise.all([
    teamFiles.list(props.teamId, props.workspaceId).catch((e) => { error.value = e.status === 403 ? 'Files are not available to you in this teamspace.' : e.message; return []; }),
    teamApi.docs(props.workspaceId).catch(() => []),
  ]);
  files.value = f;
  docs.value = d;
  if (f.length || d.length) error.value = '';
  loading.value = false;
  emit('loaded', rows.value);
}
async function newDoc() {
  const name = await ctx.prompt({ title: 'New doc', message: `Everyone in ${props.spaceName} can see it.`, placeholder: 'Q4 plan', confirmText: 'Create' });
  if (!name || !name.trim()) return;
  try { const doc = await teamApi.createDoc(props.workspaceId, name.trim(), ''); emit('open-doc', doc.id); } catch (e) { ctx.toast(e.message); }
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
watch(() => ctx.version.value, () => { const s = ctx.lastSignal.value; if (!s || (s.workspaceId === props.workspaceId && s.kind === 'docs')) load(); });
onMounted(load);
</script>
