<template>
  <!-- The ONE "which AI" page. Every option is on screen at once and every
       tile is one click: a tile that can be used is used, a sign-in starts
       straight away, and only an API key asks for anything (its field opens
       in place, focused). There used to be a summary screen with "More
       options" in front of this list, a plan-vs-key fork inside it and "+N
       more" expanders on each lane — three different extra clicks between a
       new user and the AI they already pay for. -->
  <div ref="rootEl" class="provider-lanes">
    <!-- Onboarding only: a signed-in account always has AGNT Flash, so it is
         offered as an answer beside the user's own plans. The chat card is
         shown to signed-out users, who cannot use it. -->
    <section v-if="included" class="lane lane-included">
      <p class="lane-title">
        Included with your account
        <span class="lane-chip">no setup</span>
      </p>
      <div class="provider-grid">
        <button
          type="button"
          class="provider-tile"
          :class="{ active: isActive(INCLUDED) }"
          :aria-label="`Use ${INCLUDED.name}`"
          :aria-pressed="isActive(INCLUDED)"
          @click="open(INCLUDED)"
        >
          <span v-if="isActive(INCLUDED)" class="provider-in-use">In use</span>
          <div class="provider-icon included-mark">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h8l-1 8 11-13h-8l1-7z" /></svg>
          </div>
          <span class="provider-name">{{ INCLUDED.name }}</span>
        </button>
      </div>
    </section>

    <section v-for="lane in visibleLanes" :key="lane.key" class="lane" :class="`lane-${lane.key}`">
      <p class="lane-title">
        {{ lane.title }}
        <span class="lane-chip" :class="lane.key">{{ lane.chip }}</span>
      </p>
      <p class="lane-note">{{ lane.note }}</p>

      <div class="provider-grid">
        <button
          v-for="provider in lane.all"
          :key="provider.id"
          type="button"
          class="provider-tile"
          :class="{ connected: isConnected(provider), selected: isSelected(provider), active: isActive(provider) }"
          :aria-label="isConnected(provider) ? `Use ${label(provider)}` : `Connect to ${label(provider)}`"
          :aria-pressed="isActive(provider)"
          :aria-expanded="takesPastedKey(provider) && !isConnected(provider) ? isSelected(provider) : undefined"
          @click="open(provider)"
        >
          <span v-if="isActive(provider)" class="provider-in-use">In use</span>
          <span v-else-if="isConnected(provider)" class="provider-status-dot"></span>
          <div class="provider-icon"><SvgIcon :name="provider.icon" /></div>
          <span class="provider-name">{{ label(provider) }}</span>
        </button>
      </div>

      <!-- ─────────────── AN API KEY ───────────────
           The one tile that cannot finish on its own click: the key is the
           user's to paste. Opens UNDER the grid it was chosen from, focused,
           so it is click, paste, Enter. -->
      <div v-if="selectedLaneKey === lane.key" class="provider-drawer">
        <div class="drawer-head">
          <div class="provider-icon"><SvgIcon :name="selected.icon" /></div>
          <div class="drawer-who">
            <strong>{{ label(selected) }}</strong>
            <span class="panel-billing" :class="selectedIsSubscription ? 'subscription' : 'api'">
              {{
                selectedIsSubscription
                  ? 'Included in your plan — no extra charge'
                  : `Billed to your ${label(selected)} account, per token`
              }}
            </span>
          </div>
          <button type="button" class="panel-close" :aria-label="`Close ${label(selected)}`" @click="selected = null">×</button>
        </div>

        <p v-if="siblingWarning" class="panel-warn">{{ siblingWarning }}</p>

        <div class="drawer-key">
          <input
            v-model="keyInput"
            type="password"
            class="panel-input"
            spellcheck="false"
            :placeholder="`${label(selected)} developer key`"
            :aria-label="`${label(selected)} developer key`"
            @keyup.enter="submitKey"
          />
          <button type="button" class="btn-primary panel-action" :disabled="!keyInput" @click="submitKey">Save key</button>
        </div>
        <p v-if="selected.instructions" class="panel-instructions panel-fine" v-html="selected.instructions"></p>
        <p class="panel-fine">Stored encrypted on your AGNT account, so it follows you to other machines.</p>

        <!-- The dead end this exists to remove: you picked the metered API and
             what you actually own is the subscription. -->
        <p v-if="sibling" class="panel-swap">
          {{ siblingIsSubscription ? `Have a ${label(sibling)} plan already?` : 'Want to pay per token instead?' }}
          <button type="button" @click="open(sibling)">Use {{ label(sibling) }} instead →</button>
        </p>
      </div>
    </section>

    <div v-if="localProvider" class="lane-foot">
      <button type="button" @click="$emit('connect', localProvider)">
        <SvgIcon name="terminal" />
        Run a model on this machine instead →
      </button>
    </div>
  </div>
