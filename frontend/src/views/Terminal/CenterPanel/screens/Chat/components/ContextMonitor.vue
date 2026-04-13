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
          <div class="seg seg-system" :style="{ width: systemPct + '%' }" :title="`System: ${formatNumber(breakdown.systemTokens)}`"></div>
          <div class="seg seg-tools" :style="{ width: toolsPct + '%' }" :title="`Tools: ${formatNumber(breakdown.toolTokens)}`"></div>
          <div class="seg seg-messages" :style="{ width: messagesPct + '%' }" :title="`Messages: ${formatNumber(breakdown.messagesTokens)}`"></div>
          <div class="seg seg-output" :style="{ width: outputPct + '%' }" :title="`Output buffer: ${formatNumber(breakdown.outputBufferTokens)}`"></div>
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
        <span class="legend-label">Output buffer</span>
        <span class="legend-value">{{ formatNumber(breakdown.outputBufferTokens) }}</span>
      </div>
    </div>

    <!-- Conversation Totals (cumulative across all turns) -->
    <div v-if="hasTotals" class="section-divider">Conversation{{ executionsCount > 0 ? ` · ${executionsCount} call${executionsCount === 1 ? '' : 's'}` : '' }}</div>

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

    <div v-if="hasTotals && totalCost > 0" class="cost-row cost-row-total">
      <span class="cost-label">Cost</span>
      <span class="cost-value">${{ totalCost < 0.01 ? totalCost.toFixed(6) : totalCost.toFixed(4) }}</span>
    </div>

    <!-- Last Call (per-turn debug row) -->
    <div v-if="tokenUsage || cacheMetrics || (estimatedCost != null && estimatedCost > 0)" class="section-divider last-call-divider">Last Call</div>

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
      <span class="cost-value">${{ estimatedCost < 0.01 ? estimatedCost.toFixed(6) : estimatedCost.toFixed(4) }}</span>
    </div>

    <div v-if="lastManaged" class="last-managed">
      <span class="managed-icon">&#9889;</span>
      <span class="managed-text"> Last managed: {{ lastManaged?.reduction?.toLocaleString() || '0' }} tokens saved </span>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue';

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
    totalCacheMetrics: {
      type: Object,
      default: () => ({ cacheReadTokens: 0, cacheCreationTokens: 0, uncachedTokens: 0, hitRate: '0' }),
    },
    executionsCount: {
      type: Number,
      default: 0,
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
    const totalCacheHitClass = computed(() => hitClass(props.totalCacheMetrics?.hitRate));

    const hasTotals = computed(() => (props.totalTokenUsage?.totalTokens || 0) > 0);
    const hasTotalCache = computed(() => {
      const c = props.totalCacheMetrics;
      return c && ((c.cacheReadTokens || 0) > 0 || (c.cacheCreationTokens || 0) > 0);
    });

    const formatNumber = (num) => {
      if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
      }
      return num.toString();
    };

    return {
      utilizationPercent,
      getUsageClass,
      cacheHitClass,
      totalCacheHitClass,
      hasTotals,
      hasTotalCache,
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
  background: var(--color-darker-1);
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
  background: var(--color-text-muted);
  opacity: 0.3;
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
  background: var(--color-text-muted);
  opacity: 0.4;
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
