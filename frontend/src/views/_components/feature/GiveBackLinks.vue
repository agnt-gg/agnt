<!-- Follow AGNT on X, star it on GitHub, copy an invite: three plain links.
     None of them is rewarded or checked (services/giveBack.js). The default
     slot sits at the end of the row, for a caller's own "Not now". -->
<template>
  <div class="gbl" :class="{ 'gbl--compact': compact }" data-testid="give-back">
    <div class="gbl-actions">
      <button type="button" class="gbl-btn" data-action="follow-x" @click="openExternal(X_FOLLOW_URL)">
        <svg class="gbl-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.x" /></svg>Follow @{{ X_HANDLE }}
      </button>
      <button type="button" class="gbl-btn" data-action="star-github" @click="openExternal(GITHUB_REPO_URL)">
        <svg class="gbl-icon gbl-icon--star" viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.star" /></svg>{{ compact ? 'Star' : 'Star on GitHub' }}
        <span v-if="stars" class="gbl-count" data-testid="give-back-stars">{{ stars }}</span>
      </button>
      <button
        v-if="invite && link"
        type="button"
        class="gbl-btn gbl-btn--invite"
        :class="{ 'is-copied': copyState === 'copied' }"
        data-action="copy-invite"
        @click="copyInvite"
      >
        <svg class="gbl-icon gbl-icon--line" viewBox="0 0 24 24" aria-hidden="true"><path :d="copyState === 'copied' ? ICONS.check : ICONS.copy" /></svg>{{ copyLabel }}
      </button>
      <slot />
    </div>
    <p v-if="terms && invite && link" class="gbl-terms" data-testid="give-back-terms">{{ INVITE_TERMS }}</p>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useInviteLink } from '@/composables/useInviteLink.js';
import { openExternal } from '@/services/agntFlash.js';
import { GITHUB_REPO_URL, ICONS, X_FOLLOW_URL, X_HANDLE, copyToClipboard, fetchStarCount, formatStarCount } from '@/services/giveBack.js';
import { INVITE_TERMS } from '@/services/referral/referralProgram.js';

defineProps({
  /** Small buttons, for a card inside a conversation. */
  compact: { type: Boolean, default: false },
  /** Offer the invite link. Off where the invite is already shown on its own. */
  invite: { type: Boolean, default: true },
  /** Say under the buttons what an invite gives and earns. */
  terms: { type: Boolean, default: false },
});

const { link } = useInviteLink();
const stars = ref('');
const copyState = ref('idle'); // 'idle' | 'copied' | 'failed'
const copyLabel = computed(() => ({ copied: 'Copied', failed: "Couldn't copy" })[copyState.value] || 'Copy invite link');

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

onMounted(async () => {
  const count = await fetchStarCount();
  if (live) stars.value = formatStarCount(count);
});
onBeforeUnmount(() => {
  live = false;
  clearTimeout(resetTimer);
});
</script>

<style scoped>
/* Theme tokens only: these buttons render in every theme. */
.gbl {
  min-width: 0;
}
.gbl-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.gbl-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: var(--color-darker-0);
  color: var(--text-primary);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.gbl-btn:hover {
  border-color: var(--text-tertiary, var(--text-secondary));
  background: var(--surface-hover);
}
.gbl-btn:focus-visible {
  outline: 2px solid var(--color-pink);
  outline-offset: 2px;
}
.gbl-icon {
  width: 14px;
  height: 14px;
  flex: none;
  fill: currentColor;
}
/* GitHub's own star gold: the button reads as GitHub's at a glance. */
.gbl-icon--star {
  fill: #e3b341;
}
.gbl-icon--line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.gbl-count {
  margin-left: 2px;
  padding-left: 8px;
  border-left: 1px solid var(--terminal-border-color);
  font-weight: 500;
  color: var(--text-tertiary, var(--text-secondary));
}
.gbl-btn--invite {
  border-color: rgba(var(--pink-rgb), 0.45);
}
.gbl-btn--invite .gbl-icon {
  color: var(--color-pink);
}
.gbl-btn.is-copied {
  border-color: rgba(var(--green-rgb), 0.8);
  background: rgba(var(--green-rgb), 0.08);
}
.gbl-btn.is-copied .gbl-icon {
  color: var(--status-green-text);
}
.gbl--compact .gbl-actions {
  gap: 6px;
}
.gbl--compact .gbl-btn {
  gap: 7px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12.5px;
}
.gbl-terms {
  margin: 10px 0 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text-tertiary, var(--text-secondary));
}
</style>
