/**
 * Shared presentation rules for a marketplace item card.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this, "what a marketplace item looks like" was defined FOUR times:
 * Marketplace.vue (the `mk-card` family) plus a hand-copied variant in each of
 * Agents.vue, Workflows.vue and Tools.vue. 19 CSS selectors were byte-identical
 * across those three and 2 had already drifted; Agents.vue even labelled its
 * copy `MARKETPLACE STYLES (matching Workflows.vue)` — a hand-maintained
 * invariant with no test, which had already failed twice.
 *
 * Everything here is a PURE function of an item. No store, no Vue reactivity,
 * no DOM. That keeps it trivially unit-testable and lets both the Marketplace
 * screen and MarketplaceShelf render from one definition, so the badge rules
 * and the generated art cannot diverge again.
 *
 * Consumed by:
 *   - views/Terminal/CenterPanel/screens/Marketplace/Marketplace.vue
 *   - views/Terminal/_components/MarketplaceShelf.vue
 */

/**
 * The asset types the marketplace can actually serve.
 *
 * This is a CLOSED SET mirrored from the server: `asset_type` is only ever one
 * of these four. There is deliberately no `skill` and no `widget` — those
 * screens can mount a shelf, but it will correctly render nothing until the
 * backend accepts those types. Callers should use `isShelfEligible()` rather
 * than assuming a shelf can be filled for an arbitrary type.
 */
export const MARKETPLACE_ASSET_TYPES = Object.freeze(['agent', 'workflow', 'tool', 'plugin']);

/** Hue per asset type — the seed for every generated card gradient. */
const TYPE_HUE = Object.freeze({ workflow: 192, agent: 150, tool: 45, plugin: 268 });

const ICONS = Object.freeze({
  agent: 'fas fa-robot',
  tool: 'fas fa-wrench',
  plugin: 'fas fa-puzzle-piece',
  workflow: 'fas fa-project-diagram',
});

const LABELS = Object.freeze({
  agent: 'Agent',
  tool: 'Tool',
  plugin: 'Plugin',
  workflow: 'Workflow',
});

const DAY_MS = 86400000;

/** Normalised asset type, defaulting to the historical 'workflow'. */
export const assetTypeOf = (item) => (item && item.asset_type) || 'workflow';

export const isShelfEligible = (assetType) => MARKETPLACE_ASSET_TYPES.includes(assetType);

export const assetIcon = (item) => ICONS[assetTypeOf(item)] || ICONS.workflow;

export const assetTypeLabel = (item) => LABELS[assetTypeOf(item)] || LABELS.workflow;

/**
 * Deterministic hue for an item. Same item -> same colour, forever, on every
 * machine: seeded from the id (falling back to the title) rather than random,
 * so a card does not change appearance between renders or between users.
 */
export const hueFor = (item) => {
  const base = TYPE_HUE[assetTypeOf(item)] || 192;
  const seed = String((item && (item.id || item.title)) || '')
    .split('')
    .reduce((a, c) => a + c.charCodeAt(0), 0);
  return (base + ((seed * 13) % 38)) % 360;
};

/**
 * The card art band.
 *
 * NOTE: this gradient is DARK IN EVERY THEME. Anything painted on top of it
 * must therefore use a literal light ink (`--text-on-scrim`), never a theme
 * text token — those flip to dark ink in light/rose and vanish.
 */
export const artStyle = (item) => {
  const h1 = hueFor(item);
  const h2 = (h1 + 46) % 360;
  return {
    backgroundImage:
      `radial-gradient(120% 130% at 12% 8%, hsl(${h1} 62% 52% / .95), transparent 62%),` +
      `radial-gradient(120% 120% at 92% 96%, hsl(${h2} 62% 44% / .9), transparent 58%),` +
      `linear-gradient(135deg, hsl(${h1} 38% 22%), hsl(${h2} 42% 13%))`,
  };
};

/** The raised icon tile that straddles the art band and the card body. */
export const iconStyle = (item) => {
  const h1 = hueFor(item);
  return {
    backgroundImage: `linear-gradient(140deg, hsl(${h1} 72% 58%), hsl(${(h1 + 40) % 360} 66% 42%))`,
    color: '#0a0a14',
  };
};

const itemDate = (i) => (i && (i.published_at || i.created_at || i.updated_at)) || null;

/**
 * Age in days. Returns Infinity when an item carries no usable date, so it
 * simply never qualifies as new/trending rather than poisoning comparisons
 * with NaN.
 */
export const daysSince = (i) => {
  const d = itemDate(i);
  if (!d) return Infinity;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / DAY_MS : Infinity;
};

export const isNew = (i) => daysSince(i) <= 30;

/** Install velocity. The 7-day floor stops a brand-new item dividing by ~0. */
export const trendScore = (i) => ((i && i.downloads) || 0) / Math.max(daysSince(i), 7);

/**
 * Top ~15% by install velocity — and only when the pool is big enough for
 * "trending" to carry any information at all. Badging 2 of 4 items as trending
 * is noise, not a signal.
 */
export const buildTrendingIds = (list) => {
  const pool = (list || []).filter((i) => Number.isFinite(daysSince(i)) && (i.downloads || 0) > 0);
  if (pool.length < 6) return new Set();
  const ranked = [...pool].sort((a, b) => trendScore(b) - trendScore(a));
  return new Set(ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.15))).map((i) => i.id));
};

/**
 * "#1 in <Category>", suppressed for categories too small for a ranking to
 * mean anything and for items nobody has installed. Returns id -> rank.
 */
export const buildCategoryRankMap = (list) => {
  const byCat = {};
  for (const i of list || []) {
    if (!i || !i.category) continue;
    (byCat[i.category] = byCat[i.category] || []).push(i);
  }
  const map = {};
  for (const key of Object.keys(byCat)) {
    const group = byCat[key];
    if (group.length < 3) continue;
    const top = [...group].sort((a, b) => (b.downloads || 0) - (a.downloads || 0))[0];
    if (top && (top.downloads || 0) > 0) map[top.id] = 1;
  }
  return map;
};

/** 1234 -> "1.2K". Kept identical to the Marketplace screen's formatting. */
export const formatCount = (num) => {
  const n = Number(num) || 0;
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
};

/** "1 install" / "2 installs" — pluralised off the RAW count, not the abbreviation. */
export const installsLabel = (num) => `${formatCount(num)} install${Number(num) === 1 ? '' : 's'}`;

/**
 * Local, case-insensitive search across the fields a user can actually see on
 * the card. Deliberately local: the shelf must never mutate the marketplace
 * store's global `filters`, or searching on the Agents screen would silently
 * re-scope the Marketplace screen (and vice versa).
 */
export const matchesQuery = (item, query) => {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.tagline, item.description, item.category, item.publisher_pseudonym]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
};

/** Most-installed first, with a stable title tiebreak so order never flickers. */
export const byPopularity = (a, b) => (b.downloads || 0) - (a.downloads || 0) || String(a.title || '').localeCompare(String(b.title || ''));

/**
 * Trim a list to whole grid rows.
 *
 * A shelf that ends on a ragged row reads as "we ran out" rather than "here is
 * a selection" — 6 items in a 4-column grid rendered 4 + 2 and left a measured
 * 659px of dead space. Column count is responsive, so the caller passes the
 * live value and this stays a pure function.
 */
export const trimToWholeRows = (list, columns, maxRows = 2) => {
  const cols = Math.max(1, Number(columns) || 1);
  const items = list || [];
  if (items.length <= cols) return items;
  const whole = Math.floor(items.length / cols) * cols;
  return items.slice(0, Math.min(whole, cols * maxRows));
};
