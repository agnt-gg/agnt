<template>
  <!-- What the AGNT Flash meter's label opens: the credits, an invite to share,
       and a follow and a star. Only ever on a click; never shown unasked.
       Teleported, so the column the meter sits in cannot clip it. -->
  <Teleport to="body">
    <div ref="panel" class="on-us" role="dialog" aria-label="AGNT Flash credits and invites" tabindex="-1" :style="placement" data-testid="on-us">
      <div class="on-us-head">
        <span class="on-us-kicker">{{ account.trial ? 'On us' : 'AGNT Flash' }}</span>
        <button type="button" class="on-us-close" aria-label="Close" data-action="close" @click="emit('close', { returnFocus: true })">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
      <div class="on-us-title">{{ title }}</div>
      <div class="on-us-meter" aria-hidden="true"><i :style="{ width: `${Math.round(share * 100)}%` }"></i></div>
      <div class="on-us-meter-label">
        <span data-testid="on-us-used">{{ usedLabel }}</span>
        <span>{{ account.trial ? 'One-time · no card' : resetLabel }}</span>
      </div>

      <section v-if="link" class="on-us-section" data-testid="on-us-invite">
        <div class="on-us-section-title">
          <svg class="on-us-line" viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.gift" /></svg>Give a friend 30 days of AGNT Pro
        </div>
        <div class="on-us-link">
          <span class="on-us-url">{{ shortLink }}</span>
          <button type="button" class="on-us-copy" :class="{ 'is-copied': copyState === 'copied' }" data-action="copy-invite" @click="copyInvite">
            <svg class="on-us-line" viewBox="0 0 24 24" aria-hidden="true"><path :d="copyState === 'copied' ? ICONS.check : ICONS.copy" /></svg>{{ copyLabel }}
          </button>
        </div>
        <div class="on-us-share">
          <span>Share on</span>
          <button type="button" aria-label="Share on X" data-action="share-x" @click="openExternal(intents.x)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.x" /></svg>
          </button>
          <button type="button" aria-label="Share on LinkedIn" data-action="share-linkedin" @click="openExternal(intents.linkedin)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.linkedin" /></svg>
          </button>
          <button type="button" aria-label="Share by email" data-action="share-email" @click="openExternal(intents.email)">
            <svg class="on-us-line" viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.mail" /></svg>
          </button>
        </div>
        <p class="on-us-note">Give a month, get a month: each friend who subscribes earns you a free month of Pro.</p>
      </section>

      <div class="on-us-foot">
        <GiveBackLinks compact :invite="false" />
        <button type="button" class="on-us-more" data-action="referrals" @click="emit('open-referrals')">Referral details</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import GiveBackLinks from '@/views/_components/feature/GiveBackLinks.vue';
import { useInviteLink } from '@/composables/useInviteLink.js';
import { formatCredits, openExternal, usedShare } from '@/services/agntFlash.js';
import { ICONS, copyToClipboard, usedPhrase } from '@/services/giveBack.js';
import { INVITE_SHARE_TEXT, shareIntents } from '@/services/referral/referralProgram.js';

const props = defineProps({
  /** The AGNT Flash account the meter shows (services/agntFlash.js). */
  account: { type: Object, required: true },
  /** The control that opened it: placed above it, and a click on it is not an outside click. */
  anchor: { default: null },
});
/** `close` carries `{ returnFocus }`: true for Escape and the close button, false for a click elsewhere, which keeps its own focus. */
const emit = defineEmits(['close', 'open-referrals']);

const panel = ref(null);
const placement = ref({});

