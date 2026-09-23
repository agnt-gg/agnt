<template>
  <Teleport to="body">
    <div v-if="link" class="share-scrim" @click.self="close">
      <section class="share-sheet team-panel" role="dialog" aria-modal="true" aria-label="Add shared items">
        <header>
          <div class="title">
            <i class="fas fa-gift" aria-hidden="true"></i>
            <h2>{{ preview?.title || 'Shared with you' }}</h2>
          </div>
          <button class="icon" aria-label="Close" @click="close"><i class="fas fa-times"></i></button>
        </header>

        <div v-if="done" class="body">
          <p class="ok"><i class="fas fa-check" aria-hidden="true"></i> Added {{ done.installed.length }} item{{ done.installed.length === 1 ? '' : 's' }} to {{ destination }}.</p>
          <p>They are yours now: change and run them like anything you made.</p>
          <div class="row"><button class="primary" @click="openAdded">Open {{ kindLabel(primaryKind) }}s</button><button @click="close">Done</button></div>
        </div>

        <div v-else class="body">
          <p v-if="loading" role="status">Opening the link…</p>
          <template v-else-if="preview">
            <p><span v-if="preview.author">{{ preview.author }} shared this. </span>Adding it gives you your own copy; nothing is linked back to whoever shared it.</p>
            <ul class="rows" aria-label="What will be added">
              <li v-for="(item, index) in preview.items" :key="index">
                <div class="who"><strong>{{ item.name }}</strong><span><i :class="kindIcon(item.kind)" aria-hidden="true"></i> {{ kindLabel(item.kind) }}</span></div>
              </li>
            </ul>
            <p v-if="preview.needs.length">Uses {{ needsText(preview.needs) }}. You connect your own accounts; no one else's credentials come with it.</p>
            <p v-if="preview.removed" class="warn"><i class="fas fa-shield-alt" aria-hidden="true"></i> {{ preview.removed }} value{{ preview.removed === 1 ? ' that looked like a credential was' : 's that looked like credentials were' }} removed before adding.</p>
          </template>
          <p v-if="error" class="error" role="alert">{{ error }}</p>
          <div class="row">
            <button v-if="preview" class="primary" :disabled="busy" @click="add"><i class="fas fa-plus" aria-hidden="true"></i> {{ busy ? 'Adding…' : 'Add to ' + destination }}</button>
            <button @click="close">{{ preview ? 'Cancel' : 'Close' }}</button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>
<script setup>
/**
 * The confirmation card for a share link. Opened by `?shared=<id>` on any route
 * (that is where agnt://shared lands, see electron/deepLink.js) or by
 * openReceive(). Following a link never installs anything: the card shows what
 * the link holds, sanitized exactly as install will, and waits for a click.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { providerName } from '@/utils/teamClient.js';
import { shareState, closeReceive } from '@/composables/useShare.js';
import { kindIcon, kindLabel, kindRoute } from '@/services/share/shareKinds.js';
import { previewReceived, receive, inTeamSpace } from '@/services/share/shareClient.js';
import '@/views/_components/team/team.css';

const route = useRoute();
const router = useRouter();
const link = ref(null), preview = ref(null), done = ref(null), loading = ref(false), busy = ref(false), error = ref('');
const destination = computed(() => (inTeamSpace() ? 'this team' : 'Personal'));
const primaryKind = computed(() => {
  const kinds = (done.value?.installed || []).map(item => item.kind);
  // The item that was shared is installed last (dependencies first), so it names the screen to open.
  return kinds[kinds.length - 1] || preview.value?.items?.[0]?.kind || 'agent';
});
const needsText = needs => needs.map(n => providerName(n.provider) + (n.reason === 'model' ? ' models' : '')).join(', ');

async function open(value) {
  link.value = value; preview.value = null; done.value = null; error.value = ''; loading.value = true;
  try { preview.value = await previewReceived(value); }
  catch (e) {
    error.value = e.status === 404 ? (e.code === 'not_installable' ? 'This link is a conversation to read, not something to add. Open it in your browser.' : 'This link is no longer available. Whoever shared it may have turned it off.') : e.message;
  } finally { loading.value = false; }
}
async function add() {
  busy.value = true; error.value = '';
  try {
    done.value = await receive(link.value);
    // A received workspace lives on the server until the Workspaces page next syncs; pull it now.
    if (done.value.installed?.some(item => item.kind === 'workspace')) {
      const { useWorkspaces } = await import('@/views/Terminal/CenterPanel/screens/Workspace/useWorkspaces.js');
      await useWorkspaces().hydrateFromServer?.();
    }
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
function close() {
  link.value = null;
  closeReceive();
  if (route.query.shared !== undefined) {
    const { shared: _shared, ...query } = route.query;
    router.replace({ query }).catch(() => {});
  }
}
function openAdded() {
  const path = kindRoute(primaryKind.value);
  close();
  router.push(path).catch(() => {});
}

watch(() => route.query.shared, value => { if (typeof value === 'string' && value) open(value); }, { immediate: true });
watch(() => shareState.receiving, value => { if (value) open(value); });
</script>
<style scoped>
.share-scrim { position: fixed; inset: 0; z-index: 3000; background: rgba(0, 0, 0, .55); display: grid; place-items: center; padding: 16px; }
.share-sheet { width: min(520px, 100%); max-height: 90vh; height: auto; overflow: auto; border: 1px solid var(--terminal-border-color); border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .45); }
.share-sheet header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--terminal-border-color); }
.share-sheet .title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.share-sheet .title > i { color: var(--color-primary); }
.share-sheet header h2 { margin: 0; font-size: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.share-sheet .body { padding: 18px 20px; display: grid; gap: 12px; }
.share-sheet .row { display: flex; gap: 8px; flex-wrap: wrap; }
.share-sheet .warn { color: var(--color-yellow, #ffd700); }
.share-sheet .ok { color: var(--color-green, #19ef83); font-size: 14px; }
.share-sheet .error { padding: 10px 12px; border-radius: 6px; }
</style>
