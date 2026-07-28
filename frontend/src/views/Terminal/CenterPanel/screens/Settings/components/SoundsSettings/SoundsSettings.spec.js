import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SoundsSettings from './SoundsSettings.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import { getEventPreferences, getMasterEnabled, getMasterVolume, resolveSound, setEventPreferences } from '@/services/soundPreferences';

function createWrapper() {
  const playSound = vi.fn();
  const wrapper = mount(SoundsSettings, {
    global: { provide: { playSound } },
  });
  return { wrapper, playSound };
}

// The conversation-complete chime is the row this panel exists to expose.
const EVENT_ID = 'chatUnread';

const picker = (wrapper) => wrapper.findComponent(CustomSelect);

// Selecting through the component's own contract, so these tests break if the
// binding breaks — which is exactly what a native <select> hid before.
const choose = (wrapper, value) => picker(wrapper).vm.$emit('update:modelValue', value);

describe('SoundsSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('per-event rows', () => {
    it('renders a row for every configurable sound', () => {
      const { wrapper } = createWrapper();
      const rows = wrapper.findAll('.event-row');
      expect(rows.length).toBeGreaterThan(0);
      expect(wrapper.text()).toContain('Conversation Complete');
    });

    it('offers every shipped audio file as an option', () => {
      const { wrapper } = createWrapper();
      const options = picker(wrapper).props('options');
      expect(options.length).toBeGreaterThan(1);
      expect(options.map((o) => o.value)).toContain('/sounds/success-chime.mp3');
      expect(options.every((o) => o.label && o.value)).toBe(true);
    });

    it('uses the shared select component rather than a native dropdown', () => {
      const { wrapper } = createWrapper();
      expect(picker(wrapper).exists()).toBe(true);
      expect(wrapper.find('select').exists()).toBe(false);
    });

    it('starts at the catalogue default on a fresh install', () => {
      const { wrapper } = createWrapper();
      const row = wrapper.find('.event-row');
      expect(picker(wrapper).props('modelValue')).toBe('/sounds/success-chime.mp3');
      expect(picker(wrapper).find('.selected').text()).toBe('Success chime');
      expect(row.find('.event-volume').element.value).toBe('100');
      expect(row.find('.toggle-switch input').element.checked).toBe(true);
    });

    it('loads previously saved preferences on mount', () => {
      setEventPreferences(EVENT_ID, { enabled: false, volume: 0.4, src: '/sounds/woosh_s21KzKN.mp3' });
      const { wrapper } = createWrapper();
      const row = wrapper.find('.event-row');
      expect(picker(wrapper).props('modelValue')).toBe('/sounds/woosh_s21KzKN.mp3');
      expect(picker(wrapper).find('.selected').text()).toBe('Woosh');
      expect(row.find('.event-volume').element.value).toBe('40');
      expect(row.find('.toggle-switch input').element.checked).toBe(false);
    });
  });

  describe('editing the conversation-complete sound', () => {
    it('muting the event persists and actually silences it', async () => {
      const { wrapper } = createWrapper();
      const toggle = wrapper.find('.event-row .toggle-switch input');

      await toggle.setValue(false);

      expect(getEventPreferences(EVENT_ID).enabled).toBe(false);
      expect(resolveSound(EVENT_ID)).toBeNull();
    });

    it('lowering the event volume scales against master', async () => {
      const { wrapper } = createWrapper();
      await wrapper.find('.control-row:not(.event-row) .volume-slider').setValue(50); // master 50%
      await wrapper.find('.event-row .event-volume').setValue(50); // event 50%

      expect(getEventPreferences(EVENT_ID).volume).toBeCloseTo(0.5);
      expect(resolveSound(EVENT_ID).volume).toBeCloseTo(0.25);
    });

    it('choosing a different file persists and is what plays', async () => {
      const { wrapper } = createWrapper();
      choose(wrapper, '/sounds/cha-ching-money.mp3');
      await wrapper.vm.$nextTick();

      expect(getEventPreferences(EVENT_ID).src).toBe('/sounds/cha-ching-money.mp3');
      expect(resolveSound(EVENT_ID).src).toBe('/sounds/cha-ching-money.mp3');
    });

    it('shows the current level as a readout', async () => {
      const { wrapper } = createWrapper();
      await wrapper.find('.event-row .event-volume').setValue(35);
      expect(wrapper.find('.event-volume-readout').text()).toBe('35%');
    });
  });

  describe('preview', () => {
    it('previews through the real playback path so it reflects the saved setting', async () => {
      const { wrapper, playSound } = createWrapper();
      await wrapper.find('.event-row .preview-button').trigger('click');
      expect(playSound).toHaveBeenCalledWith(EVENT_ID);
    });

    it('stays silent when the event is muted', async () => {
      setEventPreferences(EVENT_ID, { enabled: false });
      const { wrapper, playSound } = createWrapper();
      await wrapper.find('.event-row .preview-button').trigger('click');
      expect(playSound).not.toHaveBeenCalled();
    });

    it('changing the file previews it immediately', async () => {
      const { wrapper, playSound } = createWrapper();
      choose(wrapper, '/sounds/cha-ching-money.mp3');
      await wrapper.vm.$nextTick();
      expect(playSound).toHaveBeenCalledWith(EVENT_ID);
    });
  });

  describe('master controls', () => {
    it('still persists the master toggle', async () => {
      const { wrapper } = createWrapper();
      await wrapper.find('.master-control input[type="checkbox"]').setValue(false);
      expect(getMasterEnabled()).toBe(false);
    });

    it('still persists the master volume', async () => {
      const { wrapper } = createWrapper();
      await wrapper.find('.control-row:not(.event-row) .volume-slider').setValue(70);
      expect(getMasterVolume()).toBeCloseTo(0.7);
    });

    it('disables the per-event controls when the master toggle is off', async () => {
      const { wrapper } = createWrapper();
      await wrapper.find('.master-control input[type="checkbox"]').setValue(false);

      const row = wrapper.find('.event-row');
      expect(row.classes()).toContain('disabled');
      expect(row.find('.event-volume').attributes('disabled')).toBeDefined();
      expect(row.find('.preview-button').attributes('disabled')).toBeDefined();
      expect(picker(wrapper).props('disabled')).toBe(true);
    });
  });
});
