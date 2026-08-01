<template>
  <div class="context-tiles">
    <!-- L0 — the collapsed state carries real numbers. This strip is what the
         panel looks like 90% of the time, so "Context & Cost ▾" alone was a
         wasted row. -->
    <div class="tiles-strip" :class="{ expanded: !collapsed }" @click="$emit('toggle')">
      <span class="strip-title">Context &amp; Cost</span>

      <div v-if="hasBreakdown" class="strip-bar" v-tooltip="compositionTitle">
        <div class="seg seg-system" :style="{ width: systemPct + '%' }"></div>
        <div class="seg seg-tools" :style="{ width: toolsPct + '%' }"></div>
        <div class="seg seg-messages" :style="{ width: messagesPct + '%' }"></div>
        <div class="seg seg-output" :style="{ width: outputPct + '%' }"></div>
      </div>

      <div v-for="s in stripStats" :key="s.key" class="strip-stat">
        <span class="strip-value" :class="s.cls">{{ s.value }}</span>
        <span class="strip-key">{{ s.key }}</span>
      </div>

      <span
        v-if="driftWarning"
        class="strip-pip"
        v-tooltip="`Estimator undercounts by ×${driftFactor.toFixed(2)} — the panel shows provider-calibrated numbers`"
      ></span>

      <span class="strip-toggle">{{ collapsed ? '&#9662;' : '&#9652;' }}</span>
    </div>

    <div v-show="!collapsed" class="tiles-body">
      <!-- L1 — six uniform tiles. auto-fit so they reflow 6→3→2 without ever
           leaving a ragged row, and the 1px grid gap IS the divider. -->
      <div class="tiles-grid">
        <button
          v-for="t in tiles"
          :key="t.key"
          type="button"
          class="tile"
          :class="{ active: openTile === t.key, placeholder: t.pending }"
          :disabled="t.pending"
          :aria-expanded="openTile === t.key"
          @click="selectTile(t.key)"
        >
          <span class="tile-key">{{ t.label }}</span>
          <span class="tile-value" :class="t.cls">
            {{ t.value }}<small v-if="t.unit"> {{ t.unit }}</small>
          </span>
          <span v-if="t.key === 'request' && hasBreakdown" class="tile-mini">
            <span class="seg seg-system" :style="{ width: miniPct(breakdown.systemTokens) + '%' }"></span>
            <span class="seg seg-tools" :style="{ width: miniPct(breakdown.toolTokens) + '%' }"></span>
            <span class="seg seg-messages" :style="{ width: miniPct(breakdown.messagesTokens) + '%' }"></span>
          </span>
          <span class="tile-sub" :class="t.subCls">{{ t.sub }}</span>
        </button>
      </div>

      <!-- L2 — the drawer. Wrapping flex so blocks grow into the row instead of
           leaving a gutter at any panel width. -->
      <div v-if="openTile" class="tiles-drawer">

        <!-- REQUEST -->
        <template v-if="openTile === 'request'">
          <!-- Full width: the composition bar is inherently horizontal, and a
               narrow column of it beside a tall inventory list leaves the
               drawer's bottom-left quadrant empty. -->
          <div class="blk full">
            <span class="blk-head">Composition &middot; {{ formatNumber(currentTokens) }} tokens</span>
            <div class="blk-bar">
              <div class="seg seg-system" :style="{ width: relPct(breakdown.systemTokens) + '%' }"></div>
              <div class="seg seg-tools" :style="{ width: relPct(breakdown.toolTokens) + '%' }"></div>
              <div class="seg seg-messages" :style="{ width: relPct(breakdown.messagesTokens) + '%' }"></div>
            </div>
            <div class="legend">
              <div v-for="l in legendRows" :key="l.id" class="legend-row">
                <span class="legend-dot" :class="l.dot"></span>
                <span class="legend-label">{{ l.label }}</span>
                <span class="legend-value">{{ formatNumber(l.tokens) }}</span>
              </div>
            </div>
            <span class="blk-note">
              Output reserve is held for the reply and is not part of the request total.
            </span>
          </div>
          <div class="blk grow"><slot name="inventory" /></div>
        </template>

        <!-- FLOOR -->
        <template v-else-if="openTile === 'floor'">
          <div class="blk narrow">
            <div class="accent accent-indigo">
              <div class="accent-head">
                <span class="accent-label">Per-turn floor</span>
                <span class="accent-amount">{{ formatUsd(economics.floorCost) }}</span>
              </div>
              <div class="mini-track">
                <div class="mt-system" :style="{ width: floorSystemPct + '%' }"></div>
                <div class="mt-tools" :style="{ width: 100 - floorSystemPct + '%' }"></div>
              </div>
              <span class="blk-note">
                <b>{{ formatNumber(economics.floorTokens) }} tokens</b> are re-sent on every
                request before you type a word &mdash; system
                {{ formatNumber(economics.systemTokens) }} + tools
                {{ formatNumber(economics.toolTokens) }}.
                <template v-if="executionsCount > 0">
                  Paid <b>{{ executionsCount }}&times;</b> so far =
                  <b class="danger">{{ formatUsd(economics.floorCost * executionsCount) }}</b>.
                </template>
              </span>
            </div>
            <div v-if="economics.floorCostCached != null" class="row">
              <span class="row-label">When the prefix hits cache</span>
              <span class="row-value good">{{ formatUsd(economics.floorCostCached) }}</span>
            </div>
            <span class="blk-note">
              The gap between those two is exactly what one broken cache prefix costs.
            </span>
          </div>

          <div class="blk grow">
            <span class="blk-head">Recurring segments &middot; sorted by cost</span>
            <div class="cols">
              <span class="col-flex">Segment</span>
              <span class="col-num">$/turn</span>
              <span class="col-num">so far</span>
            </div>
            <div v-for="(d, i) in recurringDrivers" :key="d.id" class="driver">
              <span class="driver-rank">{{ i + 1 }}</span>
              <span class="driver-name" v-tooltip="d.label">{{ d.label }}</span>
              <span class="why" :class="d.whyClass">{{ d.why }}</span>
              <!-- Fixed 4dp in the table so the decimal points form a column;
                   mixed 2dp/4dp currency is unreadable when stacked. -->
              <span class="driver-per">{{ formatUsdFixed(d.cost) }}</span>
              <span class="driver-total">{{ formatUsd(d.cost * Math.max(1, executionsCount)) }}</span>
            </div>
            <span v-if="topThreeSaving > 0" class="blk-note">
              Removing the top 3 saves <b class="danger">{{ formatUsd(topThreeSaving) }}</b> per turn
              &mdash; <b class="danger">{{ formatUsd(topThreeSaving * Math.max(1, executionsCount)) }}</b>
              at this conversation's length.
            </span>
          </div>
        </template>

        <!-- SPENT / SAVED — both open the full cost detail, which is one story. -->
        <template v-else-if="openTile === 'spent' || openTile === 'saved'">
          <div v-if="cacheState" class="blk full">
            <div class="accent" :class="cacheState === 'expired' ? 'accent-pink' : 'accent-green'">
              <span class="blk-note">
                <template v-if="cacheState === 'expired'">
                  <b class="danger">Prompt cache has probably gone cold.</b>
                  The next turn would rewrite the whole prefix at full price
                  <template v-if="hasEconomics">
                    &mdash; about <b class="danger">{{ formatUsd(economics.floorCost) }}</b> for the
                    fixed {{ formatNumber(economics.floorTokens) }} tokens alone.
                  </template>
                </template>
                <template v-else>
                  <b class="good">Prompt cache should still be warm</b> &mdash; about
                  {{ fmtDuration(cacheExpiresInMs) }} of the window left.
                  <template v-if="hasEconomics && economics.floorCostCached != null">
                    Sending now costs <b class="good">{{ formatUsd(economics.floorCostCached) }}</b>
                    for the fixed prefix instead of {{ formatUsd(economics.floorCost) }}.
                  </template>
                </template>
              </span>
              <!-- Show the working. This is an inference from two observable
                   facts, so both are stated and the user can overrule it. -->
              <span class="blk-note dim">
                Last confirmed cache activity <b>{{ cacheAgeLabel }}</b> ago &middot;
                this provider's window is <b>{{ fmtDuration(cacheTtl) }}</b>.
              </span>
            </div>
          </div>
          <div class="blk grow"><slot name="cost" /></div>
        </template>

        <!-- DRIFT -->
        <template v-else-if="openTile === 'drift'">
          <div class="blk narrow">
            <div class="accent accent-gold">
              <div class="accent-head">
                <span class="accent-label">Estimate drift</span>
                <span class="accent-amount warn">&times;{{ driftFactor.toFixed(2) }}</span>
              </div>
              <div class="mini-track">
                <div class="mt-est" :style="{ width: 100 / driftFactor + '%' }"></div>
                <div class="mt-drift" :style="{ width: 100 - 100 / driftFactor + '%' }"></div>
              </div>
              <span class="blk-note">
                The panel already applies this correction, so every size it shows is
                calibrated. It predicted <b>{{ formatNumber(currentTokens) }}</b>, the
                provider counted <b class="warn">{{ formatNumber(providerCounted) }}</b> &mdash;
                <b class="warn">{{ driftPct }}%</b> still unaccounted for.
              </span>
            </div>
          </div>
          <div class="blk">
            <span class="blk-head">Forecast</span>
            <div class="row">
              <span class="row-label">Growth per turn</span>
              <span class="row-value">{{ growthPerTurn ? formatNumber(growthPerTurn) : '&mdash;' }}</span>
            </div>
            <div class="row">
              <span class="row-label">Headroom</span>
              <span class="row-value">{{ formatNumber(headroom) }}</span>
            </div>
            <div class="row">
              <span class="row-label" :class="{ warn: turnsToCompression != null && turnsToCompression <= 3 }">Compression starts in</span>
              <span class="row-value" :class="{ warn: turnsToCompression != null && turnsToCompression <= 3 }">
                {{ turnsToCompression == null ? 'not growing' : `~${turnsToCompression} turn${turnsToCompression === 1 ? '' : 's'}` }}
              </span>
            </div>
            <span class="blk-note">
              Nothing stops when the window fills. Context management compresses the
              oldest turns and the conversation carries on &mdash; what changes is fidelity
              and the cost of rebuilding the prefix, not whether you can keep going.
            </span>
          </div>
        </template>

        <!-- THIS TURN -->
        <template v-else-if="openTile === 'turn'">
          <div class="blk narrow">
            <span class="blk-head">Requests this turn</span>
            <div class="rounds">
              <button
                v-for="(r, i) in rounds"
                :key="i"
                type="button"
                class="round"
                :class="{ selected: i === selectedRound, broke: r.prefixBroke }"
                :style="{ flex: roundFlex(r) }"
                v-tooltip="`Round ${i + 1} · ${formatNumber(r.tokens)} tokens`"
                @click="pinRound(i)"
              >
                <i :style="{ height: roundHeight(r) + '%' }"></i>
              </button>
            </div>
            <div class="rounds-axis">
              <span>r1 &ndash; r{{ rounds.length }}</span>
              <span class="rounds-sel">{{ selectedRoundLabel }}</span>
            </div>
            <span class="blk-note">
              A turn is not one request. Each tool round re-sends the whole context, so the last
              round of a long loop is usually the expensive one.
            </span>
          </div>
          <div class="blk"><slot name="health" /></div>
          <div class="blk"><slot name="activity" /></div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const USD = '\u0024';

