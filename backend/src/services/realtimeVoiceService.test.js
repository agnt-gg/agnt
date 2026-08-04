import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getValidAccessToken = vi.fn();
vi.mock('./auth/AuthManager.js', () => ({
  default: { getValidAccessToken: (...a) => getValidAccessToken(...a) },
}));

const {
  createRealtimeCall,
  buildSessionConfig,
  buildInstructions,
  buildTools,
  REALTIME_MODEL,
  REALTIME_VOICES,
  DEFAULT_VOICE,
} = await import('./realtimeVoiceService.js');

const origFetch = globalThis.fetch;

beforeEach(() => {
  getValidAccessToken.mockReset();
  globalThis.fetch = vi.fn();
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('buildInstructions — the model must not answer by itself', () => {
  /**
   * This is the single load-bearing property of the whole design. A realtime
   * model left unconstrained will answer "what is in my repo?" with a
   * confident invention, because nothing tells it that it cannot see the repo.
   */
  const text = () => buildInstructions();

  it('forbids answering from its own knowledge, explicitly', () => {
    expect(text()).toMatch(/NEVER answer from your own knowledge/i);
    expect(text()).toMatch(/no knowledge of your own/i);
  });

  it('names the tool it must route everything through', () => {
    expect(text()).toContain('run_agnt');
  });

  it('forbids claiming inability instead of delegating', () => {
    expect(text()).toMatch(/NEVER say you are unable/i);
  });

  it('tells it to acknowledge and then go quiet during long work', () => {
    // Thirty seconds of silence reads as a dropped call; narrating invented
    // progress is worse. Short ack, then stop.
    expect(text()).toMatch(/STOP TALKING until the result arrives/i);
    expect(text()).toMatch(/Do not fill the silence/i);
  });

  it('keeps spoken output speakable — no markdown, no code read aloud', () => {
    expect(text()).toMatch(/Never read code/i);
    expect(text()).toMatch(/No markdown/i);
  });

  it('uses the assistant name it is given', () => {
    expect(buildInstructions({ assistantName: 'Scout' })).toContain('Scout');
  });
});

describe('buildTools — exactly one door into AGNT', () => {
  it('declares run_agnt and nothing else', () => {
    const tools = buildTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('run_agnt');
    expect(tools[0].type).toBe('function');
  });

  it('takes a self-contained instruction, because AGNT does not hear the audio', () => {
    const params = buildTools()[0].parameters;
    expect(params.required).toEqual(['instruction']);
    expect(params.properties.instruction.type).toBe('string');
    expect(params.properties.instruction.description).toMatch(/self-contained/i);
  });

  it('the description pushes the model to use it for everything', () => {
    expect(buildTools()[0].description).toMatch(/EVERY request/);
  });

  it('is valid JSON-serialisable schema (it is sent as a JSON string)', () => {
    expect(() => JSON.stringify(buildTools())).not.toThrow();
    const round = JSON.parse(JSON.stringify(buildTools()));
    expect(round[0].parameters.properties.instruction).toBeDefined();
  });
});

describe('buildSessionConfig', () => {
  it('uses the speech-to-speech model and audio output', () => {
    const c = buildSessionConfig();
    expect(c.model).toBe(REALTIME_MODEL);
    expect(c.type).toBe('realtime');
    expect(c.output_modalities).toEqual(['audio']);
  });

  it('uses SEMANTIC turn detection, not a silence timer', () => {
    // The whole reason the cascade needed a hand-built endpointer.
    expect(buildSessionConfig().audio.input.turn_detection).toEqual({ type: 'semantic_vad' });
  });

  it('honours a valid voice and falls back on an invalid one', () => {
    expect(buildSessionConfig({ voice: 'cedar' }).audio.output.voice).toBe('cedar');
    expect(buildSessionConfig({ voice: 'not-a-voice' }).audio.output.voice).toBe(DEFAULT_VOICE);
    expect(REALTIME_VOICES).toContain(DEFAULT_VOICE);
  });

  it('carries the instructions and the tool', () => {
    const c = buildSessionConfig();
    expect(c.instructions).toMatch(/run_agnt/);
    expect(c.tools[0].name).toBe('run_agnt');
    expect(c.tool_choice).toBe('auto');
  });
});

describe('createRealtimeCall', () => {
  it('rejects a missing SDP without touching the network', async () => {
    const r = await createRealtimeCall({ sdp: '', userId: 'u1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing-sdp');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('"no credentials" is a NORMAL result, not an error status', async () => {
    getValidAccessToken.mockResolvedValue(null);
    const r = await createRealtimeCall({ sdp: 'v=0...', userId: 'u1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-credentials');
    expect(r.status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('a vault failure degrades to no-credentials rather than throwing', async () => {
    getValidAccessToken.mockRejectedValue(new Error('vault down'));
    const r = await createRealtimeCall({ sdp: 'v=0...', userId: 'u1' });
    expect(r.reason).toBe('no-credentials');
  });

  it('posts the SDP and the session config to the calls endpoint', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'v=0 answer' });

    const r = await createRealtimeCall({ sdp: 'v=0 offer', userId: 'u1', voice: 'cedar' });

    expect(r.ok).toBe(true);
    expect(r.sdp).toBe('v=0 answer');

    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/realtime/calls');
    expect(opts.headers.Authorization).toBe('Bearer sk-test');
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.body.get('sdp')).toBe('v=0 offer');

    const session = JSON.parse(opts.body.get('session'));
    expect(session.model).toBe(REALTIME_MODEL);
    expect(session.audio.output.voice).toBe('cedar');
    expect(session.tools[0].name).toBe('run_agnt');
  });

  it('asks the vault for the openai provider specifically', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'answer' });
    await createRealtimeCall({ sdp: 'offer', userId: 'u9' });
    expect(getValidAccessToken).toHaveBeenCalledWith('u9', 'openai');
  });

  it('reports a provider failure without leaking the key', async () => {
    getValidAccessToken.mockResolvedValue('sk-super-secret-value');
    globalThis.fetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'You have no credits remaining.',
    });

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(JSON.stringify(r)).not.toContain('sk-super-secret-value');
    expect(r.detail).toMatch(/no credits/i);
  });

  it('survives a network throw', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    globalThis.fetch.mockRejectedValue(new Error('offline'));
    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('network');
  });
});
