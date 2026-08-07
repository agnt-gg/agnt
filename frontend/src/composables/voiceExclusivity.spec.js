/**
 * ONE MOUTH, ONE MIC, ONE CONVERSATION.
 *
 * THE BUG THIS FILE EXISTS FOR
 * ----------------------------
 * Open voice in one chat, navigate to another, start talking there: the
 * utterance was sent to BOTH conversations and both answers were spoken over
 * each other.
 *
 * The cause was structural, not a missing guard. Every chat host owns its own
 * `useVoiceEngines()` instance, and each one ends its session only when ITS
 * OWN conversation changes (`epoch`). Nothing ever asked the question that
 * actually matters — "is another surface already listening?" — because no
 * component can answer it. Meanwhile Terminal.vue wraps screens in
 * <KeepAlive>, so navigating away does NOT unmount the previous host: its
 * session, its microphone and its submit path all stay live off-screen.
 *
 * The microphone is a singleton and so is the person talking into it.
 * Therefore a voice session must be a singleton too, and that fact has to live
 * somewhere ABOVE any single host. That is the voice floor.
 *
 * These tests drive the real composable through a real mount, with one shared
 * fake microphone feeding every live session — exactly as one physical mic
 * feeds every session in the browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, KeepAlive, ref } from 'vue';
import { mount } from '@vue/test-utils';

// ---- one microphone, shared by every session (as in the browser) --------

const captureHandlers = {};
const fakeCapture = {
  startRecording: vi.fn(() => true),
  stopRecording: vi.fn(async () => ({ blob: new Blob(['x'.repeat(4000)]), durationMs: 4000, sampleRate: 48000 })),
  start: vi.fn(async () => ({ ok: true })),
  stop: vi.fn(),
  setDucked: vi.fn(),
  on: vi.fn((event, fn) => {
    captureHandlers[event] = captureHandlers[event] || [];
    captureHandlers[event].push(fn);
    return () => {};
  }),
  silenceMs: 0,
  isSpeaking: false,
  isCalibrating: false,
  isRecording: false,
  isActive: true,
};

const fakeSpeech = {
  speak: vi.fn(() => Promise.resolve()),
  whenIdle: vi.fn(() => Promise.resolve()),
  cancel: vi.fn(() => ({ spoken: '', discarded: '', partial: '' })),
  reset: vi.fn(),
  spokenPrefix: vi.fn(() => ''),
  configure: vi.fn(),
  on: vi.fn(() => () => {}),
  state: 'idle',
  isSpeaking: false,
  pending: [],
};

vi.mock('../voice/audioCapture.js', () => ({
  createAudioCapture: () => fakeCapture,
  default: {},
}));

vi.mock('../voice/speechOut.js', async () => {
  const actual = await vi.importActual('../voice/speechOut.js');
  return { ...actual, createSpeechOut: () => fakeSpeech, isWebSpeechAvailable: () => true };
});

vi.mock('../../user.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  default: {},
}));

const { useVoiceEngines } = await import('./useVoiceEngines.js');
const { voiceFloorTicket } = await import('../voice/voiceFloor.js');

function fire(event, payload) {
  for (const fn of captureHandlers[event] || []) fn(payload);
}

async function advance(ms) {
  vi.advanceTimersByTime(ms);
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

/**
 * A chat surface: the smallest thing that owns a voice session, mounted for
 * real so lifecycle hooks (unmount, KeepAlive deactivate) actually run.
 */
function makeHost(submit) {
  const isStreaming = ref(false);
  const epoch = ref(0);
  let api = null;
  const Host = defineComponent({
    name: 'ChatHost',
    setup() {
      api = useVoiceEngines({
        surface: 'chat',
        submit,
        streamingAnswer: () => '',
        isStreaming,
        epoch,
      });
      return () => h('div');
    },
  });
  return { Host, isStreaming, epoch, api: () => api };
}

