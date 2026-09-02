import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addTicket, loadTickets, nextId, parseFrontmatter, scoreTicket, serializeFrontmatter, setStatus } from './tickets.mjs';

describe('frontmatter', () => {
  it('round-trips every value shape a ticket uses', () => {
    const meta = {
      id: 'T-0042',
      status: 'enriched',
      value: 3,
      confidence: 0.8,
      risk: 'low',
      footprint: ['backend/src/a.js', 'frontend/src/b.vue'],
      blockedBy: [],
      note: 'has: a colon',
      repro: 'archive a conv with 3+ agents → stack renders 2',
      nothing: null,
      flag: true,
    };
    const text = serializeFrontmatter(meta, 'the raw dump\n');
    const back = parseFrontmatter(text);
    expect(back.meta).toEqual(meta);
    expect(back.body).toBe('the raw dump\n');
  });

  it('quotes strings the parser would otherwise reinterpret', () => {
    for (const s of ['123', 'true', '[x]', ' leading', '"quoted"']) {
      expect(parseFrontmatter(serializeFrontmatter({ v: s })).meta.v).toBe(s);
    }
  });

  it('treats a file with no frontmatter as pure body', () => {
    expect(parseFrontmatter('just a dump')).toEqual({ meta: {}, body: 'just a dump' });
  });

  it('refuses a line it cannot parse rather than guess', () => {
    expect(() => parseFrontmatter('---\nthis is not a key\n---\n')).toThrow(/cannot parse/);
  });
});

describe('store', () => {
  let dir;
  beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-tickets-'))));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('a dump becomes an inbox ticket with nothing else required', () => {
    const t = addTicket(dir, '  avatars look wrong in archived convos sometimes ');
    expect(t.id).toBe('T-0001');
    expect(t.status).toBe('inbox');
    const [loaded] = loadTickets(dir);
    expect(loaded.id).toBe('T-0001');
    expect(loaded.body).toBe('avatars look wrong in archived convos sometimes\n');
    expect(loaded.file).toBe(t.file);
  });

  it('ids keep counting past a gap', () => {
    addTicket(dir, 'a');
    addTicket(dir, 'b');
    fs.rmSync(path.join(dir, 'T-0001.md'));
    expect(nextId(dir)).toBe('T-0003');
  });

  it('an empty dump is not a ticket', () => {
    expect(() => addTicket(dir, '   ')).toThrow(/empty/);
  });

  it('setStatus persists and refuses unknown states', () => {
    const t = addTicket(dir, 'x');
    setStatus(t, 'approved', { footprint: ['a.js'] });
    const [back] = loadTickets(dir);
    expect(back.status).toBe('approved');
    expect(back.footprint).toEqual(['a.js']);
    expect(() => setStatus(t, 'done')).toThrow(/unknown status/);
  });
});

describe('score', () => {
  it('rewards value and confidence, charges effort', () => {
    expect(scoreTicket({ value: 4, effort: 2, confidence: 1 })).toBe(2);
    expect(scoreTicket({ value: 4, effort: 2, confidence: 0.5 })).toBe(1);
  });

  it('charges contention: a hot footprint costs more than its effort says', () => {
    const rate = (f) => (f === 'hot.js' ? 0.1 : 0);
    const cold = scoreTicket({ value: 4, effort: 2, confidence: 1, footprint: ['cold.js'] }, rate);
    const hot = scoreTicket({ value: 4, effort: 2, confidence: 1, footprint: ['hot.js'] }, rate);
    expect(cold).toBe(2);
    expect(hot).toBe(1); // contention = 1 + 0.1*10 = 2
  });

  it('credits unblocking work — de-chokepointing outranks features when throughput binds', () => {
    expect(scoreTicket({ value: 1, effort: 2, confidence: 1, unblocks: 5 })).toBe(3);
  });

  it('never divides by zero on a missing effort', () => {
    expect(Number.isFinite(scoreTicket({ value: 1, effort: 0 }))).toBe(true);
  });
});
