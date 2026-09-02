// useInspect — a screen's view of the shell's inspect request.
//
// The right panel has two states: nothing selected (a summary of the screen)
// and selected (the item you clicked). This composable answers "which one",
// filtered to the kinds this screen can show, so a request for a kind it
// cannot show leaves the summary in place instead of a blank panel.
import { computed } from 'vue';
import { useStore } from 'vuex';

/**
 * @param {string[]|null} kinds  kinds this panel can render; null = all
 */
export function useInspect(kinds = null) {
  const store = useStore();
  const target = computed(() => {
    const t = store.getters['shell/inspect'];
    if (!t) return null;
    if (kinds && !kinds.includes(t.kind)) return null;
    return t;
  });
  const clear = () => store.dispatch('shell/clearInspect');
  const inspect = (kind, id, extra = {}) => store.dispatch('shell/inspect', { kind, id, ...extra });
  return { target, clear, inspect };
}
