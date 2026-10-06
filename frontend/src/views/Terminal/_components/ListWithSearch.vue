<!-- ListWithSearch — search-and-select for a long list (an agent's tools,
     skills, workflows). The selection is chips inside the field; typing
     filters; matches open beneath it with a check against each. Nothing is
     shown that you did not ask for, so a list of 300 tools costs one line
     until you search it.

     v-model: array of ids. The list opens in the flow, not as a floating
     popup, so a scrolling modal can never clip it. -->
<template>
  <div ref="root" class="lws" :class="{ open }" @focusout="onFocusOut">
    <div class="lws-field" @click="focusInput">
      <span v-for="item in selectedItems" :key="item[idKey]" class="lws-chip">
        <span class="lws-chip-label">{{ labelOf(item) }}</span>
        <button type="button" class="lws-chip-x" :aria-label="'Remove ' + labelOf(item)" @click.stop="toggle(item[idKey])">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </span>
      <input
        ref="input"
        v-model="search"
        class="lws-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="listId"
        :aria-activedescendant="open && options[active] ? optionId(options[active]) : undefined"
        :placeholder="selectedItems.length ? 'Add more…' : placeholder || `Search ${noun}…`"
        @focus="open = true"
        @keydown="onKey"
      />
    </div>

    <div class="lws-summary">
      <span>{{ selectedItems.length ? `${selectedItems.length} of ${items.length} selected` : emptyMessage || `No ${noun} selected` }}</span>
      <span class="lws-summary-actions">
        <button v-if="canAddAllMatching" type="button" @click="addAllMatching">{{ search.trim() ? `Select ${options.length} matching` : `Select all ${items.length}` }}</button>
        <button v-if="selectedItems.length" type="button" @click="clear">Clear</button>
      </span>
    </div>

    <ul v-if="open" :id="listId" class="lws-results" role="listbox" aria-multiselectable="true" :aria-label="noun">
      <li v-if="!options.length" class="lws-empty">{{ items.length ? `No ${noun} match “${search.trim()}”.` : `No ${noun} available.` }}</li>
      <li
        v-for="(item, index) in options"
        :id="optionId(item)"
        :key="item[idKey]"
        class="lws-option"
        :class="{ active: index === active, chosen: isChosen(item) }"
        role="option"
        :aria-selected="isChosen(item) ? 'true' : 'false'"
        @mousedown.prevent
        @mouseenter="active = index"
        @click="toggle(item[idKey])"
      >
        <span class="lws-check"><i v-if="isChosen(item)" class="fas fa-check" aria-hidden="true"></i></span>
        <span class="lws-option-label">{{ labelOf(item) }}</span>
        <small v-if="descriptionOf(item)" class="lws-option-desc">{{ descriptionOf(item) }}</small>
      </li>
    </ul>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick } from 'vue';

let instances = 0;

