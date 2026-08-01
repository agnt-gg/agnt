<template>
  <div class="context-monitor">
    <div class="context-header">
      <span class="monitor-title">Request Size</span>
      <span class="model-badge">{{ contextStatus?.model || 'N/A' }}</span>
    </div>

    <div class="context-bar">
      <!-- Segmented bar: system / tools / messages / output buffer.
           Falls back to a single-color fill when breakdown isn't available. -->
      <div class="usage-bar segmented">
        <template v-if="hasBreakdown">
          <div class="seg seg-system" :style="{ width: systemPct + '%' }" v-tooltip="`System: ${formatNumber(breakdown.systemTokens)}`"></div>
          <div class="seg seg-tools" :style="{ width: toolsPct + '%' }" v-tooltip="`Tools: ${formatNumber(breakdown.toolTokens)}`"></div>
          <div class="seg seg-messages" :style="{ width: messagesPct + '%' }" v-tooltip="`Messages: ${formatNumber(breakdown.messagesTokens)}`"></div>
          <div class="seg seg-output" :style="{ width: outputPct + '%' }" v-tooltip="`Output reserve: ${formatNumber(breakdown.outputBufferTokens)} (held for the reply, not part of the request total)`"></div>
        </template>
        <div v-else class="seg usage-fill" :class="getUsageClass()" :style="{ width: utilizationPercent + '%' }"></div>
      </div>
      <div class="context-info">
        <span class="token-count">{{ formatNumber(contextStatus?.currentTokens || 0) }} / {{ formatNumber(contextStatus?.tokenLimit || 0) }}</span>
        <span class="percentage">{{ utilizationPercent.toFixed(1) }}%</span>
      </div>
    </div>

    <!-- Legend with per-component numbers -->
    <div v-if="hasBreakdown" class="context-legend">
      <div class="legend-row">
        <span class="legend-dot dot-system"></span>
        <span class="legend-label">System</span>
        <span class="legend-value">{{ formatNumber(breakdown.systemTokens) }}</span>
      </div>
      <div class="legend-row">
        <span class="legend-dot dot-tools"></span>
        <span class="legend-label">Tools</span>
        <span class="legend-value">{{ formatNumber(breakdown.toolTokens) }}</span>
      </div>
      <div class="legend-row">
        <span class="legend-dot dot-messages"></span>
        <span class="legend-label">Messages</span>
        <span class="legend-value">{{ formatNumber(breakdown.messagesTokens) }}</span>
      </div>
      <div class="legend-row">
        <span class="legend-dot dot-output"></span>
        <span class="legend-label">Output reserve</span>
        <span class="legend-value">{{ formatNumber(breakdown.outputBufferTokens) }}</span>
      </div>
    </div>

    <!-- Conversation Totals (cumulative across all turns) -->
    <!--
      "calls" was wrong: one row here is one TURN, and a turn is however many
      API requests the tool loop needed. Calling it a call made the token
      totals look impossible against the context window.
    -->
    <div v-if="hasTotals" class="section-divider">Conversation{{ executionsCount > 0 ? ` · ${executionsCount} turn${executionsCount === 1 ? '' : 's'}` : '' }}</div>

    <div v-if="hasTotals" class="token-usage-row">
      <span class="usage-label">Tokens</span>
      <div class="usage-values">
        <span class="in-tokens">{{ formatNumber(totalTokenUsage.inputTokens || 0) }} in</span>
        <span class="token-sep">&middot;</span>
        <span class="out-tokens">{{ formatNumber(totalTokenUsage.outputTokens || 0) }} out</span>
        <span class="token-sep">&middot;</span>
        <span class="total-tokens">{{ formatNumber(totalTokenUsage.totalTokens || 0) }} total</span>
      </div>
    </div>

    <div v-if="hasTotalCache" class="cache-row">
      <div class="cache-label-group">
        <span class="cache-label">Cache</span>
        <span class="cache-hit-badge" :class="totalCacheHitClass" v-if="parseFloat(totalCacheMetrics.hitRate) > 0">{{ totalCacheMetrics.hitRate }}%</span>
      </div>
      <div class="cache-values">
        <span class="cache-read">{{ formatNumber(totalCacheMetrics.cacheReadTokens || 0) }} hit</span>
        <span class="cache-sep">&middot;</span>
        <span class="cache-write">{{ formatNumber(totalCacheMetrics.cacheCreationTokens || 0) }} new</span>
        <span class="cache-sep">&middot;</span>
        <span class="cache-miss">{{ formatNumber(totalCacheMetrics.uncachedTokens || 0) }} miss</span>
      </div>
    </div>

    <div v-if="hasTotals && hasSavings" class="cost-row cost-row-baseline">
      <span class="cost-label">{{ isInvestment ? 'Baseline (no cache)' : 'Without Caching' }}</span>
      <span class="cost-value baseline-value" :class="{ struck: !isInvestment }">{{ formatUsd(totalUncachedCost) }}</span>
    </div>

    <div v-if="hasTotals && totalCost > 0" class="cost-row cost-row-total">
      <span class="cost-label">{{ hasSavings ? paidLabel : totalLabel }}</span>
      <span class="cost-value" :class="{ notional: isNotional }">{{ formatUsd(totalCost) }}</span>
    </div>

    <div v-if="hasTotals && isNotional" class="cost-row cost-row-total">
      <span class="cost-label">You Paid</span>
      <span class="cost-value paid-nothing"><span class="paid-note">subscription</span>$0.00</span>
    </div>

    <div v-if="hasTotals && hasSavings" class="savings-block" :class="{ investment: isInvestment }">
      <div class="savings-head">
        <!-- Same word as the tile that opens this drawer: one number, one name. -->
        <span class="savings-label">{{ isInvestment ? 'Cost of Caching' : 'Saved by Caching' }}</span>
        <span class="savings-amount">
          {{ formatUsd(totalSaved) }}
          <span v-if="!isInvestment" class="savings-pct">{{ totalSavedPct.toFixed(1) }}%</span>
          <span v-else class="savings-pct">more</span>
        </span>
      </div>
      <div v-if="!isInvestment" class="savings-track">
        <div class="savings-free" :style="{ width: (100 - paidPct) + '%' }"></div>
        <div class="savings-paid" :style="{ width: paidPct + '%' }"></div>
      </div>
      <div v-if="isInvestment" class="savings-note">
        Writing the cache prefix costs more up front &mdash; it pays back on the next turn.
      </div>
    </div>

    <div v-if="showSubscriptionSavings" class="savings-block subscription">
      <div class="savings-head">
        <span class="savings-label">Saved by Subscription</span>
        <span class="savings-amount">{{ formatUsd(subscriptionSaved) }}</span>
      </div>
      <div class="savings-total">
        <span class="savings-total-label">Total avoided</span>
        <span class="savings-total-value">{{ formatUsd(totalAvoided) }}</span>
      </div>
    </div>

    <div v-if="hasModelMix" class="model-mix">
      <div class="model-mix-head">
        <span>{{ modelMix.length }} models &middot; {{ isNotional ? 'metered split' : 'cost split' }}</span>
        <span class="model-mix-total">{{ formatUsd(modelMixTotal) }}</span>
      </div>
      <div v-for="m in modelMix" :key="m.model" class="model-mix-row">
        <span class="model-mix-name">{{ m.model }}</span>
        <span class="model-mix-calls">{{ m.calls }} {{ m.calls === 1 ? 'turn' : 'turns' }}</span>
        <span class="model-mix-cost">{{ formatUsd(m.cost) }}</span>
      </div>
    </div>


    <!--
      Last TURN, not last call.

      The backend accumulates usage once per tool round and each round re-sends
      the whole conversation, so this input figure is a SUM over N requests.
      Labelled "Last Call" it read as a single request of 4.2M tokens into a 1M
      window — an impossibility that made the whole panel look broken, when the
      number was the correct billed total all along.
    -->
    <div v-if="tokenUsage || cacheMetrics || (estimatedCost != null && estimatedCost > 0)" class="section-divider last-call-divider">Last turn{{ roundCount > 0 ? ` · ${roundCount} round${roundCount === 1 ? '' : 's'}` : '' }}</div>

    <div v-if="tokenUsage" class="token-usage-row subtle">
      <span class="usage-label">Tokens</span>
      <div class="usage-values">
        <span class="in-tokens">{{ formatNumber(tokenUsage.inputTokens || 0) }} in</span>
        <span class="token-sep">&middot;</span>
        <span class="out-tokens">{{ formatNumber(tokenUsage.outputTokens || 0) }} out</span>
        <span class="token-sep">&middot;</span>
        <span class="total-tokens">{{ formatNumber(tokenUsage.totalTokens || 0) }} total</span>
      </div>
    </div>

    <div v-if="cacheMetrics" class="cache-row subtle">
      <div class="cache-label-group">
        <span class="cache-label">Cache</span>
        <span class="cache-hit-badge" :class="cacheHitClass" v-if="parseFloat(cacheMetrics.hitRate) > 0">{{ cacheMetrics.hitRate }}%</span>
      </div>
      <div class="cache-values">
        <span class="cache-read">{{ formatNumber(cacheMetrics.cacheReadTokens || 0) }} hit</span>
        <span class="cache-sep">&middot;</span>
        <span class="cache-write">{{ formatNumber(cacheMetrics.cacheCreationTokens || 0) }} new</span>
        <span class="cache-sep">&middot;</span>
        <span class="cache-miss">{{ formatNumber(cacheMetrics.uncachedTokens || 0) }} miss</span>
      </div>
    </div>

    <div v-if="estimatedCost != null && estimatedCost > 0" class="cost-row subtle">
      <span class="cost-label">Cost</span>
      <span class="cost-value">
        <span v-if="showLastBaseline" class="baseline-inline">was {{ formatUsd(costBreakdown.uncached) }}</span>
        {{ formatUsd(estimatedCost) }}
      </span>
    </div>

    <div v-if="lastManaged" class="last-managed">
      <span class="managed-icon">&#9889;</span>
      <span class="managed-text"> Last managed: {{ lastManaged?.reduction?.toLocaleString() || '0' }} tokens saved </span>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

