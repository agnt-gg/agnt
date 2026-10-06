import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import sqlite3 from 'sqlite3';

vi.mock('../models/database/index.js', () => ({ default: {}, dbReady: Promise.resolve() }));
import { SkillFolderAccess } from './SkillFolderAccess.js';

let db;
let ownerFromEnv;
let store;

beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  ownerFromEnv = '';
  store = new SkillFolderAccess(db, Promise.resolve(), { ownerFromEnv: () => ownerFromEnv });
  await store.run('CREATE TABLE users(id TEXT, email TEXT, created_at TEXT)');
  await store.run('CREATE TABLE skills(id TEXT PRIMARY KEY, user_id TEXT, slug TEXT, name TEXT)');
});
afterEach(() => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve())));

const users = (...rows) => Promise.all(rows.map(([id, email, at]) => store.run('INSERT INTO users VALUES(?,?,?)', [id, email, at])));
const dbSkill = (id, userId, slug) => store.run('INSERT INTO skills VALUES(?,?,?,?)', [id, userId, slug, slug]);

describe('SkillFolderAccess: who may see a folder skill', () => {
  it("gives the desktop's skills to the account that built them, not to every row in users", async () => {
    // The machine this was written on: one real account, id-less leftovers, test accounts.
    await users(['nathan', 'n@bizop.io', '2025-07-26'], ['stale', null, '2025-08-02'], [null, null, '2026-04-08'], ['e2e-user', 'e2e@e2e.local', '2026-08-10']);
    await dbSkill('s1', 'nathan', 'drafted-by-hand');
    await dbSkill('s2', 'nathan', 'another');

    await store.adoptUnseen(['annie-music-video', 'bounty-hunter']);

    expect(await store.owners('annie-music-video')).toEqual(['nathan']);
    expect([...await store.namesFor('stale')]).toEqual([]);
    expect([...await store.namesFor('e2e-user')]).toEqual([]);
    expect([...await store.namesFor('nathan')].sort()).toEqual(['annie-music-video', 'bounty-hunter']);
  });

  it('gives an imported skill to whoever has its database row', async () => {
    await users(['nathan', null, '2025-01-01'], ['bob', null, '2025-02-01']);
    await dbSkill('s1', 'nathan', 'x'); await dbSkill('s2', 'nathan', 'y');
    await dbSkill('s3', 'bob', 'bobs-import');

    await store.adoptUnseen(['bobs-import']);

    expect(await store.owners('bobs-import')).toEqual(['bob']);
  });

  it('never matches evidence on a display name, only on the slug the importer wrote', async () => {
    await users(['nathan', null, '2025-01-01'], ['bob', null, '2025-02-01']);
    await dbSkill('s1', 'nathan', 'kept');
    await store.run("INSERT INTO skills VALUES('s2','bob','something-else','code-review')");

    await store.adoptUnseen(['code-review']);

    expect(await store.owners('code-review')).toEqual(['nathan']);
  });

  it("gives a hosted instance's folders to its configured owner, by id or by login email", async () => {
    await users(['owner-id', 'Owner@Example.com', '2026-01-01'], ['member', 'm@example.com', '2025-01-01']);
    await dbSkill('s1', 'member', 'busy'); // the member has built more skills; it does not matter
    ownerFromEnv = 'owner@example.com';
    await store.adoptUnseen(['by-email']);
    expect(await store.owners('by-email')).toEqual(['owner-id']);

    ownerFromEnv = 'owner-id';
    await store.adoptUnseen(['by-id']);
    expect(await store.owners('by-id')).toEqual(['owner-id']);
    expect(await store.isHomeOwner('owner-id')).toBe(true);
    expect(await store.isHomeOwner('member')).toBe(false);
  });

  it('never hands an adopted skill to an account created later', async () => {
    await users(['nathan', null, '2025-01-01']);
    await store.adoptUnseen(['legacy']);
    await users(['newcomer', null, '2030-01-01']);
    await dbSkill('s1', 'newcomer', 'legacy'); // even with a same-slug row of their own
    await store.adoptUnseen(['legacy']);
    expect(await store.owners('legacy')).toEqual(['nathan']);
  });

  it('defers while no account exists instead of recording an ownerless verdict', async () => {
    await store.adoptUnseen(['early']);
    expect(await store.owners('early')).toEqual([]);
    await users(['first', null, '2025-01-01']);
    await store.adoptUnseen(['early']);
    expect(await store.owners('early')).toEqual(['first']);
  });

  it('lets a writer claim a skill before adoption can give it to the owner', async () => {
    await users(['nathan', null, '2025-01-01'], ['bob', null, '2025-02-01']);
    await dbSkill('s1', 'nathan', 'x');
    await store.grant('bobs-new-skill', 'bob');
    await store.adoptUnseen(['bobs-new-skill']);
    expect(await store.owners('bobs-new-skill')).toEqual(['bob']);
    await store.revoke('bobs-new-skill', 'bob');
    expect(await store.owners('bobs-new-skill')).toEqual([]);
  });

  it('adopts once when readers race', async () => {
    await users(['nathan', null, '2025-01-01']);
    const runs = vi.spyOn(store, 'homeOwner');
    await Promise.all([store.adoptUnseen(['a', 'b']), store.adoptUnseen(['a', 'b']), store.adoptUnseen(['b'])]);
    expect(runs).toHaveBeenCalledTimes(1);
    expect(await store.owners('a')).toEqual(['nathan']);
  });

  it('keeps its verdicts across a restart', async () => {
    await users(['nathan', null, '2025-01-01']);
    await store.adoptUnseen(['durable']);
    const restarted = new SkillFolderAccess(db, Promise.resolve(), { ownerFromEnv: () => '' });
    await users(['later', null, '2020-01-01']); // older timestamp, still never inherits
    await restarted.adoptUnseen(['durable']);
    expect(await restarted.owners('durable')).toEqual(['nathan']);
  });
});
