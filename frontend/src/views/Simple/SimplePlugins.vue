<template>
  <SimplePage :title="page.title" :sub="page.sub" action-label="New plugin" v-model:query="query" search-placeholder="Search plugins" @action="openConnectors">
    <p v-if="!cards.connected.length && !cards.available.length" class="simple-empty">
      {{ query ? `No plugins match “${query}”.` : 'Plugins you add show up here.' }}
    </p>
    <template v-for="section in sections" :key="section.id">
      <div v-if="section.cards.length" class="simple-section-head">
        <span>{{ section.label }}</span><span class="simple-count">{{ section.cards.length }}</span>
      </div>
      <div v-if="section.cards.length" class="simple-grid">
        <button v-for="c in section.cards" :key="c.id" type="button" class="simple-card" @click="openConnectors">
          <span class="simple-card-icon" aria-hidden="true">
            <!-- Provider icons are names in the shared icon set, drawn exactly as
                 Studio's Connectors draws them. -->
            <SvgIcon v-if="c.icon" :name="c.icon" />
            <template v-else>{{ initialOf(c.name) }}</template>
          </span>
          <span class="simple-row-text">
            <strong>{{ c.name }}</strong>
            <small :class="{ ok: c.connected }">{{ c.status }}</small>
          </span>
        </button>
      </div>
    </template>
  </SimplePage>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimplePage from './SimplePage.vue';
import { SIMPLE_PAGES, pluginCards, initialOf } from './simpleModel.js';

const emit = defineEmits(['run', 'ask']);
const store = useStore();
const page = SIMPLE_PAGES.plugins;
const query = ref('');

const cards = computed(() => pluginCards(store.state.appAuth?.allProviders, store.getters['appAuth/connectedApps'], query.value));
const sections = computed(() => [
  { id: 'connected', label: 'Connected', cards: cards.value.connected },
  { id: 'available', label: 'Available', cards: cards.value.available },
]);


// Connecting is OAuth / key entry with real consequences; it happens on the
// one screen that already does it properly, not in a copy of it.
function openConnectors() {
  emit('run', { type: 'screen', screen: 'ConnectorsScreen', opts: {} });
}

onMounted(() => {
  if (!store.state.appAuth?.allProviders?.length) store.dispatch('appAuth/fetchAllProviders').catch(() => {});
  if (!store.getters['appAuth/connectedApps']?.length) store.dispatch('appAuth/fetchConnectedApps').catch(() => {});
});
</script>
