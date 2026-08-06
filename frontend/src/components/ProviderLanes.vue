<template>
  <div class="provider-lanes">
    <!-- ─────────────── LANE LIST ─────────────── -->
    <template v-if="!selected">
      <section v-for="lane in visibleLanes" :key="lane.key" class="lane" :class="`lane-${lane.key}`">
        <p class="lane-title">
          {{ lane.title }}
          <span class="lane-chip" :class="lane.key">{{ lane.chip }}</span>
        </p>
        <p class="lane-note">{{ lane.note }}</p>

        <div class="provider-grid">
          <button
            v-for="provider in lane.shown"
            :key="provider.id"
            type="button"
            class="provider-tile"
            :class="{ connected: isConnected(provider) }"
            :aria-label="`Connect to ${label(provider)}`"
            @click="open(provider)"
          >
            <span v-if="isConnected(provider)" class="provider-status-dot"></span>
            <div class="provider-icon"><SvgIcon :name="provider.icon" /></div>
            <span class="provider-name">{{ label(provider) }}</span>
          </button>

          <button
            v-if="lane.hidden > 0"
            type="button"
            class="provider-tile more"
            :aria-label="`Show ${lane.hidden} more providers`"
            @click="expanded[lane.key] = true"
          >
            <span class="provider-name">+{{ lane.hidden }}<br />more</span>
          </button>
        </div>
      </section>

      <div v-if="localProvider" class="lane-foot">
        <button type="button" @click="$emit('connect', localProvider)">
          <SvgIcon name="terminal" />
          Run a model on this machine instead →
        </button>
      </div>
    </template>

    <!-- ─────────────── ONE PROVIDER ─────────────── -->
    <div v-else class="provider-panel">
      <button type="button" class="panel-back" @click="selected = null">← All providers</button>

      <div class="panel-head">
        <div class="provider-icon"><SvgIcon :name="selected.icon" /></div>
        <h3>{{ label(selected) }}</h3>
      </div>

      <!-- Line one answers the only question that matters: who charges me? -->
      <p class="panel-billing" :class="selectedIsSubscription ? 'subscription' : 'api'">
        {{
          selectedIsSubscription
            ? 'Included in your plan — no extra charge'
            : `Billed to your ${label(selected)} account, per token`
        }}
      </p>

      <div class="panel-box">
        <p v-if="siblingWarning" class="panel-warn">{{ siblingWarning }}</p>

        <template v-if="isConnected(selected)">
          <p>
            <strong>Already connected.</strong>
            AGNT found your {{ label(selected) }} credentials and is using them — there is nothing to do here.
          </p>
        </template>
        <template v-else-if="selectedTakesPastedKey">
          <!-- Same field and same source as the bare password prompt this
               replaced, moved next to the explanation of what it bills. -->
          <p v-if="selected.instructions" class="panel-instructions" v-html="selected.instructions"></p>
          <p v-else>Paste a key from your {{ label(selected) }} developer account.</p>
          <input
            v-model="keyInput"
            type="password"
            class="panel-input"
            spellcheck="false"
            :placeholder="`${label(selected)} developer key`"
            :aria-label="`${label(selected)} developer key`"
            @keyup.enter="submitKey"
          />
          <p class="panel-fine">Stored encrypted on your AGNT account, so it follows you to other machines.</p>
        </template>
        <template v-else>
          <p>Opens {{ label(selected) }} so you can sign in once, with the account your plan is on.</p>
          <p v-if="selectedIsLocalCli" class="panel-fine">
            The session stays <strong>on this computer</strong>. AGNT never sees a password.
          </p>
        </template>
      </div>

      <button
        v-if="selectedTakesPastedKey && !isConnected(selected)"
        type="button"
        class="btn-primary panel-action"
        :disabled="!keyInput"
        @click="submitKey"
      >
        Save key
      </button>
      <button v-else type="button" class="btn-primary panel-action" @click="$emit('connect', selected)">
        {{ isConnected(selected) ? 'Use ' + label(selected) : 'Sign in with ' + label(selected) + ' →' }}
      </button>

      <!-- The dead end this screen exists to remove: you picked the metered
           API and what you actually own is the subscription. -->
      <p v-if="sibling" class="panel-swap">
        {{ siblingIsSubscription ? `Have a ${label(sibling)} plan already?` : 'Want to pay per token instead?' }}
        <button type="button" @click="open(sibling)">Connect {{ label(sibling) }} instead →</button>
      </p>
    </div>
  </div>
</template>

<script>
import { computed, reactive, ref } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import {
  LANE_PREVIEW_COUNT,
  PROVIDER_LANE_SIBLING,
  isSubscriptionProvider,
  providerLabel,
  providerLanes,
} from '@/store/app/aiProvider.js';
import { CLI_PROVIDER_IDS } from '@/store/auth/appAuth.js';

