<template>
  <div class="ml-pair">
    <div class="ml-card">
      <div class="ml-icon"><i class="fas" :class="iconClass"></i></div>
      <h1>{{ title }}</h1>
      <p>{{ message }}</p>
      <button v-if="state === 'error'" class="ml-btn" @click="goHome">Back to AGNT Chat</button>
    </div>
  </div>
</template>

<script setup>
/**
 * Lite pairing landing: /m/pair?c=<code>
 * Claims via POST /api/pairing/claim (no Vue full-app /pair UI).
 * Full web AGNT continues to use /pair.
 */
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useStore } from 'vuex';
import {
  claimPairingCodeAt,
  rememberServerOrigin,
  applyPairingSession,
} from '@/services/mobileLitePairing.js';

const route = useRoute();
const router = useRouter();
const store = useStore();

const state = ref('working'); // working | done | error
const message = ref('Verifying your pairing code…');

const title = computed(() =>
  state.value === 'done' ? 'Paired' : state.value === 'error' ? "Couldn't pair" : 'Pairing…'
);
const iconClass = computed(() =>
  state.value === 'done'
    ? 'fa-check-circle'
    : state.value === 'error'
      ? 'fa-exclamation-circle'
      : 'fa-spinner fa-spin'
);

const goHome = () => router.replace({ name: 'MobileHome' });

onMounted(async () => {
  const code = String(route.query.c || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(code)) {
    state.value = 'error';
    message.value = 'That pairing link is malformed. Generate a new code on your desktop.';
    return;
  }

  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
    const res = await claimPairingCodeAt(code, { origin });
    if (origin) rememberServerOrigin(origin);
    await applyPairingSession(store, res);

    state.value = 'done';
    message.value = 'Signed in. Opening Annie…';
    // Hard navigation — router.replace alone is unreliable in Capacitor WKWebView.
    setTimeout(() => {
      const o = typeof window !== 'undefined' ? window.location.origin : '';
      window.location.replace(`${o}/m/chat?_ts=${Date.now()}`);
    }, 400);
  } catch (e) {
    state.value = 'error';
    const status = e?.response?.status;
    message.value =
      status === 404
        ? 'That code was already used or has expired. Generate a new one on your desktop.'
        : status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : e?.message || e?.response?.data?.error || 'Pairing failed. Generate a new code on your desktop.';
  }
});
</script>

<style scoped>
.ml-pair {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  padding-top: max(24px, env(safe-area-inset-top));
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  background: #12121c;
  box-sizing: border-box;
}
.ml-card {
  width: 100%;
  max-width: 380px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 32px 24px;
  border-radius: 16px;
  background: #1b1b2b;
  border: 1px solid #2e3350;
  color: #e8e8f0;
}
.ml-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  background: color-mix(in srgb, #19ef83 15%, transparent);
  color: #19ef83;
}
.ml-card h1 {
  margin: 0;
  font-size: 22px;
}
.ml-card p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: #8b93a7;
}
.ml-btn {
  min-height: 44px;
  padding: 12px 24px;
  border: none;
  border-radius: 10px;
  background: #19ef83;
  color: #04120a;
  font-weight: 600;
  font-size: 15px;
  font-family: inherit;
  cursor: pointer;
}
</style>
