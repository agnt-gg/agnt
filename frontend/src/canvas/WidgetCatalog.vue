<template>
  <Teleport to="body">
    <div v-if="isOpen" class="wc-backdrop" @click.self="$emit('close')">
      <div class="wc-modal">
        <!-- Header -->
        <div class="wc-header">
          <span class="wc-title">ADD WIDGET</span>
          <button class="wc-close" @click="$emit('close')"><i class="fas fa-times"></i></button>
        </div>

        <!-- Search -->
        <div class="wc-search">
          <i class="fas fa-search"></i>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search widgets..."
            ref="searchInput"
          />
        </div>

        <!-- Category tabs -->
        <div class="wc-tabs">
          <button
            v-for="cat in categories"
            :key="cat.id"
            class="wc-tab"
            :class="{ active: activeCategory === cat.id }"
            @click="activeCategory = cat.id"
          >
            {{ cat.label }}
          </button>
        </div>

        <!-- Widget grid -->
        <div class="wc-body">
          <div class="wc-grid">
            <div
              v-for="widget in filteredWidgets"
              :key="widget.id"
              class="wc-card"
              :class="{ 'wc-active': isOnPage(widget.id) }"
              @click="toggleWidget(widget)"
            >
              <div class="wc-card-icon"><i :class="widget.icon"></i></div>
              <div class="wc-card-name">{{ widget.name }}</div>
              <div class="wc-card-desc">{{ widget.description }}</div>
              <div class="wc-card-size">{{ widget.defaultSize.cols }}x{{ widget.defaultSize.rows }}</div>
              <span v-if="isOnPage(widget.id)" class="wc-badge wc-on">ON PAGE</span>
              <span v-else class="wc-badge wc-free">AVAILABLE</span>
            </div>
          </div>

          <div v-if="filteredWidgets.length === 0" class="wc-empty">
            <p>No widgets match your search</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { ref, computed, watch, nextTick } from 'vue';
import { useStore } from 'vuex';
import { getAllWidgets, getWidget } from './widgetRegistry.js';

export default {
  name: 'WidgetCatalog',
  props: {
    isOpen: { type: Boolean, default: false },
    pageId: { type: String, required: true },
  },
  emits: ['close'],
  setup(props) {
    const store = useStore();
    const searchQuery = ref('');
    const activeCategory = ref('all');
    const searchInput = ref(null);

    const categories = computed(() => {
      const cats = [{ id: 'all', label: 'All' }];
      const seen = new Set();
      for (const w of getAllWidgets()) {
        if (!seen.has(w.category)) {
          seen.add(w.category);
          cats.push({
            id: w.category,
            label: w.category.charAt(0).toUpperCase() + w.category.slice(1),
          });
        }
      }
      return cats;
    });

    const filteredWidgets = computed(() => {
      let widgets = getAllWidgets();

      if (activeCategory.value !== 'all') {
        widgets = widgets.filter((w) => w.category === activeCategory.value);
      }

      if (searchQuery.value.trim()) {
        const q = searchQuery.value.toLowerCase();
        widgets = widgets.filter(
          (w) =>
            w.name.toLowerCase().includes(q) ||
            w.description.toLowerCase().includes(q) ||
            w.category.toLowerCase().includes(q),
        );
      }

      return widgets;
    });

    const currentLayout = computed(() => {
      return store.getters['widgetLayout/pageLayout'](props.pageId) || [];
    });

    function isOnPage(widgetId) {
      return currentLayout.value.some((w) => w.widgetId === widgetId);
    }

    function toggleWidget(widget) {
      if (isOnPage(widget.id)) {
        // Remove all instances of this widget from page
        const instances = currentLayout.value.filter((w) => w.widgetId === widget.id);
        for (const inst of instances) {
          store.dispatch('widgetLayout/removeWidget', {
            pageId: props.pageId,
            instanceId: inst.instanceId,
          });
        }
      } else {
        // Add widget
        store.dispatch('widgetLayout/addWidget', {
          pageId: props.pageId,
          widgetId: widget.id,
          cols: widget.defaultSize.cols,
          rows: widget.defaultSize.rows,
        });
      }
    }

    // Auto-focus search on open
    watch(
      () => props.isOpen,
      (open) => {
        if (open) {
          nextTick(() => searchInput.value?.focus());
        } else {
          searchQuery.value = '';
          activeCategory.value = 'all';
        }
      },
    );

    return {
      searchQuery,
      activeCategory,
      searchInput,
      categories,
      filteredWidgets,
      isOnPage,
      toggleWidget,
    };
  },
};
</script>

<style scoped>
.wc-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.wc-modal {
  background: var(--color-darker-0, #0a0a14);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 64px rgba(0, 0, 0, 0.5);
}

.wc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.wc-title {
  font-size: var(--font-size-xs, 11px);
  letter-spacing: 2px;
  color: var(--color-green);
  font-weight: 600;
}

.wc-close {
  background: none;
  border: none;
  color: var(--color-text-muted, #556);
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  transition: color 0.15s;
}

.wc-close:hover {
  color: #e05a5a;
}

/* ── Search ── */
.wc-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.wc-search i {
  color: var(--color-text-muted, #445);
  font-size: 12px;
}

.wc-search input {
  flex: 1;
  background: none;
  border: none;
  color: var(--color-light-0, #aab);
  font-size: var(--font-size-sm, 13px);
  font-family: inherit;
  outline: none;
}

.wc-search input::placeholder {
  color: var(--color-text-muted, #334);
}

/* ── Category tabs ── */
.wc-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  overflow-x: auto;
  border-bottom: 1px solid var(--terminal-border-color);
}

.wc-tab {
  background: none;
  border: 1px solid transparent;
  color: var(--color-text-muted, #556);
  font-size: var(--font-size-xs, 11px);
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.wc-tab:hover {
  color: var(--color-light-0, #aab);
  border-color: rgba(255, 255, 255, 0.05);
}

.wc-tab.active {
  color: var(--color-green);
  border-color: rgba(25, 239, 131, 0.25);
  background: rgba(25, 239, 131, 0.06);
}

/* ── Body ── */
.wc-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.wc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.wc-card {
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
  position: relative;
}

.wc-card:hover {
  border-color: rgba(25, 239, 131, 0.3);
  background: rgba(255, 255, 255, 0.04);
}

.wc-card.wc-active {
  border-color: rgba(25, 239, 131, 0.25);
  background: rgba(25, 239, 131, 0.04);
}

.wc-card-icon {
  font-size: 18px;
  color: var(--color-text-muted, #556);
  margin-bottom: 6px;
}

.wc-card.wc-active .wc-card-icon {
  color: var(--color-green);
}

.wc-card-name {
  font-size: var(--font-size-xs, 11px);
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--color-light-0, #aab);
  margin-bottom: 4px;
  font-weight: 600;
}

.wc-card-desc {
  font-size: 10px;
  color: var(--color-text-muted, #445);
  margin-bottom: 6px;
}

.wc-card-size {
  font-size: 9px;
  color: var(--color-text-muted, #334);
  letter-spacing: 1px;
}

.wc-badge {
  display: inline-block;
  font-size: 9px;
  letter-spacing: 0.5px;
  padding: 2px 6px;
  border-radius: 3px;
  margin-top: 6px;
}

.wc-on {
  background: rgba(25, 239, 131, 0.12);
  color: var(--color-green);
}

.wc-free {
  background: rgba(100, 100, 200, 0.12);
  color: var(--color-text-muted, #667);
}

.wc-empty {
  text-align: center;
  padding: 32px;
  color: var(--color-text-muted, #445);
  font-size: var(--font-size-sm, 13px);
}
</style>
