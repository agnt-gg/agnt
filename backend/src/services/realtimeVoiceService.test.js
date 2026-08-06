import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getValidAccessToken = vi.fn();
vi.mock('./auth/AuthManager.js', () => ({
  default: { getValidAccessToken: (...a) => getValidAccessToken(...a) },
}));

// CodexAuthManager reads ~/.codex/auth.json from the REAL home directory, so
// leaving it unmocked would make "this user has no credential" depend on
// whether the machine running the suite happens to be signed in to ChatGPT.
const ensureValidToken = vi.fn();
const getChatGptAccountId = vi.fn();
vi.mock('./auth/CodexAuthManager.js', () => ({
  default: {
    ensureValidToken: (...a) => ensureValidToken(...a),
    // Both accessors answer from the same stub here: which of the two the
    // resolver is right to ask is pinned in openAiVoiceCredential.test.js, and
    // duplicating that decision in this file would only give it somewhere to
    // drift to.
    ensureValidOAuthToken: (...a) => ensureValidToken(...a),
    getChatGptAccountId: (...a) => getChatGptAccountId(...a),
  },
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
  ensureValidToken.mockReset();
  getChatGptAccountId.mockReset();
  ensureValidToken.mockResolvedValue(null);
  getChatGptAccountId.mockReturnValue(null);
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
  it('uses the speech-to-speech model', () => {
    const c = buildSessionConfig();
    expect(c.model).toBe(REALTIME_MODEL);
    expect(c.type).toBe('realtime');
  });

  describe('nothing can be HEARD that was not also WRITTEN', () => {
    /**
     * THE BUG THIS EXISTS FOR
     * -----------------------
     * Realtime models narrate their tool calls. Ours spoke a line of its own
     * in the same response as the run_agnt call — in a voice the user takes
     * for Annie's — and the client then discarded that text on purpose as
     * filler. Heard, never written down, no trace anywhere. A user noticed it
     * before any log did, because there was no log.
     *
     * The session default governs responses the SERVER creates on its own,
     * which is exactly that one. Making it text-only removes the capability
     * rather than asking the model not to use it, so the guarantee holds even
     * when the model ignores its instructions — which is the only case that
     * ever mattered.
     */
    it('the session default is TEXT, so an auto-created response cannot speak', () => {
      expect(buildSessionConfig().output_modalities).toEqual(['text']);
    });

    it('still keeps an output voice, for the responses the client creates', () => {
      // Those are the ones that speak, and they carry only Annie's words.
      // Dropping this would leave her narration on the API default voice.
      expect(buildSessionConfig({ voice: 'cedar' }).audio.output.voice).toBe('cedar');
    });

    it('still listens — output modality says nothing about input', () => {
      const c = buildSessionConfig();
      expect(c.audio.input.turn_detection).toEqual({ type: 'semantic_vad' });
      expect(c.audio.input.format).toEqual({ type: 'audio/pcm', rate: 24000 });
    });

    it('denoises the input BEFORE turn detection reads it', () => {
      // Turn detection asks "is someone speaking?" of whatever arrives, and a
      // cough answers yes — which opened a turn, came back transcribed as
      // "um", and mid-run landed as a steer. near_field is the desk/headset
      // profile; far_field assumes a room mic and would be the wrong guess.
      expect(buildSessionConfig().audio.input.noise_reduction).toEqual({ type: 'near_field' });
    });

    it('still declares the tool — a text response can act, it just cannot talk', () => {
      // If this broke, voice would go silent AND stop working entirely, so it
      // is worth stating rather than inferring from the config shape.
      expect(buildSessionConfig().tools[0].name).toBe('run_agnt');
      expect(buildSessionConfig().tool_choice).toBe('auto');
    });
  });

  it('uses SEMANTIC turn detection, not a silence timer', () => {
    // The whole reason the cascade needed a hand-built endpointer.
    expect(buildSessionConfig().audio.input.turn_detection).toEqual({ type: 'semantic_vad' });
  });

  it('honours a valid voice and falls back on an invalid one', () => {
    expect(buildSessionConfig({ voice: 'cedar' }).audio.output.voice).toBe('cedar');
    expect(buildSessionConfig({ voice: undefined }).audio.output.voice).toBe(DEFAULT_VOICE);
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

describe('voice works however the user signed in with OpenAI', () => {
  /**
   * Voice used to require a platform API key and nothing else. A user signed in
   * with ChatGPT or Codex — the same OAuth flow, the same ~/.codex/auth.json —
   * silently got the cascade pipeline instead, even though OpenAI accepts that
   * token for Realtime (measured: POST /v1/realtime/calls -> 201).
   */
  const ok = () => globalThis.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'answer' });

  it('opens the session with the ChatGPT/Codex token when there is no platform key', async () => {
    getValidAccessToken.mockResolvedValue(null);
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    ok();

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });

    expect(r.ok).toBe(true);
    const [, opts] = globalThis.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer eyJ.oauth.token');
  });

  it('identifies the ChatGPT account so the right subscription is billed', async () => {
    getValidAccessToken.mockResolvedValue(null);
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    getChatGptAccountId.mockReturnValue('acct_abc');
    ok();

    await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(globalThis.fetch.mock.calls[0][1].headers['chatgpt-account-id']).toBe('acct_abc');
  });

  it('sends no account header for a platform key', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    ok();
    await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(globalThis.fetch.mock.calls[0][1].headers).not.toHaveProperty('chatgpt-account-id');
  });

  it('spends the ChatGPT subscription before the metered key', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    ok();
    await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer eyJ.oauth.token');
  });
});

