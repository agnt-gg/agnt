<template>
  <!-- The approved mockup's Library: Agents & skills, Connections, Templates.
       Backed by the real Market catalog and the real apps catalog. -->
  <div class="content">
    <div class="page">
      <div class="page-head"><div><h1>Library</h1><p>Agents, connections and templates your team has published, plus AGNT’s. Add to My Space to make your own copy.</p></div></div>
      <nav class="tabs" aria-label="Library">
        <button v-for="t in TABS" :key="t.id" type="button" class="tab" :class="{ 'is-active': tab === t.id }" @click="ctx.go({ view: 'library', tab: t.id })"><MkIcon :name="t.icon" size="sm" />{{ t.label }}</button>
      </nav>
      <template v-if="tab === 'connections'">
        <div class="banner"><MkIcon name="plug" size="sm" /><span>Connections follow scope: <b>yours</b> power your private agents and routines, <b>team</b> connections power everything in teamspaces. Nobody sees anyone else’s keys.</span></div>
        <AppsSection />
      </template>
      <template v-else>
        <p v-if="status === 'loading' && !items.length" class="empty">Loading…</p>
        <p v-else-if="!listed.length" class="empty">{{ status === 'error' ? 'The catalog could not load. Try again in a moment.' : 'Nothing here yet.' }}</p>
        <div v-else class="cards">
          <div v-for="l in listed" :key="l.id" class="card">
            <div class="card-top">
              <span v-if="tab === 'agents'" class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span>
              <span v-else class="r-icon"><MkIcon :name="l.asset_type === 'workflow' ? 'bolt' : 'template'" size="sm" /></span>
              <div style="min-width: 0"><h4>{{ l.title }}</h4><div class="mk-muted">{{ l.creator_name || l.author || 'AGNT' }}</div></div>
            </div>
            <p class="mk-clamp2">{{ l.description || '' }}</p>
            <div class="row-gap"><span class="tag">{{ typeLabel(l) }}</span><span v-if="Number(l.price) > 0" class="tag">${{ Number(l.price).toFixed(2) }}</span></div>
            <div class="card-foot lib-foot">
              <button type="button" class="primary" style="min-height: 30px" :disabled="busy || isInstalled(l)" @click="install(l)">{{ installingId === l.id ? 'Adding…' : isInstalled(l) ? 'Added' : tab === 'templates' ? 'Use template' : 'Add to My Space' }}</button>
            </div>
          </div>
        </div>
        <p v-if="installError" class="mk-error" role="alert" style="margin-top: 12px">{{ installError }}</p>
      </template>
    </div>
    <SimpleModal ref="modalRef" />
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import MkIcon from './MkIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import AppsSection from '@/views/Terminal/CenterPanel/screens/Connectors/components/AppsSection.vue';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import { assetTypeLabel } from '@/composables/useMarketplaceCard';

const TABS = [{ id: 'agents', label: 'Agents & skills', icon: 'bot' }, { id: 'connections', label: 'Connections', icon: 'plug' }, { id: 'templates', label: 'Templates', icon: 'template' }];
const props = defineProps({ tab: { type: String, default: 'agents' } });
const ctx = inject('teamCtx');
const store = useStore();
const modalRef = ref(null);
const { handleInstall } = useMarketplaceInstall(modalRef);
const installingId = ref(null);
const installError = ref('');
const installedHere = ref(new Set());

const items = computed(() => store.getters['marketplace/shelfItems'] || []);
const status = computed(() => store.getters['marketplace/shelfStatus']);
const listed = computed(() => items.value.filter((l) => (props.tab === 'templates' ? l.asset_type === 'workflow' : ['agent', 'skill'].includes(l.asset_type))));
const busy = computed(() => installingId.value !== null);
const typeLabel = (l) => assetTypeLabel(l);
const isInstalled = (l) => installedHere.value.has(String(l.id)) || (store.state.marketplace?.myInstalls || []).some((owned) => String(owned.marketplace_item_id || owned.id) === String(l.id));

async function install(l) {
  if (busy.value || isInstalled(l)) return;
  installingId.value = l.id;
  installError.value = '';
  try {
    const result = await handleInstall({ ...l, price: Number(l.price) || 0 });
    if (result?.success) {
      installedHere.value = new Set([...installedHere.value, String(l.id)]);
      ctx.toast(`${l.title} added to My Space`);
    } else if (result?.error) installError.value = result.error;
  } catch (e) {
    installError.value = e.message || 'Could not add it. Please try again.';
  } finally {
    installingId.value = null;
  }
}
onMounted(() => {
  store.dispatch('marketplace/fetchShelfItems', {});
  store.dispatch('marketplace/fetchMyInstalls');
});
</script>
