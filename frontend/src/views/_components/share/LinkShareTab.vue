<template>
  <div class="link-share body">
    <p v-if="loading" role="status">Checking for an existing link…</p>

    <template v-else-if="link">
      <p class="ok" v-if="justCreated"><i class="fas fa-check" aria-hidden="true"></i> Link ready. Anyone with it can {{ conversation ? 'read this conversation' : 'add a copy to their AGNT' }}.</p>
      <p v-else class="muted">This {{ label }} has a live link. Anyone with it can {{ conversation ? 'read it' : 'add a copy' }}.</p>
      <div class="link-row">
        <input :value="link.url" readonly aria-label="Share link" @focus="$event.target.select()" />
        <button class="primary" @click="copyLink"><i :class="copied ? 'fas fa-check' : 'fas fa-copy'" aria-hidden="true"></i> {{ copied ? 'Copied' : 'Copy' }}</button>
      </div>
      <p v-if="link.stale" class="warn"><i class="fas fa-history" aria-hidden="true"></i> Changed since this link was made. People with it get the earlier version.</p>
      <p v-if="created?.removed" class="warn"><i class="fas fa-shield-alt" aria-hidden="true"></i> {{ created.removed }} value{{ created.removed === 1 ? ' that looked like a credential or a file on this computer was' : 's that looked like credentials or files on this computer were' }} left out.</p>
      <p class="muted offer"><i class="fas fa-gift" aria-hidden="true"></i> Anyone new who joins through this link gets their first month of AGNT Cloud free, and it counts toward your referral rewards.</p>
      <div class="row">
        <a class="btn" :href="intents.x" target="_blank" rel="noopener noreferrer" @click.prevent="openExternal(intents.x)"><i class="fas fa-share-alt" aria-hidden="true"></i> Post on X</a>
        <a class="btn" :href="intents.linkedin" target="_blank" rel="noopener noreferrer" @click.prevent="openExternal(intents.linkedin)"><i class="fas fa-share-alt" aria-hidden="true"></i> LinkedIn</a>
      </div>
      <div class="row">
        <a class="btn" :href="link.url" target="_blank" rel="noopener noreferrer"><i class="fas fa-external-link-alt" aria-hidden="true"></i> Open page</a>
        <button v-if="link.stale" :disabled="busy" @click="create">Make a new link</button>
        <button v-if="canRevoke" class="danger" :disabled="busy" @click="revoke">Turn off link</button>
      </div>
    </template>

    <template v-else>
      <p class="muted" v-if="conversation">Anyone with the link can read this conversation. Only the words are shared: tool calls, files and images are left out, and anything that looks like a credential is removed.</p>
      <p class="muted" v-else>Anyone with the link can add their own copy of this {{ label }} to AGNT. It is not listed anywhere, and your credentials and files are never included.</p>
      <template v-if="!conversation && canPreview">
        <label class="check"><input v-model="includeDependencies" type="checkbox" @change="loadPreview" /> Include what it uses</label>
        <p v-if="previewing" role="status">Checking what goes in the link…</p>
        <template v-else-if="preview">
          <ul class="rows" aria-label="What the link contains">
            <li v-for="item in preview.items" :key="item.kind + item.id">
              <div class="who"><strong>{{ item.name }}</strong><span>{{ kindLabel(item.kind) }}{{ item.dependency ? ' · used by ' + name : '' }}</span></div>
            </li>
          </ul>
          <p v-if="preview.needs.length">Uses {{ needsText(preview.needs) }}. Whoever adds it connects their own.</p>
          <p v-if="preview.removed" class="warn"><i class="fas fa-shield-alt" aria-hidden="true"></i> {{ preview.removed }} value{{ preview.removed === 1 ? ' that looked like a credential or a file on this computer' : 's that looked like credentials or files on this computer' }} will be left out.</p>
        </template>
      </template>
      <div class="row">
        <button class="primary" :disabled="busy || previewing" @click="create"><i class="fas fa-link" aria-hidden="true"></i> {{ busy ? 'Creating link…' : 'Create link' }}</button>
        <button @click="$emit('close')">Cancel</button>
      </div>
    </template>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>
