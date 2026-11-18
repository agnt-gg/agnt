<template>
  <aside class="mk one-offer" :class="{ 'is-compact': compact }" :aria-label="`${offer.eyebrow} offer`" data-testid="one-offer">
    <!-- The offer card, bottom left beside the rail. Closing it leaves the rail's
         offer button, which opens it again until the offer ends. -->
    <button type="button" class="offer-x" aria-label="Hide this offer" @click="$emit('dismiss')"><MkIcon name="x" size="sm" /></button>
    <div class="offer-eyebrow">{{ offer.eyebrow }}</div>
    <div class="offer-title">{{ offer.title }}</div>
    <div class="offer-body">
      {{ offer.body }}
      <button type="button" class="offer-code" :aria-label="`Copy code ${offer.code}`" @click="copyCode">{{ copied ? 'Copied' : offer.code }}</button>
      {{ offer.afterCode }}
    </div>
    <div class="offer-time">Ends {{ endsOn }} &middot; {{ timeLeft }}</div>
    <button type="button" class="offer-cta" data-testid="one-offer-cta" @click="upgradeOpen = true">Get the deal</button>
    <UpgradeModal :open="upgradeOpen" :suggest="suggest" preset-yearly :preset-code="offer.code" :note="note" @close="upgradeOpen = false" />
  </aside>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { useStore } from 'vuex';
import MkIcon from './mk/MkIcon.vue';
import UpgradeModal from '@/components/UpgradeModal.vue';
import { offerEndsOn, offerTimeLeft } from './offer.js';

const props = defineProps({
  offer: { type: Object, required: true },
  now: { type: Number, required: true },
  /** A phone: no rail, so the card sits along the bottom. */
  compact: { type: Boolean, default: false },
});
defineEmits(['dismiss']);

const store = useStore();
const upgradeOpen = ref(false);
const copied = ref(false);
let copiedTimer = null;

const endsOn = computed(() => offerEndsOn(props.offer));
const timeLeft = computed(() => offerTimeLeft(props.offer, props.now));
const planType = computed(() => store.state.userAuth?.planType || 'free');
// A plan billed monthly opens on itself: annual ticked, the code filled in.
const suggest = computed(() => (planType.value === 'free' ? 'personal' : planType.value));
// A new yearly subscription carries the code to Stripe's checkout page
// (userAuth createSubscription), so there is nothing to type.
const note = computed(() => (planType.value === 'free' ? `${props.offer.code} is applied at checkout: ${props.offer.title}.` : ''));

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.offer.code);
  } catch {
    return; // no clipboard: the code is still on the card to read
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 1500);
}
onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

<style scoped>
.one-offer {
  position: fixed;
  left: 72px;
  bottom: 16px;
  z-index: 40;
  width: 258px;
  box-sizing: border-box;
  padding: 16px 16px 14px;
  border-radius: 14px;
  background: radial-gradient(140% 120% at 100% 0%, rgba(var(--pink-rgb), 0.24), transparent 58%), var(--color-popup);
  border: 1px solid rgba(var(--pink-rgb), 0.45);
  color: var(--text-primary);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5), 0 0 36px rgba(var(--pink-rgb), 0.14);
  font-family: var(--font-family-primary, system-ui);
}
.one-offer.is-compact { left: 12px; right: 12px; bottom: 12px; width: auto; }
.offer-x { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.offer-x:hover { background: var(--surface-hover); color: var(--text-primary); }
.offer-eyebrow { font: 600 10.5px/1 var(--font-family-mono, ui-monospace), monospace; letter-spacing: 0.2em; text-transform: uppercase; color: var(--color-pink); }
.offer-title { margin: 9px 28px 7px 0; font-size: 22px; font-weight: 800; line-height: 1.08; color: var(--text-primary); }
.offer-body { font-size: 13.5px; line-height: 1.75; color: var(--text-secondary); }
.offer-code { display: inline-block; padding: 3px 9px; border: 1px dashed rgba(var(--pink-rgb), 0.85); border-radius: 6px; background: rgba(var(--pink-rgb), 0.1); color: var(--color-pink); font: 600 12px/1.3 var(--font-family-mono, ui-monospace), monospace; letter-spacing: 0.05em; cursor: copy; }
.offer-time { margin-top: 6px; font-size: 12.5px; color: var(--text-tertiary); }
.offer-cta { margin-top: 12px; width: 100%; height: 34px; border: 0; border-radius: 8px; background: var(--color-pink); color: var(--on-fill-brand); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.offer-cta:hover { filter: brightness(1.08); }
</style>
