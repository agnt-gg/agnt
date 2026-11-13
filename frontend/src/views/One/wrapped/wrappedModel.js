/**
 * AGNT One's year in review ("Wrapped"): when it is offered, and the cards made
 * from GET /api/wrapped/:year. Pure functions, so every figure a card shows can
 * be checked without a browser. A card whose numbers are empty is left out
 * rather than shown with zeros.
 */

export const MONTHS = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const MON = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = Object.freeze(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
const DAY_MS = 86400000;

/** The AGNT mark: six dots, as [cx, cy] in its 37×36 box. */
export const MARK_DOTS = Object.freeze([[18.77, 4.5], [12.02, 18], [25.52, 18], [5.27, 31.5], [18.77, 31.5], [32.27, 31.5]]);
/** Where each dot of the mark moves to become a conductor (the fifth dot) facing five players. */
const CONDUCTOR_MOVES = Object.freeze([[0, 2.5], [-1.85, -8.29], [1.85, -8.29], [-0.6, -14.63], [0, 0], [0.6, -14.63]]);

/** Fewer active days than this, and there is no year to tell yet. */
export const MIN_ACTIVE_DAYS = 7;
export const CALLS_PER_DOT = 500;
export const WORDS_PER_TOKEN = 0.75;
export const WAR_AND_PEACE_WORDS = 587287;
/** The most spines the shelf draws; past it, one spine stands for several copies. */
export const MAX_SPINES = 350;

// ── When it is offered ─────────────────────────────────────────────────────

/**
 * December 1 to January 31 is the season, for the year that is ending (or has
 * just ended). The rest of the year the cards still open from More, as the
 * year so far.
 */
export function wrappedSeason(now = new Date()) {
  const month = now.getMonth();
  if (month === 11) return { year: now.getFullYear(), inSeason: true };
  if (month === 0) return { year: now.getFullYear() - 1, inSeason: true };
  return { year: now.getFullYear(), inSeason: false };
}

// ── Which years the person has opened (the capsule's "New") ──────────────

const SEEN_KEY = 'agnt:one-wrapped-seen';
export const seenKey = (account) => (account ? `${SEEN_KEY}:${account}` : SEEN_KEY);

/** Whole years only: a hand-edited or stale value is dropped. */
export function loadSeenYears(account, storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(seenKey(account)) || '[]');
    return Array.isArray(raw) ? raw.filter((year) => Number.isInteger(year)) : [];
  } catch {
    return [];
  }
}

/** Saves and returns the years seen. A failed write keeps them for this session. */
export function saveSeenYear(account, year, storage = globalThis.localStorage) {
  const years = [...new Set([...loadSeenYears(account, storage), year])].sort((a, b) => a - b);
  try {
    storage?.setItem(seenKey(account), JSON.stringify(years));
  } catch (error) {
    console.warn('[AGNT One] could not remember the year in review as seen:', error?.message || error);
  }
  return years;
}

// ── Numbers in words ───────────────────────────────────────────────────────

