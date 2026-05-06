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
 * @param {Function} options.getSkills - () => Array<{ id, name, description, icon, slug }>
 * @param {Function} options.getGoals - () => Array<{ id, title, status }>
 * @param {Function} options.hasActiveSkill - () => boolean (controls "Detach skill" item)
 * @param {Function} options.hasActiveGoal - () => boolean (controls "Detach goal" item)
 */
export function useCommandMenu(inputRef, { getAgents, getCommands, getHashtags, getSkills, getGoals, hasActiveSkill, hasActiveGoal, orchestratorAvatar } = {}) {
  // --- State ---
  const isOpen = ref(false);
  const triggerChar = ref(null); // '@' | '/' | '#'
  const triggerIndex = ref(-1); // position of trigger char in input string
  const query = ref('');
  const selectedIndex = ref(0);
  const lastSelectedItem = ref(null); // tracks most recent selection for parent to consume

  // --- Default providers ---
  const defaultCommands = () => [
    { id: 'new-chat', name: 'New Chat', description: 'Start a new conversation', icon: 'fas fa-plus' },
    { id: 'clear', name: 'Clear Chat', description: 'Clear current conversation', icon: 'fas fa-eraser' },
    { id: 'export', name: 'Export Chat', description: 'Export conversation to file', icon: 'fas fa-download' },
    { id: 'skill', name: 'Skill', description: 'Attach a skill to this conversation', icon: 'fas fa-puzzle-piece' },
    { id: 'goal', name: 'Goal', description: 'Create, attach, or check a goal', icon: 'fas fa-bullseye' },
    { id: 'help', name: 'Help', description: 'Show available commands', icon: 'fas fa-question-circle' },
  ];

  const defaultHashtags = () => [
    { id: 'workflows', name: 'Workflows', description: 'Reference a workflow', icon: 'fas fa-project-diagram' },
    { id: 'plugins', name: 'Plugins', description: 'Reference a plugin', icon: 'fas fa-puzzle-piece' },
  ];

  // Detect /skill or /goal sub-mode from the active query: when the user has
  // typed `/skill` or `/skill foo`, the menu pivots from listing commands to
  // listing skills (or goal actions+items). Returns:
  //   { mode: 'skill' | 'goal', filter: string }   when active
  //   null                                          otherwise
  const detectSlashSubMode = () => {
    if (triggerChar.value !== '/') return null;
    const q = (query.value || '').toLowerCase();
    const skillMatch = /^skill(?:\s+(.*))?$/.exec(q);
    if (skillMatch) return { mode: 'skill', filter: (skillMatch[1] || '').trim() };
    const goalMatch = /^goal(?:\s+(.*))?$/.exec(q);
    if (goalMatch) return { mode: 'goal', filter: (goalMatch[1] || '').trim() };
    return null;
  };

  // --- Computed items based on active trigger ---
  const items = computed(() => {
    let source = [];
    let appliedFilter = null; // when set, slash-submode handles filtering itself

    if (triggerChar.value === '@') {
      const orchestrator = {
        id: 'orchestrator',
        name: 'Annie',
        description: 'Orchestrator — main AI assistant',
        icon: orchestratorAvatar || 'fas fa-brain',
        type: 'agent',
        subtype: 'orchestrator',
      };
      const agents = getAgents ? getAgents() : [];
      source = [
        orchestrator,
        ...agents.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description || '',
          icon: a.avatar || 'fas fa-robot',
          type: 'agent',
        })),
      ];
    } else if (triggerChar.value === '/') {
      const subMode = detectSlashSubMode();

      if (subMode?.mode === 'skill') {
        // /skill picker: list available skills, with a Detach action at top
        // when one is currently attached.
        const skills = getSkills ? getSkills() : [];
        const detachItem = hasActiveSkill && hasActiveSkill()
          ? [{
              id: '__detach_skill__',
              name: 'Detach skill',
              description: 'Remove the active skill from this conversation',
              icon: 'fas fa-times-circle',
              type: 'skill-action',
              action: 'detach-skill',
              subtype: 'detach',
            }]
          : [];
        source = [
          ...detachItem,
          ...skills.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description || '',
            icon: s.icon || 'fas fa-puzzle-piece',
            type: 'skill',
            action: 'attach-skill',
            payload: s,
          })),
        ];
        appliedFilter = subMode.filter;
      } else if (subMode?.mode === 'goal') {
        // /goal picker: collapses create/attach/status/detach into one menu.
        // Action items appear at the top; existing goals follow.
        const goals = getGoals ? getGoals() : [];
        const actions = [
          {
            id: '__create_goal__',
            name: '+ Create new goal',
            description: 'Type a description on the next line; submit to create',
            icon: 'fas fa-plus-circle',
            type: 'goal-action',
            action: 'create-goal',
            subtype: 'create',
          },
        ];
        if (hasActiveGoal && hasActiveGoal()) {
          actions.push({
            id: '__goal_status__',
            name: 'View status',
            description: "Show this goal's current progress as a snapshot",
            icon: 'fas fa-chart-line',
            type: 'goal-action',
            action: 'goal-status',
            subtype: 'status',
          });
          actions.push({
            id: '__detach_goal__',
            name: 'Detach goal',
            description: 'Remove the active goal from this conversation',
            icon: 'fas fa-times-circle',
            type: 'goal-action',
            action: 'detach-goal',
            subtype: 'detach',
          });
        }
        source = [
          ...actions,
          ...goals.map((g) => ({
            id: g.id,
            name: g.title || g.name || `Goal ${String(g.id).slice(0, 8)}`,
            description: g.status ? `${g.status}` : '',
            icon: 'fas fa-bullseye',
            type: 'goal',
            action: 'attach-goal',
            payload: g,
            subtype: g.status,
          })),
        ];
        appliedFilter = subMode.filter;
      } else {
        source = (getCommands ? getCommands() : defaultCommands()).map((c) => ({
          ...c,
          type: 'command',
        }));
      }
    } else if (triggerChar.value === '#') {
      source = (getHashtags ? getHashtags() : defaultHashtags()).map((h) => ({
        ...h,
        type: 'hashtag',
      }));
    }

    // For sub-modes the filter is the text after the verb word; for normal
    // triggers it's the entire query. Action items (create/detach/status)
    // bypass the filter so they're always visible while filtering goals.
    const filterStr = appliedFilter !== null ? appliedFilter : (query.value || '');
    if (!filterStr) return source;

    const q = filterStr.toLowerCase();
    return source.filter((item) => {
      if (item.type === 'goal-action' || item.type === 'skill-action') return true;
      return (item.name || '').toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q);
    });
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

    if (item.action) {
      // Action items (skill/goal attach/detach/status/create) don't insert
      // text — the parent handles them via consumeLastSelected. Strip the
      // trigger+query from the input so the textarea is clean to receive
      // the next thing the user types (e.g. a goal description).
      // For "create-goal" we keep the trigger area cleared so the user can
      // immediately type the new goal's description.
      inputRef.value = before + after;
    } else if (item.id === 'skill' || item.id === 'goal') {
      // Picking the bare /skill or /goal command shouldn't insert text — it
      // should pivot the menu into sub-mode. Re-open with the prefix typed.
      inputRef.value = before + '/' + item.name + ' ' + after;
      // Re-trigger detection so the menu pivots immediately. The caller
      // typically calls textarea.focus() and re-runs handleInput, but we
      // also bump the local state here so items refresh on the same tick.
      triggerChar.value = '/';
      // triggerIndex remains the position of '/'
      query.value = item.name + ' ';
      selectedIndex.value = 0;
      lastSelectedItem.value = item;
      // Don't close — sub-mode should appear with skills/goals listed
      return item;
    } else if (item.type === 'command') {
      inputRef.value = before + '/' + item.name + ' ' + after;
    } else {
      // For @agents and #hashtags, insert mention
      const prefix = triggerChar.value;
      inputRef.value = before + prefix + item.name + ' ' + after;
    }

    lastSelectedItem.value = item;
    close();

    // Return the selected item so the parent can act on it
    return item;
  }

  /**
   * Consume and clear the last selected item (one-shot read).
   */
  function consumeLastSelected() {
    const item = lastSelectedItem.value;
    lastSelectedItem.value = null;
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
    lastSelectedItem,

    // Methods
    handleInput,
    handleKeydown,
    select,
    close,
    getCaretCoords,
    consumeLastSelected,
  };
}
