import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, inject, nextTick } from 'vue';
import { createStore } from 'vuex';
import TerminalLayout from './TerminalLayout.vue';
import { setEventPreferences, setMasterEnabled, setMasterVolume } from '@/services/soundPreferences';
import { claimVoiceFloor, releaseVoiceFloor } from '@/voice/voiceFloor.js';

/**
 * The settings panel is only real if playback honours it. These tests drive the
 * provided `playSound` and assert on the Audio object that actually gets built,
 * which is the one place the two halves have to agree.
 */

// Captures every Audio the layout constructs.
let constructed;

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.volume = 1;
    this.currentTime = 0;
    constructed.push(this);
  }
  addEventListener() {}
  pause() {}
  play() {
    return Promise.resolve();
  }
}

// Child that hands the injected playSound back to the test.
const SoundProbe = defineComponent({
  name: 'SoundProbe',
  setup() {
    const playSound = inject('playSound');
    return { playSound };
  },
  render: () => null,
});

function themeStore() {
  return createStore({
    modules: {
      theme: {
        namespaced: true,
        getters: {
          currentTheme: () => ({}),
          backgroundImage: () => null,
          backgroundVideo: () => null,
        },
      },
    },
  });
}

// The slotted content only exists after the reveal timer fires, so the probe
// is not mountable until the timers have been advanced.
async function mountRevealed() {
  const wrapper = mount(TerminalLayout, {
    props: { initialDelay: 0 },
    slots: { default: SoundProbe },
    global: { plugins: [themeStore()], stubs: { SongPlayer: true, SimpleModal: true } },
  });

  vi.advanceTimersByTime(1);
  await nextTick();
  return wrapper;
}

async function mountLayout() {
  const wrapper = await mountRevealed();

  // Sounds are suppressed until the browser has a real interaction to hang
  // playback off; reproduce that here rather than reaching into internals.
  await wrapper.find('.terminal-container').trigger('click');

  return wrapper;
}

function playSoundFrom(wrapper) {
  return wrapper.findComponent(SoundProbe).vm.playSound;
}

describe('TerminalLayout sound playback', () => {
  beforeEach(() => {
    localStorage.clear();
    constructed = [];
    vi.stubGlobal('Audio', FakeAudio);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('plays the catalogued file at the master volume by default', async () => {
    setMasterVolume(0.4);
    const wrapper = await mountLayout();

    playSoundFrom(wrapper)('chatUnread');

    expect(constructed).toHaveLength(1);
    expect(constructed[0].src).toBe('/sounds/success-chime.mp3');
    expect(constructed[0].volume).toBeCloseTo(0.4);
  });

  it('honours a per-event mute', async () => {
    setEventPreferences('chatUnread', { enabled: false });
    const wrapper = await mountLayout();

    playSoundFrom(wrapper)('chatUnread');

    expect(constructed).toHaveLength(0);
  });

  it('honours a per-event volume, scaled against master', async () => {
    setMasterVolume(0.8);
    setEventPreferences('chatUnread', { volume: 0.5 });
    const wrapper = await mountLayout();

    playSoundFrom(wrapper)('chatUnread');

    expect(constructed[0].volume).toBeCloseTo(0.4);
  });

  it('honours a per-event file swap', async () => {
    setEventPreferences('chatUnread', { src: '/sounds/woosh_s21KzKN.mp3' });
    const wrapper = await mountLayout();

    playSoundFrom(wrapper)('chatUnread');

    expect(constructed[0].src).toBe('/sounds/woosh_s21KzKN.mp3');
  });

  it('leaves other sounds alone when one event is muted', async () => {
    setEventPreferences('chatUnread', { enabled: false });
    const wrapper = await mountLayout();

    playSoundFrom(wrapper)('buttonClick');

    expect(constructed).toHaveLength(1);
    expect(constructed[0].src).toBe('/sounds/mouse-click.mp3');
  });

  it('still obeys the master toggle', async () => {
    setMasterEnabled(false);
    const wrapper = await mountLayout();

    playSoundFrom(wrapper)('chatUnread');

    expect(constructed).toHaveLength(0);
  });

  it('warns once for an unregistered sound instead of playing silence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrapper = await mountLayout();

    playSoundFrom(wrapper)('doesNotExist');

    expect(constructed).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('Sound "doesNotExist" not found.');
  });

  it('stays silent before the first user interaction', async () => {
    const wrapper = await mountRevealed(); // deliberately no click

    playSoundFrom(wrapper)('chatUnread');

    expect(constructed).toHaveLength(0);
  });
});

describe('nothing is played into an open microphone', () => {
  /**
   * THE BUG THIS EXISTS FOR
   * -----------------------
   * A run finishing plays the completion chime out of the speakers. With a live
   * voice session that audio goes straight back into the open microphone; the
   * Realtime server's VAD hears speech and TRUNCATES the assistant's own
   * unplayed audio, because any speech is treated as the user barging in. The
   * reply stopped dead mid-sentence — and since speech lags the text stream by
   * seconds, "the message finished" is precisely when she is still talking, so
   * it happened on most turns rather than occasionally.
   *
   * The REAL voiceFloor singleton is used rather than a mock: the guard is only
   * worth anything if it agrees with the thing that actually tracks the
   * microphone, and a mock would happily agree with a guard that reads nothing.
   */
  let ticket = null;

  beforeEach(() => {
    localStorage.clear();
    constructed = [];
    vi.stubGlobal('Audio', FakeAudio);
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (ticket !== null) releaseVoiceFloor(ticket);
    ticket = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('suppresses the completion chime while a voice session is live', async () => {
    const wrapper = await mountLayout();
    ticket = claimVoiceFloor(() => {});

    playSoundFrom(wrapper)('chatUnread');

    expect(constructed).toHaveLength(0);
  });

  it('suppresses every other sound too, not just the chime', async () => {
    // They all reach the same microphone. A rule listing which sounds are
    // dangerous would have to be updated by whoever adds the next one.
    const wrapper = await mountLayout();
    ticket = claimVoiceFloor(() => {});

    for (const name of ['buttonClick', 'typewriterKeyPress', 'chaChingMoney']) {
      playSoundFrom(wrapper)(name);
    }

    expect(constructed).toHaveLength(0);
  });

  it('plays again once the session ends', async () => {
    // The guard must be tied to the LIVE session, not latch on for ever after
    // the first voice turn of the app's life.
    const wrapper = await mountLayout();
    const t = claimVoiceFloor(() => {});
    playSoundFrom(wrapper)('chatUnread');
    expect(constructed).toHaveLength(0);

    releaseVoiceFloor(t);
    playSoundFrom(wrapper)('chatUnread');

    expect(constructed).toHaveLength(1);
    expect(constructed[0].src).toBe('/sounds/success-chime.mp3');
  });

  it('plays normally when no voice session has ever started', async () => {
    // Guards against the opposite failure: silencing the app for everyone who
    // never uses voice.
    const wrapper = await mountLayout();

    playSoundFrom(wrapper)('chatUnread');

    expect(constructed).toHaveLength(1);
  });
});