export const formatCount = (n) => Math.round(n).toLocaleString('en-US');
export const formatDollars = (n) => '$' + formatCount(n);
export const formatCents = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const oneDecimal = (v) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, ''));
/** 1,234 → 1.2K; 272,761,301 → 273M; 59,121,190,028 → 59.1B. */
export function formatCompact(n) {
  if (n >= 1e9) return oneDecimal(n / 1e9) + 'B';
  if (n >= 1e6) return oneDecimal(n / 1e6) + 'M';
  if (n >= 1e3) return oneDecimal(n / 1e3) + 'K';
  return String(Math.round(n));
}
const monthIndex = (iso) => Number(iso.slice(5, 7)) - 1;
export const shortDate = (iso) => `${MON[monthIndex(iso)]} ${Number(iso.slice(8, 10))}`;
export const longDate = (iso) => `${MONTHS[monthIndex(iso)]} ${Number(iso.slice(8, 10))}`;
/** Calendar arithmetic on 'YYYY-MM-DD' dates, free of any time zone. */
const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const total = (counts) => Object.values(counts || {}).reduce((a, b) => a + b, 0);
/** ['a'] → 'a'; ['a', 'b', 'c'] → 'a, b and c'. */
export function listing(parts) {
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
}
/** A repeatable pseudo-random sequence, so a card draws the same every time. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const round1 = (n) => Math.round(n * 10) / 10;

// ── The year, derived ──────────────────────────────────────────────────────

export function hasStory(data) {
  return Boolean(data && Array.isArray(data.days) && data.days.length >= MIN_ACTIVE_DAYS && data.totals?.calls > 0);
}

export function deriveYear(data) {
  const days = data.days;
  const firstDay = days[0][0];
  const lastDay = days[days.length - 1][0];

  let longest = null;
  let run = null;
  for (const [iso] of days) {
    const n = dayNumber(iso);
    run = run && n - run.lastN === 1 ? { ...run, length: run.length + 1, end: iso, lastN: n } : { length: 1, start: iso, end: iso, lastN: n };
    if (!longest || run.length > longest.length) longest = run;
  }
  const streak = { length: longest.length, start: longest.start, end: longest.end, unbroken: longest.start === firstDay && longest.end === lastDay };
  const busiest = days.reduce((a, b) => (b[1] > a[1] ? b : a));

  const months = [];
  for (const [iso, calls] of days) {
    const key = iso.slice(0, 7);
    const current = months[months.length - 1];
    if (current && current.key === key) current.calls += calls;
    else months.push({ key, month: monthIndex(iso), calls });
  }
  const peakMonth = months.reduce((a, b) => (b.calls > a.calls ? b : a));
  const firstMonth = months[0];
  const through = data.window?.through || lastDay;
  const [ty, tm, td] = through.split('-').map(Number);
  const lastMonth = months[months.length - 1];
  const partialKey = !data.window?.complete && lastMonth.key === through.slice(0, 7) && td < new Date(Date.UTC(ty, tm, 0)).getUTCDate() ? lastMonth.key : null;

  const weekdayTotals = new Array(7).fill(0);
  for (const [iso, calls] of days) weekdayTotals[weekdayOf(iso)] += calls;

  const calls = data.totals.calls;
  const pct = (n) => Math.round((100 * n) / calls);
  const { conversation = 0, automation = 0 } = data.split || {};
  let persona = null;
  if (conversation || automation) {
    persona = conversation >= automation
      ? { name: 'Conductor', line: `You lead in conversation and let the orchestra play: ${pct(conversation)}% of your calls came from chats with Annie, ${pct(automation)}% from workflows and goals.` }
      : { name: 'Operator', line: `You build things that run without you: ${pct(automation)}% of your calls came from workflows and goals, ${pct(conversation)}% from chats with Annie.` };
  }

  const built = data.built || {};
  const builtKinds = Object.keys(built).map((kind) => ({ kind, count: total(built[kind]) })).filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
  const byMonth = {};
  for (const kind of Object.keys(built)) for (const [key, n] of Object.entries(built[kind])) byMonth[key] = (byMonth[key] || 0) + n;
  const peakBuildKey = Object.keys(byMonth).sort((a, b) => byMonth[b] - byMonth[a] || a.localeCompare(b))[0] || null;
  const peakBuild = peakBuildKey && {
    month: monthIndex(peakBuildKey),
    parts: Object.keys(built).map((kind) => ({ kind, n: built[kind][peakBuildKey] || 0 })).filter((p) => p.n > 0).sort((a, b) => b.n - a.n).slice(0, 3),
  };

  return {
    firstDay,
    lastDay,
    through,
    streak,
    busiest: { date: busiest[0], calls: busiest[1] },
    months,
    peakMonth,
    firstMonth,
    partialKey,
    busiestWeekday: weekdayTotals.indexOf(Math.max(...weekdayTotals)),
    persona,
    builtKinds,
    peakBuild,
  };
}

// ── Pictures made of the mark's dots ───────────────────────────────────────

/** A dot per active day, a column per week (Monday first), darker the busier the day. */
export function calendarGeometry(days, busiestDate) {
  const start = dayNumber(days[0][0]);
  const startRow = (weekdayOf(days[0][0]) + 6) % 7;
  const max = Math.max(...days.map(([, calls]) => calls));
  const dots = [];
  const labels = [];
  let ring = null;
  let cols = 0;
  let lastMonth = -1;
  for (const [iso, calls] of days) {
    const k = dayNumber(iso) - start;
    const col = Math.floor((k + startRow) / 7);
    const row = (k + startRow) % 7;
    cols = Math.max(cols, col + 1);
    const dot = { cx: col * 10 + 5, cy: row * 10 + 5, o: Math.round((0.22 + 0.78 * Math.sqrt(calls / max)) * 100) / 100, k };
    dots.push(dot);
    if (iso === busiestDate) ring = { cx: dot.cx, cy: dot.cy };
    const m = monthIndex(iso);
    if (m !== lastMonth) {
      lastMonth = m;
      labels.push({ x: col * 10 + 1.4, text: MON[m] });
    }
  }
  return { width: cols * 10, height: 84, dots, ring, labels };
}

