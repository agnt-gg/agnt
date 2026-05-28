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
          <div
            v-for="cat in categories"
            :key="cat.id"
            class="tool-section"
            :class="{ 'is-locked': cat.locked }"
          >
            <div class="section-header" @click="toggleExpand(cat.id)">
              <span class="section-expand">{{ expanded[cat.id] ? '\u25BE' : '\u25B8' }}</span>
              <label class="group-toggle" @click.stop>
                <input
                  type="checkbox"
                  :checked="isCategoryEnabled(cat)"
:disabled="cat.locked"
                  @change="toggleCategory(cat)"
                />
                <span class="toggle-switch"></span>
              </label>
              <span class="section-title">{{ cat.name }}</span>
              <span v-if="cat.locked" class="section-lock" title="Always enabled for this chat">
                <i class="fas fa-lock"></i>
              </span>
              <span class="section-badge">{{ getCategoryEnabledCount(cat) }}/{{ getCategoryTotalCount(cat) }}</span>
            </div>
            <div v-if="cat.description && expanded[cat.id]" class="cat-description">{{ cat.description }}</div>

            <!-- Direct tools (everything except the parent MCP group, which has none here). -->
            <div v-if="expanded[cat.id] && cat.tools && cat.tools.length > 0" class="section-tools">
              <label
                v-for="tool in cat.tools"
                :key="tool.name"
                class="tool-item toggleable"
                :class="{ 'is-locked': cat.locked }"
              >
                <input
                  type="checkbox"
                  :checked="isToolEnabled(tool.name)"
                  :disabled="cat.locked"
                  @change="toggleTool(tool.name)"
                />
                <span class="toggle-switch"></span>
                <span class="tool-name">{{ tool.name }}</span>
              </label>
            </div>

            <!-- Subcategories (one level deep \u2014 used by the MCP parent group). -->
            <div v-if="expanded[cat.id] && cat.subcategories && cat.subcategories.length > 0" class="subsection-list">
              <div
                v-for="subcat in cat.subcategories"
                :key="subcat.id"
                class="tool-subsection"
                :class="{ 'is-locked': subcat.locked }"
              >
                <div class="subsection-header" @click.stop="toggleExpand(subcat.id)">
                  <span class="section-expand">{{ expanded[subcat.id] ? '\u25BE' : '\u25B8' }}</span>
                  <label class="group-toggle" @click.stop>
                    <input
                      type="checkbox"
                      :checked="isCategoryEnabled(subcat)"
