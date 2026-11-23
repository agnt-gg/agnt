/**
 * The page's CSS custom properties and their live values, for content drawn in an iframe
 * (chat artifacts, widgets, widget thumbnails) so it can use var(--color-*) and friends.
 *
 * Reading them walks every rule of every stylesheet, which costs tens of milliseconds, so the
 * result is kept until something that changes it does: the theme, the classes or inline style
 * on <html> and <body> (custom themes set variables there), or the number of stylesheets
 * (a lazily loaded chunk adds its CSS).
 */
let cached = { key: null, vars: [] };

function cacheKey(themeKey) {
  const html = document.documentElement;
  const body = document.body;
  return [
    String(themeKey ?? ''),
    document.styleSheets.length,
    html.className,
    body?.className || '',
    html.getAttribute('style') || '',
    body?.getAttribute('style') || '',
  ].join('|');
}

/** [[name, value], …] for every custom property with a value, in the order first seen. */
export function themeVariables(themeKey) {
  const key = cacheKey(themeKey);
  if (cached.key === key) return cached.vars;
  const names = new Set();
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (!rule.style) continue;
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (prop.startsWith('--')) names.add(prop);
          }
        }
      } catch (_) {
        /* a cross-origin stylesheet cannot be read; skip it */
      }
    }
  } catch (_) {
    /* no stylesheets to read */
  }
  const rootStyle = getComputedStyle(document.documentElement);
  const bodyStyle = getComputedStyle(document.body);
  const vars = [];
  for (const prop of names) {
    const value = bodyStyle.getPropertyValue(prop).trim() || rootStyle.getPropertyValue(prop).trim();
    if (value) vars.push([prop, value]);
  }
  cached = { key, vars };
  return vars;
}

/** Test seam: forget the cached variables. */
export function _resetThemeVariables() {
  cached = { key: null, vars: [] };
}
