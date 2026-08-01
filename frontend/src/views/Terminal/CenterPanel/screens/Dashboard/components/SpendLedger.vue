<template>
  <div class="spend-ledger">
    <div class="ledger-header">
      <div class="header-with-info">
        <h5>Spend</h5>
        <!--
          The window has always been the chart's, but nothing on screen said so,
          which made every figure below ambiguous. It reads from the data
          actually loaded rather than the selector, so mid-fetch it describes
          what is on screen instead of what is about to be.
        -->
        <span class="range-label">Last {{ activityDays }} days</span>
        <!--
          Each sentence names a figure that is actually on screen, in the order
          it appears. The previous copy described an older version of this
          panel — it claimed subscription fees were NOT included, while the row
          beside it was adding them into an out-of-pocket total.
        -->
        <Tooltip
          title="What AGNT cost you"
          :text="`Billed via API is money charged to your own API keys. Subscriptions are the seat fees you entered under Details, counted for this window only. Together they are what actually left your pocket. Avoided is what caching and your seats kept off the bill entirely. Same dates as the chart above.`"
          position="bottom"
          width="340px"
        >
          <i class="fas fa-info-circle info-icon"></i>
        </Tooltip>
      </div>
      <div class="header-flags">
        <!--
          Flags stay in the collapsed header on purpose. They exist to say the
          totals cannot be trusted, and a warning you have to expand to find is
          not a warning.
        -->
        <Tooltip
          v-if="writeFailures > 0"
          :text="`${writeFailures} ledger write(s) failed — the totals below are understated`"
          width="auto"
          position="bottom"
        >
          <span class="flag flag-error"><i class="fas fa-exclamation-triangle"></i> {{ writeFailures }}</span>
        </Tooltip>
        <Tooltip
          v-if="summary && summary.unpricedCalls > 0"
          :text="`${summary.unpricedCalls} call(s) used a model with no pricing data. Their cost is unknown, not zero — so they are excluded from the totals rather than counted as free.`"
          width="300px"
          position="bottom"
        >
          <span class="flag flag-warn">{{ summary.unpricedCalls }} unpriced</span>
        </Tooltip>
        <!-- Only offered when there is genuinely something behind it. -->
        <button
          v-if="hasDetail"
          type="button"
          class="expand-toggle clickable"
          :aria-expanded="isExpanded"
          @click="toggleExpanded"
        >
          <span>{{ isExpanded ? 'Less' : 'Details' }}</span>
          <i :class="['fas', isExpanded ? 'fa-chevron-up' : 'fa-chevron-down']"></i>
        </button>
      </div>
    </div>

    <div v-if="isLoading && !summary" class="ledger-loading">Loading spend…</div>

    <div v-else-if="!summary || summary.calls === 0" class="ledger-empty">
      No LLM calls recorded in this window.
    </div>

    <template v-else>
      <!--
        The headline is what your API keys were billed, and nothing else.

        The label carries the scope, because it sits adjacent to the number it
        qualifies — "billed via API" distinguishes this from the subscription
        figure beside it without the heading having to do that work.

        It must never be RATE-SHAPED, though. This slot is read as the number's
        unit, so "billed per token" turned "$3.96" into "$3.96 per token" — a
        rate, and an alarming one. Guarded by spec.
      -->
      <div class="ledger-summary">
        <span class="headline">
          <span class="headline-value">{{ formatUsd(charged) }}</span>
          <span class="headline-label">billed via API</span>
        </span>

        <!--
          Once the user has told us what their seats cost, the two halves of
          real money can finally sit together. This is the ONLY place the
          phrase "out of pocket" is strictly true — a subscription is money
          too, so neither figure alone deserves it.

          Shown only when seat fees are known: inventing a zero would make the
          total silently wrong for every user who has not filled them in.
        -->
        <template v-if="hasSeatFee">
          <span class="headline-op">+</span>
          <span class="headline">
            <span class="headline-value">{{ formatUsd(seatFee) }}</span>
            <span class="headline-label">subscriptions</span>
          </span>
          <span class="headline-op">=</span>
          <span class="headline headline-total">
            <span class="headline-value">{{ formatUsd(outOfPocket) }}</span>
            <span class="headline-label">out of pocket</span>
          </span>
        </template>

        <span v-for="m in metrics" :key="m.label" class="metric" :class="m.tone">
          <b>{{ m.value }}</b> {{ m.label }}
        </span>
      </div>

      <div v-if="isExpanded" class="ledger-detail">
        <!--
          What AGNT saved. Two independent mechanisms, named separately because
          they are not the same thing and a user should be able to act on each:
          caching is AGNT's doing, seats are the user's plan choice.
        -->
        <div v-if="totalAvoided > 0" class="savings-block">
          <div class="savings-title"><i class="fas fa-bolt"></i> What you were not billed for</div>

          <!--
            Each row states a concrete before/after rather than a percentage of
            something unnamed. "69% of what this usage would have cost without
            it" made the reader derive the baseline in their head just to learn
            what the 69% was a share OF; naming the number outright removes the
            arithmetic entirely.
          -->
          <div v-if="savedByCache > 0" class="saving-row">
            <span class="saving-value">{{ formatUsd(savedByCache) }}</span>
            <span class="saving-text">
              <b>saved by caching.</b>
              This usage would have cost {{ formatUsd(wouldHaveCost) }} at metered rates —
              caching brought it to {{ formatUsd(totalValue) }}, a {{ savedPct.toFixed(0) }}% cut.
            </span>
          </div>

          <div v-if="seats > 0" class="saving-row">
            <span class="saving-value">{{ formatUsd(seats) }}</span>
            <span class="saving-text">
              <b>saved by subscription.</b>
              Your seats absorbed the rest at a flat monthly rate, so it never reached this
              bill.
            </span>
          </div>

          <!--
            The rollup, matching the Context &amp; Cost panel's wording so the two
            surfaces cannot describe the same idea two ways.

            It reconciles by construction — wouldHaveCost is charged + seats +
            savedByCache, so subtracting this total leaves exactly `charged`.
            That identity is what makes adding the two mechanisms legitimate,
            and it stays under test even though it is no longer spelled out on
            screen.
          -->
          <div class="saving-total">
            <span class="saving-total-label">Total avoided</span>
            <span class="saving-total-value">{{ formatUsd(totalAvoided) }}</span>
          </div>
          <!--
            What the rate chip means. A blended all-in figure is expected to sit
            far below a provider's list price, so stating both side by side is
            what stops the small number reading as an error — and it is the
            clearest single measure of what AGNT is doing for the user.
          -->
          <div v-if="effectiveRate != null && ratedMoney > 0" class="saving-rate">
            <b>{{ formatRate(effectiveRate) }} per million tokens</b>
            {{ hasSeatFee ? 'all-in' : 'billed via API' }} — against
            <b>{{ formatRate(meteredRate) }}</b> at metered rates,
            across {{ formatTokens(summary.inputTokens + summary.outputTokens) }} tokens.
          </div>

          <!-- Only computable once the user has told us what a seat costs. -->
          <div v-if="leverage" class="leverage-row">
            <i class="fas fa-id-badge"></i>
            <span>
              Your seats cost <b>{{ formatUsd(leverage.fee) }}</b> for this period and ran
              <b>{{ formatUsd(leverage.meteredWork) }}</b> of work at metered rates —
              <b class="leverage-multiple">{{ leverage.multiple.toFixed(1) }}× </b>
              what you paid for them.
            </span>
          </div>
          <!--
            Named honestly: a subscription is real money, so "saved by
            subscription" is gross, not net. This is the one line that says so,
            and it doubles as the reason to fill the fees in.
          -->
          <button
            v-else-if="seatProviders.length"
            type="button"
            class="seat-cost-cta clickable"
            @click="showSeatEditor = true"
          >
            Your seat fees are not counted above — add them to see the net
          </button>
        </div>

        <!--
          Optional, user-supplied, and hidden until asked for. AGNT knows which
          providers are flat-rate and what their usage was worth; the one thing
          it cannot know is what the user pays for them.
        -->
        <div v-if="showSeatEditor" class="seat-editor">
          <div class="col-title">Monthly cost per seat</div>
          <div v-for="p in seatProviders" :key="p.bucket" class="seat-input-row">
            <label :for="`seat-${p.bucket}`">{{ providerLabel(p.bucket) }}</label>
            <div class="seat-input">
              <span class="currency">$</span>
              <input
                :id="`seat-${p.bucket}`"
                v-model="seatDraft[p.bucket]"
                type="number"
                min="0"
                step="1"
                placeholder="0"
                inputmode="decimal"
              />
              <span class="per-month">/mo</span>
            </div>
          </div>
          <div class="seat-actions">
            <button type="button" class="btn-save clickable" @click="saveSeatCosts">Save</button>
            <button type="button" class="btn-cancel clickable" @click="showSeatEditor = false">Cancel</button>
          </div>
          <div class="seat-hint">
            Stored only on this machine, in your own AGNT database. Used to compare what your
            seats cost against what they did.
          </div>
        </div>

        <!-- Cache hit rate: the mechanism behind the savings figure above. -->
        <div v-if="summary.inputTokens > 0" class="cache-row">
          <div class="cache-track">
            <div class="cache-fill" :style="{ width: cacheHitRate + '%' }"></div>
          </div>
          <span class="cache-label">{{ cacheHitRate.toFixed(0) }}% of input served from cache</span>
        </div>

        <!--
          The reconciliation anchor. Every bar and every model row below sums to
          THIS figure, not to the headline — because the breakdowns describe
          total usage value while the headline describes charges. Stating it
          explicitly is what keeps the parts checkable against a whole.
        -->
        <div class="value-anchor">
          <span>Total usage value</span>
          <span class="value-anchor-total">{{ formatUsd(totalValue) }}</span>
        </div>
        <div v-if="hasNotional" class="value-legend">
          <span class="swatch swatch-charged"></span> charged
          <span class="swatch swatch-seat"></span> seat value
        </div>

        <div class="ledger-columns">
          <div class="ledger-col">
            <div class="col-title">Usage value by source</div>
            <div v-for="row in byOrigin" :key="row.bucket" class="bar-row">
              <span class="bar-label">{{ originLabel(row.bucket) }}</span>
              <div class="bar-track">
                <!--
                  Stacked, not one flat colour: both axes stay visible at once,
                  so it is obvious at a glance how much of a bar is real money
                  and how much is seat value.
                -->
                <div class="bar-stack" :style="{ width: barWidth(row) + '%' }">
                  <div class="seg seg-charged" :style="{ width: chargedShare(row) + '%' }"></div>
                  <div class="seg seg-seat" :style="{ width: 100 - chargedShare(row) + '%' }"></div>
                </div>
              </div>
              <span class="bar-value">{{ formatUsd(rowValue(row)) }}</span>
            </div>
          </div>

          <div class="ledger-col">
            <div class="col-title">Usage value by model</div>
            <div v-for="row in topModels" :key="row.bucket" class="model-row">
              <!--
                The same stacked treatment as the bars, not a binary dot.

                A dot switched on `costUsd > 0` claimed "this model cost money"
                identically for a model that was 100% charged and one with a
                cent of charges against thousands in seat value — a threshold
                standing in for a proportion, which is the defect the per-row
                axis switch already was. It also drew a circle for a meaning
                the legend explains with a square, so nothing connected the
                two.
              -->
              <span v-if="hasNotional" class="model-split">
                <span class="seg seg-charged" :style="{ width: chargedShare(row) + '%' }"></span>
                <span class="seg seg-seat" :style="{ width: 100 - chargedShare(row) + '%' }"></span>
              </span>
              <span class="model-name" v-tooltip="row.bucket">{{ row.bucket }}</span>
              <span class="model-calls">{{ row.calls }}</span>
              <span class="model-value">{{ formatUsd(rowValue(row)) }}</span>
            </div>
          </div>
        </div>

        <div v-if="hasNotional" class="ledger-note">
          <i class="fas fa-id-badge"></i>
          Seat usage bills no money — it is shown at what the same tokens would have cost on a
          metered API, so the breakdowns above are all one kind of number and their parts add up
          to the total usage value. Only the headline is a charge.
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { computed, ref, watch } from 'vue';
import { useStore } from 'vuex';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

