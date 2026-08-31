// systemNav — lets a non-Settings screen host SettingsPanel.
//
// Memory, Evolution and Autonomy render SettingsPanel on their left so the
// SYSTEM list stays on screen while you move between them. That panel emits
// two actions, and without this helper each of the three screens would have to
// reimplement both — which is exactly how the second one drifts from the
// first.
//
// 'settings-goto' → a sibling SYSTEM screen: navigate directly.
// 'settings-nav'  → a section of SettingsScreen, which is a different screen
//                   from here. Settings.vue reads this localStorage key in
//                   initializeScreen, so writing it BEFORE navigating is what
//                   makes the destination open on the right section instead of
//                   the default (Profile).

const PENDING_SECTION_KEY = 'settings-initial-section';

/**
 * @param   {string}   action  panel action name
 * @param   {*}        payload panel action payload
 * @param   {Function} go      (screenName) => void — navigate
 * @returns {boolean}  true when the action was a SYSTEM nav and was handled
 */
export function handleSystemNav(action, payload, go) {
  if (action === 'settings-goto') {
    go(payload);
    return true;
  }
  if (action === 'settings-nav') {
    try {
      localStorage.setItem(PENDING_SECTION_KEY, payload);
    } catch {
      // Private mode / quota: navigation still works, Settings just opens on
      // its default section. Losing the section is not worth losing the click.
    }
    go('SettingsScreen');
    return true;
  }
  return false;
}
