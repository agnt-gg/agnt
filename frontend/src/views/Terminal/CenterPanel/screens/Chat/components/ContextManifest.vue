<template>
  <div v-if="manifest" class="context-manifest">
    <div class="manifest-header">
      <span class="panel-title">Context Inventory</span>
      <span class="mode-badge" :class="modeClass">{{ modeLabel }}</span>
    </div>

    <!-- Cache prefix stability. The panel already showed a hit RATE; this
         explains WHY it moved, which is the actionable half. -->
    <div v-if="cache" class="manifest-alert" :class="cache.prefixStable ? 'ok' : 'warn'">
      <span class="alert-icon">{{ cache.prefixStable ? '&#10003;' : '&#9888;' }}</span>
      <span class="alert-text">
        <template v-if="cache.prefixStable">
          <b>Prompt prefix stable</b>{{ cache.toolsAdded ? ` — ${cache.toolsAdded} tool${cache.toolsAdded === 1 ? '' : 's'} appended` : '' }}.
        </template>
        <template v-else>
          <b>Prefix changed this turn</b>{{ changedLabel }} — the cached prefix is rewritten at full price.
        </template>
      </span>
    </div>

    <!-- Tools removed to fit the model's limits. This is a capability loss,
         so it gets banner treatment rather than a muted row at the bottom. -->
    <div v-if="manifest.tools.droppedCount > 0" class="manifest-alert warn">
      <span class="alert-icon">&#9888;</span>
      <span class="alert-text">
        <b>{{ manifest.tools.droppedCount }} of {{ notInContextTotal }} tools dropped</b> by the budget cap
        &mdash; still reachable via <code>discover_tools</code>.</span>
    </div>

    <!-- SYSTEM PROMPT -->
    <div class="manifest-group">
      <div class="group-head" @click="toggle('system')">
        <span class="group-arrow">{{ open.system ? '&#9662;' : '&#9656;' }}</span>
        <span class="group-dot dot-system"></span>
        <span class="group-name">System prompt</span>
        <span class="group-count">{{ manifest.system.sections.length }} part{{ manifest.system.sections.length === 1 ? '' : 's' }}</span>
        <span class="group-tokens">{{ formatNumber(manifest.system.total) }}</span>
      </div>
      <div v-if="open.system" class="group-body">
        <div v-for="s in manifest.system.sections" :key="s.id" class="item-row">
          <span class="item-name">{{ s.label }}</span>
          <span v-if="s.frozen" class="why why-frozen">frozen</span>
          <span class="item-tokens">{{ formatNumber(s.tokens) }}</span>
        </div>
      </div>
    </div>

    <!-- TOOLS -->
    <div class="manifest-group">
      <div class="group-head" @click="toggle('tools')">
        <span class="group-arrow">{{ open.tools ? '&#9662;' : '&#9656;' }}</span>
        <span class="group-dot dot-tools"></span>
        <span class="group-name">Tools</span>
        <span class="group-count" :class="{ capped: manifest.tools.droppedCount > 0 }">{{ manifest.tools.count }} of {{ manifest.tools.registryTotal }}</span>
        <span class="group-tokens">{{ formatNumber(manifest.tools.total) }}</span>
      </div>
      <div v-if="open.tools" class="group-body">
        <div class="body-controls">
          <span class="sort-toggle" @click="sortByCost = !sortByCost">
            sort: {{ sortByCost ? 'cost' : 'load order' }}
          </span>
        </div>
        <div v-for="t in visibleTools" :key="t.name" class="item-row">
          <span class="item-name">{{ t.name }}</span>
          <span class="why" :class="whyClass(t.reason)">{{ whyLabel(t) }}</span>
          <span class="item-tokens">{{ formatNumber(t.tokens) }}</span>
        </div>
        <div v-if="hiddenToolCount > 0" class="show-more" @click="showAllTools = true">
          &#65291; {{ hiddenToolCount }} more
        </div>
        <div v-else-if="showAllTools && manifest.tools.items.length > TOOL_PREVIEW" class="show-more" @click="showAllTools = false">
          &#8722; collapse
        </div>
      </div>
    </div>

    <!-- MESSAGES -->
    <div class="manifest-group">
      <div class="group-head" @click="toggle('messages')">
        <span class="group-arrow">{{ open.messages ? '&#9662;' : '&#9656;' }}</span>
        <span class="group-dot dot-messages"></span>
        <span class="group-name">Messages</span>
        <span class="group-count">{{ manifest.messages.count }}</span>
        <span class="group-tokens">{{ formatNumber(manifest.messages.total) }}</span>
      </div>
      <div v-if="open.messages" class="group-body">
        <div class="item-row">
          <span class="item-name">In this request</span>
          <span class="item-tokens">{{ manifest.messages.count }}</span>
        </div>
        <div v-if="manifest.messages.managed" class="item-row">
          <span class="item-name">Trimmed to fit</span>
          <span class="why why-deny">managed</span>
          <span class="item-tokens">-{{ formatNumber(manifest.messages.reduction) }}</span>
        </div>
      </div>
    </div>

    <!-- NOT IN CONTEXT — the half the panel could never show -->
    <div v-if="notInContextTotal > 0" class="manifest-group">
      <div class="group-head" @click="toggle('hidden')">
        <span class="group-arrow">{{ open.hidden ? '&#9662;' : '&#9656;' }}</span>
        <span class="group-dot dot-hidden"></span>
        <span class="group-name muted">Not in context</span>
        <span class="group-count">{{ notInContextTotal }}</span>
        <span class="group-tokens muted">&mdash;</span>
      </div>
      <div v-if="open.hidden" class="group-body">
        <div v-if="manifest.tools.hiddenCount > 0" class="item-row">
          <span class="item-name">{{ manifest.tools.hiddenCount }} tools reachable via discover_tools</span>
        </div>
        <div v-if="manifest.tools.droppedCount > 0" class="item-row">
          <span class="item-name">of which {{ manifest.tools.droppedCount }} dropped by the budget cap</span>
          <span class="why why-deny">capped</span>
        </div>
        <div v-if="manifest.tools.deniedCount > 0" class="item-row">
          <span class="item-name">{{ manifest.tools.deniedCount }} turned off by you</span>
          <span class="why why-deny">opt-out</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed } from 'vue';

