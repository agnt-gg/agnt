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

describe('buildInstructions — the model is a mouth, not a second assistant', () => {
  /**
   * THE LOAD-BEARING PROPERTY OF THE WHOLE DESIGN.
   *
   * The user hears one voice and reads one transcript, and they must be the
   * same person saying the same words. That only holds if this model has no
   * identity and no discretion: Annie (the orchestrator) answers everything,
   * and this model reads her answer aloud.
   *
   * The first version said "You are Annie" and allowed it to handle
   * "conversational glue" itself. Those turns never reached the orchestrator,
   * so they never reached the chat either — the user watched a conversation
   * happen and leave no trace.
   */
  const text = () => buildInstructions();

  it('tells it that it is NOT the assistant', () => {
    expect(text()).toMatch(/You are NOT Annie/);
    expect(text()).toMatch(/You are not an assistant at all/i);
    expect(text()).toMatch(/no voice of your own/i);
  });

  it('sends EVERY utterance to the orchestrator, with no easy-case carve-out', () => {
    // The carve-out is the bug. A model allowed to answer "trivial" things
    // decides for itself what is trivial, and it cannot see what it cannot see.
    expect(text()).toMatch(/EVERY single thing the user says goes to run_agnt/i);
    expect(text()).toMatch(/including "hello"/i);
    expect(text()).toMatch(/You do not get to decide what is worth/i);
  });

  it('forbids answering, guessing, greeting or stalling on its own', () => {
    expect(text()).toMatch(/NEVER answer from your own knowledge/i);
    expect(text()).toMatch(/NEVER apologise, explain, greet, stall or/i);
    expect(text()).toMatch(/NEVER say you are unable/i);
  });

  it('passes the user\u2019s words through unedited', () => {
    expect(text()).toMatch(/Do not reword, shorten, interpret/i);
  });

  it('forbids FRAMING the message, not just rewording it', () => {
    // Rewording was already forbidden and the model complied — it wrapped the
    // words instead, which the old rule did not cover. What reaches the chat
    // is the user's own message, so anything added appears to them as words
    // they never said.
    expect(text()).toMatch(/user_message field is a TRANSCRIPT, not a request you write/i);
    expect(text()).toMatch(/no "The user said"/);
    expect(text()).toMatch(/no "please respond to them"/i);
    expect(text()).toMatch(/no third person/i);
    expect(text()).toMatch(/words they never said/i);
  });

  it('SPEAKS HER ANSWER VERBATIM — screen and voice must not diverge', () => {
    expect(text()).toMatch(/SPEAK THAT TEXT EXACTLY AS GIVEN, word for word/i);
    expect(text()).toMatch(/Do NOT summarise it, reword it/i);
    expect(text()).toMatch(/the screen and the voice disagree/i);
  });

  it('keeps the DELIVERY natural while the WORDS stay hers', () => {
    // Naturalness is the entire reason for speech-to-speech; it just must not
    // extend to editing what is said.
    expect(text()).toMatch(/Read it naturally/i);
    expect(text()).toMatch(/The\s+delivery is yours; the words are hers/i);
  });

  it('stays silent while she works rather than inventing a holding phrase', () => {
    // A filler line would be this model's voice, not hers. The UI already
    // shows that work is happening.
    expect(text()).toMatch(/Say NOTHING while you wait/i);
    expect(text()).toMatch(/do not invent a holding phrase/i);
  });

  it('uses the assistant name it is given', () => {
    const t = buildInstructions({ assistantName: 'Scout' });
    expect(t).toContain('Scout');
    expect(t).toMatch(/You are NOT Scout/);
  });
});

describe('buildTools — exactly one door into AGNT', () => {
  it('declares run_agnt and nothing else', () => {
    const tools = buildTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('run_agnt');
    expect(tools[0].type).toBe('function');
  });

  it('THE PARAMETER IS A QUOTE, NOT A COMMISSION', () => {
    /**
     * REGRESSION. The field was called `instruction` and described as "the
     * user's request as a complete, self-contained instruction — include any
     * context from the conversation". That is a commission, and the model did
     * the job it was given. A user who said "hey, what all can you do?" saw
     * this arrive in their chat as their own message:
     *
     *   The user said: "Hey, what all can you do?". Please respond to the
     *   user with your capabilities.
     *
     * The field name and its description are the closest thing to the model's
     * hands — no amount of "do not reword" elsewhere outranks a parameter that
     * asks to be written.
     */
    const params = buildTools()[0].parameters;
    expect(params.required).toEqual(['user_message']);
    expect(params.properties.user_message.type).toBe('string');

    const desc = params.properties.user_message.description;
    expect(desc).toMatch(/EXACTLY what the user said, word for word/i);
    expect(desc).toMatch(/transcribing/i);
    // The exact failure, named in the description so the model cannot read
    // past it.
    expect(desc).toMatch(/never add a preamble/i);
    expect(desc).toMatch(/The user said/);
    expect(desc).toMatch(/please respond/i);
    expect(desc).toMatch(/third person/i);
  });

  it('no longer offers a field that invites authorship', () => {
    const params = buildTools()[0].parameters;
    expect(params.properties.instruction).toBeUndefined();
    expect(JSON.stringify(params)).not.toMatch(/self-contained instruction/i);
  });

  it('the tool DELIVERS what was said rather than sending an instruction', () => {
    // The tool description is read alongside the parameter; "send an
    // instruction to AGNT" pulled in the same wrong direction.
    const desc = buildTools()[0].description;
    expect(desc).toMatch(/Deliver what the user just said/i);
    expect(desc).not.toMatch(/send an instruction/i);
  });

  it('the description pushes the model to use it for everything', () => {
    expect(buildTools()[0].description).toMatch(/EVERY request/);
  });

  it('is valid JSON-serialisable schema (it is sent as a JSON string)', () => {
    expect(() => JSON.stringify(buildTools())).not.toThrow();
    const round = JSON.parse(JSON.stringify(buildTools()));
    expect(round[0].parameters.properties.user_message).toBeDefined();
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
