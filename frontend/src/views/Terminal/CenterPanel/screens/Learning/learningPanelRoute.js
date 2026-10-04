/**
 * Where a click in the Settings nav goes when it is made on the Learning page.
 *
 * Learning renders the Settings nav on its left (screenRegistry.js), so every
 * kind of row that nav emits must lead somewhere from here. It used to handle
 * only screen rows: a Settings section row ('settings-nav') was dropped, so
 * the whole sidebar did nothing and the page felt locked.
 *
 * @returns {{ screen: string, opts?: object } | null}
 */
export function learningPanelRoute(action, payload) {
  if (action === 'settings-nav' && typeof payload === 'string' && payload) {
    return { screen: 'SettingsScreen', opts: { section: payload } };
  }
  if ((action === 'settings-goto' || action === 'navigate') && payload) {
    // 'navigate' carries { screen, opts }; 'settings-goto' a screen name.
    if (typeof payload === 'string') return { screen: payload };
    if (typeof payload.screen === 'string') return { screen: payload.screen, opts: payload.opts };
  }
  return null;
}
