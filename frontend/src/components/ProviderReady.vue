<template>
  <!-- The onboarding provider step when there is nothing to decide, or one
       thing to decide. The first-run default has already been chosen by the
       store (a subscription found on this machine, else AGNT Flash), so this
       shows that choice as a fact. The full list is ProviderLanes, one
       "more options" away. -->
  <div class="provider-ready">
    <!-- Checking: the connection list or the first-run pick is not in yet. -->
    <div v-if="mode === 'checking'" class="pr-skeleton" aria-busy="true" aria-label="Checking for an AI on this computer"></div>

    <!-- Several subscriptions found: one question, the store's pick already checked. -->
    <div v-else-if="mode === 'choose'" class="pr-list" role="radiogroup" aria-label="AI to use">
      <button
        v-for="provider in detected"
        :key="provider.id"
        type="button"
        role="radio"
        class="pr-row pr-option"
        :class="{ picked: isActive(provider) }"
        :aria-checked="isActive(provider)"
        @click="$emit('connect', provider)"
      >
        <span class="pr-mark"><SvgIcon :name="provider.icon" /></span>
        <span class="pr-meta">
          <span class="pr-name">{{ label(provider) }}</span>
          <span class="pr-sub">Signed in</span>
        </span>
        <span class="pr-radio" aria-hidden="true"></span>
      </button>
    </div>

    <!-- One AI in use: a status, not a control. -->
    <template v-else>
      <div class="pr-row pr-status" data-testid="provider-in-use">
        <span class="pr-mark" :class="{ agnt: activeIsAgnt }">
          <!-- The lightning mark, as on the onboarding step: the AGNT logo
               is unreadable at icon size. -->
          <svg v-if="activeIsAgnt" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h8l-1 8 11-13h-8l1-7z" /></svg>
          <SvgIcon v-else-if="activeRecord" :name="activeRecord.icon" />
        </span>
        <span class="pr-meta">
          <span class="pr-name">{{ activeLabel }}</span>
          <span class="pr-sub">{{ activeSub }}</span>
        </span>
        <span class="pr-state">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          In use
        </span>
      </div>

      <!-- On AGNT Flash, a subscription the user already pays for is the
           obvious upgrade, so it is offered here rather than behind a link. -->
      <template v-if="activeIsAgnt && offers.length">
        <p class="pr-divider">Already pay for one? Use it instead</p>
        <div class="pr-grid">
          <button
            v-for="provider in offers"
            :key="provider.id"
            type="button"
            class="pr-row pr-tile"
            :aria-label="`Sign in to ${label(provider)}`"
            @click="$emit('connect', provider)"
          >
            <span class="pr-mark small"><SvgIcon :name="provider.icon" /></span>
            <span class="pr-name">{{ label(provider) }}</span>
            <span class="pr-go" aria-hidden="true">→</span>
          </button>
        </div>
      </template>
    </template>

    <button v-if="mode !== 'checking'" type="button" class="pr-link" @click="$emit('more')">
      {{ mode === 'ready' && !activeIsAgnt ? 'Use a different AI' : 'More options' }} →
    </button>
  </div>
</template>

<script>
import { computed } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import {
  FIRST_RUN_SUBSCRIPTION_ORDER,
  detectedSubscriptions,
  isSubscriptionProvider,
  providerLabel,
  resolveProviderKey,
} from '@/store/app/aiProvider.js';

/** How many "use it instead" tiles sit under AGNT Flash: one row of two, twice. */
const OFFER_COUNT = 4;