/** Match the sibling panels: k / M / B, because agentic loops reach 9 figures. */
function formatNumber(num) {
  const n = Number(num) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function formatUsd(n) {
  const v = Math.abs(Number(n) || 0);
  if (v === 0) return USD + '0.00';
  if (v < 0.01) return USD + v.toFixed(4);
  return USD + v.toFixed(2);
}

/** Table columns need a constant decimal count or the points do not line up. */
function formatUsdFixed(n) {
  return USD + Math.abs(Number(n) || 0).toFixed(4);
}

export default {
  name: 'ContextTiles',
  props: {
    collapsed: { type: Boolean, default: false },
    contextStatus: { type: Object, default: null },
    manifest: { type: Object, default: null },
    totalTokenUsage: { type: Object, default: () => ({}) },
    totalCost: { type: Number, default: 0 },
    totalUncachedCost: { type: Number, default: null },
    totalCacheMetrics: { type: Object, default: () => ({}) },
    executionsCount: { type: Number, default: 0 },
    subscriptionBased: { type: Boolean, default: null },
    /** [{ tokens, limit, prefixBroke }] for the current turn, round 1 first. */
    rounds: { type: Array, default: () => [] },
    /** Real per-turn growth, measured across turns rather than guessed. */
    growthPerTurn: { type: Number, default: 0 },
    lastTurnCost: { type: Number, default: null },
    /** ISO timestamp of the last turn that read or wrote the prompt cache. */
    lastCacheActivityAt: { type: String, default: null },
    /** The provider's cache window, supplied by the backend. Null = no claim. */
    cacheTtlMs: { type: Number, default: null },
  },
  emits: ['toggle'],
  setup(props) {
    const openTile = ref(null);
    const selectedRound = ref(0);

    // A cache deadline that only updates on the next turn is useless — the
    // whole point is to see it running out while deciding whether to send.
    const now = ref(Date.now());
    let clock = null;
    onMounted(() => { clock = setInterval(() => { now.value = Date.now(); }, 15_000); });
    onBeforeUnmount(() => { if (clock) clearInterval(clock); });

    // Follow the newest round as a turn streams, but never fight a user who has
    // deliberately clicked back to an earlier one. Pinning is set by the click
    // itself rather than inferred from a value change: clicking the round that
    // is already selected is still an explicit choice, and inferring intent
    // from a delta silently misses it.
    const userPinnedRound = ref(false);
    const pinRound = (i) => { selectedRound.value = i; userPinnedRound.value = true; };

    watch(() => props.rounds.length, (len, prev) => {
      // A shorter list means a new turn began, which releases any pin.
      if (prev !== undefined && len < prev) userPinnedRound.value = false;
      if (!userPinnedRound.value) selectedRound.value = Math.max(0, len - 1);
      // immediate so opening the drawer part-way through a turn lands on the
      // round in flight rather than on round 1.
    }, { immediate: true });

    const selectTile = (key) => {
      const tile = tiles.value.find((t) => t.key === key);
      if (!tile || tile.pending) return; // nothing to expand yet
      openTile.value = openTile.value === key ? null : key;
    };

    const breakdown = computed(() => props.contextStatus?.breakdown || null);
    const hasBreakdown = computed(() => !!breakdown.value);
    const tokenLimit = computed(() => props.contextStatus?.tokenLimit || 0);
    const currentTokens = computed(() => props.contextStatus?.currentTokens || 0);
    // A window is known as soon as a model is chosen, so `tokenLimit` alone is
    // not evidence of anything. Utilization is only reportable once a request
    // has actually been sized — otherwise the panel states "0% full" about a
    // conversation it has never measured.
    const hasRequest = computed(() => tokenLimit.value > 0 && currentTokens.value > 0);

    const utilization = computed(() => {
      if (!tokenLimit.value) return 0;
      return Math.min((currentTokens.value / tokenLimit.value) * 100, 100);
    });
    const utilizationClass = computed(() => {
      const p = utilization.value;
      if (p >= 90) return 'critical';
      if (p >= 75) return 'warn';
      return '';
    });

    // Strip/tile bar segments are scaled against the WINDOW (how much of the
    // budget each part occupies); the drawer bar is scaled against the REQUEST
    // (what the request is made of). Different questions, different denominators.
    const winPct = (t) => (tokenLimit.value ? Math.min(((t || 0) / tokenLimit.value) * 100, 100) : 0);
    const systemPct = computed(() => winPct(breakdown.value?.systemTokens));
    const toolsPct = computed(() => winPct(breakdown.value?.toolTokens));
    const messagesPct = computed(() => winPct(breakdown.value?.messagesTokens));
    const outputPct = computed(() => winPct(breakdown.value?.outputBufferTokens));

    const requestTotal = computed(() => {
      const b = breakdown.value;
      if (!b) return 0;
      return (b.systemTokens || 0) + (b.toolTokens || 0) + (b.messagesTokens || 0);
    });
    const relPct = (t) => (requestTotal.value ? ((t || 0) / requestTotal.value) * 100 : 0);
    // The tile bar sits directly under the utilization percentage, so it has to
    // MEAN that percentage. Scaling it against the request total instead made
    // the segments always fill the track — a 4% context rendered as a full bar,
    // flatly contradicting the number above it. Window-scaled, the fill length
    // is the utilization and the segments show what it is made of.
    const miniPct = winPct;

    const compositionTitle = computed(() => {
      const b = breakdown.value;
      if (!b) return '';
      return `System ${formatNumber(b.systemTokens)} · Tools ${formatNumber(b.toolTokens)} · `
        + `Messages ${formatNumber(b.messagesTokens)} · Output reserve ${formatNumber(b.outputBufferTokens)}`;
    });

    const legendRows = computed(() => {
      const b = breakdown.value || {};
      return [
        { id: 'system', label: 'System', dot: 'dot-system', tokens: b.systemTokens || 0 },
        { id: 'tools', label: 'Tools', dot: 'dot-tools', tokens: b.toolTokens || 0 },
        { id: 'messages', label: 'Messages', dot: 'dot-messages', tokens: b.messagesTokens || 0 },
        { id: 'output', label: 'Output reserve', dot: 'dot-output', tokens: b.outputBufferTokens || 0 },
      ];
    });

    /* ── economics ── */
    const economics = computed(() => props.manifest?.economics || null);
    const hasEconomics = computed(() => !!economics.value && economics.value.floorTokens > 0);
    const floorSystemPct = computed(() => {
      const e = economics.value;
      if (!e || !e.floorTokens) return 50;
      return (e.systemTokens / e.floorTokens) * 100;
    });

    // Everything in the fixed prefix is a standing order; message content is
    // spent money. Only the former is worth ranking for deletion.
    const recurringDrivers = computed(() => {
      const e = economics.value;
      if (!e) return [];
      const sections = (props.manifest?.system?.sections || []).map((s) => ({
        id: `sys-${s.id}`,
        label: s.label,
        cost: s.cost || 0,
        why: 'system',
        whyClass: 'why-system',
      }));
      const tools = (props.manifest?.tools?.items || []).map((t) => ({
        id: `tool-${t.name}`,
        label: t.name,
        cost: t.cost || 0,
        why: t.reason === 'group' && t.group ? t.group : t.reason,
        whyClass: t.reason === 'discovered' ? 'why-discovered' : 'why-tool',
      }));
      return [...sections, ...tools].sort((a, b) => b.cost - a.cost).slice(0, 8);
    });
    const topThreeSaving = computed(() =>
      recurringDrivers.value.slice(0, 3).reduce((acc, d) => acc + d.cost, 0));

    /* ── savings ── */
    const totalSaved = computed(() => {
      if (props.totalUncachedCost == null) return null;
      return props.totalUncachedCost - (props.totalCost || 0);
    });
    const savedPct = computed(() => {
      const base = props.totalUncachedCost;
      if (!base || base <= 0) return 0;
      return (totalSaved.value / base) * 100;
    });
    const hasSavings = computed(() => totalSaved.value != null && Math.abs(totalSaved.value) > 1e-9);
    const isInvestment = computed(() => (totalSaved.value || 0) < 0);

    /* ── cache freshness ── */
    const cacheAgeMs = computed(() => {
      if (!props.lastCacheActivityAt) return null;
      const t = Date.parse(props.lastCacheActivityAt);
      if (!Number.isFinite(t)) return null;
      return Math.max(0, now.value - t);
    });

    // The window is a property of the provider AND of what AGNT asks for — the
    // Anthropic adapter explicitly requests a 1h ttl rather than accepting the
    // 5-minute default. Hardcoding a constant here was wrong by 12x, so the
    // number now arrives from the backend and null means "make no claim".
    const cacheTtl = computed(() => {
      const t = Number(props.cacheTtlMs);
      return Number.isFinite(t) && t > 0 ? t : null;
    });

    const cacheState = computed(() => {
      const age = cacheAgeMs.value;
      if (age == null || cacheTtl.value == null) return null;
      return age >= cacheTtl.value ? 'expired' : 'warm';
    });

    const cacheExpiresInMs = computed(() => {
      const age = cacheAgeMs.value;
      if (age == null || cacheTtl.value == null) return null;
      return Math.max(0, cacheTtl.value - age);
    });

    const fmtDuration = (ms) => {
      const mins = Math.max(0, Math.round(ms / 60_000));
      if (mins < 60) return `${Math.max(1, mins)}m`;
      const h = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem ? `${h}h ${rem}m` : `${h}h`;
    };

    const cacheAgeLabel = computed(() =>
      (cacheAgeMs.value == null ? null : fmtDuration(cacheAgeMs.value)));

    const cacheLabel = computed(() => {
      if (cacheState.value === 'expired') return 'cache likely cold';
      if (cacheState.value === 'warm') return `cache warm \u00b7 ~${fmtDuration(cacheExpiresInMs.value)} left`;
      return null;
    });

    /* ── drift ── */
    // Drift is the error LEFT OVER after calibration, not the size of the
    // correction. currentTokens is already calibrated, so reporting the
    // correction factor here told the user their numbers were 61% wrong when
    // they were right. A backend that sends no residual gets 1.0 and the tile
    // disappears, which is the correct "not measured yet" state.
    const driftFactor = computed(() => {
      const r = Number(breakdown.value?.residualDrift);
      return Number.isFinite(r) && r > 0 ? r : 1;
    });
    // Over- and under-counting are both drift.
    const driftWarning = computed(() => Math.abs(driftFactor.value - 1) >= 0.15);
    const driftPct = computed(() => Math.round(Math.abs(driftFactor.value - 1) * 100));
    const providerCounted = computed(() => Math.round(currentTokens.value * driftFactor.value));
    const headroom = computed(() => Math.max(0, tokenLimit.value - currentTokens.value));
    // Turns until context management starts compressing. The conversation does
    // NOT stop there — older turns get summarised and it continues — so no copy
    // built on this number may call it a wall or a limit.
    const turnsToCompression = computed(() => {
      const g = Number(props.growthPerTurn) || 0;
      if (!tokenLimit.value || g <= 0) return null;
      return Math.max(0, Math.floor(headroom.value / g));
    });

    /* ── rounds ── */
    const maxRoundTokens = computed(() =>
      Math.max(1, ...props.rounds.map((r) => r.tokens || 0)));
    // Caps at 92% so the tallest bar keeps headroom instead of touching the
    // top edge, which reads as a clipped chart rather than a full one.
    const roundHeight = (r) => Math.max(8, ((r.tokens || 0) / maxRoundTokens.value) * 92);
    const roundFlex = (r) => ((r.tokens || 0) / maxRoundTokens.value) * 0.7 + 0.3;
    const selectedRoundLabel = computed(() => {
      const r = props.rounds[selectedRound.value];
      if (!r) return '';
      return `r${selectedRound.value + 1} · ${formatNumber(r.tokens)}`;
    });
    const prefixBroke = computed(() => props.rounds.some((r) => r.prefixBroke)
      || props.manifest?.cache?.prefixStable === false);

    /* ── strip ── */
    const isNotional = computed(() => props.subscriptionBased === true);
    const stripStats = computed(() => {
      const out = [];
      if (hasRequest.value) {
        out.push({ key: 'full', value: `${utilization.value.toFixed(0)}%`, cls: utilizationClass.value });
      }
      if ((props.totalCost || 0) > 0) {
        out.push({ key: isNotional.value ? 'notional' : 'spent', value: formatUsd(props.totalCost), cls: '' });
      }
      if (hasSavings.value) {
        out.push({
          key: isInvestment.value ? 'invested' : 'saved',
          value: formatUsd(totalSaved.value),
          cls: isInvestment.value ? 'warn' : 'good',
        });
      }
      return out;
    });

    /* ── tiles ── */
    // The four core tiles ALWAYS render, showing a muted placeholder until their
    // data exists. Dropping them made a fresh conversation render one lone tile
    // stretched across the whole panel by auto-fit, which both wasted the row
    // and made a 4% context read as a nearly-full bar.
    const tiles = computed(() => {
      const out = [];

      out.push(hasRequest.value
        ? {
          key: 'request',
          label: 'Request',
          value: `${utilization.value.toFixed(0)}%`,
          cls: utilizationClass.value,
          sub: `${formatNumber(currentTokens.value)} / ${formatNumber(tokenLimit.value)}`,
        }
        : { key: 'request', label: 'Request', value: '—', cls: '', sub: 'no request yet', pending: true });

      out.push(hasEconomics.value
        ? {
          key: 'floor',
          label: 'Floor / turn',
          value: formatUsd(economics.value.floorCost),
          cls: 'indigo',
          sub: `${formatNumber(economics.value.floorTokens)} re-sent`
            + (props.executionsCount > 0 ? ` · ${props.executionsCount}×` : ''),
        }
        : { key: 'floor', label: 'Floor / turn', value: '—', cls: '', sub: 'no pricing for this model', pending: true });

      const inTok = props.totalTokenUsage?.inputTokens || 0;
      out.push((props.totalCost || 0) > 0
        ? {
          key: 'spent',
          label: isNotional.value ? 'Notional' : 'Spent',
          value: formatUsd(props.totalCost),
          cls: '',
          sub: `${props.executionsCount} call${props.executionsCount === 1 ? '' : 's'}`
            + (inTok ? ` · ${formatNumber(inTok)} in` : ''),
        }
        : { key: 'spent', label: 'Spent', value: '—', cls: '', sub: 'no billed turns yet', pending: true });

      const hit = props.totalCacheMetrics?.hitRate;
      out.push(hasSavings.value
        ? {
          key: 'saved',
          label: isInvestment.value ? 'Cache invested' : 'Saved',
          value: formatUsd(totalSaved.value),
          cls: isInvestment.value ? 'warn' : 'good',
          // The cache clock outranks the hit rate here: a 90% historical hit
          // rate is cold comfort if the prefix expired four minutes ago.
          sub: isInvestment.value
            ? 'first prefix write · pays back next turn'
            : `${Math.abs(savedPct.value).toFixed(1)}%`
              + (cacheLabel.value
                ? ` \u00b7 ${cacheLabel.value}`
                : (hit && parseFloat(hit) > 0 ? ` · cache ${hit}%` : '')),
          subCls: cacheState.value === 'expired' ? 'warn' : '',
        }
        : { key: 'saved', label: 'Saved', value: '—', cls: '', sub: 'nothing cached yet', pending: true });

      if (driftWarning.value) {
        out.push({
          key: 'drift',
          label: 'Drift',
          value: `×${driftFactor.value.toFixed(2)}`,
          cls: 'warn',
          sub: `${driftPct.value}% off after calibration`,
        });
      }

      if (props.rounds.length > 0) {
        const parts = [];
        if (props.lastTurnCost != null) parts.push(formatUsd(props.lastTurnCost));
        if (prefixBroke.value) parts.push('prefix broke');
        out.push({
          key: 'turn',
          label: 'This turn',
          value: String(props.rounds.length),
          unit: props.rounds.length === 1 ? 'rd' : 'rds',
          cls: '',
          sub: parts.join(' · ') || 'in flight',
        });
      }

      return out;
    });

    // A tile can disappear between turns (drift resolves, savings flip). Leaving
    // a drawer open for a tile that no longer exists would render an empty box.
    watch(tiles, (list) => {
      if (openTile.value && !list.some((t) => t.key === openTile.value)) openTile.value = null;
    });

    return {
      openTile, selectTile, selectedRound, pinRound,
      breakdown, hasBreakdown, currentTokens, tokenLimit,
      utilization, utilizationClass,
      systemPct, toolsPct, messagesPct, outputPct,
      relPct, miniPct, compositionTitle, legendRows,
      economics, hasEconomics, floorSystemPct, recurringDrivers, topThreeSaving,
      totalSaved, savedPct, hasSavings, isInvestment,
      driftFactor, driftWarning, driftPct, providerCounted, headroom, turnsToCompression,
      cacheState, cacheLabel, cacheExpiresInMs, cacheAgeLabel, cacheTtl, fmtDuration,
      roundHeight, roundFlex, selectedRoundLabel, prefixBroke,
      stripStats, tiles,
      formatNumber, formatUsd, formatUsdFixed,
    };
  },
};
</script>

<style scoped>
.context-tiles {
  display: flex;
  flex-direction: column;
}

/* ── L0 strip ── */
.tiles-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.2s ease;
  flex-wrap: wrap;
  /* The strip spans the panel, so its contents spread across it. Previously
     the toggle held `margin-left: auto` and was the only thing pushing right,
     which crushed every stat into the left third. */
  justify-content: space-between;
}