const LANE_COPY = {
  subscription: {
    title: 'Sign in to a plan',
    chip: 'already paid',
    note: 'A subscription you already bought. Usage is included — AGNT never adds a charge.',
  },
  api: {
    title: 'Paste an API key',
    chip: 'pay per token',
    note: 'A developer account, billed by them for what you use. Separate from any subscription.',
  },
};

export default {
  name: 'ProviderLanes',
  components: { SvgIcon },
  props: {
    /** Raw provider records from the auth API (store.state.appAuth.allProviders). */
    providers: { type: Array, default: () => [] },
    /** store.state.appAuth.connectedApps */
    connectedIds: { type: Array, default: () => [] },
    /** store.state.appAuth.codexStatus */
    codexStatus: { type: Object, default: () => ({}) },
  },
  emits: ['connect', 'submit-credential'],
  setup(props, { emit }) {
    const selected = ref(null);
    const keyInput = ref('');
    const expanded = reactive({ subscription: false, api: false });

    const lanes = computed(() =>
      providerLanes(props.providers, {
        codexStatus: props.codexStatus,
        connectedIds: props.connectedIds,
      }),
    );

    const visibleLanes = computed(() =>
      ['subscription', 'api']
        .map((key) => {
          const all = lanes.value[key];
          const shown = expanded[key] ? all : all.slice(0, LANE_PREVIEW_COUNT);
          return { key, ...LANE_COPY[key], all, shown, hidden: all.length - shown.length };
        })
        .filter((lane) => lane.all.length > 0),
    );

    const localProvider = computed(() => lanes.value.local[0] || null);

    const isConnected = (provider) => {
      const id = String(provider?.id || '').toLowerCase();
      return props.connectedIds.some((app) => String(app).toLowerCase() === id);
    };

    const label = (provider) => providerLabel(provider);

    const selectedIsSubscription = computed(() => isSubscriptionProvider(selected.value));

    const selectedIsLocalCli = computed(() =>
      CLI_PROVIDER_IDS.includes(String(selected.value?.id || '').toLowerCase()),
    );

    // Branches on how the provider connects, NOT on which lane it is in: a
    // subscription seat can still be redeemed by pasting a token, and the two
    // questions have to stay separate or one of those providers gets a form it
    // cannot use.
    const selectedTakesPastedKey = computed(() => {
      const type = selected.value?.connectionType || selected.value?.connection_type;
      return type === 'apikey';
    });

    const sibling = computed(() => {
      const id = String(selected.value?.id || '').toLowerCase();
      const siblingId = PROVIDER_LANE_SIBLING[id];
      if (!siblingId) return null;
      // Only offer the swap if the sibling is actually on this screen. A link
      // to a provider we are not showing is a worse dead end than no link.
      const pool = [...lanes.value.subscription, ...lanes.value.api];
      return pool.find((p) => String(p.id).toLowerCase() === siblingId) || null;
    });

    const siblingIsSubscription = computed(() => isSubscriptionProvider(sibling.value));

    const siblingWarning = computed(() => {
      if (!sibling.value || selectedIsSubscription.value || !siblingIsSubscription.value) return '';
      return `This is not your ${label(sibling.value)} subscription. It is a separate ${label(selected.value)} developer account with its own balance.`;
    });

    const open = (provider) => {
      keyInput.value = '';
      selected.value = provider;
    };

    const submitKey = () => {
      if (!keyInput.value) return;
      // Positional, matching the saveApiKey(provider, value) both parents
      // already implement — the panel adds explanation, not new mechanics.
      emit('submit-credential', selected.value, keyInput.value);
      keyInput.value = '';
    };

    return {
      selected,
      keyInput,
      expanded,
      lanes,
      visibleLanes,
      localProvider,
      isConnected,
      selectedIsSubscription,
      selectedIsLocalCli,
      selectedTakesPastedKey,
      sibling,
      siblingIsSubscription,
      siblingWarning,
      label,
      open,
      submitKey,
    };
  },
};
</script>

<style scoped>
.provider-lanes {
  max-width: 520px;
  margin: 24px auto 0;
  text-align: left;
}

/* ── lanes ── */
.lane {
  margin-bottom: 22px;
}

.lane-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 2px;
  font-size: 1em;
  font-weight: 600;
  color: var(--color-text);
}

.lane-chip {
  font-size: 0.62em;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 4px;
}

/* Deliberately neutral, and identical in both lanes. Green already means
   "connected" on the tiles below; a green lane chip would make one colour
   answer two questions on the same screen, and the louder of two coloured
   chips also reads as a recommendation we do not intend to make. The lane
   names carry the meaning — the chips only price them. */
.lane-chip {
  background: var(--color-darker-1);
  color: var(--color-text-muted);
}

.lane-note {
  margin: 0 0 12px;
  font-size: 0.85em;
  color: var(--color-text-muted);
}

