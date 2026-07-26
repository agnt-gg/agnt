import { describe, expect, it, vi } from 'vitest';

/**
 * `recall` silently returned zero results for any hyphenated query.
 *
 * Root cause: an FTS5 bareword may contain only letters, digits, underscores
 * and non-ASCII characters. A hyphen is not legal — FTS5 reads `foo-bar` as a
 * column filter and the statement fails with "no such column: bar". The old
 * sanitizer deliberately preserved hyphens (`[^a-zA-Z0-9_-]`), so it emitted
 * un-runnable SQL for project names, model ids, ISO dates, UUIDs, and ordinary
 * hyphenated English. search() then caught the throw per-source and returned
 * [], which reached the caller as a confident "0 results".
 *
 * These tests pin both halves: the emitted query must be *runnable*, and a
 * query that fails on every source must not masquerade as an empty result set.
 */

// Route every DB call through a switch the tests can steer. Mocking the module
// also keeps the real SQLite file out of the test run entirely.
const dbBehaviour = { mode: 'ok' };

vi.mock('../models/database/index.js', () => {
  const respond = (sql, cb) => {
    const failThis =
      dbBehaviour.mode === 'all-fail' ||
      (dbBehaviour.mode === 'one-fails' && sql.includes('conversation_logs_fts'));
    if (failThis) return cb(new Error('SQLITE_ERROR: no such column: bar'));
    return cb(null, []);
  };
  return {
    default: {
      all: (sql, params, cb) => respond(sql, cb),
      get: (sql, params, cb) => respond(sql, (e, r) => cb(e, r ? r[0] : null)),
    },
  };
});

const MemorySearchService = (await import('./MemorySearchService.js')).default;
const { sanitizeFtsQuery } = MemorySearchService;

// A conservative model of FTS5's bareword rule: if sanitize() emits a bare
// (unquoted) term containing a hyphen, SQLite rejects the whole statement.
function containsBareHyphen(fts) {
  const bare = fts.replace(/"[^"]*"\*?/g, ' ');
  return /-/.test(bare);
}

describe('sanitizeFtsQuery — FTS5 syntax legality', () => {
  const hyphenated = [
    'ARC-AGI',
    'gba-recomp',
    'agnt-pro',
    'claude-opus-5',
    'gpt-5.6-luna',
    '2026-07-25',
    'd9a5a00f-b3fe-4eaa-81ca-51856e790ab5',
    'rct-x86-wasm-lift',
    'e-mail',
    'buzz relay NIP-98',
    'gba-recomp ARM7TDMI recompiler verify gate',
  ];

  it.each(hyphenated)('emits no bare hyphen for %j', (q) => {
    expect(containsBareHyphen(sanitizeFtsQuery(q))).toBe(false);
  });

  it('never emits an unbalanced double quote', () => {
    for (const q of ['say "hello" now', 'a"b', '""', 'x" OR "1', ...hyphenated]) {
      expect((sanitizeFtsQuery(q).match(/"/g) || []).length % 2).toBe(0);
    }
  });
});

describe('sanitizeFtsQuery — semantics', () => {
  it('turns a hyphenated compound into an adjacency phrase, not an AND of common words', () => {
    expect(sanitizeFtsQuery('gba-recomp')).toBe('"gba recomp"*');
  });

  it('treats every non-alphanumeric char as a separator rather than deleting it', () => {
    // Deleting the dot produced the token `56`, which can never match the
    // indexed tokens [5][6] under the unicode61 tokenizer.
    expect(sanitizeFtsQuery('gpt-5.6-luna')).toBe('"gpt 5 6 luna"*');
  });

  it('keeps short parts inside a phrase, where adjacency constrains them', () => {
    expect(sanitizeFtsQuery('e-mail')).toBe('"e mail"*');
  });

  it('still drops sub-2-character standalone tokens', () => {
    expect(sanitizeFtsQuery('a recomp')).toBe('recomp*');
  });

  it('mixes phrases and barewords in one query', () => {
    expect(sanitizeFtsQuery('buzz relay NIP-98')).toBe('buzz* relay* "NIP 98"*');
  });

  it('returns empty string when nothing survives, so the caller falls back to date-only', () => {
    for (const q of ['', '   ', '!!! ---', null, undefined, 42]) {
      expect(sanitizeFtsQuery(q)).toBe('');
    }
  });
});

describe('sanitizeFtsQuery — no regression on hyphen-free input', () => {
  // Must be byte-identical to the previous implementation's output.
  it.each([
    ['recomp', 'recomp*'],
    ['pokemon', 'pokemon*'],
    ['cache wars', 'cache* wars*'],
    ['annie music video', 'annie* music* video*'],
    ['whitepaper', 'whitepaper*'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFtsQuery(input)).toBe(expected);
  });
});

describe('search() — a total failure must not look like an empty result', () => {
  it('requires a userId', async () => {
    dbBehaviour.mode = 'ok';
    await expect(MemorySearchService.search({ q: 'anything' })).rejects.toThrow(/requires userId/);
  });

  it('throws MEMORY_SEARCH_FAILED when every source errors', async () => {
    dbBehaviour.mode = 'all-fail';
    await expect(
      MemorySearchService.search({ userId: 'u1', q: 'anything' })
    ).rejects.toMatchObject({ code: 'MEMORY_SEARCH_FAILED' });
  });

  it('reports the underlying SQLite message instead of hiding it', async () => {
    dbBehaviour.mode = 'all-fail';
    await expect(
      MemorySearchService.search({ userId: 'u1', q: 'anything' })
    ).rejects.toThrow(/no such column: bar/);
  });

  it('does NOT throw on partial failure — surviving sources still return', async () => {
    dbBehaviour.mode = 'one-fails';
    await expect(
      MemorySearchService.search({ userId: 'u1', q: 'anything' })
    ).resolves.toEqual([]);
  });

  it('negative control: a healthy DB resolves normally', async () => {
    dbBehaviour.mode = 'ok';
    await expect(
      MemorySearchService.search({ userId: 'u1', q: 'anything' })
    ).resolves.toEqual([]);
  });
});
