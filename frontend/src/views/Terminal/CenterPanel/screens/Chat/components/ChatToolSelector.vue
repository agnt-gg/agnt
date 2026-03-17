<template>
  <div class="chat-tool-selector" ref="selectorRef">
    <div class="tool-dropdown">
      <div class="dropdown-header">
        <span class="dropdown-title">Tools</span>
        <div class="header-actions">
          <button @click="enableAll" class="header-btn" title="Enable All"><i class="fas fa-check-double"></i></button>
          <button @click="disableAllOptional" class="header-btn" title="Reset"><i class="fas fa-undo"></i></button>
          <button @click="$emit('close')" class="close-btn"><i class="fas fa-times"></i></button>
        </div>
      </div>

      <div class="dropdown-content">
        <div class="tool-summary">
          <div class="summary-label">Enabled:</div>
          <div class="summary-count">{{ enabledCount }} / {{ totalCount }} tools</div>
        </div>

        <div v-if="isLoading" class="tool-loading">
          <div class="loading-spinner"></div>
          <span>Loading tools...</span>
        </div>

        <template v-if="!isLoading">
          <div v-for="cat in categories" :key="cat.id" class="tool-section">
            <div class="section-header" @click="toggleExpand(cat.id)">
              <span class="section-expand">{{ expanded[cat.id] ? '\u25BE' : '\u25B8' }}</span>
              <label class="group-toggle" @click.stop>
                <input type="checkbox" :checked="isCategoryEnabled(cat)" @change="toggleCategory(cat)" />
                <span class="toggle-switch"></span>
              </label>
              <span class="section-title">{{ cat.name }}</span>
              <span class="section-badge">{{ getCategoryEnabledCount(cat) }}/{{ cat.tools.length }}</span>
            </div>
            <div v-if="cat.description && expanded[cat.id]" class="cat-description">{{ cat.description }}</div>
            <div v-if="expanded[cat.id]" class="section-tools">
              <label v-for="tool in cat.tools" :key="tool.name" class="tool-item toggleable">
                <input type="checkbox" :checked="isToolEnabled(tool.name)" @change="toggleTool(tool.name)" />
                <span class="toggle-switch"></span>
                <span class="tool-name">{{ tool.name }}</span>
              </label>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { API_CONFIG } from '@/../user.config.js';

var STORAGE_KEY = 'agnt_enabled_tools';

export default {
  name: 'ChatToolSelector',
  props: {
    isOpen: { type: Boolean, default: false },
  },
  emits: ['close'],
  setup(props, { emit }) {
    var selectorRef = ref(null);
    var isLoading = ref(true);
    var categories = ref([]);
    var enabledTools = ref(new Set());
    var expanded = ref({});

    var saveState = function () {
      var enabled = [];
      var disabled = [];
      categories.value.forEach(function (cat) {
        if (cat.locked) return;
        cat.tools.forEach(function (t) {
          if (enabledTools.value.has(t.name)) {
            enabled.push(t.name);
          } else {
            disabled.push(t.name);
          }
        });
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled));
      localStorage.setItem('agnt_disabled_tools', JSON.stringify(disabled));
    };

    var fetchTools = async function () {
      isLoading.value = true;
      try {
        var token = localStorage.getItem('token');
        var resp = await fetch(API_CONFIG.BASE_URL + '/orchestrator/tools', {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!resp.ok) throw new Error(resp.status);
        var data = await resp.json();
        categories.value = data.categories || [];

        // Start with ALL tools enabled (locked ones are always on anyway)
        var allNames = new Set();
        categories.value.forEach(function (cat) {
          cat.tools.forEach(function (t) {
            allNames.add(t.name);
          });
        });
        enabledTools.value = new Set(allNames);

        // Apply saved disabled state
        try {
          var disabled = JSON.parse(localStorage.getItem('agnt_disabled_tools') || '[]');
          disabled.forEach(function (name) {
            enabledTools.value.delete(name);
          });
        } catch (e) {
          /* ignore */
        }
        enabledTools.value = new Set(enabledTools.value);
      } catch (err) {
        console.error('[ChatToolSelector] fetch failed:', err);
      }
      isLoading.value = false;
    };

    var totalCount = computed(function () {
      var count = 0;
      categories.value.forEach(function (cat) {
        count += cat.tools.length;
      });
      return count;
    });

    var enabledCount = computed(function () {
      var count = 0;
      categories.value.forEach(function (cat) {
        cat.tools.forEach(function (t) {
          if (enabledTools.value.has(t.name)) count++;
        });
      });
      return count;
    });

    var isToolEnabled = function (name) {
      return enabledTools.value.has(name);
    };

    var toggleTool = function (name) {
      if (enabledTools.value.has(name)) {
        enabledTools.value.delete(name);
      } else {
        enabledTools.value.add(name);
      }
      enabledTools.value = new Set(enabledTools.value);
      saveState();
    };

    var isCategoryEnabled = function (cat) {
      return (
        cat.tools.length > 0 &&
        cat.tools.every(function (t) {
          return enabledTools.value.has(t.name);
        })
      );
    };

    var getCategoryEnabledCount = function (cat) {
      var count = 0;
      cat.tools.forEach(function (t) {
        if (enabledTools.value.has(t.name)) count++;
      });
      return count;
    };

    var toggleCategory = function (cat) {
      var allOn = isCategoryEnabled(cat);
      cat.tools.forEach(function (t) {
        if (allOn) {
          enabledTools.value.delete(t.name);
        } else {
          enabledTools.value.add(t.name);
        }
      });
      enabledTools.value = new Set(enabledTools.value);
      saveState();
    };

    var toggleExpand = function (id) {
      expanded.value = Object.assign({}, expanded.value);
      expanded.value[id] = !expanded.value[id];
    };

    var enableAll = function () {
      categories.value.forEach(function (cat) {
        cat.tools.forEach(function (t) {
          enabledTools.value.add(t.name);
        });
      });
      enabledTools.value = new Set(enabledTools.value);
      saveState();
    };

    var disableAllOptional = function () {
      categories.value.forEach(function (cat) {
        cat.tools.forEach(function (t) {
          enabledTools.value.delete(t.name);
        });
      });
      enabledTools.value = new Set(enabledTools.value);
      saveState();
    };

    var handleClickOutside = function (event) {
      if (!props.isOpen) return;
      if (selectorRef.value && selectorRef.value.contains(event.target)) return;
      emit('close');
    };

    var handleEscape = function (event) {
      if (event.key === 'Escape' && props.isOpen) emit('close');
    };

    onMounted(function () {
      fetchTools();
      setTimeout(function () {
        document.addEventListener('click', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
      }, 100);
    });

    onUnmounted(function () {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    });

    return {
      selectorRef: selectorRef,
      isLoading: isLoading,
      categories: categories,
      enabledTools: enabledTools,
      expanded: expanded,
      totalCount: totalCount,
      enabledCount: enabledCount,
      isToolEnabled: isToolEnabled,
      toggleTool: toggleTool,
      isCategoryEnabled: isCategoryEnabled,
      getCategoryEnabledCount: getCategoryEnabledCount,
      toggleCategory: toggleCategory,
      toggleExpand: toggleExpand,
      enableAll: enableAll,
      disableAllOptional: disableAllOptional,
    };
  },
};
</script>

<style scoped>
.chat-tool-selector {
  position: fixed;
  bottom: 140px;
  right: 399px;
  z-index: 10000;
}

.tool-dropdown {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  min-width: 320px;
  max-width: 400px;
}

.dropdown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  border-radius: 8px 8px 0 0;
}

.dropdown-title {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--color-light-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.header-actions {
  display: flex;
  gap: 2px;
  align-items: center;
}

.header-btn {
  background: transparent;
  border: none;
  color: var(--color-med-navy);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-size: 0.9em;
}

.header-btn:hover {
  background: rgba(127, 129, 147, 0.15);
  color: var(--color-light-med-navy);
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--color-med-navy);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-size: 1em;
}

.close-btn:hover {
  background: rgba(255, 107, 107, 0.1);
  color: var(--color-red);
}

.dropdown-content {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(127, 129, 147, 0.2) transparent;
}

.tool-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid rgba(var(--green-rgb), 0.15);
  border-radius: 6px;
}

