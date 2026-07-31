import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  uniqueAgentsByName,
  buildMentionRegex,
  renderMentionPills,
  findAgentMentions,
} from './agentMentions.js';

/**
 * The defect this file pins: agent NAMES are not unique. The old per-name
 * replace loop re-scanned its own output, so a second agent sharing a name
 * wrapped the pill it had just emitted (the `<` of `</span>` satisfies the
 * boundary lookahead) — a mention pill inside a mention pill.
 */

// Mirrors the real install: two Sols, three Social Media Managers.
const ROSTER = [
  { id: 'sol-1', name: 'Sol', icon: '🔥' },
  { id: 'sol-2', name: 'Sol', icon: '🌞' },
  // Deliberately listed BEFORE 'Social Media Manager': registration order must
  // not decide the match. Only longest-first alternation keeps the long name
  // whole, so this ordering is what makes that sort load-bearing.
  { id: 'social-1', name: 'Social', icon: '💬' },
  { id: 'smm-1', name: 'Social Media Manager', icon: '📣' },
  { id: 'smm-2', name: 'Social Media Manager', icon: '📢' },
  { id: 'smm-3', name: 'Social Media Manager', icon: '📡' },
  { id: 'solar-1', name: 'Solar', icon: '☀️' },
  { id: 'rex-1', name: 'Rex (v2)', icon: '🤖' },
];

const PILL = (n) => `<span class="mention-pill">@${n}</span>`;

describe('renderMentionPills — duplicate-name nesting regression', () => {
  it('a name shared by TWO agents produces exactly one pill', () => {
    const out = renderMentionPills('hey @Sol look', ROSTER);
    expect(out).toBe(`hey ${PILL('Sol')} look`);
    expect(out).not.toContain('mention-pill"><span');
  });

  it('a name shared by THREE agents still produces exactly one pill', () => {
    const out = renderMentionPills('ping @Social Media Manager now', ROSTER);
    expect((out.match(/mention-pill/g) || []).length).toBe(1);
  });

  it('never emits a pill inside a pill, for any mention in the roster', () => {
    const text = ROSTER.map((a) => `@${a.name}`).join(' and ');
    const out = renderMentionPills(text, ROSTER);
    expect(out).not.toMatch(/<span class="mention-pill">@[^<]*<span/);
  });

  it('ANTI-VACUITY: the old per-name loop really does nest (so the assertions above are load-bearing)', () => {
    let html = 'hey @Sol look';
    for (const name of ROSTER.map((a) => a.name)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(`@${escaped}(?=[\\s.,!?;:&<]|$)`, 'g'), PILL(name));
    }
    expect(html).toContain('mention-pill"><span');
  });
});

describe('renderMentionPills — matching rules', () => {
  it('longest name wins over a shorter prefix of it', () => {
    expect(renderMentionPills('@Solar rises', ROSTER)).toBe(`${PILL('Solar')} rises`);
  });

  it('keeps a multi-word name whole when a shorter name is its first word', () => {
    expect(renderMentionPills('@Social Media Manager ping', ROSTER))
      .toBe(`${PILL('Social Media Manager')} ping`);
    expect(renderMentionPills('@Social alone', ROSTER)).toBe(`${PILL('Social')} alone`);
  });

  it('the same rule governs floor passes, not just rendering', () => {
    expect(findAgentMentions('@Social Media Manager ping', ROSTER).map((a) => a.name))
      .toEqual(['Social Media Manager']);
  });

  it('escapes regex metacharacters in names', () => {
    expect(renderMentionPills('ask @Rex (v2), ok?', ROSTER)).toBe(`ask ${PILL('Rex (v2)')}, ok?`);
  });

  it('requires a boundary — no match mid-word', () => {
    expect(renderMentionPills('mail me@Solve.com', ROSTER)).toBe('mail me@Solve.com');
  });

  it('marks up multiple distinct mentions in one pass', () => {
    expect(renderMentionPills('@Sol and @Solar', ROSTER)).toBe(`${PILL('Sol')} and ${PILL('Solar')}`);
  });

  it('empty/missing roster leaves the html untouched', () => {
    expect(renderMentionPills('hi @Sol', [])).toBe('hi @Sol');
    expect(renderMentionPills('hi @Sol', null)).toBe('hi @Sol');
    expect(renderMentionPills('hi @Sol', [null, { id: 'x' }])).toBe('hi @Sol');
  });

  it('is idempotent — re-rendering already-pilled html adds nothing', () => {
    const once = renderMentionPills('hey @Sol', ROSTER);
    expect(renderMentionPills(once, ROSTER)).toBe(once);
  });
});

