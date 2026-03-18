import { ref, computed, watch, nextTick } from 'vue';

/**
 * Composable for detecting @, #, / triggers in a textarea and managing
 * a filterable, keyboard-navigable command menu.
 *
 * @param {import('vue').Ref<string>} inputRef - reactive v-model of the textarea
 * @param {Object} options
 * @param {Function} options.getAgents - () => Array<{ id, name, description, avatar }>
 * @param {Function} options.getCommands - () => Array<{ id, name, description, icon }>
 * @param {Function} options.getHashtags - () => Array<{ id, name, description, icon }>
 */
export function useCommandMenu(inputRef, { getAgents, getCommands, getHashtags } = {}) {
  // --- State ---
  const isOpen = ref(false);
  const triggerChar = ref(null); // '@' | '/' | '#'
  const triggerIndex = ref(-1); // position of trigger char in input string
  const query = ref('');
  const selectedIndex = ref(0);

  // --- Default providers ---
  const defaultCommands = () => [
    { id: 'new-chat', name: 'New Chat', description: 'Start a new conversation', icon: 'fas fa-plus' },
    { id: 'clear', name: 'Clear Chat', description: 'Clear current conversation', icon: 'fas fa-eraser' },
    { id: 'export', name: 'Export Chat', description: 'Export conversation to file', icon: 'fas fa-download' },
    { id: 'help', name: 'Help', description: 'Show available commands', icon: 'fas fa-question-circle' },
  ];

  const defaultHashtags = () => [
    { id: 'workflows', name: 'Workflows', description: 'Reference a workflow', icon: 'fas fa-project-diagram' },
    { id: 'plugins', name: 'Plugins', description: 'Reference a plugin', icon: 'fas fa-puzzle-piece' },
  ];

  // --- Computed items based on active trigger ---
  const items = computed(() => {
    let source = [];

    if (triggerChar.value === '@') {
      const agents = getAgents ? getAgents() : [];
      source = agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description || '',
        icon: a.avatar || 'fas fa-robot',
        type: 'agent',
      }));
    } else if (triggerChar.value === '/') {
      source = (getCommands ? getCommands() : defaultCommands()).map((c) => ({
        ...c,
        type: 'command',
      }));
    } else if (triggerChar.value === '#') {
      source = (getHashtags ? getHashtags() : defaultHashtags()).map((h) => ({
        ...h,
        type: 'hashtag',
      }));
    }

    if (!query.value) return source;

    const q = query.value.toLowerCase();
    return source.filter(
      (item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
    );
  });

  // Clamp selectedIndex when filtered list shrinks
  watch(items, (list) => {
    if (selectedIndex.value >= list.length) {
      selectedIndex.value = Math.max(0, list.length - 1);
    }
  });

  // --- Trigger detection ---
  /**
   * Call this on every input event. Inspects the text left of the caret
   * to decide whether the menu should open/update/close.
   *
   * @param {HTMLTextAreaElement} textarea
   */
  function handleInput(textarea) {
    const value = textarea.value;
    const caret = textarea.selectionStart;

    // Walk backward from caret to find an un-escaped trigger character
    const textBeforeCaret = value.slice(0, caret);

    // Find the last trigger character that isn't preceded by a non-space character
    // (so "hello@" doesn't trigger, but "hello @" does, and "@" at start does)
    for (let i = textBeforeCaret.length - 1; i >= 0; i--) {
      const ch = textBeforeCaret[i];

      // Stop at whitespace — no trigger found in this "word"
      if (ch === ' ' || ch === '\n' || ch === '\t') {
        close();
        return;
      }

      if (ch === '@' || ch === '/' || ch === '#') {
        // Trigger is valid only at start of input or preceded by whitespace
        if (i === 0 || /\s/.test(textBeforeCaret[i - 1])) {
          triggerChar.value = ch;
          triggerIndex.value = i;
          query.value = textBeforeCaret.slice(i + 1);
          selectedIndex.value = 0;
          isOpen.value = true;
          return;
        }
        // Otherwise it's mid-word, not a trigger
        close();
        return;
      }
    }

    // Nothing found
    close();
  }

  // --- Keyboard navigation ---
  /**
   * Call from @keydown on the textarea. Returns true if the event was consumed.
   */
  function handleKeydown(event) {
    if (!isOpen.value) return false;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        selectedIndex.value = (selectedIndex.value + 1) % (items.value.length || 1);
        return true;

      case 'ArrowUp':
        event.preventDefault();
        selectedIndex.value = (selectedIndex.value - 1 + items.value.length) % (items.value.length || 1);
        return true;

      case 'Tab':
      case 'Enter':
        if (items.value.length > 0) {
          event.preventDefault();
          select(items.value[selectedIndex.value]);
          return true;
        }
        break;

      case 'Escape':
        event.preventDefault();
        close();
        return true;
    }

    return false;
  }

  // --- Selection ---
  function select(item) {
    if (!item) return;

    const value = inputRef.value;
    const before = value.slice(0, triggerIndex.value);
    const after = value.slice(triggerIndex.value + 1 + query.value.length);

    if (item.type === 'command') {
      // For commands, replace the whole trigger+query with /command
      inputRef.value = before + '/' + item.name + ' ' + after;
    } else {
      // For @agents and #hashtags, insert mention
      const prefix = triggerChar.value;
      inputRef.value = before + prefix + item.name + ' ' + after;
    }

    close();

    // Return the selected item so the parent can act on it
    return item;
  }

  function close() {
    isOpen.value = false;
    triggerChar.value = null;
    triggerIndex.value = -1;
    query.value = '';
    selectedIndex.value = 0;
  }

  // --- Caret position helper ---
  /**
   * Returns approximate pixel position of the trigger character in the textarea.
   * Used to position the popup menu.
   */
  function getCaretCoords(textarea) {
    if (!textarea) return { top: 0, left: 0 };

    const rect = textarea.getBoundingClientRect();
    // Position the menu above the input area
    return {
      bottom: window.innerHeight - rect.top + 8,
      left: rect.left,
      width: rect.width,
    };
  }

  return {
    // State
    isOpen,
    triggerChar,
    query,
    items,
    selectedIndex,

    // Methods
    handleInput,
    handleKeydown,
    select,
    close,
    getCaretCoords,
  };
}
