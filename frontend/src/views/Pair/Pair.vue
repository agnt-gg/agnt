<template>
  <div class="pair-screen">
    <div class="pair-card">
      <div class="pair-mark">
        <i class="fas" :class="iconClass"></i>
      </div>

      <h1 class="pair-title">{{ title }}</h1>
      <p class="pair-msg">{{ message }}</p>

      <button v-if="state === 'error'" class="pair-btn" @click="goHome">Continue to AGNT</button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';
import pairingService from '@/services/pairingService.js';
import { setMediaCookie } from '@/services/mediaAuth.js';

const route = useRoute();
const router = useRouter();
const store = useStore();

const state = ref('working'); // working | done | error
const message = ref('Verifying your pairing code…');

const title = computed(() =>
  state.value === 'done' ? 'Paired' : state.value === 'error' ? "Couldn't pair" : 'Pairing…'
);
const iconClass = computed(() =>
  state.value === 'done' ? 'fa-circle-check' : state.value === 'error' ? 'fa-circle-exclamation' : 'fa-spinner fa-spin'
);

const goHome = () => router.replace('/chat');

onMounted(async () => {
  const code = String(route.query.c || '').trim();
  if (!/^[a-f0-9]{32}$/.test(code)) {
    state.value = 'error';
    message.value = 'That pairing link is malformed. Generate a new code on your desktop.';
    return;
  }

  try {
    const res = await pairingService.claimCode(code);
    if (!res?.token) throw new Error('No token returned');

    // Same path a normal sign-in takes, so every downstream store stays in sync.
    store.commit('userAuth/SET_TOKEN', res.token);
    setMediaCookie(res.token);
    await store.dispatch('userAuth/fetchUserData', { forceRefresh: true });

    state.value = 'done';
    message.value = 'Signed in. Taking you to your chats…';
    // Replace, never push: the code is spent, so the back button must not
    // return to a URL that will now fail.
    setTimeout(() => router.replace('/chat'), 900);
  } catch (e) {
    state.value = 'error';
    const status = e?.response?.status;
    message.value =
      status === 404
        ? 'That code was already used or has expired. Generate a new one on your desktop.'
        : status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : e?.response?.data?.error || 'Pairing failed. Generate a new code on your desktop.';
  }
});
</script>

<style scoped>
.pair-screen {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  padding-top: max(24px, env(safe-area-inset-top));
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  background: var(--color-background, #12121c);
  box-sizing: border-box;
}

.pair-card {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  padding: 32px 24px;
  border-radius: 16px;
  background: var(--color-darker-1, #1b1b2b);
  border: 1px solid var(--color-dull-navy, #2e3350);
}

.pair-mark {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  background: color-mix(in srgb, var(--color-primary, #19ef83) 15%, transparent);
  color: var(--color-primary, #19ef83);
}

.pair-title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  color: var(--color-text, #e0e0e0);
}

.pair-msg {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-light-med-navy, #8b93a7);
}

.pair-btn {
  min-height: 44px;
  padding: 12px 24px;
  border-radius: 10px;
  border: none;
  background: var(--color-primary, #19ef83);
  color: #04120a;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
</style>
