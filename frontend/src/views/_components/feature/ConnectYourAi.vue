<!-- "Connect your AI" (services/ownAi.js): shown at the top of the AI settings
     while the account has no AI of its own. Subscriptions first, an API key
     second, and AGNT Flash as a way to start that leaves the step open. -->
<template>
  <section v-if="shown" class="connect-your-ai" data-testid="connect-your-ai" aria-labelledby="connect-your-ai-title">
    <SimpleModal ref="modal" />
    <h3 id="connect-your-ai-title">{{ CONNECT_AI_TITLE }}</h3>
    <p class="cya-why">{{ CONNECT_AI_WHY }}</p>
    <div class="cya-subs">
      <button
        v-for="sub in SUBSCRIPTION_SIGN_INS"
        :key="sub.providerId"
        type="button"
        class="cya-btn"
        :data-provider="sub.providerId"
        :disabled="!!connecting"
        @click="signIn(sub.providerId)"
      >
        {{ connecting === sub.providerId ? 'Connecting…' : `Sign in with ${sub.label}` }}
      </button>
    </div>
    <div class="cya-foot">
      <button type="button" class="cya-link" data-action="api-key" @click="emit('api-key')">Use an API key instead</button>
      <button type="button" class="cya-link quiet" data-action="later" @click="later">Start with AGNT Flash for now</button>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { useProviderConnection } from '@/composables/useProviderConnection.js';
import { readFacts } from '@/composables/useJourney.js';
import { CONNECT_AI_TITLE, CONNECT_AI_WHY, SUBSCRIPTION_SIGN_INS, hasOwnAi, deferredThisSession, deferThisSession } from '@/services/ownAi.js';

const emit = defineEmits(['api-key']);
const store = useStore();
const modal = ref(null);
const { handleProviderToggle } = useProviderConnection(modal);

// Only once connected accounts are known: never flash the card at someone
// who is already connected while the list loads.
const ready = ref(false);
const deferred = ref(deferredThisSession());
const connecting = ref(null);
const shown = computed(() => ready.value && !deferred.value && !hasOwnAi(readFacts(store)));

async function signIn(providerId) {
  connecting.value = providerId;
  try {
    await handleProviderToggle(providerId);
  } finally {
    connecting.value = null;
  }
}
function later() {
  deferThisSession();
  deferred.value = true;
}
onMounted(async () => {
  try {
    await store.dispatch('appAuth/fetchConnectedApps');
  } catch (error) {
    console.warn('[ConnectYourAi] connected apps unavailable:', error?.message || error);
  } finally {
    ready.value = true;
  }
});
</script>

<style scoped>
.connect-your-ai {
  margin-bottom: 16px;
  padding: 16px 18px;
  border: 1px solid rgba(var(--green-rgb), 0.45);
  border-radius: 12px;
  background: rgba(var(--green-rgb), 0.06);
  color: var(--text-primary);
}
.connect-your-ai h3 {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
}
.cya-why {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.cya-subs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cya-btn {
  padding: 8px 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-background);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.cya-btn:hover:not(:disabled) {
  background: var(--surface-hover);
}
.cya-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.cya-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 12px;
}
.cya-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-primary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.cya-link.quiet {
  color: var(--text-secondary);
  font-weight: 400;
}
</style>