.tiles-strip:hover {
  background: rgba(255, 255, 255, 0.03);
}

.strip-title {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.strip-bar {
  width: 58px;
  height: 5px;
  flex: none;
  display: flex;
  gap: 1px;
  background: rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}

/* Below ~520px the strip must carry the title, three stats, the pip and the
   toggle; the bar is the one element whose information is already restated by
   the Request tile directly underneath it.
   MUST come after `.strip-bar` — a container query adds no specificity, so the
   later of two equally specific rules wins and `display: flex` would survive. */
@container (max-width: 520px) {
  .strip-bar { display: none; }
}

.strip-stat {
  display: flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
}

.strip-value {
  font-family: var(--font-family-mono, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 600;
}

.strip-key {
  font-size: 9px;
  letter-spacing: 0.9px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.36);
}

.strip-pip {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--color-orange, #ff9500);
  box-shadow: 0 0 6px var(--color-orange, #ff9500);
}

.strip-toggle {
  font-size: 0.8em;
  color: var(--color-med-navy);
  user-select: none;
}

.tiles-strip.expanded .strip-toggle {
  color: var(--color-blue);
}

/* ── L1 tiles ── */
.tiles-grid {
  display: grid;
  /* auto-fit + a real minimum is what stops the ragged bottom edge: tiles
     reflow 6 → 3 → 2 and always fill their row completely. */
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 1px;
  background: var(--terminal-border-color);
  border-top: 1px solid var(--terminal-border-color);
  border-bottom: 1px solid var(--terminal-border-color);
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  min-height: 72px;
  padding: 10px 14px;
  background: var(--color-darker-1);
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.tile:hover {
  background: rgba(255, 255, 255, 0.045);
}

.tile.active {
  background: rgba(var(--blue-rgb), 0.07);
  border-bottom-color: var(--color-blue);
}

.tile:focus-visible {
  outline: 1px solid var(--color-blue);
  outline-offset: -1px;
}

/* Holds its slot in the grid but reads plainly as "nothing here yet" rather
   than as a live metric worth clicking. */
.tile.placeholder {
  cursor: default;
}

.tile.placeholder:hover {
  background: var(--color-darker-1);
}

.tile.placeholder .tile-value {
  color: rgba(255, 255, 255, 0.28);
}

.tile-key {
  font-size: 9px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.36);
}

.tile-value {
  font-family: var(--font-family-mono, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.1;
}

.tile-value small {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.36);
  /* The template's whitespace is collapsed by the compiler, so the unit needs
     its own gap or it renders jammed against the numeral ("6rds"). */
  margin-left: 3px;
}

.tile-mini {
  display: flex;
  gap: 1px;
  width: 100%;
  height: 4px;
  margin-top: 2px;
  background: rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.tile-sub {
  font-size: 9.5px;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
  margin-top: auto;
}

/* ── L2 drawer ── */
.tiles-drawer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  max-height: 60vh;
  overflow-y: auto;
  /* Blocks size to their own content instead of stretching to the tallest.
     Without this a short summary card next to a long list renders as a tall
     box that is mostly empty — the same trap the old three-column grid hit. */
  align-items: flex-start;
  /* When the tiles wrap to two rows the open tile is no longer adjacent to its
     drawer, so the tile's own underline stops reading as a connector. This rule
     marks the drawer as opened content at any width. */
  border-top: 2px solid rgba(var(--blue-rgb), 0.5);
  margin-top: -1px;
}

.blk {
  /* Grow into the row rather than leaving a gutter; 250px basis keeps two
     blocks side by side in a normal chat pane and stacks them when narrow. */
  flex: 1 1 250px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.blk.grow { flex: 2 1 320px; }
.blk.narrow { flex: 1 1 210px; }
.blk.full { flex: 1 1 100%; }

.blk-head {
  font-size: 9px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.36);
}

.blk-note {
  font-size: 9.5px;
  line-height: 1.55;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
}

.blk-note b { color: var(--color-text); }

.blk-note.dim {
  color: rgba(255, 255, 255, 0.36);
  font-size: 9px;
}

.blk-note.dim b { color: rgba(255, 255, 255, 0.55); font-weight: 500; }
.blk-note b.danger { color: var(--pink, #e53d8f); }
.blk-note b.warn { color: var(--color-orange, #ff9500); }

.blk-bar {
  display: flex;
  gap: 1px;
  height: 6px;
  background: rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}

.seg { height: 100%; transition: width 0.3s ease; }
.seg-system { background: var(--color-blue); }
.seg-tools { background: var(--color-indigo); }
.seg-messages { background: var(--color-green); }
.seg-output { background: rgba(255, 255, 255, 0.18); }

.legend {
  display: grid;
  /* 116px is the measured width of the longest label ("Output reserve") plus
     its dot and value; below that the label ellipses for no reason. */
  grid-template-columns: repeat(auto-fit, minmax(116px, 1fr));
  gap: 2px 10px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  min-width: 0;
}

.legend-dot { width: 7px; height: 7px; border-radius: 2px; flex: none; }
.dot-system { background: var(--color-blue); }
.dot-tools { background: var(--color-indigo); }
.dot-messages { background: var(--color-green); }
.dot-output { background: rgba(255, 255, 255, 0.18); }

.legend-label {
  color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legend-value {
  font-family: var(--font-family-mono, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 10px;
  flex: none;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  padding: 2px 0;
}

.row-label { color: var(--color-text-muted, rgba(255, 255, 255, 0.6)); min-width: 0; }
.row-value {
  font-family: var(--font-family-mono, monospace);
  font-variant-numeric: tabular-nums;
  flex: none;
}

/* ── accents: same grammar as .savings-block in ContextMonitor ── */
.accent {
  padding: 8px 10px;
  border-left: 2px solid;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.accent-indigo {
  background: rgba(125, 61, 229, 0.09);
  border-color: var(--color-indigo);
}

.accent-gold {
  background: rgba(255, 149, 0, 0.07);
  border-color: var(--color-orange, #ff9500);
}

.accent-green {
  background: rgba(var(--green-rgb), 0.06);
  border-color: var(--color-green);
}

.accent-pink {
  background: rgba(229, 61, 143, 0.08);
  border-color: var(--pink, #e53d8f);
}

.accent-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.accent-label {
  font-size: 9px;
  letter-spacing: 1.1px;
  text-transform: uppercase;
  color: #b98cff;
}

.accent-gold .accent-label { color: var(--color-orange, #ff9500); }

.accent-amount {
  font-family: var(--font-family-mono, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 17px;
  font-weight: 600;
}

.mini-track {
  display: flex;
  gap: 1px;
  height: 4px;
  background: rgba(0, 0, 0, 0.4);
}

.mt-system { background: var(--color-blue); }
.mt-tools { background: var(--color-indigo); }
.mt-est { background: rgba(255, 255, 255, 0.3); }
.mt-drift { background: var(--color-orange, #ff9500); }

/* ── drivers ── */
.cols {
  display: flex;
  gap: 8px;
  font-size: 8px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  padding-bottom: 2px;
}

.col-flex { flex: 1; }
.col-num { width: 56px; text-align: right; flex: none; }

.driver {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 3px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.driver:last-of-type { border-bottom: 0; }

.driver-rank {
  font-family: var(--font-family-mono, monospace);
  font-size: 9px;
  /* The rank carries the ordering, so it has to be readable rather than
     decorative; 0.3 alpha was the dimmest text in the panel. */
  color: rgba(255, 255, 255, 0.45);
  width: 10px;
  flex: none;
}

.driver-name {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.why {
  font-size: 8px;
  padding: 0 4px;
  border-radius: 3px;
  flex: none;
  max-width: 74px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.why-system { background: rgba(var(--blue-rgb), 0.16); color: var(--color-blue); }
.why-tool { background: rgba(125, 61, 229, 0.2); color: #b98cff; }
.why-discovered { background: rgba(var(--green-rgb), 0.14); color: var(--color-green); }

.driver-per,
.driver-total {
  font-family: var(--font-family-mono, monospace);
  font-variant-numeric: tabular-nums;
  width: 56px;
  text-align: right;
  flex: none;
}

.driver-per { font-size: 10px; color: var(--color-text-muted, rgba(255, 255, 255, 0.6)); }
.driver-total { font-size: 11px; font-weight: 600; }

/* ── rounds ── */
.rounds {
  display: flex;
  gap: 2px;
  /* Real headroom above the tallest bar. Capping the bar at 92% of a 22px
     track left under 2px of clearance, which still read as clipped. */
  height: 28px;
  padding-top: 6px;
  align-items: flex-end;
}

.round {
  height: 100%;
  padding: 0;
  background: rgba(255, 255, 255, 0.07);
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-width: 6px;
}

.round:hover { background: rgba(255, 255, 255, 0.12); }

.round.selected {
  background: rgba(var(--blue-rgb), 0.14);
  border-bottom-color: var(--color-blue);
}

.round i {
  display: block;
  width: 100%;
  background: linear-gradient(180deg, rgba(var(--blue-rgb), 0.5), rgba(var(--blue-rgb), 0.15));
}

.round.selected i {
  background: linear-gradient(180deg, var(--color-blue), rgba(var(--blue-rgb), 0.3));
}

/* A broken cache prefix is the single most expensive event in a turn, so it
   gets a mark on the round where it happened rather than a footnote. */
.round.broke::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--pink, #e53d8f);
}

.rounds-axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 3px;
  font-family: var(--font-family-mono, monospace);
  font-size: 8.5px;
  color: rgba(255, 255, 255, 0.3);
}

.rounds-sel { color: var(--color-blue); }

/* ── shared state colours ── */
.good { color: var(--color-green); }
.warn { color: var(--color-orange, #ff9500); }
.critical { color: var(--color-red); }
.indigo { color: #b98cff; }
.danger { color: var(--pink, #e53d8f); }
</style>