<script setup>
import { computed, onMounted, ref } from 'vue';
import { providerName } from '@/utils/teamClient.js';
import { kindLabel, isBundleKind } from '@/services/share/shareKinds.js';
import { createLink, listLinks, previewItem, revokeLink, inTeamSpace } from '@/services/share/shareClient.js';
import { shareIntents } from '@/services/referral/referralProgram.js';
import '@/views/_components/team/team.css';

const props = defineProps({
  kind: { type: String, required: true },
  id: { type: [String, Number], required: true },
  name: { type: String, default: 'This item' },
});
defineEmits(['close']);
const conversation = computed(() => !isBundleKind(props.kind));
const label = computed(() => kindLabel(props.kind).toLowerCase());
// Links from inside a team project are the team's; only your own personal links are tracked, so only they can be turned off here.
const canRevoke = computed(() => conversation.value || !inTeamSpace());
const canPreview = computed(() => !inTeamSpace());
const loading = ref(true), previewing = ref(false), busy = ref(false), error = ref(''), copied = ref(false), justCreated = ref(false);
const link = ref(null), created = ref(null), preview = ref(null), includeDependencies = ref(true);
const needsText = needs => needs.map(n => providerName(n.provider) + (n.reason === 'model' ? ' models' : '')).join(', ');
const target = () => ({ kind: props.kind, id: String(props.id), includeDependencies: includeDependencies.value });
const intents = computed(() => shareIntents(link.value?.url || '', conversation.value
  ? `A conversation I had with AGNT: ${props.name}`
  : `I built "${props.name}" with AGNT. Add a copy to yours:`));
function openExternal(url) {
  if (window.electron?.openExternalUrl) window.electron.openExternalUrl(url);
  else window.open(url, '_blank', 'noopener');
}

async function loadPreview() {
  previewing.value = true; error.value = '';
  try { preview.value = await previewItem(target()); } catch (e) { preview.value = null; error.value = e.message; } finally { previewing.value = false; }
}
async function load() {
  try { link.value = (await listLinks(target()))[0] || null; } catch (e) { console.warn('[Share] links:', e.message); link.value = null; }
  finally { loading.value = false; }
  if (!link.value && !conversation.value && canPreview.value) await loadPreview();
}
async function create() {
  busy.value = true; error.value = '';
  try {
    created.value = await createLink(target());
    link.value = { id: created.value.id, url: created.value.url, stale: false };
    justCreated.value = true;
    await copyLink();
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function copyLink() {
  if (!link.value?.url) return;
  try { await navigator.clipboard.writeText(link.value.url); copied.value = true; setTimeout(() => { copied.value = false; }, 2000); } catch { /* the field stays selectable */ }
}
async function revoke() {
  busy.value = true; error.value = '';
  try { await revokeLink(link.value.id); link.value = null; created.value = null; justCreated.value = false; if (!conversation.value && canPreview.value) await loadPreview(); }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
onMounted(load);
</script>
<style scoped>
.link-share { display: grid; gap: 12px; }
.link-share label.check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-muted); }
.link-share label.check input { width: auto; }
.link-share .row { display: flex; gap: 8px; flex-wrap: wrap; }
.link-row { display: flex; gap: 8px; }
.link-row input { flex: 1; min-width: 0; font-family: var(--font-family-mono, monospace); font-size: 12px; }
/* An anchor dressed as the dialog's buttons (team.css styles <button> only). */
.link-share .btn { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; font: inherit; color: var(--color-text); border: 1px solid var(--terminal-border-color); border-radius: 6px; background: var(--color-darker-0); padding: 8px 10px; }
.link-share .btn:hover { color: var(--color-primary); border-color: rgba(var(--primary-rgb), .35); }
.link-share .warn { color: var(--color-yellow, #ffd700); }
.link-share .ok { color: var(--color-green, #19ef83); font-size: 14px; }
.link-share .error { padding: 10px 12px; border-radius: 6px; }
</style>