/* ── tiles ──
   The single definition of a provider tile. The onboarding modal and the chat
   setup card each carried their own copy, with different gaps and hover
   colours; both now render this component instead.

   A GRID, not a wrapping flex row. Flex sizes each tile to its own label, so
   "Gemini CLI" came out wider than "Gemini" and the two lanes' columns landed
   at different x positions — tidy in isolation, visibly ragged once there are
   two rows to compare. Equal columns also give the divider below something to
   line up with. */
.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 12px;
  align-items: start;
}

.provider-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 80px;
  padding: 8px;
  border: 3px solid var(--color-text-muted);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.3s ease;
}

.provider-tile:hover {
  background: var(--color-darker-1);
  transform: translateY(-2px);
  border-color: rgba(var(--primary-rgb), 0.3);
}

.provider-tile:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.provider-tile:active {
  transform: translateY(0);
}

.provider-tile.connected {
  background: rgba(var(--green-rgb), 0.05);
  border-color: var(--color-green);
}

.provider-tile.connected:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: var(--color-green);
}

.provider-tile.more {
  border-style: dashed;
  border-width: 2px;
  border-color: var(--terminal-border-color);
}

.provider-tile.more .provider-name {
  color: var(--color-text-muted);
}

.provider-status-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-green);
  box-shadow: var(--glow-success);
}

.provider-icon :deep(svg) {
  width: 32px;
  height: 32px;
  margin-bottom: 3px;
}

.provider-name {
  margin-top: 4px;
  font-weight: 500;
  text-align: center;
  font-size: 0.9em;
  color: var(--color-text);
  /* Fixed columns mean a long label can no longer widen its tile, so it has to
     be allowed to wrap instead of overflowing the border. */
  line-height: 1.15;
  overflow-wrap: anywhere;
}

/* ── local footnote ── */
.lane-foot {
  margin-top: 4px;
  padding-top: 16px;
}

/* The divider only exists when there is something above it to divide from.
   Local is offered unconditionally — including when the catalog is empty or
   never arrived — so the footer can legitimately be the first thing in this
   component, and a rule above nothing reads as a stray line left behind by
   content that failed to render. */
.lane + .lane-foot {
  border-top: 1px solid var(--terminal-border-color);
}

.lane-foot button {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 0.9em;
  color: var(--color-text-muted);
}

.lane-foot button:hover {
  color: var(--color-primary);
}

/* Sized in em so it tracks the label instead of drifting when the font-size
   changes, and BELOW cap-height because a framed glyph reads heavier than a
   letterform in the same box — at full size it read as a badge, not a word.
   The :deep() prefix out-specifies SvgIcon's global `.svg-icon path[fill]`,
   which would otherwise paint this the full-contrast text colour while the
   label beside it stayed muted. */
.lane-foot :deep(.svg-icon) {
  display: inline-flex;
  width: 0.85em;
  height: 0.85em;
  color: inherit;
}

.lane-foot :deep(.svg-icon svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.lane-foot :deep(.svg-icon path[fill]) {
  fill: currentColor;
}

.lane-foot :deep(.svg-icon path[stroke]) {
  stroke: currentColor;
}

/* ── one provider ── */
.panel-back {
  margin-bottom: 20px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 0.9em;
  color: var(--color-text-muted);
}

.panel-back:hover {
  color: var(--color-primary);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 6px;
}

.panel-head .provider-icon :deep(svg) {
  width: 36px;
  height: 36px;
  margin-bottom: 0;
}

.panel-head h3 {
  margin: 0;
  font-size: 1.35em;
  font-weight: 600;
  color: var(--color-text);
}

.panel-billing {
  margin: 0 0 18px;
  padding-left: 50px;
  font-size: 0.9em;
}

.panel-billing.subscription {
  color: var(--color-green);
}

.panel-billing.api {
  color: var(--color-secondary);
}

.panel-box {
  margin-bottom: 14px;
  padding: 18px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  background: var(--color-darker-1);
}

.panel-box p {
  margin: 0 0 10px;
  font-size: 0.92em;
  line-height: 1.55;
  color: var(--color-text-muted);
}

.panel-box p:last-child {
  margin-bottom: 0;
}

.panel-box strong {
  color: var(--color-text);
  font-weight: 600;
}

.panel-warn {
  color: var(--color-text) !important;
}

.panel-instructions :deep(a) {
  color: var(--color-secondary);
}

.panel-fine {
  font-size: 0.82em !important;
}

/* No `background` here on purpose. Text fields take their fill from the app's
   zero-specificity default, which is the only one that stays legible in every
   theme — an explicit --color-darker-2 reads as a hole in the light themes.
   themeSurfaces.spec.js enforces this. */
.panel-input {
  width: 100%;
  margin-bottom: 10px;
  padding: 12px 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.95em;
}

.panel-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.panel-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.panel-swap {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--terminal-border-color);
  font-size: 0.88em;
  color: var(--color-text-muted);
}

.panel-swap button {
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  color: var(--color-secondary);
}

.panel-swap button:hover {
  text-decoration: underline;
}
</style>