export default {
  name: 'ListWithSearch',
  props: {
    items: { type: Array, required: true },
    modelValue: { type: Array, required: true },
    labelKey: { type: String, default: 'name' },
    idKey: { type: String, default: 'id' },
    placeholder: { type: String, default: '' },
    emptyMessage: { type: String, default: '' },
    /** Plural noun for the copy ("tools"); derived from the placeholder when absent. */
    itemNoun: { type: String, default: '' },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const root = ref(null);
    const input = ref(null);
    const search = ref('');
    const open = ref(false);
    const active = ref(0);
    const listId = `lws-${++instances}`;

    const labelOf = (item) => String(item[props.labelKey] || item.title || item.name || item[props.idKey] || '');
    const descriptionOf = (item) => String(item.description || '').slice(0, 120);
    const optionId = (item) => `${listId}-${String(item[props.idKey]).replace(/[^\w-]/g, '_')}`;
    const chosen = computed(() => new Set(props.modelValue));
    const isChosen = (item) => chosen.value.has(item[props.idKey]);

    const noun = computed(() => {
      if (props.itemNoun) return props.itemNoun;
      const hint = `${props.placeholder} ${props.labelKey}`.toLowerCase();
      return ['tools', 'skills', 'workflows'].find((word) => hint.includes(word.slice(0, -1))) || 'items';
    });

    const byLabel = (a, b) => labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: 'base', numeric: true });
    // In model order, so chips do not jump around as more are added.
    const selectedItems = computed(() => {
      const byId = new Map(props.items.map((item) => [item[props.idKey], item]));
      return props.modelValue.map((id) => byId.get(id)).filter(Boolean);
    });
    // Matches by name or description, best (name starts with the query) first.
    const options = computed(() => {
      const q = search.value.trim().toLowerCase();
      if (!q) return [...props.items].sort(byLabel);
      const rank = (item) => (labelOf(item).toLowerCase().startsWith(q) ? 0 : labelOf(item).toLowerCase().includes(q) ? 1 : 2);
      return props.items
        .filter((item) => labelOf(item).toLowerCase().includes(q) || descriptionOf(item).toLowerCase().includes(q))
        .sort((a, b) => rank(a) - rank(b) || byLabel(a, b));
    });
    const canAddAllMatching = computed(() => options.value.some((item) => !isChosen(item)));

    watch(search, () => {
      active.value = 0;
      open.value = true;
    });

    const update = (ids) => emit('update:modelValue', ids);
    const toggle = (id) => update(chosen.value.has(id) ? props.modelValue.filter((x) => x !== id) : [...props.modelValue, id]);
    const addAllMatching = () => update([...props.modelValue, ...options.value.filter((item) => !isChosen(item)).map((item) => item[props.idKey])]);
    const clear = () => update([]);

    function focusInput() {
      open.value = true;
      input.value?.focus();
    }
    function scrollActiveIntoView() {
      nextTick(() => root.value?.querySelector('.lws-option.active')?.scrollIntoView?.({ block: 'nearest' }));
    }
    function onKey(event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open.value = true;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        if (options.value.length) active.value = (active.value + step + options.value.length) % options.value.length;
        scrollActiveIntoView();
      } else if (event.key === 'Enter') {
        // Never submit the surrounding form from inside the picker.
        event.preventDefault();
        const item = options.value[active.value];
        if (open.value && item) toggle(item[props.idKey]);
      } else if (event.key === 'Escape') {
        if (open.value) {
          event.stopPropagation(); // close the list, not the modal around it
          open.value = false;
        }
      } else if (event.key === 'Backspace' && !search.value && props.modelValue.length) {
        update(props.modelValue.slice(0, -1));
      }
    }
    // Close when focus leaves the whole picker (tabbing away, clicking out).
    function onFocusOut(event) {
      if (!root.value?.contains(event.relatedTarget)) open.value = false;
    }

    return {
      root, input, search, open, active, listId, noun, options, selectedItems, canAddAllMatching,
      labelOf, descriptionOf, optionId, isChosen, toggle, addAllMatching, clear, focusInput, onKey, onFocusOut,
    };
  },
};
</script>

<style scoped>
.lws {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.lws-field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  max-height: 120px;
  overflow-y: auto;
  padding: 6px 8px;
  box-sizing: border-box;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-darker-0);
  cursor: text;
  transition: border-color 0.15s;
}
.lws.open .lws-field,
.lws-field:focus-within {
  border-color: rgba(var(--green-rgb), 0.5);
}
.lws-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 4px 3px 10px;
  border: 1px solid rgba(var(--green-rgb), 0.25);
  border-radius: 999px;
  background: rgba(var(--green-rgb), 0.08);
  color: var(--color-text);
  font-size: 12px;
  line-height: 1.3;
}
.lws-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lws-chip-x {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: var(--color-text-muted);
  font-size: 10px;
  cursor: pointer;
  flex: 0 0 auto;
}
.lws-chip-x:hover {
  color: var(--color-text);
  background: rgba(var(--green-rgb), 0.15);
}
.lws-input {
  flex: 1 1 120px;
  min-width: 120px;
  padding: 4px 2px;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: 13px;
}
.lws-input::placeholder {
  color: var(--color-text-muted);
}
.lws-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--color-text-muted);
}
.lws-summary-actions {
  display: flex;
  gap: 12px;
}
.lws-summary-actions button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-green);
  font: inherit;
  cursor: pointer;
}
.lws-summary-actions button:hover {
  text-decoration: underline;
}
.lws-results {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: var(--color-darker-0);
}
.lws-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  column-gap: 8px;
  align-items: center;
  padding: 7px 8px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.lws-option.active {
  background: rgba(var(--green-rgb), 0.08);
}
.lws-check {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  font-size: 9px;
  color: var(--on-fill-accent);
}
.lws-option.chosen .lws-check {
  background: var(--color-green);
  border-color: var(--color-green);
}
.lws-option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lws-option-desc {
  grid-column: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-size: 11px;
}
.lws-empty {
  padding: 10px 8px;
  color: var(--color-text-muted);
  font-size: 12.5px;
}
</style>