describe('uniqueAgentsByName / buildMentionRegex', () => {
  it('resolves a duplicated name to the first-registered agent', () => {
    expect(uniqueAgentsByName(ROSTER).filter((a) => a.name === 'Sol').map((a) => a.id)).toEqual(['sol-1']);
  });

  it('drops malformed entries', () => {
    expect(uniqueAgentsByName([null, { id: 'a' }, { name: '' }, { id: 'b', name: 'B' }])).toEqual([{ id: 'b', name: 'B' }]);
  });

  it('returns null when there is nothing to match', () => {
    expect(buildMentionRegex([])).toBeNull();
    expect(buildMentionRegex(null)).toBeNull();
  });

  it('orders alternatives longest-first', () => {
    expect(buildMentionRegex(['Sol', 'Solar']).source).toContain('(Solar|Sol)');
  });
});

describe('findAgentMentions — floor-pass detection', () => {
  it('a duplicated name queues ONE speaker, not two', () => {
    expect(findAgentMentions('over to @Sol', ROSTER)).toEqual([{ id: 'sol-1', name: 'Sol', icon: '🔥', note: null }]);
  });

  it('repeating the same mention queues the agent once', () => {
    expect(findAgentMentions('@Sol ... @Sol again', ROSTER).map((a) => a.id)).toEqual(['sol-1']);
  });

  it('returns mentions in order of first appearance', () => {
    expect(findAgentMentions('@Solar then @Sol', ROSTER).map((a) => a.id)).toEqual(['solar-1', 'sol-1']);
  });

  it('excludes the speaker itself by id or by name', () => {
    expect(findAgentMentions('as @Sol I defer to @Solar', ROSTER, { id: 'sol-1' }).map((a) => a.id)).toEqual(['solar-1']);
    expect(findAgentMentions('as @Sol I defer to @Solar', ROSTER, { name: 'Sol' }).map((a) => a.id)).toEqual(['solar-1']);
  });

  it('agrees with the renderer: every pill rendered is a floor pass, and vice versa', () => {
    const text = 'hey @Sol and @Solar, not me@Solve.com';
    const rendered = renderMentionPills(text, ROSTER);
    const pillNames = [...rendered.matchAll(/<span class="mention-pill">@([^<]+)<\/span>/g)].map((m) => m[1]);
    const mentionNames = findAgentMentions(text, ROSTER).map((a) => a.name);
    expect(mentionNames).toEqual(pillNames);
  });

  it('empty content / no roster → nothing', () => {
    expect(findAgentMentions('', ROSTER)).toEqual([]);
    expect(findAgentMentions('hi @Sol', [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Systemic guard: exactly ONE mention grammar in the codebase.
// ---------------------------------------------------------------------------

describe('no hand-rolled mention regex outside agentMentions.js', () => {
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const walk = (dir, acc = []) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(full, acc); }
      else if (/\.(js|vue)$/.test(e.name)) acc.push(full);
    }
    return acc;
  };

  const files = walk(srcRoot);

  it('scans a non-trivial number of files (anti-vacuity)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('only agentMentions.js constructs the mention-pill markup', () => {
    const offenders = files.filter((f) => {
      const base = path.basename(f);
      if (base === 'agentMentions.js' || base === 'agentMentions.spec.js') return false;
      let src;
      try { src = fs.readFileSync(f, 'utf8'); } catch { return false; }
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // Building the pill span in a template literal = a second grammar.
      return /class=\\?"mention-pill\\?">\$\{/.test(code);
    }).map((f) => path.relative(srcRoot, f));
    expect(offenders).toEqual([]);
  });
});
