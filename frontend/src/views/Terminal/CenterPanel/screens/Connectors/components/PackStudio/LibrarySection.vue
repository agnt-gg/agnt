<template>
  <div class="rack" :class="[`rack-${kindKey}`, { collapsed }]">
    <button class="rack-header" @click="collapsed = !collapsed" type="button">
      <span class="chevron">
        <i :class="collapsed ? 'fas fa-caret-right' : 'fas fa-caret-down'"></i>
      </span>
      <span class="rack-icon">
        <i :class="icon"></i>
      </span>
      <span class="rack-label">{{ title }}</span>
      <span class="rack-count">×{{ items.length.toString().padStart(2, '0') }}</span>
      <span class="rack-line" aria-hidden="true"></span>
    </button>

    <ul v-if="!collapsed" class="rack-items">
      <li v-if="items.length === 0" class="rack-empty">
        <i class="fas fa-circle-notch"></i>
        <span>NO {{ title }} :: AVAILABLE</span>
      </li>

      <li
        v-for="(item, idx) in items"
        :key="item.id"
        class="rack-item"
        :class="{ added: isAdded(item.id) }"
        :style="{ '--i': idx }"
        @click="!isAdded(item.id) && $emit('add', item.id)"
      >
        <span class="rack-item-bar" aria-hidden="true"></span>
        <div class="rack-item-body">
          <div class="rack-item-name">{{ item.name || item.title || item.slug || item.id }}</div>
          <div v-if="item.description" class="rack-item-desc">{{ item.description }}</div>
        </div>
        <span class="rack-item-action">
          <i v-if="isAdded(item.id)" class="fas fa-check"></i>
          <i v-else class="fas fa-plus"></i>
        </span>
        <span class="rack-item-scanline" aria-hidden="true"></span>
      </li>
    </ul>
  </div>
</template>

<script>
import { ref } from 'vue';

export default {
  name: 'LibrarySection',
  props: {
    title: { type: String, required: true },
    icon: { type: String, default: 'fas fa-cube' },
    kindKey: { type: String, required: true },
    items: { type: Array, default: () => [] },
    isAdded: { type: Function, required: true },
  },
  emits: ['add'],
  setup() {
    const collapsed = ref(false);
    return { collapsed };
  },
};
</script>

<style scoped>
.rack {
  --gx: var(--green-rgb, 25, 239, 131);
  --mono: ui-monospace, 'JetBrains Mono', 'SF Mono', 'Cascadia Mono', 'Consolas', monospace;
  border: 1px solid rgba(var(--gx), 0.15);
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(var(--gx), 0.025), rgba(0, 0, 0, 0.18));
  overflow: hidden;
  transition: border-color 0.15s;
}
.rack:hover { border-color: rgba(var(--gx), 0.3); }

/* ─── header bar ─── */
.rack-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: var(--mono);
  color: var(--color-text);
  text-align: left;
  transition: background 0.12s;
}
.rack-header:hover { background: rgba(var(--gx), 0.05); }

.chevron {
  width: 12px;
  display: inline-flex;
  justify-content: center;
  color: rgba(var(--gx), 0.6);
  font-size: 10px;
}

.rack-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--gx), 0.1);
  border: 1px solid rgba(var(--gx), 0.3);
  border-radius: 4px;
  color: rgb(var(--gx));
  font-size: 10px;
  filter: drop-shadow(0 0 4px rgba(var(--gx), 0.3));
}

.rack-label {
  font-size: 11px;
  letter-spacing: 2.5px;
  font-weight: 600;
  color: rgb(var(--gx));
}

.rack-count {
  font-size: 10px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
}

.rack-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(var(--gx), 0.3), transparent);
  margin-left: 6px;
}

/* ─── items ─── */
.rack-items {
  list-style: none;
  margin: 0;
  padding: 4px 8px 8px;
  border-top: 1px dashed rgba(var(--gx), 0.12);
}

.rack-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 10px;
  font-size: 10px;
  letter-spacing: 1.5px;
  color: var(--color-text-muted);
  font-style: italic;
}
.rack-empty i { font-size: 9px; opacity: 0.5; }

.rack-item {
  position: relative;
  display: grid;
  grid-template-columns: 4px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 8px 6px;
  margin-top: 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s, transform 0.1s;
  animation: itemFade 280ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 25ms);
}
@keyframes itemFade {
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: none; }
}

.rack-item:hover:not(.added) {
  background: rgba(var(--gx), 0.05);
  border-color: rgba(var(--gx), 0.35);
  transform: translateX(2px);
}
.rack-item:active:not(.added) {
  transform: translateX(0);
  background: rgba(var(--gx), 0.1);
}

.rack-item-bar {
  width: 3px;
  height: 22px;
  background: rgba(var(--gx), 0.25);
  border-radius: 2px;
  transition: background 0.12s, height 0.12s;
}
.rack-item:hover:not(.added) .rack-item-bar {
  background: rgb(var(--gx));
  height: 28px;
  box-shadow: 0 0 8px rgba(var(--gx), 0.6);
}

.rack-item-body { min-width: 0; }
.rack-item-name {
  font-size: 12px;
  color: var(--color-text);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.3px;
}
.rack-item-desc {
  margin-top: 2px;
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-style: italic;
}

.rack-item-action {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(var(--gx), 0.3);
  border-radius: 4px;
  font-size: 10px;
  color: rgb(var(--gx));
  background: rgba(var(--gx), 0.04);
  transition: all 0.15s;
}
.rack-item:hover:not(.added) .rack-item-action {
  background: rgba(var(--gx), 0.18);
  border-color: rgba(var(--gx), 0.7);
  box-shadow: 0 0 12px rgba(var(--gx), 0.45);
}

/* added (locked-out) state */
.rack-item.added {
  background: rgba(var(--gx), 0.03);
  border-color: rgba(var(--gx), 0.18);
  cursor: default;
  opacity: 0.55;
}
.rack-item.added .rack-item-bar { background: rgb(var(--gx)); opacity: 0.6; }
.rack-item.added .rack-item-action {
  border-style: dashed;
  background: transparent;
  color: rgba(var(--gx), 0.7);
}

/* hover scanline */
.rack-item-scanline {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(120deg, transparent 30%, rgba(var(--gx), 0.12) 50%, transparent 70%);
  transform: translateX(-100%);
  transition: transform 0s;
}
.rack-item:hover:not(.added) .rack-item-scanline {
  animation: scan 1.1s linear forwards;
}
@keyframes scan { to { transform: translateX(100%); } }
</style>