const ORIGIN_LABELS = {
  chat: 'Chat',
  agent: 'Agents',
  goal_task: 'Goal tasks',
  goal_eval: 'Goal evaluation',
  workflow_node: 'Workflows',
  insight: 'Insights',
  system: 'System',
};

const PROVIDER_LABELS = {
  'claude-code': 'Claude Code',
  'openai-codex': 'Codex',
  'gemini-cli': 'Gemini CLI',
  'kimi-code': 'Kimi Code',
  'cursor-cli': 'Cursor',
  antigravity: 'Antigravity',
  'grok-build': 'Grok Build',
};

// Component-scoped, matching the `creditsChart_*` keys the chart above uses.
const EXPANDED_KEY = 'spendLedger_expanded';

// Seat fees are quoted per month; windows are in days.
const DAYS_PER_MONTH = 30;

export default {
  name: 'SpendLedger',
  components: { Tooltip },
  setup() {
    const store = useStore();

    // Collapsed by default: this section sits inside a height-constrained
    // dashboard card, and the headline answers the common question on its own.
    // The preference is remembered so a user who wants the breakdown does not
    // have to re-open it on every visit.
    const isExpanded = ref(localStorage.getItem(EXPANDED_KEY) === 'true');

    const toggleExpanded = () => {
      isExpanded.value = !isExpanded.value;
      localStorage.setItem(EXPANDED_KEY, isExpanded.value ? 'true' : 'false');
    };

    const showSeatEditor = ref(false);
    const seatDraft = ref({});

    const ledger = computed(() => store.getters['userStats/ledger']);
    const isLoading = computed(() => store.getters['userStats/isLedgerLoading']);
    const summary = computed(() => ledger.value.summary);

    /**
     * The ONE value formula for every breakdown row.
     *
     * A single call is either charged or notional, never both, so summing the
     * two axes yields "what this usage is worth at metered rates" — and every
     * subset of it reconciles to the whole. It is deliberately NOT what the
     * headline shows: the headline is charges only.
     */
    const valueOf = (row) => (Number(row?.costUsd) || 0) + (Number(row?.notionalUsd) || 0);
    const rowValue = valueOf;

    // Set by the store only on a successful load, so this always describes the
    // figures currently rendered — never a range whose data has not arrived.
    const activityDays = computed(() => ledger.value.activityDays || 14);

    const writeFailures = computed(() => summary.value?.ledgerHealth?.totalFailures || 0);

    const charged = computed(() => Number(summary.value?.costUsd) || 0);
    const seats = computed(() => Number(summary.value?.notionalUsd) || 0);
    const totalValue = computed(() => charged.value + seats.value);

    const hasNotional = computed(() => seats.value > 0);
    const hasCharged = computed(() => charged.value > 0);

    const savedByCache = computed(() => {
      const s = summary.value;
      if (!s) return 0;
      return (Number(s.savedUsd) || 0) + (Number(s.notionalSavedUsd) || 0);
    });

    /**
     * Share of the would-have-been bill that caching removed.
     *
     * Deliberately NOT the cache hit rate. A token ratio and a money ratio are
     * different numbers — cached reads still bill at a fraction of the input
     * rate and output tokens never cache — so printing the hit rate under a
     * "saved" label would be a false claim. The hit rate keeps its own honest
     * label further down.
     */
    /** What this usage would have cost with no caching at all. */
    const wouldHaveCost = computed(() => totalValue.value + savedByCache.value);

    const savedPct = computed(() => {
      if (wouldHaveCost.value <= 0) return 0;
      return Math.min(100, (savedByCache.value / wouldHaveCost.value) * 100);
    });

    /**
     * Everything that never reached a per-token bill, by either mechanism.
     *
     * Reconciles exactly by construction: wouldHaveCost is charged + seats +
     * savedByCache, so wouldHaveCost − totalAvoided is precisely `charged`.
     * That identity is what the check line under the rollup states, and it is
     * why the two mechanisms can be added at all — both are measured against
     * the same metered baseline.
     */
    const totalAvoided = computed(() => savedByCache.value + seats.value);

    /**
     * Seat fees for this window, and the true total that leaves the user's
     * pocket. Null-safe on purpose: `leverage` is null until the user supplies
     * a fee, and a $0 stand-in would understate the total rather than admit it
     * is unknown.
     */
    const seatFee = computed(() => leverage.value?.fee || 0);
    const hasSeatFee = computed(() => seatFee.value > 0);
    const outOfPocket = computed(() => charged.value + seatFee.value);

    const cacheHitRate = computed(() => {
      const s = summary.value;
      if (!s || !s.inputTokens) return 0;
      return Math.min(100, (s.cacheReadTokens / s.inputTokens) * 100);
    });

    /** Seat providers with actual usage in this window. */
    const seatProviders = computed(() =>
      (ledger.value.byProvider || [])
        .filter((p) => (Number(p.notionalUsd) || 0) > 0)
        .sort((a, b) => (b.notionalUsd || 0) - (a.notionalUsd || 0))
    );

    /**
     * Seat cost against seat value.
     *
     * Only counts fees for seats actually USED in this window — charging a
     * user's leverage figure for a subscription they did not touch would
     * understate it for no reason. Fees are quoted monthly and prorated to the
     * window, so a 7-day view compares against a week of subscription, not a
     * month of it.
     *
     * Returns null until the user has supplied at least one fee; a leverage
     * multiple with no denominator is not a number worth guessing.
     */
    /**
     * What the seats actually PROCESSED, valued at metered rates.
     *
     * `notionalUsd` is seat usage AFTER caching, and it is already on screen
     * as "saved by subscription" — so using it here made the leverage row a
     * tautology that restated the savings figure under a second name, and
     * understated the work by the entire cache saving on those same rows
     * ($11.4k against $43.1k, a 3.8x gap).
     *
     * `notionalUncachedUsd` is the seat rows' full metered value, which is the
     * honest answer to "how much work did this subscription do". Falls back to
     * the post-cache figure when the backend does not report it, so an older
     * server understates rather than crashes.
     */
    const seatsMeteredWork = computed(() => {
      const full = Number(summary.value?.notionalUncachedUsd) || 0;
      return full > 0 ? full : seats.value;
    });

    const leverage = computed(() => {
      const costs = ledger.value.subscriptionCosts || {};
      const used = seatProviders.value;
      if (!used.length || seats.value <= 0) return null;

      let monthly = 0;
      for (const p of used) {
        const fee = Number(costs[String(p.bucket).toLowerCase()]);
        if (Number.isFinite(fee) && fee > 0) monthly += fee;
      }
      if (monthly <= 0) return null;

      const fee = monthly * (activityDays.value / DAYS_PER_MONTH);
      if (fee <= 0) return null;
      return {
        fee,
        meteredWork: seatsMeteredWork.value,
        multiple: seatsMeteredWork.value / fee,
      };
    });

    /** Every token moved this window — the denominator every rate below uses. */
    const millionsOfTokens = computed(() => {
      const s = summary.value;
      if (!s) return 0;
      return ((s.inputTokens || 0) + (s.outputTokens || 0)) / 1e6;
    });

    /**
     * What a million tokens actually cost, all-in.
     *
     * Deliberately divides the SAME money the headline row ends on by the SAME
     * token count shown beside it, so the three chips can be checked against
     * each other by hand. When seat fees are known that is true out-of-pocket;
     * until then it is API billing alone, and the label says which — quietly
     * folding an unknown seat fee into a "what you paid" rate would understate
     * it without ever admitting to a gap.
     *
     * This is an EFFECTIVE rate, not a list price: it blends input, output,
     * cached reads, cache writes and every model used. It is expected to sit
     * far below any provider's published per-token figure, and the comparison
     * line in the detail is what stops that reading as an error.
     */
    const ratedMoney = computed(() => (hasSeatFee.value ? outOfPocket.value : charged.value));
    const effectiveRate = computed(() => {
      if (millionsOfTokens.value <= 0) return null;
      return ratedMoney.value / millionsOfTokens.value;
    });

    /** The same rate at metered prices — what these tokens would have cost. */
    const meteredRate = computed(() => {
      if (millionsOfTokens.value <= 0) return null;
      return wouldHaveCost.value / millionsOfTokens.value;
    });

    /**
     * The compact line beside the headline.
     *
     * Seat coverage and cache savings lead because they are the good news and
     * the reason the headline is small. Both are explicitly framed as things
     * NOT charged, so neither can be mistaken for spend.
     */
    const metrics = computed(() => {
      const s = summary.value;
      if (!s) return [];
      const out = [];
      // ONE savings number beside the headline, not two. Caching and seats are
      // different mechanisms but the same answer to "what did this not cost
      // me", and the expanded block breaks them apart for anyone who wants it.
      if (totalAvoided.value > 0) {
        out.push({ value: formatUsd(totalAvoided.value), label: 'avoided', tone: 'good' });
      }
      out.push({ value: s.calls.toLocaleString(), label: 'calls' });
      out.push({ value: formatTokens(s.inputTokens + s.outputTokens), label: 'tokens' });
      // Last, because it is derived from the two chips before it — the reader
      // has the numerator and the denominator in hand by the time they reach it.
      if (effectiveRate.value != null && ratedMoney.value > 0) {
        out.push({
          value: `${formatRate(effectiveRate.value)}/M`,
          label: hasSeatFee.value ? 'all-in' : 'billed',
        });
      }
      return out;
    });

    const byOrigin = computed(() =>
      [...(ledger.value.byOrigin || [])].sort((a, b) => rowValue(b) - rowValue(a))
    );

    const topModels = computed(() =>
      [...(ledger.value.byModel || [])].sort((a, b) => rowValue(b) - rowValue(a)).slice(0, 5)
    );

    // Nothing to expand into means no toggle. An affordance that opens an empty
    // panel is worse than no affordance.
    const hasDetail = computed(
      () => !!summary.value && summary.value.calls > 0 && (byOrigin.value.length > 0 || topModels.value.length > 0)
    );

    const barWidth = (row) => {
      const max = Math.max(...byOrigin.value.map(rowValue), 0);
      if (!max) return 0;
      // Floor at 2% so a real-but-tiny bucket is still visibly present rather
      // than rendering as nothing at all.
      return Math.max(2, (rowValue(row) / max) * 100);
    };

    /** Percentage of a bar that is real money, for the stacked fill. */
    const chargedShare = (row) => {
      const total = rowValue(row);
      if (total <= 0) return 0;
      return Math.min(100, ((Number(row.costUsd) || 0) / total) * 100);
    };

    // Seed the editor from saved values whenever it opens, so a user editing
    // one seat does not silently blank the others.
    watch(showSeatEditor, (open) => {
      if (!open) return;
      const costs = ledger.value.subscriptionCosts || {};
      const draft = {};
      for (const p of seatProviders.value) {
        const existing = costs[String(p.bucket).toLowerCase()];
        draft[p.bucket] = Number.isFinite(Number(existing)) && Number(existing) > 0 ? String(existing) : '';
      }
      seatDraft.value = draft;
    });

    const saveSeatCosts = async () => {
      const costs = { ...(ledger.value.subscriptionCosts || {}) };
      for (const [provider, raw] of Object.entries(seatDraft.value)) {
        const n = Number(raw);
        const key = String(provider).toLowerCase();
        // Blank or zero removes the entry rather than storing a falsy fee, so
        // "cleared" and "never set" stay the same state.
        if (Number.isFinite(n) && n > 0) costs[key] = n;
        else delete costs[key];
      }
      try {
        await store.dispatch('userStats/saveSubscriptionCosts', costs);
        showSeatEditor.value = false;
      } catch (e) {
        console.error('[SpendLedger] Failed to save subscription costs:', e);
      }
    };

    function formatUsd(v) {
      const n = Number(v) || 0;
      if (n === 0) return '$0.00';
      if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
      // Grouped: seat value reaches five figures, and "$18463.47" is materially
      // harder to read than "$18,463.47".
      return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    /**
     * Rates need more precision than totals: an all-in figure lands around a
     * few cents, where formatUsd's 2-decimal rounding would flatten $0.051 and
     * $0.054 to the same "$0.05" and hide the difference between a good window
     * and a better one.
     */
    function formatRate(v) {
      const n = Number(v) || 0;
      if (n >= 1) return `$${n.toFixed(2)}`;
      if (n >= 0.001) return `$${n.toFixed(3)}`;
      return `$${n.toFixed(4)}`;
    }

    function formatTokens(n) {
      const v = Number(n) || 0;
      if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
      if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
      if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
      return String(v);
    }

    const originLabel = (b) => ORIGIN_LABELS[b] || b;
    const providerLabel = (b) => PROVIDER_LABELS[String(b).toLowerCase()] || b;

    return {
      summary,
      isLoading,
      activityDays,
      isExpanded,
      toggleExpanded,
      hasDetail,
      writeFailures,
      charged,
      seats,
      totalValue,
      hasNotional,
      hasCharged,
      savedByCache,
      savedPct,
      wouldHaveCost,
      totalAvoided,
      seatFee,
      hasSeatFee,
      outOfPocket,
      effectiveRate,
      meteredRate,
      ratedMoney,
      formatRate,
      metrics,
      cacheHitRate,
      byOrigin,
      topModels,
      barWidth,
      chargedShare,
      rowValue,
      seatProviders,
      seatsMeteredWork,
      leverage,
      showSeatEditor,
      seatDraft,
      saveSeatCosts,
      formatUsd,
      formatTokens,
      originLabel,
      providerLabel,
    };
  },
};
</script>

<style scoped>
.spend-ledger {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--terminal-border-color);
}

