<template>
  <section v-if="canUpgrade" class="upgrade-offer" :class="{ compact }" aria-label="Upgrade your plan">
    <div><strong>{{ title }}</strong><p>{{ description }}</p></div>
    <button type="button" class="upgrade-offer-button" @click="open = true"><i class="fas fa-bolt" aria-hidden="true"></i> Upgrade</button>
    <UpgradeModal :open="open" @close="close" />
  </section>
</template>
<script setup>
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import UpgradeModal from './UpgradeModal.vue';
const props = defineProps({
  compact: Boolean,
  title: { type: String, default: 'Let AGNT work on your schedule' },
  description: { type: String, default: 'Upgrade to automate recurring goals and unlock paid features.' },
});
const store = useStore();
const open = ref(false);
const canUpgrade = computed(() => ['', 'free', 'community', 'trial'].includes(String(store.getters['userAuth/planType'] || '').toLowerCase()));
async function close() {
  open.value = false;
  try { await store.dispatch('userAuth/fetchSubscription', { forceRefresh: true }); }
  catch (error) { console.error('[UpgradePrompt] Unable to refresh subscription:', error); }
}
</script>
<style scoped>
.upgrade-offer { display: flex; align-items: center; gap: 18px; justify-content: space-between; border: 1px solid var(--terminal-border-color); background: var(--surface-raised); color: var(--text-primary); border-radius: 12px; padding: 20px; margin: 16px 0; }
.upgrade-offer strong { font-size: 16px; font-weight: 600; }
.upgrade-offer p { color: var(--text-secondary); font-size: 13px; line-height: 1.45; margin: 6px 0 0; }
.upgrade-offer-button { border: 0; border-radius: 8px; background: var(--fill-accent); color: var(--on-fill-accent); font: inherit; font-size: 14px; font-weight: 600; padding: 10px 15px; cursor: pointer; white-space: nowrap; }
.upgrade-offer-button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
.compact { flex-direction: column; align-items: stretch; gap: 11px; padding: 14px; margin: 12px 0; }
.compact strong { font-size: 14px; }
.compact p { font-size: 12px; }
@media(max-width:600px) { .upgrade-offer { flex-wrap: wrap; } }
</style>
