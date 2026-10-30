<template>
  <div class="content">
    <div class="doc">
      <div class="doc-meta">
        <button type="button" class="btn sm" @click="$emit('back')"><i class="fas fa-arrow-left" aria-hidden="true"></i> {{ spaceName }} docs</button>
        <span class="scope"><i class="fas fa-users" aria-hidden="true"></i>{{ spaceName }}</span>
        <span v-if="doc">Version {{ doc.revision }} · edited by {{ who(doc.updatedBy) }} · {{ ago(doc.updatedAt) }}</span>
        <span class="fill"></span>
        <span v-if="dirty" class="mk-muted">Unsaved changes</span>
        <button v-if="doc && canWrite" type="button" class="primary sm" :disabled="!dirty || saving" @click="save">{{ saving ? 'Saving…' : 'Save' }}</button>
        <button v-if="doc && canDelete" v-tooltip="'Delete doc'" type="button" class="one-icon-btn" aria-label="Delete doc" @click="remove"><i class="far fa-trash-alt" aria-hidden="true"></i></button>
      </div>
      <div v-if="conflict" class="mk-error">
        Someone else saved a newer version while you were editing. Your text is still here. Copy anything you need, then
        <button type="button" class="link" @click="reload">load their version</button>.
      </div>
      <p v-if="!doc" class="mk-muted">{{ error || 'Loading…' }}</p>
      <template v-else>
        <input v-model="name" class="doc-title" aria-label="Doc title" :readonly="!canWrite" @input="dirty = true" />
        <textarea v-model="content" class="mk-doc-body" aria-label="Doc body" placeholder="Write in plain text or Markdown…" :readonly="!canWrite" @input="dirty = true" @keydown.ctrl.s.prevent="save" @keydown.meta.s.prevent="save"></textarea>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, inject, onMounted, onBeforeUnmount } from 'vue';
import { teamApi } from './useTeam.js';
import { ago, nameOf } from './teamModel.js';

const props = defineProps({ workspaceId: { type: String, required: true }, docId: { type: String, required: true }, spaceName: { type: String, default: '' } });
const emit = defineEmits(['back']);
const ctx = inject('teamCtx');

const doc = ref(null);
const name = ref('');
const content = ref('');
const dirty = ref(false);
const saving = ref(false);
const conflict = ref(false);
const error = ref('');
const canWrite = computed(() => ctx.canWrite.value);
const canDelete = computed(() => canWrite.value && ['owner', 'admin'].includes(ctx.role.value));
const who = (id) => nameOf({ kind: 'person', id }, { people: ctx.people.value, me: ctx.me.value });

async function reload() {
  try {
    doc.value = await teamApi.doc(props.workspaceId, props.docId);
    name.value = doc.value.name;
    content.value = doc.value.content;
    dirty.value = false;
    conflict.value = false;
    error.value = '';
  } catch (e) { error.value = e.status === 404 ? 'This doc was deleted or moved.' : e.message; doc.value = null; }
}
async function save() {
  if (!dirty.value || saving.value || !doc.value) return;
  saving.value = true;
  try {
    const saved = await teamApi.saveDoc(props.workspaceId, props.docId, { name: name.value.trim() || doc.value.name, content: content.value, expectedRevision: doc.value.revision });
    doc.value = { ...doc.value, ...saved, content: content.value };
    dirty.value = false;
    ctx.toast('Saved');
  } catch (e) {
    if (e.code === 'revision_conflict') conflict.value = true;
    else ctx.toast(e.message);
  } finally { saving.value = false; }
}
async function remove() {
  if (!(await ctx.confirm({ title: 'Delete this doc?', message: 'It is removed from the teamspace for everyone. Its history is kept for the audit log.', confirmText: 'Delete', danger: true }))) return;
  try { await teamApi.deleteDoc(props.workspaceId, props.docId); emit('back'); } catch (e) { ctx.toast(e.message); }
}
// A teammate saved: refresh only if you have nothing unsaved; otherwise the save will surface the conflict.
watch(() => ctx.version.value, () => { const s = ctx.lastSignal.value; if (s?.docId === props.docId && !dirty.value) reload(); });
watch(() => props.docId, reload);
function beforeUnload(event) { if (dirty.value) { event.preventDefault(); event.returnValue = ''; } }
onMounted(() => { reload(); window.addEventListener('beforeunload', beforeUnload); });
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
</script>