.ledger-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.header-with-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ledger-header h5 {
  color: var(--color-text);
  font-size: 0.85em;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin: 0;
}

.range-label {
  font-size: 0.68em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.info-icon {
  color: var(--color-text-muted);
  font-size: 0.8em;
  cursor: help;
}

.header-flags {
  display: flex;
  gap: 6px;
  align-items: center;
}

.flag {
  font-family: var(--font-family-mono);
  font-size: 0.72em;
  padding: 2px 7px;
  border-radius: 4px;
  white-space: nowrap;
}

.flag-warn {
  background: rgba(var(--yellow-rgb), 0.12);
  border: 1px solid rgba(var(--yellow-rgb), 0.3);
  color: var(--color-yellow);
}

.flag-error {
  background: rgba(var(--red-rgb), 0.12);
  border: 1px solid rgba(var(--red-rgb), 0.35);
  color: var(--color-red);
}

.expand-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  padding: 2px 8px;
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: 0.72em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.expand-toggle:hover {
  color: var(--color-text);
  border-color: rgba(var(--primary-rgb), 0.5);
}

.expand-toggle i {
  font-size: 0.85em;
}

.ledger-loading,
.ledger-empty {
  font-family: var(--font-family-mono);
  font-size: 0.82em;
  color: var(--color-text-muted);
  padding: 6px 0;
}

/*
 * The compact line. Wraps — these metrics do not fit one line in a half-width
 * card, and a nowrap row here would bleed out of the card.
 */
.ledger-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 14px;
}

