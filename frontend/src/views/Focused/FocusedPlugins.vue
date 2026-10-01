<template>
  <FocusedConnection v-if="item" :key="item" :provider-id="item" />
  <FocusedPage v-else :title="page.title" :sub="page.sub" action-label="New plugin" v-model:query="query" search-placeholder="Search plugins" @action="nav.ask('Connect AGNT to ')">
    <p v-if="!cards.connected.length && !cards.available.length" class="focused-empty">
      {{ query ? `No plugins match “${query}”.` : 'Plugins you add show up here.' }}
    </p>
    <template v-for="section in sections" :key="section.id">
      <div v-if="section.cards.length" class="focused-section-head">
        <span>{{ section.label }}</span><span class="focused-count">{{ section.cards.length }}</span>
      </div>
      <div v-if="section.cards.length" class="focused-grid">
        <button v-for="c in section.cards" :key="c.id" type="button" class="focused-card" @click="nav.go({ page: 'plugins', item: c.id })">
          <span class="focused-card-icon" aria-hidden="true">
            <SvgIcon v-if="c.icon" :name="c.icon" />
            <template v-else>{{ initialOf(c.name) }}</template>
          </span>
          <span class="focused-row-text">
            <strong>{{ c.name }}</strong>
            <small :class="{ ok: c.connected }">{{ c.status }}</small>
          </span>
        </button>
      </div>
    </template>
  </FocusedPage>
</template>

<script setup>
import { ref, computed, inject, onMounted } from 'vue';
import { useStore } from 'vuex';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import FocusedPage from './FocusedPage.vue';
import FocusedConnection from './FocusedConnection.vue';
import { FOCUSED_PAGES, pluginCards, initialOf } from './focusedModel.js';

defineProps({ item: { type: String, default: null } });
const store = useStore();
const nav = inject('focusedNav');
const page = FOCUSED_PAGES.plugins;
const query = ref('');

const cards = computed(() => pluginCards(store.state.appAuth?.allProviders, store.getters['appAuth/connectedApps'], query.value));
const sections = computed(() => [
  { id: 'connected', label: 'Connected', cards: cards.value.connected },
  { id: 'available', label: 'Available', cards: cards.value.available },
]);

onMounted(() => {
  if (!store.state.appAuth?.allProviders?.length) store.dispatch('appAuth/fetchAllProviders').catch(() => {});
  if (!store.getters['appAuth/connectedApps']?.length) store.dispatch('appAuth/fetchConnectedApps').catch(() => {});
});
</script>
