/**
 * Turning a flat category list into SidebarCategories' `{ code, label }` shape.
 *
 * Five left panels each carried their own copy of one of these two functions.
 * They are behaviour, not markup, so they live here rather than in the frame
 * component — a panel picks the one that matches its data.
 */

/**
 * Dotted-namespace categories: "media.video" groups under "media".
 * "Uncategorized" is deliberately kept as a top-level bucket.
 * Used by anything whose categories come from user-authored records.
 */
export function dottedMainCategories(categories) {
  return (categories || [])
    .filter((cat) => {
      if (!cat) return false;
      if (cat === 'Uncategorized') return true;
      return !cat.split(' ')[0].includes('.');
    })
    .map((cat) => ({
      code: cat === 'Uncategorized' ? 'Uncategorized' : cat.split(' ')[0],
      label: cat,
    }));
}

/**
 * Flat lowercase categories shown title-cased. The code stays lowercase
 * because the item records filter on the lowercase form.
 */
export function capitalizedMainCategories(categories) {
  return (categories || []).map((cat) => ({
    code: cat,
    label: cat.charAt(0).toUpperCase() + cat.slice(1),
  }));
}

/** Categories used verbatim, no grouping and no relabelling. */
export function verbatimMainCategories(categories) {
  return (categories || []).map((cat) => ({ code: cat, label: cat }));
}

/** Unique, sorted category codes off a list of items. */
export function uniqueCategories(items, key = 'category') {
  const seen = new Set();
  for (const item of items || []) {
    if (item && item[key]) seen.add(item[key]);
  }
  return Array.from(seen).sort();
}
