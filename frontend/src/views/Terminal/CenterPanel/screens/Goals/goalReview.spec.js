/**
 * Shapes taken from a real goal in review ("agnt.gg Weekly SEO + AI Visibility
 * Review"): its checklist text, the evaluator's evidence and the files its
 * tasks wrote. The reviewer could not tell what was done; these pin that each
 * check now points at its proof.
 */
import { describe, it, expect } from 'vitest';
import { namedPathMatchers, deliverablesFor, reportSections, sectionFor, proofFor, reviewVerdict, baseName } from './goalReview.js';

const ROOT = 'C:/Users/Studio/AppData/Roaming/AGNT/projects';
const files = [
  `${ROOT}/seo-cron-check-2026-09-24.md`,
  `${ROOT}/agnt-gg-seo/weekly/2026-09-14.md`,
  `${ROOT}/seo-ro-probe.mjs`,
  `${ROOT}/agnt-gg-seo/_work/compute-metrics.mjs`,
];
const tasks = ['Fetch frozen snapshots and verify cron ran', 'Run compute-metrics and fill Metrics section', 'Score every receipt', 'Fix C5 entry inside the dated report', 'Finalize anomalies, headline and verify'].map((title, i) => ({ id: 't' + i, title }));
const report = `# agnt.gg SEO weekly: week of 2026-09-14
## Headline
The cron did not run for 09-21.
## Metrics
| metric | L | P |
|---|---|---|
| organic | 484 | 460 |
## Receipts
C0 measuring.
## Proposed change
C5: in-article path.
## Anomalies
Beacons 41% of Googlebot.`;
const sections = reportSections(report);
const item = (id, text, met, evidence) => ({ id, text, met, evidence });

describe('the deliverable', () => {
  it('is the file the checklist names, with <placeholders> matching one segment', () => {
    const items = [item('c1', 'Dated report at C:\\Users\\Studio\\AppData\\Roaming\\AGNT\\projects\\agnt-gg-seo\\weekly\\<week_start>.md', true, '')];
    expect(deliverablesFor(items, files)).toEqual([`${ROOT}/agnt-gg-seo/weekly/2026-09-14.md`]);
    // Scratch notes in the same tree are not the deliverable.
    expect(deliverablesFor(items, files)).not.toContain(`${ROOT}/seo-cron-check-2026-09-24.md`);
  });

  it('matches the same file written with either slash, and nothing when no path is named', () => {
    expect(namedPathMatchers('see weekly/<week_start>.md')[0].test('x\\weekly\\2026-09-14.md'.replace(/\\/g, '/'))).toBe(true);
    expect(deliverablesFor([item('c1', 'An anomalies section', true, '')], files)).toEqual([]);
    expect(deliverablesFor([], files)).toEqual([]);
  });
});

describe('the report', () => {
  it('splits into its ## sections, skipping the title', () => {
    expect(sections.map((s) => s.heading)).toEqual(['Headline', 'Metrics', 'Receipts', 'Proposed change', 'Anomalies']);
    expect(sections[1].body).toContain('| organic | 484 | 460 |');
    expect(reportSections('')).toEqual([]);
  });

  it('each check finds the section it is about, by its subject not its fine print', () => {
    const at = (text) => sectionFor(text, sections)?.heading || null;
    expect(at('Metrics table comparing last week vs prior week')).toBe('Metrics');
    expect(at("NULL metrics are reported as 'not measurable'")).toBe('Metrics');
    expect(at('A receipt is labeled win or loss only when complete')).toBe('Receipts');
    // Mentions "metric" in its field list; it is about the proposed change.
    expect(at('Exactly one proposed next change written as a changes.json entry (id, title, hypothesis, metric, successIf, paths)')).toBe('Proposed change');
    expect(at('Anomalies section')).toBe('Anomalies');
    expect(at('if not, the report headline states that the cron did not run')).toBe('Headline');
    expect(at('Production stays read-only')).toBe(null);
  });
});

describe('proof for each check', () => {
  it('names the task the evidence cites, the file it names, and the section', () => {
    const p = proofFor(item('c1', 'Dated report at C:\\…\\agnt-gg-seo\\weekly\\<week_start>.md', true, 'Task 5 created the dated report agnt-gg-seo\\weekly\\2026-09-14.md'), { tasks, files, sections });
    expect(p.tasks).toEqual([{ number: 5, title: 'Finalize anomalies, headline and verify' }]);
    expect(p.files.map(baseName)).toEqual(['2026-09-14.md']);
  });

  it('a missed check still shows where to look', () => {
    const p = proofFor(item('c6', 'Newest frozen week_start equals last Monday; if not, the report headline states that the cron did not run', false, 'Task 1 found the newest week (09-14) does not equal last Monday (09-21), yet analysis continued in later tasks.'), { tasks, files, sections });
    expect(p.tasks.map((t) => t.number)).toEqual([1]);
    expect(p.section.heading).toBe('Headline');
  });

  it('ignores task numbers that do not exist, and repeats', () => {
    const p = proofFor(item('x', 'x', true, 'Task 9 and task 2 and Task 2 again'), { tasks, files, sections });
    expect(p.tasks.map((t) => t.number)).toEqual([2]);
    expect(proofFor(item('y', '', null, ''), {})).toEqual({ tasks: [], files: [], section: null });
  });
});

describe('the verdict', () => {
  it('counts what was met and names what was not', () => {
    const v = reviewVerdict({ evaluated: true, items: [item('a', 'A', true), item('b', 'B', false), item('c', 'C', null)] });
    expect(v).toMatchObject({ evaluated: true, met: 1, total: 3 });
    expect(v.missed.map((m) => m.id)).toEqual(['b']);
    expect(reviewVerdict(null)).toMatchObject({ evaluated: false, met: 0, total: 0, missed: [] });
  });
});