.headline {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}

/*
 * ONE type scale for every figure in this row, declared once so the two halves
 * cannot drift apart.
 *
 * The headline used to be 1.35em against the metrics' effective 0.83em. With
 * three headline figures plus three metrics that oversized lead wrapped the
 * row badly and implied the trailing numbers mattered less — they do not, they
 * are the same class of fact. The total is still marked, by colour rather than
 * by size.
 */
.headline,
.metric {
  font-size: 0.72em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.headline-value,
.metric b {
  font-family: var(--font-family-mono);
  font-size: 1.15em;
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: 0;
  text-transform: none;
  line-height: 1.1;
}

/* Inherits the label scale from .headline above — no size of its own, or it
   would compound against it. */
.headline-label {
  letter-spacing: 0.06em;
}

.headline-op {
  /* 0.72 × 1.15 — the value scale, resolved against .ledger-summary because
     the operators sit between the headline spans rather than inside one. */
  font-family: var(--font-family-mono);
  font-size: 0.83em;
  color: var(--color-text-muted);
  align-self: center;
}

.headline-total .headline-value {
  color: var(--color-primary);
}

/* .metric and .metric b are sized by the shared rule above. */

.metric.good b {
  color: var(--color-green);
}

.ledger-detail {
  margin-top: 12px;
}

/* --- savings --- */

.savings-block {
  background: rgba(var(--green-rgb), 0.06);
  border: 1px solid rgba(var(--green-rgb), 0.2);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.savings-title {
  font-size: 0.68em;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-green);
  margin-bottom: 8px;
}

.savings-title i {
  margin-right: 4px;
}

.saving-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 5px;
  font-size: 0.78em;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.saving-value {
  font-family: var(--font-family-mono);
  font-weight: 700;
  color: var(--color-green);
  white-space: nowrap;
}

.saving-total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--green-rgb), 0.25);
}