describe('one dead credential does not end the session', () => {
  /**
   * THE OUTAGE THIS SUITE EXISTS FOR
   * --------------------------------
   * A user ran their OpenAI API account out of credit and voice stopped, while
   * a ChatGPT subscription that OpenAI would have accepted sat unused. The old
   * code resolved ONE credential and treated resolution as success — but an
   * exhausted key resolves perfectly and only fails at the call. Whether a
   * credential works is knowable only here, so failing over has to happen here.
   */
  const answers = (...responses) => {
    globalThis.fetch.mockReset();
    for (const r of responses) {
      globalThis.fetch.mockResolvedValueOnce({
        ok: r.status < 400,
        status: r.status,
        text: async () => r.body ?? '',
      });
    }
  };

  const authHeaders = () => globalThis.fetch.mock.calls.map((c) => c[1].headers.Authorization);
  /** Every attempt as "host + which token", which is what the walk really is. */
  const route = () =>
    globalThis.fetch.mock.calls.map(
      (c) => `${new URL(c[0]).host} ${c[1].headers.Authorization.replace('Bearer ', '')}`,
    );

  it('an exhausted API key is reached only after the subscription is out of routes', async () => {
    // The literal reported failure. The subscription is tried first and on BOTH
    // of its routes; only then does the walk spend the metered key.
    getValidAccessToken.mockResolvedValue('sk-no-credit');
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    answers(
      { status: 403, body: 'not entitled' },
      { status: 403, body: 'not entitled' },
      { status: 200, body: 'answer' },
    );

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r).toEqual({ ok: true, sdp: 'answer' });
    expect(route()).toEqual([
      'chatgpt.com eyJ.oauth.token',
      'api.openai.com eyJ.oauth.token',
      'api.openai.com sk-no-credit',
    ]);
  });

  it.each([401, 403, 429])(
    'a %i on the ChatGPT product falls back to the platform route, same token',
    async (status) => {
      // The reason the second route exists: if OpenAI closes one of them, the
      // subscription must not be handed to the metered key instead.
      getValidAccessToken.mockResolvedValue('sk-test');
      ensureValidToken.mockResolvedValue('eyJ.oauth.token');
      answers({ status, body: 'nope' }, { status: 200, body: 'answer' });

      const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
      expect(r.ok).toBe(true);
      expect(route()).toEqual(['chatgpt.com eyJ.oauth.token', 'api.openai.com eyJ.oauth.token']);
      expect(authHeaders()).not.toContain('Bearer sk-test');
    },
  );

  it.each([400, 500, 503])('a %i is not a credential problem and ends the walk', async (status) => {
    // A malformed offer and an OpenAI outage fail identically on every token.
    // Retrying them spends round trips to reach the same answer more slowly.
    getValidAccessToken.mockResolvedValue('sk-test');
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    answers({ status, body: 'bad' }, { status: 200, body: 'answer' });

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r.reason).toBe(`provider-${status}`);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('a network error ends the walk rather than retrying the same failure', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    globalThis.fetch.mockReset();
    globalThis.fetch.mockRejectedValue(new Error('ECONNRESET'));

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r.reason).toBe('network');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('when every credential refuses, the one the user can FIX is the one reported', async () => {
    // Telling someone their subscription is not entitled helps nobody; telling
    // them their API key is out of credit is the sentence they can act on.
    getValidAccessToken.mockResolvedValue('sk-no-credit');
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    answers(
      { status: 403, body: 'not entitled' },
      { status: 403, body: 'not entitled' },
      { status: 429, body: 'insufficient_quota' },
    );

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r.reason).toBe('provider-429');
    expect(r.detail).toContain('insufficient_quota');
  });

  it('sends the SDP offer intact on the second attempt, not an emptied body', async () => {
    // Each attempt builds its own body. If one were reused and consumable, the
    // failover would succeed at the protocol level and hand OpenAI an empty
    // offer — a failure that no status code would reveal.
    getValidAccessToken.mockResolvedValue('sk-test');
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    answers({ status: 401, body: 'nope' }, { status: 200, body: 'answer' });

    await createRealtimeCall({ sdp: 'the-real-offer', userId: 'u1' });
    const second = globalThis.fetch.mock.calls[1][1].body;
    expect(second.get('sdp')).toBe('the-real-offer');
    expect(second.get('session')).toBeTruthy();
  });
});

