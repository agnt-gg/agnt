/**
 * Report a named startup milestone to the desktop app's [boot] log, once per
 * page load. A no-op in a plain browser, and never throws: timing must not be
 * able to break the thing it times.
 */
const reported = new Set();

export function reportBootMark(name) {
  if (reported.has(name)) return;
  reported.add(name);
  try {
    window.electron?.reportBootMark?.(name);
  } catch {
    /* diagnostics only */
  }
}