/** Speak one complete utterance into the shared microphone. */
async function speakOneTurn() {
  fire('speech_start', {});
  fakeCapture.silenceMs = 700;
  await advance(60);
  await advance(10);
  await advance(700); // reopen window expires -> commit
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const k of Object.keys(captureHandlers)) delete captureHandlers[k];
  fakeCapture.silenceMs = 0;
  vi.clearAllMocks();

  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, transcript: 'open the auth file' }),
  }));
  globalThis.localStorage = { getItem: () => 'test-token', setItem: () => {} };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('two chat surfaces cannot listen at the same time', () => {
  it('starting voice in a second chat ends the session in the first', async () => {
    const submitA = vi.fn();
    const submitB = vi.fn();
    const a = makeHost(submitA);
    const b = makeHost(submitB);
    const wa = mount(a.Host);
    const wb = mount(b.Host);

    await a.api().toggleVoice();
    expect(a.api().voiceActive.value).toBe(true);

    // The user navigates to the other chat and starts talking there. The first
    // host is still mounted (KeepAlive) and never learned anything happened.
    await b.api().toggleVoice();

    expect(b.api().voiceActive.value).toBe(true);
    expect(a.api().voiceActive.value, 'the first chat is still listening').toBe(false);

    await speakOneTurn();

    expect(submitB).toHaveBeenCalledWith('open the auth file');
    expect(submitA, 'the utterance was also sent to the other conversation').not.toHaveBeenCalled();

    wa.unmount();
    wb.unmount();
  });

  it('the utterance lands in exactly one conversation (the visible one)', async () => {
    const submits = [vi.fn(), vi.fn(), vi.fn()];
    const hosts = submits.map((s) => makeHost(s));
    const wrappers = hosts.map((hst) => mount(hst.Host));

    for (const hst of hosts) await hst.api().toggleVoice();
    await speakOneTurn();

    const gotIt = submits.filter((s) => s.mock.calls.length > 0);
    expect(gotIt).toHaveLength(1);
    expect(submits[2]).toHaveBeenCalledWith('open the auth file');

    for (const w of wrappers) w.unmount();
  });

  it('anti-vacuity: one surface on its own still hears and sends', async () => {
    const submit = vi.fn();
    const only = makeHost(submit);
    const w = mount(only.Host);

    await only.api().toggleVoice();
    await speakOneTurn();

    expect(submit).toHaveBeenCalledWith('open the auth file');
    w.unmount();
  });
});

describe('a voice session does not outlive the chat you can see', () => {
  it('navigating away from a KeepAlive-cached chat ends its session', async () => {
    const submit = vi.fn();
    const hostA = makeHost(submit);
    const show = ref(true);

    const Shell = defineComponent({
      setup() {
        return () => h(KeepAlive, null, {
          default: () => (show.value ? h(hostA.Host) : h('div', { key: 'other' })),
        });
      },
    });

    const w = mount(Shell);
    await hostA.api().toggleVoice();
    expect(hostA.api().voiceActive.value).toBe(true);

    // Navigate to another screen. KeepAlive DEACTIVATES the host rather than
    // unmounting it, so onUnmounted never runs — the exact reason a session
    // used to survive navigation with its microphone open.
    show.value = false;
    await w.vm.$nextTick();
    await advance(10);

    expect(hostA.api().voiceActive.value, 'the off-screen chat is still listening').toBe(false);

    await speakOneTurn();
    expect(submit, 'an invisible chat received the utterance').not.toHaveBeenCalled();

    w.unmount();
  });

  it('a chat that stops its session leaves the floor free', async () => {
    /**
     * A NEGATIVE CONTROL FOUND THIS TEST MISSING. Deleting the release from
     * stopVoice left every behavioural test green, because a claim evicts the
     * stale holder anyway — so nothing observable broke, and the floor quietly
     * retained a reference to a torn-down component's teardown closure for as
     * long as nobody else pressed the button.
     *
     * "No dead session holds the floor" is the actual invariant, so it is
     * asserted directly rather than inferred from a symptom.
     */
    const h = makeHost(vi.fn());
    const w = mount(h.Host);

    await h.api().toggleVoice();
    expect(voiceFloorTicket()).not.toBeNull();

    await h.api().toggleVoice(); // pressed again: stop
    expect(voiceFloorTicket(), 'a stopped session still holds the floor').toBeNull();

    w.unmount();
    expect(voiceFloorTicket()).toBeNull();
  });

  it('unmounting a LIVE chat frees the floor too', async () => {
    const h = makeHost(vi.fn());
    const w = mount(h.Host);
    await h.api().toggleVoice();
    expect(voiceFloorTicket()).not.toBeNull();

    w.unmount();
    expect(voiceFloorTicket(), 'an unmounted session still holds the floor').toBeNull();
  });

  it('unmounting a chat releases the floor, so the next one can claim it', async () => {
    const submitA = vi.fn();
    const submitB = vi.fn();
    const a = makeHost(submitA);
    const wa = mount(a.Host);
    await a.api().toggleVoice();
    wa.unmount();

    const b = makeHost(submitB);
    const wb = mount(b.Host);
    await b.api().toggleVoice();
    expect(b.api().voiceActive.value).toBe(true);

    await speakOneTurn();
    expect(submitB).toHaveBeenCalledWith('open the auth file');
    expect(submitA).not.toHaveBeenCalled();
    wb.unmount();
  });
});
