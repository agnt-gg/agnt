<template>
  <div class="provider-lanes">
    <!-- ─────────────── THE FORK ───────────────
         One question, asked before the grid, on the surface where the user has
         never made this choice before.

         The lanes below answer "which vendor". This answers "which of my two
         wallets" — which was previously answered by two lane notes the user had
         to read in full to discover that half the grid was never for them. -->
    <div v-if="showFork" class="lane-fork">
      <button
        v-for="lane in visibleLanes"
        :key="lane.key"
        type="button"
        class="fork-card"
        :class="`fork-${lane.key}`"
        @click="chooseLane(lane.key)"
      >
        <span class="fork-chip" :class="lane.key">{{ lane.chip }}</span>
        <span class="fork-title">{{ lane.fork }}</span>
        <span class="fork-note">{{ lane.note }}</span>
        <span class="fork-faces" aria-hidden="true">
          <span v-for="provider in lane.faces" :key="provider.id" class="fork-face">
            <SvgIcon :name="provider.icon" />
          </span>
        </span>
      </button>
    </div>

    <!-- ─────────────── LANE LIST ─────────────── -->
    <template v-else>
      <button v-if="chosenLane" type="button" class="lane-back" @click="clearLane">← Both options</button>

      <section v-for="lane in shownLanes" :key="lane.key" class="lane" :class="`lane-${lane.key}`">
        <!-- Having just chosen a wallet, the user does not need it priced and
             described back at them; the only open question is which vendor. -->
        <p class="lane-title">
          <template v-if="chosenLane">{{ lane.pick }}</template>
          <template v-else>
            {{ lane.title }}
            <span class="lane-chip" :class="lane.key">{{ lane.chip }}</span>
          </template>
        </p>
        <p v-if="!chosenLane" class="lane-note">{{ lane.note }}</p>

        <div class="provider-grid">
          <button
            v-for="provider in lane.shown"
            :key="provider.id"
            type="button"
            class="provider-tile"
            :class="{ connected: isConnected(provider), selected: isSelected(provider) }"
            :aria-label="`Connect to ${label(provider)}`"
            :aria-expanded="isSelected(provider)"
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

        <!-- ─────────────── ONE PROVIDER ───────────────
             Opens UNDER the grid it was chosen from, not instead of it. The
             screen this replaced navigated away to say three sentences, so the
             button you came for was fifth in reading order and the tiles you
             might have meant instead were gone. Here the list never moves, the
             chosen tile stays lit, and the action is the first thing in the
             box. -->
        <div v-if="selectedLaneKey === lane.key" class="provider-drawer">
          <div class="drawer-head">
            <div class="provider-icon"><SvgIcon :name="selected.icon" /></div>
            <div class="drawer-who">
              <strong>{{ label(selected) }}</strong>
              <!-- The only question the old panel's first paragraph answered,
                   kept, because it is the one worth a line: who charges me? -->
              <span class="panel-billing" :class="selectedIsSubscription ? 'subscription' : 'api'">
                {{
                  selectedIsSubscription
                    ? 'Included in your plan — no extra charge'
                    : `Billed to your ${label(selected)} account, per token`
                }}
              </span>
            </div>
            <button
              type="button"
              class="panel-close"
              :aria-label="`Close ${label(selected)}`"
              @click="selected = null"
            >
              ×
            </button>
          </div>

          <p v-if="siblingWarning" class="panel-warn">{{ siblingWarning }}</p>

          <template v-if="isConnected(selected)">
            <p class="drawer-line">
              <strong>Already connected.</strong>
              AGNT found your {{ label(selected) }} credentials and is using them.
            </p>
            <button type="button" class="btn-primary panel-action" @click="$emit('connect', selected)">
              Use {{ label(selected) }}
            </button>
          </template>

          <template v-else-if="selectedTakesPastedKey">
            <!-- Same field and same source as the bare password prompt this
                 replaced, on one row with the button it feeds. -->
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
              <button
                type="button"
                class="btn-primary panel-action"
                :disabled="!keyInput"
                @click="submitKey"
              >
                Save key
              </button>
            </div>
            <p v-if="selected.instructions" class="panel-instructions panel-fine" v-html="selected.instructions"></p>
            <p class="panel-fine">Stored encrypted on your AGNT account, so it follows you to other machines.</p>
          </template>

          <template v-else>
            <button type="button" class="btn-primary panel-action" @click="$emit('connect', selected)">
              Sign in with {{ label(selected) }} →
            </button>
            <p v-if="selectedIsLocalCli" class="panel-fine">
              Opens {{ label(selected) }} so you can sign in once, with the account your plan is on. The session
              stays <strong>on this computer</strong>. AGNT never sees a password.
            </p>
          </template>

          <!-- The dead end this drawer exists to remove: you picked the metered
               API and what you actually own is the subscription. -->
          <p v-if="sibling" class="panel-swap">
            {{ siblingIsSubscription ? `Have a ${label(sibling)} plan already?` : 'Want to pay per token instead?' }}
            <button type="button" @click="open(sibling)">Connect {{ label(sibling) }} instead →</button>
          </p>
        </div>
      </section>
    </template>

    <!-- Offered from the fork too: running a model here is a third answer to
         "how do you want to pay", not a footnote to one of the other two. -->
    <div v-if="localProvider" class="lane-foot">
      <button type="button" @click="$emit('connect', localProvider)">
        <SvgIcon name="terminal" />
        Run a model on this machine instead →
      </button>
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
    fork: 'I have a subscription',
    pick: 'Which plan do you have?',
    note: 'A subscription you already bought. Usage is included — AGNT never adds a charge.',
  },
  api: {
    title: 'Paste an API key',
    chip: 'pay per token',
    fork: 'I have an API key',
    pick: 'Which key do you have?',
    note: 'A developer account, billed by them for what you use. Separate from any subscription.',
  },
};

