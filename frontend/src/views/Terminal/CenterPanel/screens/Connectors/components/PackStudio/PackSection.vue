<template>
  <div v-if="items.length > 0" class="loadout-rack" :class="`loadout-${kindKey}`">
    <header class="loadout-header">
      <span class="loadout-icon">
        <i :class="icon"></i>
      </span>
      <span class="loadout-label">{{ title }}</span>
      <span class="loadout-line" aria-hidden="true"></span>
      <span class="loadout-count">×{{ items.length.toString().padStart(2, '0') }}</span>
    </header>

    <ul class="loadout-items">
      <li
        v-for="(item, idx) in items"
        :key="item.id"
        class="armed"
        :style="{ '--i': idx }"
      >
        <span class="armed-bracket bracket-l" aria-hidden="true"></span>
        <span class="armed-bracket bracket-r" aria-hidden="true"></span>

        <div class="armed-body">
          <div class="armed-row">
            <span class="armed-name">{{ item.name || item.title || item.slug || item.id }}</span>
            <button
              class="armed-eject"
              type="button"
              title="Remove from pack"
              @click="$emit('remove', item.id)"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div v-if="item.description" class="armed-desc">{{ item.description }}</div>

          <div v-if="resolveRefs(item).length > 0" class="armed-refs">
            <span class="armed-refs-lbl">DEPS</span>
            <span
              v-for="(ref, i) in resolveRefs(item)"
              :key="i"
              :class="['ref-gem', `is-${ref.status}`]"
              :title="`${ref.kind}: ${ref.name} — ${labelFor(ref.status)}`"
            >
              <span class="gem-jewel"></span>
              <span class="gem-text">{{ ref.name }}</span>
            </span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script>
export default {
  name: 'PackSection',
  props: {
    title: { type: String, required: true },
    icon: { type: String, default: 'fas fa-cube' },
    kindKey: { type: String, required: true },
    items: { type: Array, default: () => [] },
    resolveRefs: { type: Function, default: () => () => [] },
  },
  emits: ['remove'],
  setup() {
    const labelFor = (status) =>
      status === 'bundled' ? 'in this pack'
      : status === 'external' ? 'requires external asset'
      : 'missing — will not resolve on import';
    return { labelFor };
  },
};
</script>

<style scoped>
.loadout-rack {
  --gx: var(--green-rgb, 25, 239, 131);
  --mono: ui-monospace, 'JetBrains Mono', 'SF Mono', 'Cascadia Mono', 'Consolas', monospace;
}

/* ─── section header ─── */
.loadout-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px 8px;
  border-bottom: 1px dashed rgba(var(--gx), 0.18);
  margin-bottom: 8px;
}
.loadout-icon {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--gx), 0.12);
  border: 1px solid rgba(var(--gx), 0.4);
  border-radius: 3px;
  color: rgb(var(--gx));
  font-size: 9px;
}
.loadout-label {
  font-size: 10px;
  letter-spacing: 3px;
  font-weight: 700;
  color: rgb(var(--gx));
  text-shadow: 0 0 6px rgba(var(--gx), 0.4);
}
.loadout-line {
  flex: 1;
  height: 1px;
  background:
    repeating-linear-gradient(90deg,
      rgba(var(--gx), 0.4) 0 4px,
      transparent 4px 8px);
}
.loadout-count {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-muted);
}

/* ─── armed item cards ─── */
.loadout-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.armed {
  position: relative;
  padding: 12px 14px 12px 18px;
  background: linear-gradient(135deg, rgba(var(--gx), 0.06), rgba(0,0,0,0.18));
  border: 1px solid rgba(var(--gx), 0.35);
  border-radius: 4px;
  overflow: hidden;
  animation: armSlide 380ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 35ms);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.armed::before {
  /* energy line on the left */
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg,
    transparent,
    rgb(var(--gx)) 20%,
    rgb(var(--gx)) 80%,
    transparent);
  box-shadow: 0 0 12px rgba(var(--gx), 0.6);
}
.armed:hover {
  border-color: rgba(var(--gx), 0.6);
  box-shadow: 0 0 0 1px rgba(var(--gx), 0.1) inset, 0 8px 24px -10px rgba(var(--gx), 0.5);
}
@keyframes armSlide {
  from { opacity: 0; transform: translateX(8px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}

/* corner brackets */
.armed-bracket {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid rgb(var(--gx));
  pointer-events: none;
  opacity: 0.7;
}
.bracket-l { top: 4px; left: 4px; border-right: none; border-bottom: none; }
.bracket-r { bottom: 4px; right: 4px; border-left: none; border-top: none; }

.armed-body { font-family: var(--mono); }

.armed-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.armed-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.armed-eject {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.12s;
  flex-shrink: 0;
}
.armed-eject:hover {
  background: rgba(255, 100, 100, 0.12);
  border-color: rgba(255, 100, 100, 0.5);
  color: #ff8585;
  transform: rotate(90deg);
}

.armed-desc {
  margin-top: 4px;
  font-size: 10px;
  color: var(--color-text-muted);
  font-style: italic;
  letter-spacing: 0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ─── reference gems ─── */
.armed-refs {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
}
.armed-refs-lbl {
  font-size: 8px;
  letter-spacing: 2px;
  color: var(--color-text-muted);
  margin-right: 4px;
}
.ref-gem {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px 2px 6px;
  font-size: 9px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
  max-width: 180px;
  letter-spacing: 0.2px;
}
.gem-jewel {
  width: 7px;
  height: 7px;
  background: var(--color-text-muted);
  transform: rotate(45deg);
  border-radius: 1px;
}
.gem-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* statuses */
.ref-gem.is-bundled {
  color: rgb(var(--gx));
  border-color: rgba(var(--gx), 0.5);
  background: rgba(var(--gx), 0.08);
}
.ref-gem.is-bundled .gem-jewel {
  background: rgb(var(--gx));
  box-shadow: 0 0 6px rgb(var(--gx));
  animation: jewelPulse 2.4s ease-in-out infinite;
}
@keyframes jewelPulse {
  0%, 100% { box-shadow: 0 0 4px rgb(var(--gx)); }
  50%      { box-shadow: 0 0 10px rgb(var(--gx)); }
}

.ref-gem.is-external {
  color: #f5b342;
  border-color: rgba(245, 179, 66, 0.5);
  background: rgba(245, 179, 66, 0.06);
}
.ref-gem.is-external .gem-jewel { background: #f5b342; box-shadow: 0 0 4px #f5b342; }

.ref-gem.is-missing {
  color: #ff8585;
  border-color: rgba(255, 100, 100, 0.55);
  background: rgba(255, 100, 100, 0.07);
}
.ref-gem.is-missing .gem-jewel {
  background: #ff6464;
  box-shadow: 0 0 6px #ff6464;
  animation: jewelWarn 1.4s ease-in-out infinite;
}
@keyframes jewelWarn {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.4; }
}
</style>
