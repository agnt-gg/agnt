/**
 * AGNT One's year in review ("Wrapped"): when it is offered, and the cards made
 * from GET /api/wrapped/:year. Pure functions, so every figure a card shows can
 * be checked without a browser. A card whose numbers are empty is left out
 * rather than shown with zeros.
 */

/** What a person calls each kind of thing they built (the data keys stay as they are). */
const BUILT_WORDS = Object.freeze({ agents: ['assistant', 'assistants'], workflows: ['automation', 'automations'], tools: ['action', 'actions'], skills: ['playbook', 'playbooks'], widgets: ['dashboard card', 'dashboard cards'], plugins: ['add-on', 'add-ons'] });

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
/** The month chart's tallest month draws at most this many dots. */
export const MAX_MONTH_DOTS = 40;
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
/** The smallest 1, 2 or 5 × 10ⁿ that draws `max` in at most `dots` dots. */
export function dotStep(max, dots = MAX_MONTH_DOTS) {
  const target = Math.max(1, max / dots);
  const power = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= target);
}
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

/** A year to tell: a week or more of active days. */
export function hasStory(data) {
  const days = data?.activity?.days;
  return Array.isArray(days) && days.filter((day) => day.active).length >= MIN_ACTIVE_DAYS;
}

/**
 * The streak a year tells: the dashboard's (unbroken up to today, over all
 * history) when it reaches into the year and is at least as long as anything
 * inside it; otherwise the year's own longest run of active days.
 */
function streakOfYear(activeDays, current, through) {
  let longest = null;
  let run = null;
  for (const { date } of activeDays) {
    const n = dayNumber(date);
    run = run && n - run.lastN === 1 ? { ...run, length: run.length + 1, end: date, lastN: n } : { length: 1, start: date, end: date, lastN: n };
    if (!longest || run.length > longest.length) longest = run;
  }
  if (current?.days > 0 && current.since <= through && current.days >= longest.length) {
    return { length: current.days, start: current.since, end: current.lastActiveDate, current: true };
  }
  return { length: longest.length, start: longest.start, end: longest.end, current: false };
}