export default {
  name: 'ProviderReady',
  components: { SvgIcon },
  props: {
    /** Provider records from the auth API, unfiltered. */
    providers: { type: Array, default: () => [] },
    connectedIds: { type: Array, default: () => [] },
    /** The provider in use (store casing, e.g. 'OpenAI-Codex' or 'AGNT'). */
    activeId: { type: String, default: '' },
    /** The connection list or the first-run pick is still arriving. */
    checking: { type: Boolean, default: false },
  },
  emits: ['connect', 'more'],
  setup(props) {
    const keyOf = (value) => resolveProviderKey(String(value || '')) || String(value || '').toLowerCase();
    const recordFor = (key) => props.providers.find((provider) => keyOf(provider.id) === key) || null;
    const label = (provider) => providerLabel(provider);

    const activeKey = computed(() => keyOf(props.activeId));
    const activeIsAgnt = computed(() => activeKey.value === 'agnt');
    const activeRecord = computed(() => recordFor(activeKey.value));
    const isActive = (provider) => keyOf(provider.id) === activeKey.value;

    /** Subscriptions signed in on this machine, best first, that have a record to show. */
    const detected = computed(() =>
      detectedSubscriptions(props.connectedIds).map(recordFor).filter(Boolean),
    );

    const mode = computed(() => {
      if (props.checking) return 'checking';
      if (detected.value.length > 1) return 'choose';
      return 'ready';
    });

    const activeLabel = computed(() => {
      if (activeIsAgnt.value) return 'AGNT Flash';
      return activeRecord.value ? label(activeRecord.value) : providerLabel(props.activeId);
    });

    const activeSub = computed(() => {
      if (activeIsAgnt.value) return 'Fast everyday AI, included with your account';
      if (isSubscriptionProvider(activeKey.value)) return 'Your subscription, signed in';
      if (activeKey.value === 'local') return 'Runs on this computer';
      return 'Your API key';
    });

    const offers = computed(() =>
      FIRST_RUN_SUBSCRIPTION_ORDER.map(recordFor).filter(Boolean).slice(0, OFFER_COUNT),
    );

    return { mode, detected, offers, activeIsAgnt, activeRecord, activeLabel, activeSub, isActive, label };
  },
};
</script>

<style scoped>
.provider-ready {
  max-width: 460px;
  margin: 24px auto 0;
  text-align: left;
}

.pr-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px 18px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 14px;
  background: var(--color-darker-0);
  color: var(--color-text);
  font: inherit;
  text-align: left;
}

button.pr-row {
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

button.pr-row:hover {
  border-color: rgba(var(--primary-rgb), 0.4);
  background: var(--color-darker-1);
}

button.pr-row:focus-visible,
.pr-link:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.pr-status {
  cursor: default;
}

.pr-mark {
  flex: none;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
}

.pr-mark.small {
  width: 32px;
  height: 32px;
  border-radius: 8px;
}

.pr-mark.agnt {
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.4);
  background: rgba(var(--primary-rgb), 0.08);
}

.pr-mark :deep(.svg-icon),
.pr-mark :deep(.svg-icon svg) {
  width: 22px;
  height: 22px;
}

.pr-mark.small :deep(.svg-icon),
.pr-mark.small :deep(.svg-icon svg) {
  width: 18px;
  height: 18px;
}

.pr-meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.pr-name {
  font-weight: 600;
  font-size: 1em;
}

.pr-sub {
  color: var(--color-text-muted);
  font-size: 0.86em;
}

.pr-state {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  color: var(--text-green);
  font-size: 0.86em;
  font-weight: 600;
}

.pr-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pr-option.picked {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.06);
}

.pr-radio {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 2px solid var(--color-text-muted);
  border-radius: 50%;
}

.picked .pr-radio {
  border-color: var(--color-primary);
}

.picked .pr-radio::after {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-primary);
}

.pr-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 32px 0 14px;
  color: var(--color-text-muted);
  font-size: 0.86em;
  font-weight: 600;
}

.pr-divider::before,
.pr-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--terminal-border-color);
}

.pr-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.pr-tile {
  padding: 12px 14px;
  gap: 10px;
}

.pr-tile .pr-name {
  flex: 1;
  min-width: 0;
}

.pr-go {
  color: var(--color-text-muted);
}

.pr-link {
  display: block;
  margin: 18px auto 0;
  padding: 6px 8px;
  border: 0;
  background: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.92em;
  font-weight: 600;
  cursor: pointer;
}

.pr-link:hover {
  color: var(--color-text);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.pr-skeleton {
  height: 74px;
  border-radius: 14px;
  border: 1px solid var(--terminal-border-color);
  background: linear-gradient(90deg, var(--color-darker-1) 0%, var(--color-darker-2) 50%, var(--color-darker-1) 100%);
  background-size: 200% 100%;
  animation: pr-shimmer 1.2s infinite linear;
}

@keyframes pr-shimmer {
  to {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pr-skeleton {
    animation: none;
  }
}

@media (max-width: 520px) {
  .pr-grid {
    grid-template-columns: 1fr;
  }
}
</style>