.saving-total-label {
  font-size: 0.7em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.saving-total-value {
  font-family: var(--font-family-mono);
  font-size: 1.15em;
  font-weight: 700;
  color: var(--color-green);
}

.saving-rate {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(var(--green-rgb), 0.15);
  font-size: 0.75em;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.saving-rate b {
  font-family: var(--font-family-mono);
  color: var(--color-text);
}

.leverage-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--green-rgb), 0.18);
  font-size: 0.78em;
  color: var(--color-text-muted);
  line-height: 1.5;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.leverage-row i {
  margin-top: 3px;
  color: var(--color-blue);
}

.leverage-row b {
  color: var(--color-text);
  font-family: var(--font-family-mono);
}

.leverage-multiple {
  color: var(--color-green) !important;
  font-size: 1.1em;
}

.seat-cost-cta {
  margin-top: 8px;
  background: transparent;
  border: 1px dashed rgba(var(--green-rgb), 0.35);
  border-radius: 4px;
  padding: 5px 10px;
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: 0.72em;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.seat-cost-cta:hover {
  color: var(--color-green);
  border-color: rgba(var(--green-rgb), 0.6);
}

/* --- seat cost editor --- */

.seat-editor {
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
}

.seat-input-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.seat-input-row label {
  font-size: 0.78em;
  color: var(--color-text);
}

.seat-input {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--font-family-mono);
  font-size: 0.78em;
  color: var(--color-text-muted);
}