/** Vendor marks shown on a fork card, as a hint at what is behind it. */
const FORK_FACE_COUNT = 4;

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
    /**
     * Ask which wallet before showing any vendor.
     *
     * On for onboarding, where the plan-vs-key distinction is the thing being
     * taught and there is room to teach it. Off in chat, where the user is
     * mid-task and already knows — there the two lanes render together and a
     * connect is one click.
     */
    askBillingFirst: { type: Boolean, default: false },
  },
  emits: ['connect', 'submit-credential'],
  setup(props, { emit }) {
    const selected = ref(null);
    const keyInput = ref('');
    const chosenLane = ref(null);
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
          return {
            key,
            ...LANE_COPY[key],
            all,
            shown,
            faces: all.slice(0, FORK_FACE_COUNT),
            hidden: all.length - shown.length,
          };
        })
        .filter((lane) => lane.all.length > 0),
    );

    const localProvider = computed(() => lanes.value.local[0] || null);

    const isConnected = (provider) => {
      const id = String(provider?.id || '').toLowerCase();
      return props.connectedIds.some((app) => String(app).toLowerCase() === id);
    };

    const label = (provider) => providerLabel(provider);

    /**
     * Which lane a provider is actually in — read back off the split, never
     * re-derived, so this cannot drift from what the grid rendered.
     */
    const laneKeyOf = (provider) => {
      const id = String(provider?.id || '').toLowerCase();
      const holds = (list) => list.some((p) => String(p.id).toLowerCase() === id);
      if (holds(lanes.value.subscription)) return 'subscription';
      if (holds(lanes.value.api)) return 'api';
      return null;
    };

    const anyConnected = computed(() =>
      [...lanes.value.subscription, ...lanes.value.api].some((provider) => isConnected(provider)),
    );

    /**
     * Two guards, both about not asking a question that has no answer:
     * one lane means there is no choice to make, and an existing connection
     * must not end up hidden behind a fork the user has to guess their way past.
     */
    const showFork = computed(
      () =>
        props.askBillingFirst &&
        !chosenLane.value &&
        !anyConnected.value &&
        visibleLanes.value.length > 1,
    );

    const shownLanes = computed(() =>
      chosenLane.value
        ? visibleLanes.value.filter((lane) => lane.key === chosenLane.value)
        : visibleLanes.value,
    );

    const isSelected = (provider) =>
      !!selected.value && String(selected.value.id) === String(provider?.id);

    const selectedLaneKey = computed(() => (selected.value ? laneKeyOf(selected.value) : null));

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
      // Only offer the swap if the sibling is actually in the catalog. A link
      // to a provider we do not have is a worse dead end than no link.
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
      // The lit tile is a toggle, so the drawer can be dismissed by the same
      // control that opened it.
      if (isSelected(provider)) {
        selected.value = null;
        return;
      }
      selected.value = provider;
      // Following the swap link across the billing divide has to bring the
      // visible lane with it. Otherwise the drawer opens inside a lane the fork
      // is hiding, and the one link that exists to clear a dead end creates one.
      if (chosenLane.value) {
        const key = laneKeyOf(provider);
        if (key) chosenLane.value = key;
      }
    };

    const chooseLane = (key) => {
      chosenLane.value = key;
      selected.value = null;
    };

    const clearLane = () => {
      chosenLane.value = null;
      selected.value = null;
      keyInput.value = '';
    };

    const submitKey = () => {
      if (!keyInput.value) return;
      // Positional, matching the saveApiKey(provider, value) both parents
      // already implement — the drawer adds explanation, not new mechanics.
      emit('submit-credential', selected.value, keyInput.value);
      keyInput.value = '';
    };

    return {
      selected,
      keyInput,
      chosenLane,
      expanded,
      lanes,
      visibleLanes,
      shownLanes,
      showFork,
      localProvider,
      isConnected,
      isSelected,
      selectedLaneKey,
      selectedIsSubscription,
      selectedIsLocalCli,
      selectedTakesPastedKey,
      sibling,
      siblingIsSubscription,
      siblingWarning,
      label,
      open,
      chooseLane,
      clearLane,
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

/* ── the fork ── */
.lane-fork {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 4px;
}

/* Deliberately the tile's own border weight and hover. A fork card is a bigger
   target for the same kind of act, and giving it a second visual language
   would imply it does something a tile does not. */
.fork-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 18px;
  border: 3px solid var(--color-text-muted);
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: all 0.3s ease;
}