/** Two dots wide per month, one dot per CALLS_PER_DOT calls (at least one). */
export function monthDotsGeometry(months, peakKey, partialKey) {
  const cols = months.map((m) => ({ ...m, n: Math.max(1, Math.round(m.calls / CALLS_PER_DOT)) }));
  const rows = Math.max(...cols.map((c) => Math.ceil(c.n / 2)));
  const colW = 20;
  const gap = 9;
  const top = 14;
  const width = cols.length * colW + (cols.length - 1) * gap;
  const height = top + rows * 10 + 13;
  const dots = [];
  const labels = [];
  let peakLabel = null;
  cols.forEach((c, ci) => {
    const x0 = ci * (colW + gap);
    const kind = c.key === peakKey ? 'peak' : c.key === partialKey ? 'partial' : '';
    for (let k = 0; k < c.n; k++) {
      const row = Math.floor(k / 2);
      dots.push({ cx: x0 + (k % 2) * 10 + 5, cy: top + (rows - 1 - row) * 10 + 5, k: row + ci, kind });
    }
    labels.push({ x: x0 + colW / 2, text: MON[c.month][0] });
    if (kind === 'peak') peakLabel = { x: x0 + colW / 2, y: top + (rows - Math.ceil(c.n / 2)) * 10 - 4, text: formatCompact(c.calls) };
  });
  return { width, height, dots, labels, peakLabel };
}

/** A shelf of `n` book spines, five rows. */
export function shelfGeometry(n) {
  const rows = 5;
  const per = Math.ceil(n / rows);
  const random = seeded(42);
  const spines = [];
  for (let k = 0; k < n; k++) {
    const h = 38 + Math.floor(random() * 16);
    const w = random() < 0.18 ? 7.5 : 6.4;
    spines.push({ x: (k % per) * 10, y: Math.floor(k / per) * 62 + 54 - h, w, h, k });
  }
  const shelves = Array.from({ length: rows }, (_, row) => ({ y: row * 62 + 54.6, width: per * 10 + 6 }));
  return { width: per * 10 + 6, height: rows * 62 - 4, spines, shelves };
}

/** SkillForge's year as three clusters of dots: trials, kept, promoted. */
export function funnelGeometry({ skillTrials, skillsKept, skillsPromoted }) {
  const groups = [
    { n: skillTrials, kind: 'trial', top: formatCount(skillTrials), sub: 'skill trials' },
    { n: skillsKept, kind: 'kept', top: formatCount(skillsKept), sub: 'skills kept' },
    { n: skillsPromoted, kind: 'promoted', top: formatCount(skillsPromoted), sub: 'promoted' },
  ];
  const cell = 4.2;
  const gap = 18;
  const dims = groups.map((g) => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(g.n)));
    return { cols, rows: Math.max(1, Math.ceil(g.n / cols)) };
  });
  const maxRows = Math.max(...dims.map((d) => d.rows));
  const base = maxRows * cell;
  const dots = [];
  const labels = [];
  const arrows = [];
  let x0 = 0;
  groups.forEach((g, gi) => {
    const { cols, rows } = dims[gi];
    for (let k = 0; k < g.n; k++) {
      dots.push({ cx: round1(x0 + (k % cols) * cell + cell / 2), cy: round1((maxRows - rows + Math.floor(k / cols)) * cell + cell / 2), k, kind: g.kind });
    }
    labels.push({ x: round1(x0), top: g.top, sub: g.sub });
    if (gi < groups.length - 1) arrows.push({ x: round1(x0 + cols * cell + gap / 2 - 1.7), y: round1(base - 16) });
    x0 += cols * cell + gap;
  });
  return { width: round1(x0 - gap), height: round1(base + 19), base: round1(base), dots, labels, arrows };
}

/** The mark's six dots, with where each moves to become a conductor and five players. */
export function conductorDots() {
  return MARK_DOTS.map(([cx, cy], k) => ({ cx, cy, k, tx: CONDUCTOR_MOVES[k][0], ty: CONDUCTOR_MOVES[k][1], lead: k === 4 }));
}