const USD_PREFIX = '$';

export default {
  name: 'ContextMonitor',
  props: {
    contextStatus: {
      type: Object,
      default: () => ({
        currentTokens: 0,
        tokenLimit: 16000,
        utilizationPercent: 0,
        model: 'N/A',
        messagesCount: 0,
      }),
    },
    lastManaged: {
      type: Object,
      default: null,
    },
    tokenUsage: {
      type: Object,
      default: null,
    },
    cacheMetrics: {
      type: Object,
      default: null,
    },
    estimatedCost: {
      type: Number,
      default: null,
    },
    totalTokenUsage: {
      type: Object,
      default: () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
    },
    totalCost: {
      type: Number,
      default: 0,
    },
    // What this conversation would have cost with caching disabled.
    // null = not priceable (unknown model / no cache pricing) -> row hidden.
    totalUncachedCost: {
      type: Number,
      default: null,
    },
    // Per-turn { actual, uncached, saved } for the Last Call section.
    costBreakdown: {
      type: Object,
      default: null,
    },
    // Every model that served this conversation, costliest first.
    modelMix: {
      type: Array,
      default: () => [],
    },
    // true = subscription seat (cost is notional), false = metered (real
    // money), null = mixed or unknown.
    subscriptionBased: {
      type: Boolean,
      default: null,
    },
    totalCacheMetrics: {
      type: Object,
      default: () => ({ cacheReadTokens: 0, cacheCreationTokens: 0, uncachedTokens: 0, hitRate: '0' }),
    },
    executionsCount: {
      type: Number,
      default: 0,
    },
    /**
     * Requests made during the last turn, round 1 first. Live state, so it is
     * empty after a page reload — the copy degrades to naming the mechanism
     * without claiming a count it cannot know.
     */
    rounds: {
      type: Array,
      default: () => [],
    },
  },
  setup(props) {
    const utilizationPercent = computed(() => {
      if (!props.contextStatus?.tokenLimit || !props.contextStatus?.currentTokens) return 0;
      return Math.min((props.contextStatus.currentTokens / props.contextStatus.tokenLimit) * 100, 100);
    });

    const getUsageClass = () => {
      const percent = utilizationPercent.value;
      if (percent >= 90) return 'critical';
      if (percent >= 75) return 'warning';
      if (percent >= 50) return 'moderate';
      return 'low';
    };

    const breakdown = computed(() => props.contextStatus?.breakdown || null);
    const hasBreakdown = computed(() => !!breakdown.value);

    // Each segment's width is scaled against the FULL context window so the bar
    // visually represents how much of the window each component occupies.
    const limitForScale = computed(() => props.contextStatus?.tokenLimit || 0);
    const segmentPct = (tokens) => {
      if (!limitForScale.value) return 0;
      return Math.min((tokens / limitForScale.value) * 100, 100);
    };
    const systemPct = computed(() => segmentPct(breakdown.value?.systemTokens || 0));
    const toolsPct = computed(() => segmentPct(breakdown.value?.toolTokens || 0));
    const messagesPct = computed(() => segmentPct(breakdown.value?.messagesTokens || 0));
    const outputPct = computed(() => segmentPct(breakdown.value?.outputBufferTokens || 0));

    const hitClass = (rateStr) => {
      const rate = parseFloat(rateStr || 0);
      if (rate >= 80) return 'hit-high';
      if (rate >= 40) return 'hit-medium';
      return 'hit-low';
    };

    const cacheHitClass = computed(() => hitClass(props.cacheMetrics?.hitRate));

    const roundCount = computed(() => props.rounds?.length || 0);


    const totalCacheHitClass = computed(() => hitClass(props.totalCacheMetrics?.hitRate));

    const hasTotals = computed(() => (props.totalTokenUsage?.totalTokens || 0) > 0);
    const hasTotalCache = computed(() => {
      const c = props.totalCacheMetrics;
      return c && ((c.cacheReadTokens || 0) > 0 || (c.cacheCreationTokens || 0) > 0);
    });

    // Savings is a real signed quantity: writing a cache prefix costs 1.25x
    // on Anthropic, so the first turn of a conversation is legitimately more
    // expensive than not caching. Showing that as "investment" is honest;
    // clamping it to zero would not be.
    // A subscription seat is already paid for, so per-token figures are
    // "what this would have cost on the metered API" - not a bill. Saying
    // "You Paid $209.84" of a Claude Max seat is simply false.
    const isNotional = computed(() => props.subscriptionBased === true);
    const paidLabel = computed(() => (isNotional.value ? 'Metered API Would Charge' : 'You Paid'));
    const totalLabel = computed(() => (isNotional.value ? 'Metered API Would Charge' : 'Total Cost'));
    // On a seat the metered-equivalent cost IS the saving: it is the amount
    // the subscription absorbed. Caching already reduced it before this point,
    // so the two layers sum to the full uncached baseline.
    const subscriptionSaved = computed(() => (isNotional.value ? (props.totalCost || 0) : 0));
    const totalAvoided = computed(() => {
      if (!isNotional.value) return totalSaved.value || 0;
      return props.totalUncachedCost != null ? props.totalUncachedCost : subscriptionSaved.value;
    });
    const showSubscriptionSavings = computed(() => isNotional.value && subscriptionSaved.value > 0);
    const hasModelMix = computed(() => (props.modelMix || []).length > 1);
    const modelMixTotal = computed(() =>
      (props.modelMix || []).reduce((acc, m) => acc + (Number(m.cost) || 0), 0));

    const totalSaved = computed(() => {
      if (props.totalUncachedCost == null) return null;
      return props.totalUncachedCost - (props.totalCost || 0);
    });
    const totalSavedPct = computed(() => {
      const base = props.totalUncachedCost;
      if (base == null || base <= 0) return 0;
      return (totalSaved.value / base) * 100;
    });
    // Hide entirely at exactly zero - a provider with no cache pricing would
    // otherwise render a meaningless zero saving.
    const hasSavings = computed(() => totalSaved.value != null && Math.abs(totalSaved.value) > 1e-9);
    const isInvestment = computed(() => (totalSaved.value || 0) < 0);
    // Share of the counterfactual bill actually paid - drives the mini track.
    const paidPct = computed(() => {
      const base = props.totalUncachedCost;
      if (!base || base <= 0) return 100;
      return Math.min(100, Math.max(0, ((props.totalCost || 0) / base) * 100));
    });

    // Only label the per-turn baseline when it is genuinely a "was" — i.e.
    // higher than what was paid. On a write turn it is lower and the wording
    // would mislead.
    const showLastBaseline = computed(() => {
      const b = props.costBreakdown;
      return !!b && b.uncached != null && b.uncached > (props.estimatedCost || 0);
    });

    const formatUsd = (n) => {
      const v = Math.abs(Number(n) || 0);
      return USD_PREFIX + (v < 0.01 ? v.toFixed(6) : v.toFixed(4));
    };

    // Agentic tool loops re-send the whole context every round, so a single
    // conversation reaches hundreds of millions of tokens. Stopping at 'k'
    // rendered 170,781,100 as "170781.1k" - technically correct, unreadable.
    const formatNumber = (num) => {
      const n = Number(num) || 0;
      const abs = Math.abs(n);
      if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
      if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (abs >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    };

    return {
      utilizationPercent,
      getUsageClass,
      cacheHitClass,
      roundCount,
      totalCacheHitClass,
      hasTotals,
      hasTotalCache,
      totalSaved,
      totalSavedPct,
      hasSavings,
      isInvestment,
      paidPct,
      showLastBaseline,
      isNotional,
      paidLabel,
      totalLabel,
      subscriptionSaved,
      totalAvoided,
      showSubscriptionSavings,
      hasModelMix,
      modelMixTotal,
      formatUsd,
      breakdown,
      hasBreakdown,
      systemPct,
      toolsPct,
      messagesPct,
      outputPct,
      formatNumber,
      parseFloat,
    };
  },
};
</script>

<style scoped>
.context-monitor {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 0;
  padding: 12px 16px;
}

.context-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.monitor-title {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.model-badge {
  font-size: 0.7em;
  padding: 2px 8px;
  background: rgba(var(--blue-rgb), 0.1);
  border: 1px solid rgba(var(--blue-rgb), 0.2);
  border-radius: 12px;
  color: var(--color-blue);
  font-family: var(--font-family-mono);
}

.context-bar {
  margin-bottom: 8px;
}

.usage-bar {
  width: 100%;
  height: 6px;
  /* Must be recessed relative to the card, not equal to it, or the meter has
     no visible extent and low fills look like stray pixels. */
  background: rgba(0, 0, 0, 0.5);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 6px;
}

.usage-bar.segmented {
  display: flex;
  gap: 1px;
}

.seg {
  height: 100%;
  transition: width 0.3s ease;
}

.seg-system {
  background: var(--color-blue);
}

.seg-tools {
  background: var(--color-indigo);
}

.seg-messages {
  background: var(--color-green);
}

.seg-output {
  background: rgba(255, 255, 255, 0.42);
  opacity: 1;
}

.context-legend {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 12px;
  margin-top: 6px;
  margin-bottom: 4px;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.7em;
  font-family: var(--font-family-mono);
  color: var(--color-text-muted);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.legend-dot.dot-system {
  background: var(--color-blue);
}

.legend-dot.dot-tools {
  background: var(--color-indigo);
}

.legend-dot.dot-messages {
  background: var(--color-green);
}

.legend-dot.dot-output {
  background: rgba(255, 255, 255, 0.55);
  opacity: 1;
}

.legend-label {
  flex: 1;
}

.legend-value {
  font-weight: 600;
  color: var(--color-text);
}

.usage-fill {
  height: 100%;
  border-radius: 3px;
  transition: all 0.3s ease;
}

.usage-fill.low {
  background: linear-gradient(90deg, var(--color-green), rgba(var(--green-rgb), 0.8));
}

.usage-fill.moderate {
  background: linear-gradient(90deg, var(--color-blue), rgba(var(--blue-rgb), 0.8));
}

.usage-fill.warning {
  background: linear-gradient(90deg, var(--color-orange), rgba(var(--orange-rgb), 0.8));
}

.usage-fill.critical {
  background: linear-gradient(90deg, var(--color-red), rgba(var(--red-rgb), 0.8));
}

.context-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.token-count {
  font-size: 0.8em;
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
}

.percentage {
  font-size: 0.8em;
  font-weight: 600;
  color: var(--color-text);
}

/* Token Usage Row */
.token-usage-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-top: 1px solid rgba(var(--blue-rgb), 0.08);
  margin-top: 4px;
}

.usage-label,
.cache-label,
.cost-label {
  font-size: 0.7em;
  font-weight: 500;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.usage-values {
  display: flex;
  align-items: center;
  font-size: 0.7em;
  font-family: var(--font-family-mono);
  color: var(--color-text-muted);
}

.in-tokens {
  color: var(--color-blue);
}

.out-tokens {
  color: var(--color-indigo);
}

.total-tokens {
  opacity: 0.6;
}

.token-sep {
  margin: 0 3px;
  opacity: 0.3;
}

/* Cache Row */
.cache-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.cache-label-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.cache-hit-badge {
  font-size: 0.6em;
  font-family: var(--font-family-mono);
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 8px;
}

.cache-hit-badge.hit-high {
  background: rgba(var(--green-rgb), 0.15);
  color: var(--color-green);
  border: 1px solid rgba(var(--green-rgb), 0.25);
}

.cache-hit-badge.hit-medium {
  background: rgba(var(--orange-rgb), 0.15);
  color: var(--color-orange);
  border: 1px solid rgba(var(--orange-rgb), 0.25);
}

.cache-hit-badge.hit-low {
  background: rgba(var(--red-rgb), 0.1);
  color: var(--color-red);
  border: 1px solid rgba(var(--red-rgb), 0.2);
}

.cache-values {
  font-size: 0.7em;
  font-family: var(--font-family-mono);
  color: var(--color-text-muted);
}

.cache-read {
  color: var(--color-green);
}

.cache-write {
  color: var(--color-blue);
  opacity: 0.8;
}

.cache-miss {
  opacity: 0.5;
}

.cache-sep {
  margin: 0 3px;
  opacity: 0.3;
}

/* Cost Row */
.cost-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.cost-value {
  font-size: 0.7em;
  font-family: var(--font-family-mono);
  color: var(--color-text-muted);
}

/* Emphasized total cost */
.cost-row-baseline .cost-value.baseline-value,
.baseline-inline {
  /* Fixed rgba rather than a theme token: --color-text-muted resolves very
     dim in some themes, and this number is the anchor of the comparison. */
  color: rgba(255, 255, 255, 0.68);
  margin-right: 6px;
}

.baseline-value.struck {
  text-decoration: line-through;
  text-decoration-color: rgba(229, 61, 143, 0.75);
  text-decoration-thickness: 1.5px;
}

/* No strike here: at this size the line merges with the digit crossbars.
   The "was" label already carries the meaning. */
.baseline-inline {
  color: rgba(255, 255, 255, 0.6);
}

.paid-nothing {
  color: var(--green, #19ef83);
}

/* Not money that was charged - must not outrank the $0.00 beneath it. */
.cost-value.notional {
  color: rgba(255, 255, 255, 0.6);
  font-weight: 500;
}

.paid-note {
  margin-right: 6px;
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
}

.savings-block.subscription {
  background: rgba(18, 224, 255, 0.06);
  border-left-color: var(--cyan, #12e0ff);
}

.savings-block.subscription .savings-amount {
  color: var(--cyan, #12e0ff);
}

.savings-total {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 7px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.savings-total-label {
  font-size: 9px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}

.savings-total-value {
  font-family: var(--font-family-mono, monospace);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text, #e8e8f0);
}

.model-mix {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--terminal-border-color);
}

.model-mix-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 9px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 4px;
}

.model-mix-total {
  font-family: var(--font-family-mono, monospace);
  letter-spacing: 0;
  color: rgba(255, 255, 255, 0.62);
}

.model-mix-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 1px 0;
  font-family: var(--font-family-mono, monospace);
  font-size: 10px;
}

.model-mix-name {
  flex: 1;
  color: rgba(255, 255, 255, 0.72);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-mix-calls {
  color: rgba(255, 255, 255, 0.45);
}

.model-mix-cost {
  color: rgba(255, 255, 255, 0.72);
  min-width: 52px;
  text-align: right;
}

.savings-block {
  margin-top: 8px;
  padding: 8px 10px;
  background: rgba(25, 239, 131, 0.06);
  border-left: 2px solid var(--green, #19ef83);
}

.savings-block.investment {
  background: rgba(255, 149, 0, 0.06);
  border-left-color: var(--gold, #ff9500);
}

.savings-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.savings-label {
  font-size: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
}

.savings-amount {
  font-family: var(--font-family-mono, monospace);
  font-size: 15px;
  font-weight: 600;
  color: var(--green, #19ef83);
}

.savings-block.investment .savings-amount {
  color: var(--gold, #ff9500);
}

.savings-pct {
  font-size: 11px;
  font-weight: 600;
  opacity: 0.92;
  margin-left: 5px;
}

.savings-track {
  display: flex;
  height: 4px;
  margin-top: 7px;
  background: rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

/* The SAVED share is the quantity the label reports, so it gets the solid
   emphasis fill and leads the bar. The paid share is the muted remainder.
   Previously this was inverted: a hatched "saved" portion read as empty
   track, making a 77.2% saving look like a 22.8% one. */
.savings-free {
  background: var(--green, #19ef83);
}

.savings-paid {
  background: rgba(255, 255, 255, 0.22);
}

.savings-block.subscription .savings-free {
  background: var(--cyan, #12e0ff);
}

.savings-note {
  margin-top: 6px;
  font-size: 9px;
  line-height: 1.45;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.55));
}

.cost-row-total .cost-value {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--color-text);
}

/* Section divider labels */
.section-divider {
  font-size: 0.65em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  opacity: 0.7;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--terminal-border-color);
}

.section-divider.last-call-divider {
  opacity: 0.5;
}

/* Subtle rows (last-call stats appear muted vs conversation totals) */
.token-usage-row.subtle,
.cache-row.subtle,
.cost-row.subtle {
  opacity: 0.7;
  border-top: none;
  padding: 2px 0;
}

/* Last Managed */
.last-managed {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.1);
  border-radius: 6px;
  margin-top: 8px;
}

.managed-icon {
  font-size: 0.9em;
}

.managed-text {
  font-size: 0.7em;
  color: var(--color-green);
  font-weight: 500;
}

@media (max-width: 768px) {
  .context-monitor {
    padding: 8px 12px;
  }

  .context-header {
    margin-bottom: 6px;
  }

  .monitor-title {
    font-size: 0.7em;
  }

  .model-badge {
    font-size: 0.65em;
    padding: 1px 6px;
  }
}
</style>