const { link } = useInviteLink();
const intents = computed(() => (link.value ? shareIntents(link.value, INVITE_SHARE_TEXT) : null));
const shortLink = computed(() => (link.value || '').replace(/^https:\/\//, ''));

const share = computed(() => usedShare(props.account));
const title = computed(() => (props.account.trial ? 'Free AGNT Flash credits' : props.account.planName || 'Your AGNT Flash credits'));
// A free trial hears how much it has used, never a raw credit count: the meter's own rule.
const usedLabel = computed(() => {
  if (!props.account.trial) return `${formatCredits(props.account.remainingCredits)} left`;
  return share.value >= 1 ? "You've used all of them" : `You've used ${usedPhrase(props.account)}`;
});
const resetLabel = computed(() =>
  props.account.resetAt ? `Resets ${new Date(props.account.resetAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '',
);

const copyState = ref('idle'); // 'idle' | 'copied' | 'failed'
const copyLabel = computed(() => ({ copied: 'Copied', failed: "Couldn't copy" })[copyState.value] || 'Copy');
let resetTimer = null;
let live = true;

async function copyInvite() {
  if (!link.value) return;
  const copied = await copyToClipboard(link.value);
  if (!live) return;
  copyState.value = copied ? 'copied' : 'failed';
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copyState.value = 'idle';
  }, 1800);
}

// ── Placement and dismissal ────────────────────────────────────────────
const GAP_PX = 10;
const EDGE_PX = 12;
const WIDTH_PX = 372;

function place() {
  const rect = props.anchor?.getBoundingClientRect?.();
  if (!rect) return;
  const width = Math.min(WIDTH_PX, window.innerWidth - EDGE_PX * 2);
  const left = Math.min(Math.max(rect.left + rect.width / 2 - width / 2, EDGE_PX), window.innerWidth - width - EDGE_PX);
  placement.value = {
    left: `${Math.round(left)}px`,
    bottom: `${Math.round(window.innerHeight - rect.top + GAP_PX)}px`,
    width: `${Math.round(width)}px`,
  };
}
function onPointerDown(event) {
  if (panel.value?.contains(event.target) || props.anchor?.contains?.(event.target)) return;
  emit('close', { returnFocus: false });
}
function onKeydown(event) {
  if (event.key === 'Escape') emit('close', { returnFocus: true });
}

onMounted(() => {
  place();
  window.addEventListener('resize', place);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeydown);
  nextTick(() => panel.value?.focus({ preventScroll: true }));
});
onBeforeUnmount(() => {
  live = false;
  clearTimeout(resetTimer);
  window.removeEventListener('resize', place);
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
/* --color-popup is translucent in several themes: layered over the page
   background it keeps its tint without the chat ghosting through. */
.on-us {
  position: fixed;
  z-index: var(--z-index-popover, 1060);
  box-sizing: border-box;
  padding: 16px 16px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  background: linear-gradient(var(--color-popup), var(--color-popup)), var(--color-background);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06), 0 24px 48px -20px rgba(30, 30, 70, 0.38);
  color: var(--text-primary);
  font-family: var(--font-family-primary);
  font-size: 13px;
  text-align: left;
}
.on-us:focus {
  outline: none;
}
.on-us-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.on-us-kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-tertiary, var(--text-secondary));
}
.on-us-close {
  width: 26px;
  height: 26px;
  margin: -4px -6px 0 0;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--text-tertiary, var(--text-secondary));
  cursor: pointer;
}
.on-us-close:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.on-us-title {
  margin-top: 6px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.015em;
}
.on-us-meter {
  height: 6px;
  margin-top: 10px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--terminal-border-color);
}
.on-us-meter i {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--color-green);
}
.on-us-meter-label {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-tertiary, var(--text-secondary));
}
.on-us-section {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--terminal-border-color);
}
.on-us-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 600;
}
.on-us-section-title .on-us-line {
  width: 15px;
  height: 15px;
  stroke: var(--color-pink);
}
.on-us-line {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.on-us-link {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 4px 4px 4px 11px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: var(--color-darker-0);
}
.on-us-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-family-mono, monospace);
  font-size: 12px;
}
.on-us-copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: var(--text-primary);
  color: var(--color-background);
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.on-us-copy svg {
  width: 13px;
  height: 13px;
}
.on-us-copy.is-copied {
  background: var(--fill-success);
  color: var(--on-fill-success);
}
.on-us-share {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary, var(--text-secondary));
}
.on-us-share button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: none;
  color: var(--text-primary);
  cursor: pointer;
}
.on-us-share button:hover {
  border-color: var(--text-tertiary, var(--text-secondary));
}
.on-us-share svg {
  width: 13px;
  height: 13px;
  fill: currentColor;
}
.on-us-share svg.on-us-line {
  fill: none;
}
.on-us-note {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-tertiary, var(--text-secondary));
}
.on-us-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--terminal-border-color);
}
.on-us-more {
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 12px;
  color: var(--text-secondary);
  text-decoration: underline;
  text-decoration-color: var(--terminal-border-color);
  text-underline-offset: 3px;
  cursor: pointer;
}
</style>