:disabled="subcat.locked"
                      @change.stop="toggleCategory(subcat)"
                    />
                    <span class="toggle-switch"></span>
                  </label>
                  <span class="subsection-title">{{ subcat.name }}</span>
                  <span class="section-badge">{{ getCategoryEnabledCount(subcat) }}/{{ getCategoryTotalCount(subcat) }}</span>
                </div>
                <div v-if="subcat.description && expanded[subcat.id]" class="cat-description sub">{{ subcat.description }}</div>
                <div v-if="expanded[subcat.id]" class="section-tools sub-tools">
                  <label
                    v-for="tool in subcat.tools"
                    :key="tool.name"
                    class="tool-item toggleable"
                    :class="{ 'is-locked': subcat.locked }"
                  >
                    <input
                      type="checkbox"
                      :checked="isToolEnabled(tool.name)"
                      :disabled="subcat.locked"
                      @change="toggleTool(tool.name)"
                    />
                    <span class="toggle-switch"></span>
                    <span class="tool-name">{{ tool.name }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { API_CONFIG } from '@/../user.config.js';
import { getChannelConfig, setChannelEnabledTools, getDefaultEnabledTools, getSpecialtyToolNames, UNIVERSAL_DEFAULT_ON_TOOLS } from '@/services/chatChannelConfig.js';

// Legacy global keys, kept as a fallback for any chat without a channelKey
// (and for backwards compatibility with users who never visited a per-channel
// chat after the migration).
var GLOBAL_ENABLED_KEY = 'agnt_enabled_tools';
var GLOBAL_DISABLED_KEY = 'agnt_disabled_tools';

export default {
  name: 'ChatToolSelector',
  props: {
    isOpen: { type: Boolean, default: false },
    // When set, the selector reads/writes this channel's tool selections
    // (chatChannelConfig.js). Each chat surface gets its own enabled set;
    // the legacy global key is the fallback for unconfigured channels.
    channelKey: { type: String, default: '' },
  },
  emits: ['close'],
  setup(props, { emit }) {
    var selectorRef = ref(null);
    var isLoading = ref(true);
    var categories = ref([]);
    var enabledTools = ref(new Set());
    var expanded = ref({});

    // Specialty (locked) tool names for this channel. Reactive on channelKey
    // change so swapping chats while the selector is mounted re-derives.
    var specialtyNames = computed(function () {
      return new Set(getSpecialtyToolNames(props.channelKey) || []);
    });
    var hasSpecialty = computed(function () { return specialtyNames.value.size > 0; });

    var isLocked = function (name) { return specialtyNames.value.has(name); };

    // Memory recall tools — default-on for every chat on FIRST open, but
    // toggleable (no lock). Once the user saves a per-channel selection,
    // their choices stick — we do NOT re-inject these into already-saved
    // sets, so unchecking sticks across sessions.
    var universalDefaultOnNames = new Set(UNIVERSAL_DEFAULT_ON_TOOLS);

    // Backend returns Built In + Plugins. For sidebar chats with a specialty
    // set, we split Built In into Specialty (locked) + System Tools, leaving
    // Plugins alone. Orchestrator and any channel without specialty keep the
    // backend's original two-bucket layout.
    //
    // Memory recall tools (recall / list_recent / get_trace) are default-ON
    // for every chat on first open (see fetchTools / readSavedEnabled) but
    // are TOGGLEABLE — they live in System Tools (sidebar) or Built In
    // (orchestrator) and the user can opt out per channel. They are NOT
    // pulled into a separate group.
    //
    // Canonical order in the dropdown:
    //   Specialty Tools (locked) → System Built In Tools → Plugins → MCP
    var reorganizeCategories = function (raw) {
      var builtIn = raw.find(function (c) { return c.id === 'builtin'; });
      var plugins = raw.find(function (c) { return c.id === 'plugins'; });
      var mcp = raw.find(function (c) { return c.id === 'mcp'; });
      var others = raw.filter(function (c) {
        return c.id !== 'builtin' && c.id !== 'plugins' && c.id !== 'mcp';
      });

      var result = [];

      if (hasSpecialty.value && builtIn) {
        var specialty = builtIn.tools.filter(function (t) { return specialtyNames.value.has(t.name); });
        var system = builtIn.tools.filter(function (t) { return !specialtyNames.value.has(t.name); });
        if (specialty.length > 0) {
          result.push({
            id: 'specialty',
            name: 'Specialty Tools',
            description: 'Built into this page — always available.',
            locked: true,
            tools: specialty,
          });
        }
        if (system.length > 0) {
          result.push({
            id: 'system',
            name: 'System Tools',
            description: 'General-purpose tools shared across all chats.',
            locked: false,
            tools: system,
          });
        }
      } else if (builtIn) {
        result.push(builtIn);
      }

      // Anything the backend sent that isn't builtin/plugins/mcp goes here
      // (currently nothing — kept for forward-compat).
      result = result.concat(others);

      if (plugins) result.push(plugins);
      if (mcp) result.push(mcp);
      return result;
    };

    var saveState = function () {
      var enabled = [];
      var disabled = [];
      categories.value.forEach(function (cat) {
        if (cat.locked) return;
        // Recurse into subcategories so MCP tools (nested under the parent
        // MCP group) are persisted alongside the rest.
        allToolsIn(cat).forEach(function (t) {
          if (enabledTools.value.has(t.name)) {
            enabled.push(t.name);
          } else {
            disabled.push(t.name);
          }
        });
      });
      if (props.channelKey) {
        // Per-channel persistence — each chat surface gets its own list.
        setChannelEnabledTools(props.channelKey, enabled);
      } else {
        // No channelKey (rare — only legacy mounts) → fall back to globals.
        localStorage.setItem(GLOBAL_ENABLED_KEY, JSON.stringify(enabled));
        localStorage.setItem(GLOBAL_DISABLED_KEY, JSON.stringify(disabled));
      }
    };

    // Read this channel's enabled set. Order of precedence:
    //   1. Explicit per-channel save.
    //   2. Curated default for sidebar chat types (agent / workflow / tool /
    //      widget / artifact) — a small page-relevant subset, no plugins.
    //   3. Legacy global key (orchestrator-era).
    //   4. null → "no saved state", caller defaults to all-enabled.
    // Returning the curated default in case 2 means the very first open of a
    // sidebar chat shows the right scoped selection without requiring a save.
    var readSavedEnabled = function () {
      if (props.channelKey) {
        var cfg = getChannelConfig(props.channelKey);
        if (cfg && Array.isArray(cfg.enabledTools)) return cfg.enabledTools;
        var sidebarDefault = getDefaultEnabledTools(props.channelKey);
        if (sidebarDefault) return sidebarDefault;
      }
      try {
        var legacy = localStorage.getItem(GLOBAL_ENABLED_KEY);
        if (legacy) {
          var parsed = JSON.parse(legacy);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (e) { /* ignore */ }
      return null;
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
        categories.value = reorganizeCategories(data.categories || []);

        // Build the universe of tool names from the categories the backend
        // returned, then intersect with what's saved for this channel.
        var allNames = new Set();
        categories.value.forEach(function (cat) {
          allToolsIn(cat).forEach(function (t) {
            allNames.add(t.name);
          });
        });

        var savedEnabled = readSavedEnabled();
        if (savedEnabled) {
          // Channel has a saved list — keep just those names enabled. Specialty
          // is always unioned in (it's locked in the UI). Memory defaults are
          // NOT re-unioned: if the user explicitly unchecked them, that choice
          // must stick.
          var savedSet = new Set(savedEnabled);
          specialtyNames.value.forEach(function (n) { savedSet.add(n); });
          enabledTools.value = new Set([...allNames].filter(function (n) {
            return savedSet.has(n);
          }));
        } else if (hasSpecialty.value) {
          // First open in a sidebar chat — specialty (locked) + universal
          // default-on memory tools enabled. Memory tools are toggleable.
          enabledTools.value = new Set([...allNames].filter(function (n) {
            return specialtyNames.value.has(n) || universalDefaultOnNames.has(n);
          }));
        } else {
          // First open in a non-sidebar channel (orchestrator) — all on.
          enabledTools.value = new Set(allNames);
        }
        enabledTools.value = new Set(enabledTools.value);
      } catch (err) {
        console.error('[ChatToolSelector] fetch failed:', err);
      }
      isLoading.value = false;
    };

    // Walk a category and yield every tool, including those nested in
    // subcategories. MCP categories use the parent/subcategory shape so
    // counts must recurse rather than just reading `cat.tools`.
    var allToolsIn = function (cat) {
      if (!cat) return [];
      var out = (cat.tools || []).slice();
      var subs = cat.subcategories || [];
      for (var i = 0; i < subs.length; i++) {
        out = out.concat(allToolsIn(subs[i]));
      }
      return out;
    };

    var totalCount = computed(function () {
      var count = 0;
      categories.value.forEach(function (cat) {
        count += allToolsIn(cat).length;
      });
      return count;
    });

    var enabledCount = computed(function () {
      var count = 0;
      categories.value.forEach(function (cat) {
        allToolsIn(cat).forEach(function (t) {
          if (enabledTools.value.has(t.name)) count++;
        });
      });
      return count;
    });

    var isToolEnabled = function (name) {
      return enabledTools.value.has(name);
    };

    var toggleTool = function (name) {
      // Specialty tools are always enabled — refuse to toggle them off.
      if (isLocked(name)) return;
      if (enabledTools.value.has(name)) {
        enabledTools.value.delete(name);
      } else {
        enabledTools.value.add(name);
      }
      enabledTools.value = new Set(enabledTools.value);
      saveState();
    };

    // Category-level helpers that recurse into subcategories. The MCP parent
    // group uses subcategories so counts and toggle-all need to walk them
    // rather than only reading the parent's direct `tools` array.
    //
    // "Enabled" = ANY tool in the category is on. The previous semantic
    // (every tool on) made the parent checkbox flip OFF the moment a single
    // child tool was disabled — visually identical to "the whole category
    // got turned off" even though only one tool changed. The any-on rule
    // means the parent stays checked while ANY tool is on, and only goes
    // unchecked when the entire category is fully disabled.
    var isCategoryEnabled = function (cat) {
      var all = allToolsIn(cat);
      if (all.length === 0) return false;
      return all.some(function (t) {
        return enabledTools.value.has(t.name);
      });
    };

    var getCategoryEnabledCount = function (cat) {
      var count = 0;
      allToolsIn(cat).forEach(function (t) {
        if (enabledTools.value.has(t.name)) count++;
      });
      return count;
    };

    var getCategoryTotalCount = function (cat) {
      return allToolsIn(cat).length;
    };

    var toggleCategory = function (cat) {
      // Locked categories (Specialty Tools) are non-toggleable.
      if (cat.locked) return;
      // Parent acts as a master switch: when any tool is on (parent shows
      // checked), clicking turns everything off. When nothing is on (parent
      // shows unchecked), clicking turns everything on. This pairs with the
      // any-on `isCategoryEnabled` semantics so the visual state matches.
      var anyOn = isCategoryEnabled(cat);
      allToolsIn(cat).forEach(function (t) {
        if (anyOn) {
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
        allToolsIn(cat).forEach(function (t) {
          enabledTools.value.add(t.name);
        });
      });
      enabledTools.value = new Set(enabledTools.value);
      saveState();
    };

    var disableAllOptional = function () {
      categories.value.forEach(function (cat) {
        // Specialty Tools stay on — that's the whole point of "locked".
        if (cat.locked) return;
        allToolsIn(cat).forEach(function (t) {
          if (isLocked(t.name)) return;
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

    // Reload the enabled set when the parent swaps channels while this
    // selector stays mounted (e.g. user pages between saved agents).
    // Re-derive specialty + recompute the enabled set with the same locking
    // semantics as fetchTools.
    watch(
      function () { return props.channelKey; },
      function () {
        if (categories.value.length === 0) return;
        // Re-bucket tools for the new channel (specialty/system split).
        // We rebuild from the original built-in + plugins shape every time
        // by remerging the existing buckets.
        var flat = [];
        categories.value.forEach(function (cat) {
          if (cat.id === 'specialty' || cat.id === 'system') {
            flat = flat.concat({ id: 'builtin', name: 'Built In', locked: false, tools: cat.tools });
          } else {
            flat.push(cat);
          }
        });
        // Coalesce duplicate built-in entries created by the loop above.
        var builtInTools = [];
        var others = [];
        flat.forEach(function (c) {
          if (c.id === 'builtin') builtInTools = builtInTools.concat(c.tools);
          else others.push(c);
        });
        var raw = [];
        if (builtInTools.length > 0) raw.push({ id: 'builtin', name: 'Built In', locked: false, tools: builtInTools });
        raw = raw.concat(others);
        categories.value = reorganizeCategories(raw);

        var allNames = new Set();
        categories.value.forEach(function (cat) {
          cat.tools.forEach(function (t) { allNames.add(t.name); });
        });
        var savedEnabled = readSavedEnabled();
        if (savedEnabled) {
          var savedSet = new Set(savedEnabled);
          specialtyNames.value.forEach(function (n) { savedSet.add(n); });
          enabledTools.value = new Set([...allNames].filter(function (n) {
            return savedSet.has(n);
          }));
        } else if (hasSpecialty.value) {
          enabledTools.value = new Set([...allNames].filter(function (n) {
            return specialtyNames.value.has(n);
          }));
        } else {
          enabledTools.value = new Set(allNames);
        }
      },
    );

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
      getCategoryTotalCount: getCategoryTotalCount,
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
  /* Keep hyphenated category names on a single line. */
  white-space: nowrap;
}

.section-badge {
  font-size: 0.7em;
  color: var(--color-med-navy);
  background: var(--color-darker-2);
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 500;
}

/* Lock indicator for the Specialty Tools category. The category and its
   rows render with a non-clickable cursor and a slightly muted toggle so
   the user reads it as "always on" rather than "broken toggle". */
.section-lock {
  font-size: 0.65em;
  color: var(--color-green);
  margin-left: 4px;
  opacity: 0.85;
}

.tool-section.is-locked .group-toggle,
.tool-section.is-locked .tool-item.is-locked {
  cursor: default;
}

.tool-item.is-locked {
  opacity: 0.85;
}

.tool-item.is-locked .tool-name {
  color: var(--color-light-green, var(--color-text));
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

/* Hierarchical subsections — used by the MCP parent group to display each
   server (chrome-devtools, notion, linear, …) as a nested section with its
   own checkbox + toggle list, rather than flooding the top-level dropdown. */
.subsection-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  padding-left: 16px;
  border-left: 1px solid rgba(127, 129, 147, 0.2);
  margin-left: 6px;
}

.tool-subsection {
  padding: 2px 0;
}

.subsection-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
  transition: background 0.15s ease;
}

.subsection-header:hover {
  background: rgba(127, 129, 147, 0.08);
}

.subsection-title {
  flex: 1;
  font-weight: 500;
  opacity: 0.95;
  /* Same hyphen-wrap fix — MCP server names contain dashes. */
  white-space: nowrap;
}

.cat-description.sub {
  padding-left: 18px;
  font-size: 0.78em;
}

.section-tools.sub-tools {
  padding-left: 18px;
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
  /* Hyphenated tool names (e.g. "chrome-devtools-mcp") must NOT break at
     each hyphen. white-space: nowrap is the minimal, safe fix — anything
     more (flex/min-width/overflow) interacts with the parent flex layout
     and can collapse the name to zero width. */
  white-space: nowrap;
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