/** The year behind the cards. Expects hasStory(data). */
export function deriveYear(data) {
  const { from, through, complete } = data.window;
  const runDays = data.activity.days;
  const activeDays = runDays.filter((day) => day.active);
  const streak = streakOfYear(activeDays, data.activity.streak, through);
  const busiest = activeDays.reduce((a, b) => (b.runs > a.runs ? b : a));

  // Every month of the window, so a quiet month reads as one rather than vanishing.
  const runsByMonth = new Map();
  for (const { date, runs } of runDays) runsByMonth.set(date.slice(0, 7), (runsByMonth.get(date.slice(0, 7)) || 0) + runs);
  const months = [];
  for (let m = monthIndex(from); m <= monthIndex(through); m++) {
    const key = `${from.slice(0, 4)}-${String(m + 1).padStart(2, '0')}`;
    months.push({ key, month: m, runs: runsByMonth.get(key) || 0 });
  }
  const peakMonth = months.reduce((a, b) => (b.runs > a.runs ? b : a));
  const firstMonth = months.find((m) => m.runs > 0) || null;
  const [ty, tm, td] = through.split('-').map(Number);
  const partialKey = !complete && td < new Date(Date.UTC(ty, tm, 0)).getUTCDate() ? through.slice(0, 7) : null;

  const weekdayTotals = new Array(7).fill(0);
  for (const { date, runs } of runDays) weekdayTotals[weekdayOf(date)] += runs;

  const calls = data.totals.calls;
  const pct = (n) => Math.round((100 * n) / calls);
  const { conversation = 0, automation = 0 } = data.split || {};
  let persona = null;
  if (conversation || automation) {
    persona = conversation >= automation
      ? { name: 'Conductor', line: `You lead in conversation and let the orchestra play: ${pct(conversation)}% of your model calls came from chats with Annie, ${pct(automation)}% from automations and goals.` }
      : { name: 'Operator', line: `You build things that run without you: ${pct(automation)}% of your model calls came from automations and goals, ${pct(conversation)}% from chats with Annie.` };
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

  // A source that starts after Jan 1 is labelled with the day it starts.
  const later = (date) => (date && date > from ? date : null);
  return {
    through,
    streak,
    busiest: { date: busiest.date, runs: busiest.runs },
    activeCount: activeDays.length,
    daysInWindow: dayNumber(through) - dayNumber(from) + 1,
    months,
    peakMonth,
    firstMonth,
    partialKey,
    busiestWeekday: weekdayTotals.indexOf(Math.max(...weekdayTotals)),
    persona,
    builtKinds,
    peakBuild,
    ledgerSince: later(data.ledger?.from),
    tokensSince: later(data.activity.tokensFrom),
  };
}

// ── Pictures made of the mark's dots ───────────────────────────────────────

/** A dot per active day, a column per week (Monday first), darker the busier the day. */
export function calendarGeometry(days, busiestDate) {
  const start = dayNumber(days[0][0]);
  const startRow = (weekdayOf(days[0][0]) + 6) % 7;
  const max = Math.max(1, ...days.map(([, value]) => value));
  const dots = [];
  const labels = [];
  let ring = null;
  let cols = 0;
  let lastMonth = -1;
  for (const [iso, value] of days) {
    const k = dayNumber(iso) - start;
    const col = Math.floor((k + startRow) / 7);
    const row = (k + startRow) % 7;
    cols = Math.max(cols, col + 1);
    const dot = { cx: col * 10 + 5, cy: row * 10 + 5, o: Math.round((0.22 + 0.78 * Math.sqrt(value / max)) * 100) / 100, k };
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

/** Two dots wide per month, one dot per `perDot` runs; a month with any runs gets at least one. */
export function monthDotsGeometry(months, peakKey, partialKey, perDot) {
  const cols = months.map((m) => ({ ...m, n: m.runs > 0 ? Math.max(1, Math.round(m.runs / perDot)) : 0 }));
  const rows = Math.max(1, ...cols.map((c) => Math.ceil(c.n / 2)));
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
    if (kind === 'peak') peakLabel = { x: x0 + colW / 2, y: top + (rows - Math.ceil(c.n / 2)) * 10 - 4, text: formatCompact(c.runs) };
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
    { n: skillTrials, kind: 'trial', top: formatCount(skillTrials), sub: 'playbook trials' },
    { n: skillsKept, kind: 'kept', top: formatCount(skillsKept), sub: 'playbooks kept' },
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

  const activity = data.activity;
  const ledgerSince = y.ledgerSince ? shortDate(y.ledgerSince) : null;
  add({ id: 'intro', tone: 'dark', duration: 5000, label: `${data.year}, wrapped.`, year: data.year, from: shortDate(data.window.from), through: shortDate(y.through), stars: starField() });

  const withYear = (iso) => (iso.startsWith(`${data.year}-`) ? longDate(iso) : `${longDate(iso)}, ${iso.slice(0, 4)}`);
  let sentence = `Your longest run this year went from ${longDate(y.streak.start)} to ${longDate(y.streak.end)}.`;
  if (y.streak.current && y.streak.start <= data.window.from) {
    sentence = `You and your assistants haven’t missed a day since ${withYear(y.streak.start)}. That’s every day of ${data.year}${data.window.complete ? '' : ' so far'}.`;
  } else if (y.streak.current) {
    sentence = `You and your assistants have shown up every day since ${withYear(y.streak.start)}.`;
  }
  add({
    id: 'streak',
    tone: 'light',
    duration: 8000,
    label: `${formatCount(y.streak.length)} days in a row`,
    length: y.streak.length,
    sentence,
    busiest: { date: shortDate(y.busiest.date), runs: formatCount(y.busiest.runs) },
    activeLine: `${formatCount(y.activeCount)} of ${formatCount(y.daysInWindow)} days active in ${data.year}`,
    calendar: calendarGeometry(activity.days.filter((d) => d.active).map((d) => [d.date, d.runs]), y.busiest.date),
  });

  const step = dotStep(Math.max(...y.months.map((m) => m.runs)));
  const ratio = y.firstMonth ? y.peakMonth.runs / y.firstMonth.runs : 0;
  add({
    id: 'volume',
    tone: 'dark',
    duration: 7500,
    label: `${formatCount(activity.runs)} runs`,
    runs: activity.runs,
    calls: t.calls > 0 ? formatCount(t.calls) : null,
    models: formatCount(data.models.count),
    providers: formatCount(data.providers.count),
    ledgerSince,
    peak: { name: MONTHS[y.peakMonth.month], runs: formatCount(y.peakMonth.runs) },
    growth: y.firstMonth && y.peakMonth.key !== y.firstMonth.key && ratio >= 2 ? `${Math.floor(ratio)}× ${MONTHS[y.firstMonth.month]}` : null,
    partialMonth: y.partialKey ? MONTHS[monthIndex(`${y.partialKey}-01`)] : null,
    perDot: formatCount(step),
    chart: monthDotsGeometry(y.months, y.peakMonth.key, y.partialKey, step),
  });

  if (activity.tokens > 0) {
    const books = t.outputTokens > 0 ? novelCopies(t.outputTokens) : null;
    const perSpine = books ? Math.max(1, Math.ceil(books.count / MAX_SPINES)) : 1;
    add({
      id: 'words',
      tone: 'light',
      duration: 8000,
      label: `${formatCompact(activity.tokens)} tokens`,
      tokens: formatCompact(activity.tokens),
      written: books ? formatCompact(t.outputTokens) : null,
      books: books?.words || null,
      cachePct: t.inputTokens > 0 ? Math.round((100 * t.cacheReadTokens) / t.inputTokens) : null,
      wordsPerToken: WORDS_PER_TOKEN,
      novelWords: formatCount(Math.round(WAR_AND_PEACE_WORDS / 1000) * 1000),
      perSpine: perSpine > 1 ? formatCount(perSpine) : null,
      shelf: books ? shelfGeometry(Math.ceil(books.count / perSpine)) : null,
      tokensSince: y.tokensSince ? shortDate(y.tokensSince) : null,
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
      ledgerSince,
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
    const parts = (y.peakBuild?.parts || []).map((p) => { const [one, many] = BUILT_WORDS[p.kind] || [p.kind.replace(/s$/, ''), p.kind]; return `${formatCount(p.n)} ${p.n === 1 ? one : many}`; });
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
      ledgerSince,
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
    runs: formatCount(activity.runs),
    tokens: activity.tokens > 0 ? formatCompact(activity.tokens) : null,
    topModel: topModel?.name || null,
    topGoal: goals.top?.[0]?.title || null,
    built: hero ? { count: formatCount(hero.count), kind: hero.kind } : null,
    saved: money?.saved > 0 ? `$${formatCompact(money.saved)}` : null,
    modelCount: data.models.count > 0 ? formatCount(data.models.count) : null,
    persona: y.persona?.name || null,
  });

  return cards;
}
