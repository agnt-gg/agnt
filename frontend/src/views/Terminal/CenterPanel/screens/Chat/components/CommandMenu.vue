<template>
  <div v-if="isOpen && items.length > 0" class="command-menu" :style="menuStyle" ref="menuRef">
    <div class="command-menu-header">
      <span class="command-menu-trigger">{{ headerLabel }}</span>
      <span class="command-menu-hint">{{ query ? `filtering: "${query}"` : 'type to filter' }}</span>
    </div>

    <div class="command-menu-list" ref="listRef">
      <div
        v-for="(item, index) in items"
        :key="item.id"
        class="command-menu-item"
        :class="{ 'is-selected': index === selectedIndex }"
        :ref="(el) => setItemRef(el, index)"
        @mouseenter="$emit('hover', index)"
        @click="$emit('select', item)"
      >
        <span class="item-icon" :class="getIconClass(item)">
          <img v-if="isImageSrc(item.icon)" :src="item.icon" class="item-icon-img" alt="" />
          <i v-else-if="isFontIcon(item.icon)" :class="item.icon"></i>
          <span v-else class="item-icon-letter">{{ getInitial(item) }}</span>
        </span>
        <div class="item-content">
          <span class="item-name">{{ item.name }}</span>
          <span v-if="item.description" class="item-description">{{ item.description }}</span>
        </div>
        <span class="item-type-badge">{{ item.subtype || item.type }}</span>
      </div>
    </div>

    <div class="command-menu-footer">
      <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span>
      <span><kbd>Tab</kbd> or <kbd>Enter</kbd> select</span>
      <span><kbd>Esc</kbd> dismiss</span>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick } from 'vue';

export default {
  name: 'CommandMenu',
  props: {
    isOpen: { type: Boolean, default: false },
    items: { type: Array, default: () => [] },
    selectedIndex: { type: Number, default: 0 },
    triggerChar: { type: String, default: null },
    query: { type: String, default: '' },
    position: { type: Object, default: () => ({ bottom: 0, left: 0, width: 400 }) },
  },
  emits: ['select', 'hover'],
  setup(props) {
    const menuRef = ref(null);
    const listRef = ref(null);
    const itemRefs = ref({});

    const headerLabel = computed(() => {
      switch (props.triggerChar) {
        case '@': return 'Mention an Agent';
        case '/': return 'Commands';
        case '#': return 'Reference';
        default: return 'Menu';
      }
    });

    const menuStyle = computed(() => ({
      bottom: `${props.position.bottom}px`,
      left: `${props.position.left}px`,
      width: `${Math.min(props.position.width || 400, 440)}px`,
    }));

    function setItemRef(el, index) {
      if (el) itemRefs.value[index] = el;
    }

    function isImageSrc(icon) {
      if (!icon) return false;
      return icon.startsWith('data:') || icon.startsWith('http') || icon.startsWith('/') || icon.startsWith('blob:');
    }

    function isFontIcon(icon) {
      if (!icon) return false;
      return icon.startsWith('fas ') || icon.startsWith('fab ') || icon.startsWith('far ');
    }

    function getInitial(item) {
      return (item.name || '?').charAt(0).toUpperCase();
    }

    function getIconClass(item) {
      return {
        'icon-agent': item.type === 'agent',
        'icon-command': item.type === 'command',
        'icon-hashtag': item.type === 'hashtag',
      };
    }

    // Auto-scroll selected item into view
    watch(() => props.selectedIndex, async (index) => {
      await nextTick();
      const el = itemRefs.value[index];
      if (el && listRef.value) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });

    return {
      menuRef,
      listRef,
      itemRefs,
      headerLabel,
      menuStyle,
      setItemRef,
      isImageSrc,
      isFontIcon,
      getInitial,
      getIconClass,
    };
  },
};
</script>

<style scoped>
.command-menu {
  position: fixed;
  z-index: 9999;
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow: hidden;
}

.command-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.command-menu-trigger {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.command-menu-hint {
  font-size: 0.7em;
  color: var(--color-med-navy);
}

.command-menu-list {
  overflow-y: auto;
  flex: 1;
  scrollbar-width: thin;
  scrollbar-color: var(--color-duller-navy) transparent;
}

.command-menu-list::-webkit-scrollbar {
  width: 4px;
}

.command-menu-list::-webkit-scrollbar-track {
  background: transparent;
}

.command-menu-list::-webkit-scrollbar-thumb {
  background-color: var(--color-duller-navy);
  border-radius: 2px;
}

.command-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.command-menu-item:hover,
.command-menu-item.is-selected {
  background: var(--color-darker-2);
}

.command-menu-item.is-selected {
  border-left: 2px solid var(--color-primary);
  padding-left: 10px;
}

.item-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85em;
  flex-shrink: 0;
}

.item-icon-img {
  width: 100%;
  height: 100%;
  border-radius: 4px;
  object-fit: cover;
}

.item-icon-letter {
  font-weight: 600;
  font-size: 0.9em;
}

.item-icon.icon-agent {
  background: rgba(100, 200, 255, 0.12);
  color: #64c8ff;
  overflow: hidden;
}

.item-icon.icon-command {
  background: rgba(160, 120, 255, 0.12);
  color: #a078ff;
}

.item-icon.icon-hashtag {
  background: rgba(100, 255, 160, 0.12);
  color: #64ffa0;
}

.item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.item-name {
  font-size: 0.85em;
  color: var(--color-text);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-description {
  font-size: 0.7em;
  color: var(--color-med-navy);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-type-badge {
  font-size: 0.6em;
  color: var(--color-med-navy);
  background: var(--color-darker-0);
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.command-menu-footer {
  display: flex;
  gap: 12px;
  padding: 6px 12px;
  border-top: 1px solid var(--terminal-border-color);
  font-size: 0.65em;
  color: var(--color-med-navy);
}

.command-menu-footer kbd {
  background: var(--color-darker-2);
  border: 1px solid var(--terminal-border-color);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: inherit;
  font-size: 0.95em;
  color: var(--color-dull-white);
}
</style>