const TOOL_PREVIEW = 8;

export default {
  name: 'ContextManifest',
  props: {
    manifest: {
      type: Object,
      default: null,
    },
  },
  setup(props) {
    const open = reactive({ system: true, tools: true, messages: false, hidden: false });
    const showAllTools = ref(false);
    const sortByCost = ref(false);

    const toggle = (key) => { open[key] = !open[key]; };

    const cache = computed(() => props.manifest?.cache || null);

    const changedLabel = computed(() => {
      const changed = cache.value?.changedSections || [];
      if (changed.length) return ` (${changed.join(', ')} refreshed)`;
      if (cache.value && cache.value.toolsStable === false) return ' (tool order changed)';
      return '';
    });

    const MODE_LABELS = {
      auto: 'auto',
      'auto-degraded': 'auto',
      whitelist: 'custom',
      specialty: 'page tools',
      agent: 'agent',
    };
    const modeLabel = computed(() => MODE_LABELS[props.manifest?.mode] || props.manifest?.mode || '');
    const modeClass = computed(() => (props.manifest?.mode === 'whitelist' ? 'mode-custom' : 'mode-auto'));

    const sortedTools = computed(() => {
      const items = props.manifest?.tools?.items || [];
      if (!sortByCost.value) return items;
      return [...items].sort((a, b) => b.tokens - a.tokens);
    });

    const visibleTools = computed(() =>
      showAllTools.value ? sortedTools.value : sortedTools.value.slice(0, TOOL_PREVIEW)
    );
    const hiddenToolCount = computed(() =>
      showAllTools.value ? 0 : Math.max(0, sortedTools.value.length - TOOL_PREVIEW)
    );

    const notInContextTotal = computed(() => {
      const t = props.manifest?.tools;
      if (!t) return 0;
      return (t.hiddenCount || 0) + (t.droppedCount || 0) + (t.deniedCount || 0);
    });

    const WHY_CLASS = {
      default: 'why-default',
      group: 'why-group',
      discovered: 'why-discovered',
      universal: 'why-default',
      specialty: 'why-group',
      assigned: 'why-discovered',
      selected: 'why-default',
    };
    const whyClass = (reason) => WHY_CLASS[reason] || 'why-default';
    const whyLabel = (t) => {
      if (t.reason === 'group' && t.group) return t.group;
      return t.reason;
    };

    const formatNumber = (num) => {
      const n = Number(num) || 0;
      const abs = Math.abs(n);
      if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
      if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
      if (abs >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    };

    return {
      open, toggle, cache, changedLabel, modeLabel, modeClass,
      visibleTools, hiddenToolCount, showAllTools, sortByCost,
      notInContextTotal, whyClass, whyLabel, formatNumber, TOOL_PREVIEW,
    };
  },
};
</script>

<style scoped>
.context-manifest {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 0;
  margin-top: 0;
}

.manifest-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.panel-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.6));
}

