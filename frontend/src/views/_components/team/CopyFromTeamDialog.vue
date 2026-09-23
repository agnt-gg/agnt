<template>
  <Teleport to="body">
    <div class="copy-dialog-scrim" @click.self="$emit('close')">
      <section class="copy-dialog team-panel" role="dialog" aria-modal="true" :aria-label="'Copy from ' + team.name">
        <header>
          <h2>Copy from {{ team.name }}</h2>
          <button class="icon" aria-label="Close" @click="$emit('close')"><i class="fas fa-times"></i></button>
        </header>
        <div class="body">
          <p>Make your own copy of something the team built. Your copy is yours to change; the team's stays as it is.</p>
          <p v-if="loading" role="status">Loading what {{ team.name }} has…</p>
          <p v-else-if="!items.length && !error" class="empty">Nothing to copy yet.</p>
          <ul v-else class="rows" aria-label="Team items">
            <li v-for="item in items" :key="item.kind + item.id">
              <label class="check"><input v-model="chosen" type="checkbox" :value="item.kind + ':' + item.id" /> <strong>{{ item.name }}</strong></label>
              <span class="pill">{{ kindLabel(item.kind) }}</span>
            </li>
          </ul>
          <p v-if="done" class="ok"><i class="fas fa-check" aria-hidden="true"></i> Copied {{ done }} item{{ done === 1 ? '' : 's' }} to Personal.</p>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="row">
            <button class="primary" :disabled="busy || !chosen.length" @click="copy">Copy {{ chosen.length || '' }} to Personal</button>
            <button @click="$emit('close')">{{ done ? 'Done' : 'Cancel' }}</button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
<script setup>
import { onMounted, ref } from 'vue';
import { shareRequest } from '@/utils/teamClient.js';
import { kindLabel, isBundleKind } from '@/services/share/shareKinds.js';
import '@/views/_components/team/team.css';

const props = defineProps({ team: { type: Object, required: true } });
const emit = defineEmits(['close', 'copied']);
const items = ref([]), chosen = ref([]), loading = ref(true), busy = ref(false), error = ref(''), done = ref(0);
// Every kind the backend can share (it filters to its own registry); only conversations are never a team item.
onMounted(async () => {
  try { items.value = (await shareRequest('/team/' + encodeURIComponent(props.team.id) + '/items')).items.filter(item => isBundleKind(item.kind)); }
  catch (e) { error.value = e.message; } finally { loading.value = false; }
});
async function copy() {
  busy.value = true; error.value = '';
  try {
    const result = await shareRequest('/import/' + encodeURIComponent(props.team.id), { method: 'POST', body: JSON.stringify({ items: chosen.value }) });
    done.value = result.installed?.length || 0; chosen.value = [];
    emit('copied', result.installed || []);
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
</script>
<style scoped>
.copy-dialog-scrim { position: fixed; inset: 0; z-index: 3000; background: rgba(0, 0, 0, .55); display: grid; place-items: center; padding: 16px; }
.copy-dialog { width: min(520px, 100%); max-height: 90vh; height: auto; border: 1px solid var(--terminal-border-color); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .45); }
.copy-dialog header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--terminal-border-color); }
.copy-dialog header h2 { margin: 0; font-size: 17px; }
.copy-dialog .body { padding: 18px 20px; display: grid; gap: 12px; }
.copy-dialog label.check { display: flex; align-items: center; gap: 8px; flex: 1; }
.copy-dialog label.check input { width: auto; }
.copy-dialog .row { display: flex; gap: 8px; flex-wrap: wrap; }
.copy-dialog .ok { color: var(--color-green, #19ef83); }
</style>