/** A night sky of small dots behind the first card. */
export function starField(count = 110) {
  const random = seeded(7);
  return Array.from({ length: count }, () => ({
    cx: round1(random() * 90),
    cy: round1(random() * 160),
    r: Math.round((0.18 + random() * 0.42) * 100) / 100,
    o: Math.round((0.12 + random() * 0.55) * 100) / 100,
    delay: round1(random() * 3.2),
  }));
}

// ── The cards ──────────────────────────────────────────────────────────────

function sharePhrase(share) {
  if (share > 0.5) return 'More than half';
  if (share === 0.5) return 'Exactly half';
  if (share > 1 / 3) return 'More than a third';
  if (share > 0.25) return 'More than a quarter';
  if (share > 0.2) return 'More than one in five';
  return `${Math.round(share * 100)}%`;
}

/** The words written, as copies of War and Peace: '350 copies', '3 copies', 'one copy', '40% of a copy'. */
export function novelCopies(outputTokens) {
  const copies = (outputTokens * WORDS_PER_TOKEN) / WAR_AND_PEACE_WORDS;
  if (copies >= 1.5) {
    const n = copies >= 100 ? Math.round(copies / 10) * 10 : Math.round(copies);
    return { count: n, words: `${formatCount(n)} copies` };
  }
  if (copies >= 0.95) return { count: 1, words: 'one copy' };
  return { count: 1, words: `${Math.max(1, Math.round(copies * 100))}% of a copy` };
}

/** The money card reads the axis that holds the year's work: subscription use at list prices, else metered spend. */
function moneyOf(totals) {
  const notional = totals.notionalUsd > 0;
  if (!notional && !(totals.costUsd > 0)) return null;
  return {
    notional,
    amount: notional ? totals.notionalUsd : totals.costUsd,
    uncached: notional ? totals.notionalUncachedUsd : totals.uncachedCostUsd,
    saved: notional ? totals.notionalSavedUsd : totals.savedUsd,
    charged: totals.costUsd,
    unpriced: totals.unpricedCalls || 0,
  };
}

/**
 * The cards, in order. Each is { id, tone, duration, label, ...what it shows };
 * `tone` is the card's ground (dark or light), `duration` its time on screen
 * in ms (0: it waits for the reader), `label` what a screen reader announces.
 */