.summary-label {
  font-size: 0.75em;
  font-weight: 500;
  color: var(--color-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.summary-count {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--color-green);
}

.tool-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--color-med-navy);
  font-size: 0.85em;
}

.loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--terminal-border-color);
  border-top-color: var(--color-green);
  border-radius: 50%;
  animation: tool-spin 0.6s linear infinite;
}

@keyframes tool-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Category sections */
.tool-section {
  padding: 8px 12px;
  background: rgba(127, 129, 147, 0.05);
  border-radius: 6px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
  padding: 2px 0;
}

.section-expand {
  font-size: 0.8em;
  color: var(--color-med-navy);
  width: 12px;
}

.cat-icon {
  font-size: 0.65em;
  color: var(--color-med-navy);
  opacity: 0.5;
}

.section-title {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--color-light-med-navy);
}

.section-badge {
  font-size: 0.7em;
  color: var(--color-med-navy);
  background: var(--color-darker-2);
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 500;
}

.section-hint {
  font-size: 0.7em;
  color: var(--color-med-navy);
  font-style: italic;
  margin-left: auto;
}

.cat-description {
  font-size: 0.7em;
  color: var(--color-med-navy);
  padding: 4px 0 4px 20px;
  line-height: 1.3;
}

/* Category toggle */
.group-toggle {
  display: flex;
  align-items: center;
  cursor: pointer;
}

.group-toggle input[type='checkbox'] {
  display: none;
}

/* Tool list */
.section-tools {
  padding: 6px 0 2px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tool-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 0.8em;
}

.tool-item.toggleable {
  cursor: pointer;
  transition: background 0.15s ease;
}

.tool-item.toggleable:hover {
  background: rgba(127, 129, 147, 0.1);
}

.tool-item.locked {
  opacity: 0.5;
}

.tool-item input[type='checkbox'] {
  display: none;
}

.tool-lock {
  font-size: 0.65em;
  color: var(--color-med-navy);
  width: 26px;
  text-align: center;
  opacity: 0.5;
}

.tool-name {
  color: var(--color-light-med-navy);
  font-family: var(--font-family-mono);
}

/* Toggle switch — matches ChatProviderSelector */
.toggle-switch {
  width: 26px;
  height: 14px;
  background: var(--color-dark-navy);
  border-radius: 7px;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}

.toggle-switch::after {
  content: '';
  width: 10px;
  height: 10px;
  background: var(--color-med-navy);
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition:
    transform 0.2s,
    background 0.2s;
}

input:checked + .toggle-switch {
  background: rgba(var(--green-rgb), 0.3);
}

input:checked + .toggle-switch::after {
  transform: translateX(12px);
  background: var(--color-green);
}
</style>