.seat-input input {
  width: 70px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  padding: 3px 6px;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: 1em;
  text-align: right;
}

.seat-input input:focus {
  outline: none;
  border-color: rgba(var(--primary-rgb), 0.6);
}

.seat-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.btn-save,
.btn-cancel {
  border-radius: 4px;
  padding: 3px 12px;
  font-family: inherit;
  font-size: 0.72em;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.btn-save {
  background: rgba(var(--green-rgb), 0.15);
  border: 1px solid rgba(var(--green-rgb), 0.4);
  color: var(--color-green);
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}

.seat-hint {
  margin-top: 8px;
  font-size: 0.7em;
  color: var(--color-text-muted);
  line-height: 1.5;
}

/* --- cache --- */

.cache-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.cache-track {
  flex: 1;
  height: 4px;
  background: var(--color-lighter-0);
  border-radius: 2px;
  overflow: hidden;
}

.cache-fill {
  height: 100%;
  background: var(--color-blue);
  border-radius: 2px;
  transition: width 0.4s ease;
}

.cache-label {
  font-family: var(--font-family-mono);
  font-size: 0.72em;
  color: var(--color-text-muted);
  white-space: nowrap;
}

/* --- breakdowns --- */

.value-anchor {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--terminal-border-color);
  font-size: 0.72em;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.value-anchor-total {
  font-family: var(--font-family-mono);
  font-size: 1.2em;
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: 0;
}

.value-legend {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  font-size: 0.68em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
}

.swatch {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: inline-block;
}

.swatch-charged {
  background: var(--color-primary);
}

.swatch-seat {
  background: rgba(var(--primary-rgb), 0.28);
  margin-left: 8px;
}

/* The legend describes the bar segments, so it is drawn as one. */
.swatch {
  height: 6px;
  width: 12px;
  border-radius: 3px;
}

.ledger-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  margin-top: 10px;
}

