import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

let db;
let ContentOutputModel;
let TMP;
const savedEnv = {};
const USER = 'user-hash-1';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const save = (id, content) =>
  ContentOutputModel.createOrUpdate(id, USER, null, null, content, false, 'conversation', `conv-${id}`, 'T');

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-hash-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;
  ContentOutputModel = (await import('./ContentOutputModel.js')).default;
  await new Promise((resolve, reject) => {
    db.run('INSERT INTO users (id, email) VALUES (?, ?)', [USER, `${USER}@test.local`], (err) => (err ? reject(err) : resolve()));
  });
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('content_hash', () => {
  it('is written on insert and replaced on update', async () => {
    const first = JSON.stringify({ messages: [{ role: 'user', content: 'a' }] });
    await save('h1', first);
    expect(await ContentOutputModel.contentHashById('h1')).toBe(sha(first));

    const second = JSON.stringify({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] });
    await save('h1', second);
    expect(await ContentOutputModel.contentHashById('h1')).toBe(sha(second));
  });

  it('is null for an unknown row', async () => {
    expect(await ContentOutputModel.contentHashById('missing')).toBeNull();
  });
});

describe('systemUserTurnsById', () => {
  it('returns user turns with a server heading near the start, in order, and nothing else', async () => {
    await save('r1', JSON.stringify({
      messages: [
        { role: 'user', content: 'build it' },
        { role: 'assistant', content: '[System: an assistant never counts]' },
        { role: 'user', content: '[System: Sub-chat finished]\n\nfirst' },
        { role: 'user', content: `${'a long ordinary message, '.repeat(4)}quoting [System: Sub-chat finished] much later` },
        { role: 'user', content: '[TEXT MESSAGE TURN]\n[System: 2 sub-chats finished]\n\nsecond' },
      ],
    }));
    expect(await ContentOutputModel.systemUserTurnsById('r1')).toEqual([
      '[System: Sub-chat finished]\n\nfirst',
      '[TEXT MESSAGE TURN]\n[System: 2 sub-chats finished]\n\nsecond',
    ]);
  });

  it('returns [] when there are none, when content is not JSON, and for an unknown row', async () => {
    await save('r2', JSON.stringify({ messages: [{ role: 'user', content: 'only a question' }] }));
    await save('r3', 'not json at all');
    expect(await ContentOutputModel.systemUserTurnsById('r2')).toEqual([]);
    expect(await ContentOutputModel.systemUserTurnsById('r3')).toEqual([]);
    expect(await ContentOutputModel.systemUserTurnsById('missing')).toEqual([]);
  });
});