export function buildCards(data) {
  if (!hasStory(data)) return [];
  const y = deriveYear(data);
  const t = data.totals;
  const cards = [];
  const add = (card) => cards.push(card);

  add({ id: 'intro', tone: 'dark', duration: 5000, label: `${data.year}, wrapped.`, year: data.year, from: shortDate(data.window?.from || y.firstDay), through: shortDate(y.through), stars: starField() });

  add({
    id: 'streak',
    tone: 'light',
    duration: 8000,
    label: `${formatCount(y.streak.length)} days in a row`,
    length: y.streak.length,
    sentence: y.streak.unbroken
      ? `You and your agents showed up every single day since ${longDate(y.streak.start)}. Not one day off.`
      : `Your longest run went from ${longDate(y.streak.start)} to ${longDate(y.streak.end)}.`,
    busiest: { date: shortDate(y.busiest.date), calls: formatCount(y.busiest.calls) },
    firstDay: shortDate(y.firstDay),
    calendar: calendarGeometry(data.days, y.busiest.date),
  });

  const ratio = y.peakMonth.calls / y.firstMonth.calls;
  add({
    id: 'volume',
    tone: 'dark',
    duration: 7500,
    label: `${formatCount(t.calls)} model calls`,
    calls: t.calls,
    models: formatCount(data.models.count),
    providers: formatCount(data.providers.count),
    peak: { name: MONTHS[y.peakMonth.month], calls: formatCount(y.peakMonth.calls) },
    growth: y.peakMonth.key !== y.firstMonth.key && ratio >= 2 ? `${Math.floor(ratio)}× ${MONTHS[y.firstMonth.month]}` : null,
    partialMonth: y.partialKey ? MONTHS[monthIndex(`${y.partialKey}-01`)] : null,
    perDot: formatCount(CALLS_PER_DOT),
    chart: monthDotsGeometry(y.months, y.peakMonth.key, y.partialKey),
  });

  if (t.outputTokens > 0) {
    const books = novelCopies(t.outputTokens);
    const perSpine = Math.max(1, Math.ceil(books.count / MAX_SPINES));
    add({
      id: 'words',
      tone: 'light',
      duration: 8000,
      label: `${formatCompact(t.outputTokens)} tokens written`,
      written: formatCompact(t.outputTokens),
      books: books.words,
      read: formatCompact(t.inputTokens),
      cachePct: t.inputTokens > 0 ? Math.round((100 * t.cacheReadTokens) / t.inputTokens) : 0,
      wordsPerToken: WORDS_PER_TOKEN,
      novelWords: formatCount(Math.round(WAR_AND_PEACE_WORDS / 1000) * 1000),
      perSpine: perSpine > 1 ? formatCount(perSpine) : null,
      shelf: shelfGeometry(Math.ceil(books.count / perSpine)),
    });
  }

  const [topModel, ...otherModels] = data.models.top || [];
  if (topModel) {
    add({
      id: 'model',
      tone: 'dark',
      duration: 7500,
      label: `Your number one model: ${topModel.name}`,
      name: topModel.name,
      calls: formatCount(topModel.calls),
      share: sharePhrase(topModel.calls / t.calls),
      rest: otherModels.map((m, i) => ({ rank: i + 2, name: m.name, calls: formatCount(m.calls), ratio: Math.round((1000 * m.calls) / topModel.calls) / 1000 })),
      modelCount: formatCount(data.models.count),
      providerCount: formatCount(data.providers.count),
    });
  }

  const goals = data.goals || {};
  if (goals.top?.length) {
    add({
      id: 'goals',
      tone: 'light',
      duration: 7500,
      label: 'Your most-run goals',
      top: goals.top.map((g, i) => ({ rank: i + 1, title: g.title, calls: formatCount(g.calls) })),
      passed: goals.created ? `${formatCount(goals.validated)} of the ${formatCount(goals.created)}` : null,
    });
  }

  if (y.builtKinds.length) {
    const parts = (y.peakBuild?.parts || []).map((p) => `${formatCount(p.n)} ${p.n === 1 ? p.kind.replace(/s$/, '') : p.kind}`);
    add({
      id: 'built',
      tone: 'dark',
      duration: 7500,
      label: 'What you built this year',
      cells: y.builtKinds,
      peak: y.peakBuild ? { month: MONTHS[y.peakBuild.month], parts: listing(parts) } : null,
    });
  }

  const money = moneyOf(t);
  if (money) {
    add({
      id: 'money',
      tone: 'light',
      duration: 8500,
      label: `${formatDollars(money.amount)} ${money.notional ? 'at API list prices' : 'in metered spend'}`,
      notional: money.notional,
      amount: Math.round(money.amount),
      uncached: money.saved > 0 ? formatDollars(money.uncached) : null,
      saved: money.saved > 0 ? formatDollars(money.saved) : null,
      charged: formatCents(money.charged),
      unpriced: money.unpriced ? formatCount(money.unpriced) : null,
    });
  }

  const l = data.learning || {};
  if (l.insightsApplied > 0) {
    add({
      id: 'learning',
      tone: 'dark',
      duration: 8000,
      label: `${formatCount(l.insightsApplied)} improvements applied`,
      applied: l.insightsApplied,
      rejected: formatCount(l.insightsRejected || 0),
      funnel: l.skillTrials > 0 ? funnelGeometry(l) : null,
      memories: l.memories > 0 ? formatCount(l.memories) : null,
    });
  }

  if (y.persona) {
    const badges = [
      { key: 'Busiest day', value: `${WEEKDAYS[y.busiestWeekday]}s` },
      { key: 'Peak month', value: MONTHS[y.peakMonth.month] },
    ];
    if (data.models.count >= 25) badges.push({ key: 'Explorer', value: `${formatCount(data.models.count)} models` });
    add({ id: 'persona', tone: 'light', duration: 8000, label: `Your AGNT type: The ${y.persona.name}`, name: y.persona.name, line: y.persona.line, badges, dots: conductorDots() });
  }

  const hero = y.builtKinds[0] || null;
  add({
    id: 'summary',
    tone: 'dark',
    duration: 0,
    label: `Your ${data.year} in AGNT`,
    year: data.year,
    streak: formatCount(y.streak.length),
    calls: formatCount(t.calls),
    topModel: topModel?.name || null,
    topGoal: goals.top?.[0]?.title || null,
    built: hero ? { count: formatCount(hero.count), kind: hero.kind } : null,
    saved: money?.saved > 0 ? `$${formatCompact(money.saved)}` : null,
    modelCount: formatCount(data.models.count),
    persona: y.persona?.name || null,
  });

  return cards;
}
