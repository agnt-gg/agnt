import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// AuthManager reaches for the database and the network on import, so it is
// mocked at the module boundary. What we care about here is the CONTRACT:
// which provider is asked for a key, and what happens when there isn't one.
const getValidAccessToken = vi.fn();
vi.mock('./auth/AuthManager.js', () => ({
  default: { getValidAccessToken: (...args) => getValidAccessToken(...args) },
}));

const { synthesize, listEngines, availableEngines, ENGINES, MAX_TTS_CHARS } = await import('./ttsService.js');

const origFetch = globalThis.fetch;

function mockAudioResponse(bytes = [1, 2, 3]) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}

beforeEach(() => {
  getValidAccessToken.mockReset();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('engine catalogue', () => {
  it('lists every engine with a default voice and model', () => {
    const engines = listEngines();
    expect(engines.length).toBeGreaterThan(0);
    for (const e of engines) {
      expect(e.id).toBeTruthy();
      expect(e.label).toBeTruthy();
      expect(e.defaultVoice).toBeTruthy();
      expect(e.defaultModel).toBeTruthy();
    }
  });

  it('ships openai and elevenlabs', () => {
    expect(ENGINES.openai).toBeDefined();
    expect(ENGINES.elevenlabs).toBeDefined();
  });
});

describe('synthesize — "not configured" is a normal answer, not an error', () => {
  it('returns available:false when the user has no key', async () => {
    getValidAccessToken.mockResolvedValue(null);
    const r = await synthesize({ text: 'hello', userId: 'u1' });
    expect(r.available).toBe(false);
    expect(r.reason).toContain('no-credentials');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns available:false rather than throwing when the vault errors', async () => {
    getValidAccessToken.mockRejectedValue(new Error('vault down'));
    const r = await synthesize({ text: 'hello', userId: 'u1' });
    expect(r.available).toBe(false);
  });

  it('rejects empty text without touching the network', async () => {
    const r = await synthesize({ text: '   ', userId: 'u1' });
    expect(r.available).toBe(false);
    expect(r.reason).toBe('empty-text');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects an unknown engine', async () => {
    const r = await synthesize({ text: 'hi', engine: 'nope', userId: 'u1' });
    expect(r.available).toBe(false);
    expect(r.reason).toContain('unknown-engine');
  });
});

describe('synthesize — openai', () => {
  it('asks the vault for the openai provider specifically', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    globalThis.fetch.mockResolvedValue(mockAudioResponse());
    await synthesize({ text: 'hello', engine: 'openai', userId: 'u1' });
    expect(getValidAccessToken).toHaveBeenCalledWith('u1', 'openai');
  });

  it('posts the expected request', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    globalThis.fetch.mockResolvedValue(mockAudioResponse());

    await synthesize({ text: 'hello there', engine: 'openai', voice: 'nova', userId: 'u1' });

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(options.body);
    expect(body.input).toBe('hello there');
    expect(body.voice).toBe('nova');
    expect(body.response_format).toBe('mp3');
  });

  it('returns audio as a Buffer with a content type', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    globalThis.fetch.mockResolvedValue(mockAudioResponse([9, 9, 9, 9]));
    const r = await synthesize({ text: 'hello', userId: 'u1' });
    expect(r.available).toBe(true);
    expect(Buffer.isBuffer(r.audio)).toBe(true);
    expect(r.audio.length).toBe(4);
    expect(r.contentType).toBe('audio/mpeg');
  });

  it('clamps speed into the range the API accepts', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    globalThis.fetch.mockResolvedValue(mockAudioResponse());

    await synthesize({ text: 'x', speed: 99, userId: 'u1' });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).speed).toBe(4);

    globalThis.fetch.mockClear();
    await synthesize({ text: 'x', speed: -5, userId: 'u1' });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).speed).toBe(0.25);

    globalThis.fetch.mockClear();
    await synthesize({ text: 'x', speed: 'fast', userId: 'u1' });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).speed).toBe(1);
  });

  it('caps very long input instead of sending it', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    globalThis.fetch.mockResolvedValue(mockAudioResponse());
    await synthesize({ text: 'a'.repeat(MAX_TTS_CHARS + 500), userId: 'u1' });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.input.length).toBe(MAX_TTS_CHARS);
  });
});

describe('synthesize — elevenlabs', () => {
  it('uses the header auth scheme and puts the voice in the path', async () => {
    getValidAccessToken.mockResolvedValue('el-key');
    globalThis.fetch.mockResolvedValue(mockAudioResponse());

    await synthesize({ text: 'hello', engine: 'elevenlabs', voice: 'voice-123', userId: 'u1' });

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('voice-123');
    expect(options.headers['xi-api-key']).toBe('el-key');
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('url-encodes the voice id', async () => {
    getValidAccessToken.mockResolvedValue('el-key');
    globalThis.fetch.mockResolvedValue(mockAudioResponse());
    await synthesize({ text: 'hi', engine: 'elevenlabs', voice: 'a b/c', userId: 'u1' });
    expect(globalThis.fetch.mock.calls[0][0]).toContain('a%20b%2Fc');
  });
});

describe('synthesize — provider failure', () => {
  it('throws with the status but never leaks the key', async () => {
    getValidAccessToken.mockResolvedValue('sk-secret-value');
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid api key',
    });

    await expect(synthesize({ text: 'hello', userId: 'u1' })).rejects.toThrow(/401/);

    try {
      await synthesize({ text: 'hello', userId: 'u1' });
    } catch (err) {
      expect(err.message).not.toContain('sk-secret-value');
      expect(err.status).toBe(401);
    }
  });

  it('survives an unreadable error body', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error('stream closed');
      },
    });
    await expect(synthesize({ text: 'hello', userId: 'u1' })).rejects.toThrow(/500/);
  });
});

describe('availableEngines', () => {
  it('reports only engines with a usable key', async () => {
    getValidAccessToken.mockImplementation(async (_userId, provider) =>
      provider === 'openai' ? 'sk-test' : null
    );
    const avail = await availableEngines('u1');
    expect(avail).toContain('openai');
    expect(avail).not.toContain('elevenlabs');
  });

  it('is empty when nothing is configured', async () => {
    getValidAccessToken.mockResolvedValue(null);
    expect(await availableEngines('u1')).toEqual([]);
  });

  it('never throws — it is a capability probe, not an operation', async () => {
    getValidAccessToken.mockRejectedValue(new Error('boom'));
    await expect(availableEngines('u1')).resolves.toEqual([]);
  });
});
