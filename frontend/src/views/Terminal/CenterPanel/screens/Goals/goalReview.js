/**
 * Reviewing a goal's work: which file is THE deliverable, and for every
 * checklist item, the proof a person can open — the evaluator's evidence, the
 * task that did it, the file it names, and the section of the report that
 * shows it.
 *
 * Pure (goalReview.spec.js). The checklist comes from reviewChecklist(), the
 * files from goalArtifactSource(), the report text from the deliverable itself.
 */

const norm = (path) => String(path || '').replace(/\\/g, '/');
export const baseName = (path) => norm(path).split('/').filter(Boolean).pop() || '';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Paths named in free text, as matchers over written files. A `<placeholder>`
 * (e.g. `<week_start>`) matches one path segment, so "weekly\<week_start>.md"
 * finds "weekly/2026-09-14.md". Only the last three segments are compared:
 * the same file is written as C:\…, /c/… or relative to the workspace.
 */
export function namedPathMatchers(text) {
  const found = String(text || '').match(/(?:[\w.<>@-]+[\\/])+[\w.<>@-]+\.[A-Za-z0-9]{1,6}\b/g) || [];
  return found.map((path) => {
    const tail = norm(path).split('/').slice(-3).join('/');
    const pattern = tail
      .split(/(<[^>]+>)/)
      .map((part) => (/^<[^>]+>$/.test(part) ? '[^/]+' : escapeRe(part)))
      .join('');
    return new RegExp(`(^|/)${pattern}$`, 'i');
  });
}

/** The files the checklist itself asks for (the deliverables), in file order. */
export function deliverablesFor(items = [], files = []) {
  const matchers = items.flatMap((item) => namedPathMatchers(item.text));
  if (!matchers.length) return [];
  return files.filter((file) => matchers.some((re) => re.test(norm(file))));
}

/** A markdown report split into its `##` sections (the title is skipped). */
export function reportSections(markdown) {
  const sections = [];
  let current = null;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*#*$/);
    if (heading) {
      current = { heading: heading[1].trim(), body: '' };
      sections.push(current);
    } else if (current) {
      current.body += line + '\n';
    }
  }
  return sections.map((s) => ({ ...s, body: s.body.trim() })).filter((s) => s.body);
}

/**
 * The report section a checklist item is about: of the headings whose words
 * all appear in the item ("Receipts" ↔ "a receipt is labeled…"), the one it
 * mentions FIRST — an item is about its subject, not a word in its fine print
 * ("one proposed change … (hypothesis, metric, …)" is about Proposed change,
 * not Metrics). Plural "s" is dropped so singular and plural mentions match.
 */
export function sectionFor(text, sections = []) {
  const haystack = String(text || '').toLowerCase();
  let best = null;
  let bestAt = Infinity;
  for (const section of sections) {
    const words = (section.heading.toLowerCase().match(/[a-z]{4,}/g) || []).map((w) => w.replace(/s$/, ''));
    if (!words.length || !words.every((w) => haystack.includes(w))) continue;
    const at = Math.min(...words.map((w) => haystack.indexOf(w)));
    if (at < bestAt) {
      best = section;
      bestAt = at;
    }
  }
  return best;
}

/**
 * The proof for one checklist item.
 * @returns {{ tasks: {number:number,title:string}[], files: string[], section: {heading:string,body:string}|null }}
 */
export function proofFor(item, { tasks = [], files = [], sections = [] } = {}) {
  const evidence = String(item?.evidence || '');
  const text = String(item?.text || '');
  const numbers = [...new Set([...evidence.matchAll(/\btasks?\s+(\d+)/gi)].map((m) => Number(m[1])))].filter(
    (n) => n >= 1 && n <= tasks.length,
  );
  const matchers = [...namedPathMatchers(text), ...namedPathMatchers(evidence)];
  const named = files.filter((file) => {
    const path = norm(file);
    const name = baseName(file);
    return matchers.some((re) => re.test(path)) || (name.length > 4 && evidence.includes(name));
  });
  return {
    tasks: numbers.map((n) => ({ number: n, title: String(tasks[n - 1]?.title || `Task ${n}`) })),
    files: [...new Set(named)],
    section: sectionFor(text, sections),
  };
}

/** One line for the reviewer: how many checks passed, and which did not. */
export function reviewVerdict(checklist) {
  const items = checklist?.items || [];
  return {
    evaluated: !!checklist?.evaluated,
    met: items.filter((i) => i.met === true).length,
    total: items.length,
    missed: items.filter((i) => i.met === false),
  };
}