describe('each credential is spent where it belongs', () => {
  /**
   * A ChatGPT token is accepted by the ChatGPT product's own realtime endpoint
   * AND by the public platform API (both measured at 201). They are not equally
   * safe to build on: every OTHER platform surface refuses this token on scope
   * (/v1/models 403; chat, responses and both audio routes 401). Realtime is
   * the lone exception there, so the subscription asks its own product first
   * and treats the platform route as a backstop.
   */
  const ok = () =>
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'answer' });
  const first = () => globalThis.fetch.mock.calls[0];

  it('a subscription opens on the ChatGPT product, not the platform API', async () => {
    getValidAccessToken.mockResolvedValue(null);
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    ok();

    await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(first()[0]).toBe('https://chatgpt.com/backend-api/codex/realtime/calls');
  });

  it('sends the ChatGPT product the JSON dialect it asks for', async () => {
    // Measured: that endpoint answers `sdp` must be a string / `session` must be
    // an object. It does not accept the multipart body the platform API takes.
    getValidAccessToken.mockResolvedValue(null);
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
    ok();

    await createRealtimeCall({ sdp: 'the-offer', userId: 'u1', voice: 'marin' });
    const [, init] = first();
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.sdp).toBe('the-offer');
    expect(body.session.audio.output.voice).toBe('marin');
  });

  it('never sends a platform key to the ChatGPT product', async () => {
    // Measured: it rejects `sk-` keys with 401. Offering one there would spend a
    // round trip to be told something already known.
    getValidAccessToken.mockResolvedValue('sk-test');
    ensureValidToken.mockResolvedValue(null);
    ok();

    await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(first()[0]).toBe('https://api.openai.com/v1/realtime/calls');
  });

  it('still sends multipart to the platform API', async () => {
    getValidAccessToken.mockResolvedValue('sk-test');
    ensureValidToken.mockResolvedValue(null);
    ok();

    await createRealtimeCall({ sdp: 'the-offer', userId: 'u1' });
    expect(first()[1].body).toBeInstanceOf(FormData);
    expect(first()[1].body.get('sdp')).toBe('the-offer');
  });
});

describe('a ChatGPT plan that is not entitled to realtime degrades quietly', () => {
  /**
   * Only `prolite` was verified against the live API. If some other plan is not
   * entitled, the user did nothing wrong and can change nothing — that is the
   * same situation as having no credential, so it produces the same NORMAL
   * result and the client falls back to the cascade. A PLATFORM key rejected
   * the same way IS the user's business and is surfaced. Tracking which kind of
   * credential was used exists precisely to tell those two apart.
   */
  beforeEach(() => {
    getValidAccessToken.mockResolvedValue(null);
    ensureValidToken.mockResolvedValue('eyJ.oauth.token');
  });

  it.each([401, 403])('a %i on the borrowed token reads as no-credentials', async (status) => {
    globalThis.fetch.mockResolvedValue({ ok: false, status, text: async () => 'insufficient permissions' });

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no-credentials');
    expect(r.status).toBe(200); // a normal state, not an error the client should show
  });

  it.each([401, 403])('a %i on a PLATFORM key is surfaced, not swallowed', async (status) => {
    getValidAccessToken.mockResolvedValue('sk-revoked');
    globalThis.fetch.mockResolvedValue({ ok: false, status, text: async () => 'invalid api key' });

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r.reason).toBe(`provider-${status}`);
    expect(r.status).toBe(status);
  });

  it('a rate-limited subscription and nothing else reads as no-credentials', async () => {
    // There is no platform key here, so a 429 on the borrowed token leaves the
    // user with nothing to act on — same situation as no credential, same
    // quiet fallback. When a key DOES exist the walk reaches it, and its own
    // 429 is surfaced; see the failover suite.
    globalThis.fetch.mockResolvedValue({ ok: false, status: 429, text: async () => 'slow down' });

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r.reason).toBe('no-credentials');
    expect(r.status).toBe(200);
  });

  it('an outage on the borrowed token is still a real failure', async () => {
    // Outages are transient and diagnosable. Hiding them as "no credentials"
    // would turn a temporary problem into a phantom one.
    globalThis.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'upstream down' });

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(r.reason).toBe('provider-503');
  });

  it('never leaks the borrowed token in the failure it reports', async () => {
    ensureValidToken.mockResolvedValue('eyJ.super-secret-oauth.token');
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });

    const r = await createRealtimeCall({ sdp: 'offer', userId: 'u1' });
    expect(JSON.stringify(r)).not.toContain('super-secret-oauth');
  });
});