</template>

<script>
import { computed, nextTick, ref } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import {
  PROVIDER_LANE_SIBLING,
  isSubscriptionProvider,
  providerLabel,
  providerLanes,
  resolveProviderKey,
} from '@/store/app/aiProvider.js';

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

/** AGNT's own model, as a tile. `id` is what the connect pipeline keys on. */
const INCLUDED = Object.freeze({ id: 'agnt', name: 'AGNT Flash' });

export default {
  name: 'ProviderLanes',
  components: { SvgIcon },
  props: {
    /** Raw provider records from the auth API (store.state.appAuth.allProviders). */
    providers: { type: Array, default: () => [] },
    /** appAuth/connectedApps */
    connectedIds: { type: Array, default: () => [] },
    /** store.state.appAuth.codexStatus */
    codexStatus: { type: Object, default: () => ({}) },
    /** The provider in use right now (any casing); its tile says "In use". */
    activeId: { type: String, default: '' },
    /** Offer AGNT Flash, the model included with a signed-in account. */
    included: { type: Boolean, default: false },
  },
  emits: ['connect', 'submit-credential'],
  setup(props, { emit }) {
    const rootEl = ref(null);
    const selected = ref(null);
    const keyInput = ref('');

    const lanes = computed(() =>
      providerLanes(props.providers, {
        codexStatus: props.codexStatus,
        connectedIds: props.connectedIds,
      }),
    );

    const visibleLanes = computed(() =>
      ['subscription', 'api']
        .map((key) => ({ key, ...LANE_COPY[key], all: lanes.value[key] }))
        .filter((lane) => lane.all.length > 0),
    );

    const localProvider = computed(() => lanes.value.local[0] || null);

    const isConnected = (provider) => {
      const id = String(provider?.id || '').toLowerCase();
      return props.connectedIds.some((app) => String(app).toLowerCase() === id);
    };

    const label = (provider) => providerLabel(provider);

    const isActive = (provider) =>
      !!props.activeId && resolveProviderKey(String(provider?.id || '')) === resolveProviderKey(props.activeId);

    /** Which lane a provider is in — read back off the split, never re-derived. */
    const laneKeyOf = (provider) => {
      const id = String(provider?.id || '').toLowerCase();
      const holds = (list) => list.some((p) => String(p.id).toLowerCase() === id);
      if (holds(lanes.value.subscription)) return 'subscription';
      if (holds(lanes.value.api)) return 'api';
      return null;
    };

    const isSelected = (provider) => !!selected.value && String(selected.value.id) === String(provider?.id);
    const selectedLaneKey = computed(() => (selected.value ? laneKeyOf(selected.value) : null));
    const selectedIsSubscription = computed(() => isSubscriptionProvider(selected.value));

    // Branches on how the provider connects, NOT on which lane it is in: a
    // subscription seat can still be redeemed by pasting a token.
    const takesPastedKey = (provider) => (provider?.connectionType || provider?.connection_type) === 'apikey';

    const sibling = computed(() => {
      const siblingId = PROVIDER_LANE_SIBLING[String(selected.value?.id || '').toLowerCase()];
      if (!siblingId) return null;
      const pool = [...lanes.value.subscription, ...lanes.value.api];
      return pool.find((p) => String(p.id).toLowerCase() === siblingId) || null;
    });
    const siblingIsSubscription = computed(() => isSubscriptionProvider(sibling.value));
    const siblingWarning = computed(() => {
      if (!sibling.value || selectedIsSubscription.value || !siblingIsSubscription.value) return '';
      return `This is not your ${label(sibling.value)} subscription. It is a separate ${label(selected.value)} developer account with its own balance.`;
    });

    /**
     * A tile was clicked. Anything that can finish without typing is handed
     * to the parent's connect pipeline right now; a key provider opens its
     * field instead (clicking the lit tile again closes it).
     */
    const open = async (provider) => {
      keyInput.value = '';
      if (isConnected(provider) || !takesPastedKey(provider)) {
        selected.value = null;
        emit('connect', provider);
        return;
      }
      if (isSelected(provider)) {
        selected.value = null;
        return;
      }
      selected.value = provider;
      await nextTick();
      rootEl.value?.querySelector('.panel-input')?.focus();
    };

    const submitKey = () => {
      if (!keyInput.value) return;
      emit('submit-credential', selected.value, keyInput.value);
      keyInput.value = '';
      selected.value = null;
    };

    return {
      INCLUDED,
      rootEl,
      selected,
      keyInput,
      visibleLanes,
      localProvider,
      isConnected,
      isSelected,
      isActive,
      takesPastedKey,
      selectedLaneKey,
      selectedIsSubscription,
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

/* The tile stays lit for as long as its drawer is open, so the grid keeps
   answering "which one am I reading about". */
.provider-tile.selected {
  border-color: var(--color-primary);
  background: var(--color-darker-1);
}

.provider-tile.connected {
  background: rgba(var(--green-rgb), 0.05);
  border-color: var(--color-green);
}

.provider-tile.connected:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: var(--color-green);
}


/* The tile in use. Brighter than "connected" (green border) because it
   answers a different question: not "can I use this" but "this is it". */
/* Green, like "connected", but strongest on the page: filled, ringed and
   badged. In the Dark theme --color-primary is a muted teal, so an in-use
   tile drawn in it read WEAKER than the bright-green connected tiles. */
.provider-tile.active,
.provider-tile.active:hover {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.16);
  box-shadow: 0 0 0 3px rgba(var(--green-rgb), 0.35);
}

/* Seated on the tile's top border, so marking a tile in use never changes its
   height (reserving room inside made it taller than its row-mates). */
.provider-in-use {
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.72em;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: 0.04em;
  white-space: nowrap;
  text-transform: uppercase;
  background: var(--color-green);
  color: var(--text-on-fill);
}


.included-mark {
  color: var(--color-primary);
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
.provider-drawer {
  margin-top: 14px;
  padding: 16px 18px;
  border: 1px solid var(--color-primary);
  border-radius: 12px;
  background: var(--color-darker-1);
}

.drawer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.drawer-head .provider-icon :deep(svg) {
  width: 30px;
  height: 30px;
  margin-bottom: 0;
}

.drawer-who {
  flex: 1;
  min-width: 0;
}

.drawer-who strong {
  display: block;
  font-size: 1.05em;
  font-weight: 600;
  color: var(--color-text);
}

.panel-billing {
  display: block;
  margin-top: 2px;
  font-size: 0.85em;
}

.panel-billing.subscription {
  color: var(--text-green);
}

.panel-billing.api {
  color: var(--text-info);
}

.panel-close {
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 1.3em;
  line-height: 1;
  color: var(--color-text-muted);
}

.panel-close:hover {
  background: var(--color-darker-1);
  color: var(--color-text);
}

.panel-warn,
.panel-fine,
.panel-instructions {
  margin: 0 0 10px;
  font-size: 0.92em;
  line-height: 1.55;
  color: var(--color-text-muted);
}

.panel-fine strong {
  color: var(--color-text);
  font-weight: 600;
}

.panel-warn {
  color: var(--color-text);
}

.panel-instructions :deep(a) {
  color: var(--text-info);
}

/* Fine print sits BELOW the button it qualifies, so the action stays first in
   reading order — the single change that shortens this box the most. */
.panel-fine {
  margin: 10px 0 0;
  font-size: 0.82em;
}

.drawer-key {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

/* No `background` here on purpose. Text fields take their fill from the app's
   zero-specificity default, which is the only one that stays legible in every
   theme — an explicit --color-darker-2 reads as a hole in the light themes.
   themeSurfaces.spec.js enforces this. */
.panel-input {
  flex: 1;
  min-width: 0;
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

.panel-action {
  white-space: nowrap;
}

.panel-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.panel-swap {
  margin: 14px 0 0;
  padding-top: 12px;
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
  color: var(--text-info);
}

.panel-swap button:hover {
  text-decoration: underline;
}
</style>
