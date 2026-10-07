import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAI } from 'openai';
import { createLocalRouter, getLocalBaseURL, requestModel, KNOWN_SERVERS, DEFAULT_LOCAL_BASE_URL, LOCAL_ROUTER_BASE_URL } from './localServers.js';

const LMSTUDIO = 'http://127.0.0.1:1234/v1';
const OLLAMA = 'http://127.0.0.1:11434/v1';
const MANAGED = 'http://127.0.0.1:50123/v1';

/** Local servers keyed by base URL → the models each serves. Absent = not listening. */
function machine(servers) {
  return vi.fn(async (url) => {
    const base = Object.keys(servers).find((prefix) => url.startsWith(prefix));
    if (!base) throw new Error('ECONNREFUSED');
    if (url === `${base}/models`) return { ok: true, json: async () => ({ data: servers[base].map((id) => ({ id })) }) };
    return { ok: true, status: 200, url, json: async () => ({ routedTo: base }) };
  });
}

/** A managed runtime double: `active` is set up, `running` is what it serves now. */
function managedDouble({ active = null, running = null, ready = !!active } = {}) {
  const state = { running };
  return {
    activeModelId: () => active,
    runningModelId: () => state.running,
    baseURL: () => (state.running ? MANAGED : null),
    activeModelReady: vi.fn(async () => ready),
    ensureRunning: vi.fn(async (id) => { state.running = id; return MANAGED; }),
    touch: vi.fn(),
  };
}

const router = (fetchImpl, managed = managedDouble()) => createLocalRouter({ managed, fetchImpl, cacheMs: 0 });

describe('known servers', () => {
  it('LM Studio, Ollama and llama-server on their default ports', () => {
    expect(KNOWN_SERVERS.map((s) => s.baseURL)).toEqual([LMSTUDIO, OLLAMA, 'http://127.0.0.1:8080/v1']);
  });
});

describe('resolve: which server a request goes to', () => {
  it('REGRESSION (triage/local-ollama): Ollama alone is found; Local is no longer LM-Studio-only', async () => {
    expect(await router(machine({ [OLLAMA]: ['qwen3:8b'] })).resolve()).toBe(OLLAMA);
  });

  it('a named model goes to the server that has it, even when another server is first', async () => {
    const fetchImpl = machine({ [LMSTUDIO]: ['qwen3.5-9b'], [OLLAMA]: ['gemma4:e4b'] });
    expect(await router(fetchImpl).resolve({ model: 'gemma4:e4b' })).toBe(OLLAMA);
    expect(await router(fetchImpl).resolve({ model: 'qwen3.5-9b' })).toBe(LMSTUDIO);
  });

  it("the managed model, by name, starts AGNT's server even while LM Studio runs", async () => {
    const managed = managedDouble({ active: 'qwen3.5-4b' });
    const url = await router(machine({ [LMSTUDIO]: ['other'] }), managed).resolve({ model: 'qwen3.5-4b' });
    expect(url).toBe(MANAGED);
    expect(managed.ensureRunning).toHaveBeenCalledWith('qwen3.5-4b');
  });

  it('nothing else running and the managed model is ready: starts it for an unnamed request', async () => {
    const managed = managedDouble({ active: 'qwen3.5-4b' });
    expect(await router(machine({}), managed).resolve()).toBe(MANAGED);
  });

  it('another server is serving: an unnamed request does not start a second model', async () => {
    const managed = managedDouble({ active: 'qwen3.5-4b' });
    expect(await router(machine({ [OLLAMA]: ['qwen3:8b'] }), managed).resolve()).toBe(OLLAMA);
    expect(managed.ensureRunning).not.toHaveBeenCalled();
  });

  it('a server that answers with no models beats nothing; nothing at all falls back to LM Studio', async () => {
    expect(await router(machine({ [OLLAMA]: [] })).resolve()).toBe(OLLAMA);
    expect(await router(machine({})).resolve()).toBe(DEFAULT_LOCAL_BASE_URL);
  });

  it('the sync getter tracks the last resolution (buildBaseURLs().local reads it)', async () => {
    await router(machine({ [OLLAMA]: ['m'] })).resolve();
    expect(getLocalBaseURL()).toBe(OLLAMA);
  });
});

describe('createFetch: the Local client', () => {
  it('reads the model from the body and rewrites the placeholder base', async () => {
    const fetchImpl = machine({ [LMSTUDIO]: ['a'], [OLLAMA]: ['b'] });
    const routed = router(fetchImpl).createFetch();
    const response = await routed(`${LOCAL_ROUTER_BASE_URL}/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'b', messages: [] }) });
    expect(await response.json()).toEqual({ routedTo: OLLAMA });
  });

  it('works through the real OpenAI SDK: chat and model listing reach the right server', async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (url === `${OLLAMA}/models`) return new Response(JSON.stringify({ object: 'list', data: [{ id: 'qwen3:8b', object: 'model' }] }), { headers: { 'content-type': 'application/json' } });
      if (url === `${OLLAMA}/chat/completions`) {
        expect(JSON.parse(init.body).model).toBe('qwen3:8b');
        return new Response(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
      }
      throw new Error('ECONNREFUSED');
    });
    const client = new OpenAI({ apiKey: 'dummy-key', baseURL: LOCAL_ROUTER_BASE_URL, fetch: router(fetchImpl).createFetch(), maxRetries: 0 });
    const completion = await client.chat.completions.create({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }] });
    expect(completion.choices[0].message.content).toBe('hi');
    const listed = await client.models.list();
    expect(listed.data.map((m) => m.id)).toEqual(['qwen3:8b']);
  });

  it('a routing failure keeps its reason in the log (the SDK would only say "Connection error")', async () => {
    const managed = managedDouble({ active: 'qwen3.5-4b' });
    managed.ensureRunning.mockRejectedValueOnce(Object.assign(new Error('Qwen 3.5 4B has not been downloaded.'), { code: 'not_installed' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const routed = router(machine({}), managed).createFetch();
    await expect(routed(`${LOCAL_ROUTER_BASE_URL}/chat/completions`, { body: JSON.stringify({ model: 'qwen3.5-4b' }) })).rejects.toThrow('not been downloaded');
    expect(warn.mock.calls[0][0]).toContain('not been downloaded');
  });
});

describe('listModelIds', () => {
  it("every running server's models plus the ready managed model, deduplicated, managed first", async () => {
    const managed = managedDouble({ active: 'qwen3.5-4b' });
    const ids = await router(machine({ [LMSTUDIO]: ['a', 'b'], [OLLAMA]: ['b', 'c'] }), managed).listModelIds();
    expect(ids).toEqual(['qwen3.5-4b', 'a', 'b', 'c']);
  });

  it('a managed model that is not downloaded is not offered', async () => {
    const managed = managedDouble({ active: 'qwen3.5-4b', ready: false });
    expect(await router(machine({}), managed).listModelIds()).toEqual([]);
  });
});

describe('requestModel', () => {
  it.each([
    [{ body: '{"model":"m"}' }, 'm'],
    [{ body: 'not json' }, undefined],
    [{ body: new Uint8Array(2) }, undefined],
    [undefined, undefined],
  ])('%j → %s', (init, expected) => {
    expect(requestModel(init)).toBe(expected);
  });
});
