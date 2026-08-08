import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

/**
 * Whitespace in a custom provider's base_url must never reach the wire.
 *
 * A base_url pasted with a trailing space produced a request to
 * `…/v1%20/v1/models`: the space survived normalization, the `endsWith('/v1')`
 * check then failed against `"…/v1 "`, so a SECOND `/v1` was appended, and the
 * space was percent-encoded on the way out. The provider 404s and the only
 * clue is a mangled URL in a log line.
 *
 * There are two halves to this and a fix that only does the first is not a
 * fix: trimming on WRITE (create/update) protects new rows, but every row
 * saved before the fix still has the space in the database. Reads must trim
 * too, or existing providers stay broken until the user re-saves them by hand.
 * `fetchModels` covers that case below.
 */

const fetchMock = vi.fn();
vi.mock('node-fetch', () => ({ default: (...args) => fetchMock(...args) }));

const { default: service } = await import('./CustomOpenAIProviderService.js');
const { default: db } = await import('../../models/database/index.js');

const USER_ID = 'trim-test-user';

/** A models response shaped like the OpenAI /v1/models payload. */
function okModels(ids = ['model-a']) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  };
}

/** The URL the service actually requested. */
const requestedUrl = () => fetchMock.mock.calls[0][0];

function insertRaw(id, baseUrl) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO custom_openai_providers
       (id, user_id, provider_name, base_url, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 1, datetime('now'), datetime('now'))`,
      [id, USER_ID, `legacy-${id}`, baseUrl],
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

beforeAll(async () => {
  // custom_openai_providers.user_id is a FK onto users(id).
  await new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)`,
      [USER_ID, 'trim-test@example.invalid', 'Trim Test'],
      (err) => (err ? reject(err) : resolve()),
    );
  });
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(okModels());
});

afterAll(async () => {
  const run = (sql, params) =>
    new Promise((resolve) => db.run(sql, params, () => resolve()));
  await run('DELETE FROM custom_openai_providers WHERE user_id = ?', [USER_ID]);
  await run('DELETE FROM users WHERE id = ?', [USER_ID]);
});

describe('testConnection — the URL that goes on the wire', () => {
  it('does not percent-encode a trailing space into the path', async () => {
    await service.testConnection('http://spark-4db0.local:8002/v1 ', null);
    expect(requestedUrl()).toBe('http://spark-4db0.local:8002/v1/models');
  });

  it('reports the exact broken URL from the bug, so a regression is recognisable', async () => {
    await service.testConnection('http://spark-4db0.local:8002/v1 ', null);
    expect(requestedUrl()).not.toContain('%20');
    expect(requestedUrl()).not.toContain('/v1/v1');
  });

  it('trims leading whitespace too', async () => {
    await service.testConnection('  http://localhost:11434/v1', null);
    expect(requestedUrl()).toBe('http://localhost:11434/v1/models');
  });

  it('still appends /v1 when the URL genuinely lacks it', async () => {
    await service.testConnection('http://localhost:1234 ', null);
    expect(requestedUrl()).toBe('http://localhost:1234/v1/models');
  });

  it('still strips a trailing slash', async () => {
    await service.testConnection('http://localhost:1234/v1/', null);
    expect(requestedUrl()).toBe('http://localhost:1234/v1/models');
  });

  it('trims a newline, the likeliest paste artifact of all', async () => {
    await service.testConnection('http://spark-4db0.local:8002/v1\n', null);
    expect(requestedUrl()).toBe('http://spark-4db0.local:8002/v1/models');
  });

  it('trims a tab', async () => {
    await service.testConnection('\thttp://localhost:1234/v1\t', null);
    expect(requestedUrl()).toBe('http://localhost:1234/v1/models');
  });

  it('returns a result instead of throwing when base_url is null', async () => {
    // The `String(baseUrl || '')` guard is what buys this: the pre-fix code
    // called .endsWith() straight on the argument and threw
    // "Cannot read properties of null". It was caught by the surrounding
    // try/catch, so the caller saw a TypeError message dressed up as a
    // connection failure. The URL built here is relative ('/v1/models'), which
    // node-fetch rejects as a non-absolute URL in production -- so this is
    // still a failed test-connection, just not a type error.
    await expect(service.testConnection(null, null)).resolves.toEqual(
      expect.objectContaining({ success: expect.any(Boolean) }),
    );
  });
});

describe('createProvider — what gets persisted', () => {
  it('stores the trimmed base_url', async () => {
    const created = await service.createProvider(USER_ID, {
      provider_name: 'spark-ling',
      base_url: 'http://spark-4db0.local:8002/v1 ',
    });
    expect(created.base_url).toBe('http://spark-4db0.local:8002/v1');

    const stored = await service.getProviderById(created.id, USER_ID);
    expect(stored.base_url).toBe('http://spark-4db0.local:8002/v1');
  });

  it('still appends /v1 to a whitespace-padded URL that lacks it', async () => {
    const created = await service.createProvider(USER_ID, {
      provider_name: 'lm-studio',
      base_url: ' http://localhost:1234 ',
    });
    expect(created.base_url).toBe('http://localhost:1234/v1');
  });
});

describe('updateProvider — what gets persisted on edit', () => {
  it('stores the trimmed base_url', async () => {
    const created = await service.createProvider(USER_ID, {
      provider_name: 'spark-qwen',
      base_url: 'http://spark-4db0.local:8000/v1',
    });

    await service.updateProvider(created.id, USER_ID, {
      base_url: 'http://spark-4db0.local:8001/v1 ',
    });

    const stored = await service.getProviderById(created.id, USER_ID);
    expect(stored.base_url).toBe('http://spark-4db0.local:8001/v1');
  });
});

describe('fetchModels — rows saved BEFORE the fix', () => {
  it('heals a legacy row whose stored base_url still has a trailing space', async () => {
    // Trimming on write cannot repair rows that are already in the database.
    // This inserts the untrimmed value directly, exactly as the pre-fix
    // createProvider would have left it.
    const id = 'legacy-trailing-space';
    await insertRaw(id, 'http://spark-4db0.local:8002/v1 ');

    await service.fetchModels(id, USER_ID);

    expect(requestedUrl()).toBe('http://spark-4db0.local:8002/v1/models');
    expect(requestedUrl()).not.toContain('%20');
  });
});