.fork-card:hover {
  background: var(--color-darker-1);
  transform: translateY(-2px);
  border-color: rgba(var(--primary-rgb), 0.3);
}

.fork-card:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.fork-card:active {
  transform: translateY(0);
}

.fork-chip {
  font-size: 0.62em;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 4px;
  background: var(--color-darker-1);
  color: var(--color-text-muted);
}

.fork-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--color-text);
}

.fork-note {
  font-size: 0.85em;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.fork-faces {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  opacity: 0.45;
}

.fork-faces :deep(svg) {
  width: 18px;
  height: 18px;
}

.lane-back {
  margin-bottom: 18px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: 0.9em;
  color: var(--color-text-muted);
}

.lane-back:hover {
  color: var(--color-primary);
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

/* Same reasoning, for the screen where the fork is what precedes it. */
.lane-fork + .lane-foot {
  border-top: 1px solid var(--terminal-border-color);
  margin-top: 18px;
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
  color: var(--color-green);
}

.panel-billing.api {
  color: var(--color-secondary);
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

.drawer-line,
.panel-warn,
.panel-fine,
.panel-instructions {
  margin: 0 0 10px;
  font-size: 0.92em;
  line-height: 1.55;
  color: var(--color-text-muted);
}

.drawer-line strong,
.panel-fine strong {
  color: var(--color-text);
  font-weight: 600;
}

.panel-warn {
  color: var(--color-text);
}

.panel-instructions :deep(a) {
  color: var(--color-secondary);
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
  color: var(--color-secondary);
}

.panel-swap button:hover {
  text-decoration: underline;
}
</style>
