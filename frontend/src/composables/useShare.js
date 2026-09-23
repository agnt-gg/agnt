/**
 * The one share sheet and the one receive card, opened from anywhere.
 *
 * A share button anywhere in the app calls openShare({ kind, id, name }) and
 * the sheet mounted once in App.vue does the rest. Screens that already have a
 * Marketplace publish flow or a file export pass them as `publish` / `exportItem`
 * callbacks so the sheet can offer them without knowing how they work.
 */
import { reactive, readonly } from 'vue';

const state = reactive({ target: null, receiving: null });

export const shareState = readonly(state);

export function openShare({ kind, id, name, publish = null, exportItem = null, tab = null } = {}) {
  if (!kind || id === undefined || id === null || id === '') return;
  state.target = { kind, id: String(id), name: name || 'This item', publish, exportItem, tab };
}

export function closeShare() {
  state.target = null;
}

/** Open the receive card for a share link (an id, an agnt.gg/s/ URL or an agnt:// link). */
export function openReceive(link) {
  if (link) state.receiving = String(link);
}

export function closeReceive() {
  state.receiving = null;
}