.mode-badge {
  font-family: var(--font-family-mono, monospace);
  font-size: 9px;
  padding: 1px 8px;
  border-radius: 12px;
}

.mode-auto {
  background: rgba(18, 224, 255, 0.1);
  border: 1px solid rgba(18, 224, 255, 0.25);
  color: var(--cyan, #12e0ff);
}

.mode-custom {
  background: rgba(229, 61, 143, 0.1);
  border: 1px solid rgba(229, 61, 143, 0.25);
  color: var(--pink, #e53d8f);
}

.manifest-alert {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin: 10px 16px;
  padding: 7px 9px;
  font-size: 10px;
  line-height: 1.5;
  border-left: 2px solid;
}

.manifest-alert.ok {
  background: rgba(25, 239, 131, 0.06);
  border-color: var(--green, #19ef83);
  color: var(--color-green);
}

.manifest-alert.warn {
  background: rgba(255, 149, 0, 0.07);
  border-color: var(--gold, #ff9500);
  color: var(--status-amber-text);
}

.manifest-group {
  border-top: 1px solid var(--terminal-border-color);
}

.group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 16px;
  cursor: pointer;
  user-select: none;
}

.group-head:hover {
  background: rgba(255, 255, 255, 0.03);
}

.group-arrow {
  font-size: 10px;
  width: 10px;
  color: var(--text-secondary);
}

.group-head:hover .group-arrow {
  color: var(--cyan, #12e0ff);
}

.group-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.dot-system { background: var(--cyan, #12e0ff); }
.dot-tools { background: var(--purple, #7d3de5); }
.dot-messages { background: var(--green, #19ef83); }
.dot-hidden { background: rgba(255, 255, 255, 0.25); }

.group-name {
  flex: 1;
  font-size: 11px;
  color: var(--color-text, #e8e8f0);
}

.group-name.muted,
.group-tokens.muted {
  color: var(--color-text-muted, rgba(255, 255, 255, 0.5));
}

.group-count {
  font-family: var(--font-family-mono, monospace);
  font-size: 9px;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.45));
}

.group-tokens {
  font-family: var(--font-family-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  min-width: 42px;
  text-align: right;
  color: var(--color-text, #e8e8f0);
}

.group-body {
  padding: 3px 16px 9px 32px;
  background: rgba(0, 0, 0, 0.18);
}

.body-controls {
  display: flex;
  justify-content: flex-end;
  padding: 2px 0 4px;
}

.sort-toggle,
.show-more {
  font-family: var(--font-family-mono, monospace);
  font-size: 9px;
  color: var(--text-secondary);
  cursor: pointer;
}

/* Reads as a control, not as a value that belongs to the row above it. */
.sort-toggle {
  padding: 2px 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 3px;
}

.sort-toggle:hover {
  border-color: rgba(18, 224, 255, 0.5);
}

.group-count.capped {
  color: var(--gold, #ff9500);
}

.sort-toggle:hover,
.show-more:hover {
  color: var(--cyan, #12e0ff);
}

.show-more {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 7px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 3px;
}

.show-more:hover {
  border-color: rgba(18, 224, 255, 0.5);
}

.item-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 0;
  font-family: var(--font-family-mono, monospace);
  font-size: 10px;
}

.item-name {
  flex: 1;
  color: var(--color-text-muted, rgba(255, 255, 255, 0.62));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-tokens {
  color: var(--text-secondary);
  min-width: 36px;
  text-align: right;
}

.manifest-alert code {
  font-family: var(--font-family-mono, monospace);
  font-size: 9.5px;
  padding: 0 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
}

.why {
  font-size: 8px;
  padding: 1px 6px;
  border-radius: 3px;
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.why-default {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-tertiary);
}

.why-group {
  background: rgba(125, 61, 229, 0.2);
  color: var(--status-purple-text);
}

.why-discovered {
  background: rgba(25, 239, 131, 0.14);
  color: var(--green, #19ef83);
}

.why-frozen {
  background: rgba(18, 224, 255, 0.12);
  color: var(--cyan, #12e0ff);
}

.why-deny {
  background: rgba(229, 61, 143, 0.15);
  color: var(--pink, #e53d8f);
}
</style>