@media (max-width: 700px) {
  .ledger-columns {
    grid-template-columns: 1fr;
  }
}

.col-title {
  font-size: 0.68em;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 6px;
}

.bar-row {
  display: grid;
  grid-template-columns: 88px 1fr auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}

.bar-label {
  font-size: 0.75em;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-track {
  height: 6px;
  background: var(--color-lighter-0);
  border-radius: 3px;
  overflow: hidden;
}

.bar-stack {
  display: flex;
  height: 100%;
  border-radius: 3px;
  overflow: hidden;
  transition: width 0.4s ease;
}

.seg {
  height: 100%;
}

.seg-charged {
  background: var(--color-primary);
}

.seg-seat {
  background: rgba(var(--primary-rgb), 0.28);
}

.bar-value,
.model-value {
  font-family: var(--font-family-mono);
  font-size: 0.75em;
  color: var(--color-text);
  white-space: nowrap;
}

.model-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}

.model-split {
  display: flex;
  width: 22px;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--color-lighter-0);
}

.model-name {
  font-size: 0.75em;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-calls {
  font-family: var(--font-family-mono);
  font-size: 0.72em;
  color: var(--color-text-muted);
}

.ledger-note {
  margin-top: 12px;
  font-size: 0.73em;
  color: var(--color-text-muted);
  line-height: 1.5;
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.ledger-note i {
  margin-top: 2px;
  color: var(--color-blue);
}
</style>
