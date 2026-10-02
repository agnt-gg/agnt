<template>
  <section class="focused-page" :aria-label="page.title">
    <header class="focused-page-head">
      <div>
        <h1>{{ page.title }}</h1>
        <p>{{ page.sub }}</p>
      </div>
    </header>

    <UiModeSetting />

    <section class="focused-edit-block">
      <div class="focused-edit-block-head"><h3>Appearance</h3></div>
      <div class="focused-edit-card">
        <div class="focused-edit-row">
          <span class="focused-edit-label">Theme</span>
          <CustomSelect :model-value="currentTheme" :options="themeOptions" @update:model-value="setTheme" />
        </div>
      </div>
    </section>

    <section class="focused-edit-block">
      <div class="focused-edit-block-head">
        <h3>Default model</h3>
        <span class="focused-edit-hint">What AGNT uses unless a chat or an agent picks another.</span>
      </div>
      <div class="focused-edit-card">
        <div class="focused-edit-row">
          <span class="focused-edit-label">Model</span>
          <div class="focused-edit-pair">
            <CustomSelect
              :model-value="provider"
              placeholder="Choose a provider"
              :options="providerOptions.map((p) => ({ label: p, value: p }))"
              @update:model-value="setProvider"
            />
            <CustomSelect
              v-if="provider"
              :model-value="model"
              placeholder="Choose a model"
              :options="modelOptions.map((m) => ({ label: m, value: m }))"
              :disabled="switching"
              @update:model-value="setModel"
            />
          </div>
        </div>
      </div>
    </section>

    <section class="focused-edit-block">
      <div class="focused-edit-block-head"><h3>Account</h3></div>
      <div class="focused-edit-card">
        <div class="focused-edit-row"><span class="focused-edit-label">Name</span><span>{{ userName || '—' }}</span></div>
        <div class="focused-edit-row"><span class="focused-edit-label">Email</span><span>{{ userEmail || '—' }}</span></div>
        <div class="focused-edit-row"><span class="focused-edit-label">Plan</span><span>{{ plan }}</span></div>
        <div class="focused-edit-row">
          <span class="focused-edit-label">Session</span>
          <button type="button" class="focused-btn" @click="logOut"><i class="fas fa-sign-out-alt" aria-hidden="true"></i>Log out</button>
        </div>
      </div>
    </section>

    <div class="focused-form-foot">
      <span class="focused-edit-hint">API keys, billing, sounds, security and everything else:</span>
      <span class="focused-flex"></span>
      <button type="button" class="focused-btn" @click="nav.studio('SettingsScreen')">All settings</button>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, inject } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import UiModeSetting from './UiModeSetting.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { FOCUSED_PAGES } from './focusedModel.js';
import { SUPPORTED_THEMES } from '@/store/app/theme.js';

const store = useStore();
const router = useRouter();
const nav = inject('focusedNav');

// The same sign-out Studio's Settings uses (LoginSection.logout).
function logOut() {
  store.dispatch('userAuth/logout');
  router.push('/');
}
const page = FOCUSED_PAGES.settings;

const themeOptions = SUPPORTED_THEMES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }));
const currentTheme = computed(() => store.getters['theme/currentTheme']);
const setTheme = (t) => store.dispatch('theme/setTheme', t);

const provider = computed(() => store.state.aiProvider?.selectedProvider || '');
const model = computed(() => store.state.aiProvider?.selectedModel || '');
const providerOptions = computed(() => {
  const list = (store.getters['aiProvider/filteredProviders'] || []).map((p) => (typeof p === 'string' ? p : p.name || p.id));
  return provider.value && !list.includes(provider.value) ? [provider.value, ...list] : list;
});
const modelOptions = computed(() => {
  const ids = (store.state.aiProvider?.allModels?.[provider.value] || []).map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  return model.value && !ids.includes(model.value) ? [model.value, ...ids] : ids;
});
const switching = ref(false);
async function setProvider(p) {
  if (!p) return;
  switching.value = true;
  try {
    // Loads the provider's models, sets it, then keeps the model valid.
    await store.dispatch('aiProvider/setProviderWithModelFetch', p);
    nav.toast(`Default model: ${p}.`);
  } catch (e) {
    nav.toast('Couldn’t change it. ' + (e?.message || e));
  } finally {
    switching.value = false;
  }
}
async function setModel(m) {
  await store.dispatch('aiProvider/setModel', m);
  nav.toast(`Default model: ${m}.`);
}

const userName = computed(() => store.getters['userAuth/userName']);
const userEmail = computed(() => store.getters['userAuth/userEmail']);
const plan = computed(() => {
  const p = String(store.getters['userAuth/planType'] || '').trim();
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Free';
});
</script>
