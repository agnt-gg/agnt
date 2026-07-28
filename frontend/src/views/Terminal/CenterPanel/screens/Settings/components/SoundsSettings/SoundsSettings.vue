<template>
  <div class="sounds-settings">
    <div class="settings-header">
      <h3>Sound Effects</h3>
      <p class="settings-description">Control audio feedback throughout the application</p>
    </div>

    <div class="sound-controls">
      <!-- Master Toggle -->
      <div class="control-row master-control">
        <div class="control-info">
          <div class="control-label">
            <i class="fas fa-volume-up"></i>
            <span>Enable Sound Effects</span>
          </div>
          <p class="control-description">Turn all sound effects on or off</p>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" v-model="soundsEnabled" @change="handleToggleChange" />
          <span class="slider"></span>
        </label>
      </div>

      <!-- Volume Control -->
      <div class="control-row" :class="{ disabled: !soundsEnabled }">
        <div class="control-info">
          <div class="control-label">
            <i class="fas fa-sliders-h"></i>
            <span>Master Volume</span>
          </div>
          <p class="control-description">Adjust the overall volume level ({{ Math.round(volume * 100) }}%)</p>
        </div>
        <div class="volume-control">
          <input
            type="range"
            min="0"
            max="100"
            v-model.number="volumePercent"
            @input="handleVolumeChange"
            :disabled="!soundsEnabled"
            class="volume-slider"
          />
        </div>
      </div>

      <!-- Test Sound Button -->
      <div class="control-row" :class="{ disabled: !soundsEnabled }">
        <div class="control-info">
          <div class="control-label">
            <i class="fas fa-play-circle"></i>
            <span>Test Sound</span>
          </div>
          <p class="control-description">Play a sample sound to test your settings</p>
        </div>
        <button class="test-button" @click="playTestSound" :disabled="!soundsEnabled" data-sound="buttonClick">
          <i class="fas fa-play"></i>
          Play Test
        </button>
      </div>
    </div>

    <!-- Individual event sounds. Rendered from the sound catalog, so exposing
         another sound is a flag in soundPreferences.js, not a UI change. -->
    <div class="sound-controls" v-if="configurableEvents.length">
      <h4 class="section-title">Individual Sounds</h4>

      <div v-for="event in configurableEvents" :key="event.id" class="control-row event-row" :class="{ disabled: !soundsEnabled }">
        <div class="control-info">
          <div class="control-label">
            <i :class="event.icon || 'fas fa-music'"></i>
            <span>{{ event.label }}</span>
          </div>
          <p class="control-description">{{ event.description }}</p>
        </div>

        <div class="event-controls">
          <CustomSelect
            class="sound-select"
            :options="soundOptions"
            v-model="prefs[event.id].src"
            :disabled="!soundsEnabled || !prefs[event.id].enabled"
            @update:model-value="handleSrcChange(event.id)"
          />

          <input
            type="range"
            min="0"
            max="100"
            class="volume-slider event-volume"
            v-model.number="prefs[event.id].volumePercent"
            :disabled="!soundsEnabled || !prefs[event.id].enabled"
            :aria-label="event.label + ' volume'"
            v-tooltip="prefs[event.id].volumePercent + '% of master'"
            @input="handleEventVolumeChange(event.id)"
          />
          <span class="event-volume-readout">{{ prefs[event.id].volumePercent }}%</span>

          <button
            class="preview-button"
            :disabled="!soundsEnabled || !prefs[event.id].enabled"
            :aria-label="'Preview ' + event.label"
            v-tooltip="'Preview'"
            @click="previewEvent(event.id)"
          >
            <i class="fas fa-play"></i>
          </button>

          <label class="toggle-switch">
            <input type="checkbox" v-model="prefs[event.id].enabled" :disabled="!soundsEnabled" @change="handleEventToggle(event.id)" />
            <span class="slider"></span>
          </label>
        </div>
      </div>
    </div>

    <div class="sound-info">
      <div class="info-card">
        <i class="fas fa-info-circle"></i>
        <div class="info-content">
          <h4>About Sound Effects</h4>
          <p>
            Sound effects provide audio feedback for various interactions throughout the application, including button clicks, notifications, and
            other UI events.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, inject, reactive } from 'vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import {
  SOUND_FILES,
  getConfigurableSoundEvents,
  getEventPreferences,
  getMasterEnabled,
  getMasterVolume,
  setEventPreferences,
  setMasterEnabled,
  setMasterVolume,
} from '@/services/soundPreferences';

export default {
  name: 'SoundsSettings',
  components: { CustomSelect },
  setup() {
    const playSound = inject('playSound', () => {});

    const configurableEvents = getConfigurableSoundEvents();
    const soundOptions = SOUND_FILES.map((file) => ({ label: file.label, value: file.src }));

    // Read on setup rather than in onMounted: loading a frame later renders the
    // defaults first, so a user with a customised sound watches it flip.
    const soundsEnabled = ref(getMasterEnabled());
    const volumePercent = ref(Math.round(getMasterVolume() * 100));

    // Per-event UI state. Volume is held as a percentage of master so the
    // slider reads the way it looks: 100% means "as loud as the master allows".
    const prefs = reactive({});
    configurableEvents.forEach((event) => {
      const saved = getEventPreferences(event.id);
      prefs[event.id] = {
        enabled: saved.enabled,
        volumePercent: Math.round(saved.volume * 100),
        src: saved.src,
      };
    });

    // Computed volume (0-1 range)
    const volume = computed(() => volumePercent.value / 100);

    const handleToggleChange = () => {
      setMasterEnabled(soundsEnabled.value);
      if (soundsEnabled.value) {
        playSound('buttonClick', volume.value);
      }
    };

    const handleVolumeChange = () => {
      setMasterVolume(volume.value);
    };

    const playTestSound = () => {
      if (soundsEnabled.value) {
        playSound('chaChingMoney', volume.value);
      }
    };

    const persistEvent = (eventId) => {
      const local = prefs[eventId];
      setEventPreferences(eventId, {
        enabled: local.enabled,
        volume: local.volumePercent / 100,
        src: local.src,
      });
    };

    // Every change is written before the preview plays, so what the user hears
    // is what was just saved rather than a parallel preview path.
    const previewEvent = (eventId) => {
      if (!soundsEnabled.value || !prefs[eventId].enabled) return;
      playSound(eventId);
    };

    const handleEventToggle = (eventId) => {
      persistEvent(eventId);
      if (prefs[eventId].enabled) previewEvent(eventId);
    };

    const handleEventVolumeChange = (eventId) => {
      persistEvent(eventId);
    };

    const handleSrcChange = (eventId) => {
      persistEvent(eventId);
      previewEvent(eventId);
    };

    return {
      soundsEnabled,
      volumePercent,
      volume,
      configurableEvents,
      soundOptions,
      prefs,
      handleToggleChange,
      handleVolumeChange,
      playTestSound,
      previewEvent,
      handleEventToggle,
      handleEventVolumeChange,
      handleSrcChange,
    };
  },
};
</script>

<style scoped>
.sounds-settings {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-header h3 {
  color: var(--color-text);
  font-size: 1.3em;
  font-weight: 600;
  margin: 0 0 8px 0;
}

.settings-description {
  color: var(--color-text-muted);
  font-size: 0.95em;
  margin: 0;
  opacity: 0.8;
}

.sound-controls {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.control-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: rgba(var(--primary-rgb), 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  transition: all 0.2s ease;
  gap: 20px;
}

.control-row.master-control {
  border-color: rgba(var(--primary-rgb), 0.3);
  background: rgba(var(--primary-rgb), 0.08);
}

.control-row.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.control-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.control-label {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  font-size: 1em;
  font-weight: 600;
}

.control-label i {
  color: var(--color-primary);
  font-size: 0.9em;
  width: 18px;
  text-align: center;
}

.control-description {
  color: var(--color-text-muted);
  font-size: 0.85em;
  margin: 0;
  opacity: 0.8;
}

/* Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 52px;
  height: 28px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(127, 129, 147, 0.3);
  transition: 0.3s;
  border-radius: 28px;
  border: 1px solid var(--terminal-border-color);
}

.slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: var(--color-text-muted);
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

input:checked + .slider:before {
  transform: translateX(24px);
  background-color: var(--color-white);
}

/* Volume Control */
.volume-control {
  flex-shrink: 0;
  width: 200px;
}

.volume-slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: rgba(127, 129, 147, 0.2);
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.5);
  transition: all 0.2s ease;
}

.volume-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 12px rgba(var(--primary-rgb), 0.8);
}

.volume-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  border: none;
  box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.5);
  transition: all 0.2s ease;
}

.volume-slider::-moz-range-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 12px rgba(var(--primary-rgb), 0.8);
}

.volume-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Test Button */
button.test-button {
  padding: 10px 20px;
  background: var(--color-primary);
  color: var(--color-white) !important;
  border: none;
  border-radius: 6px;
  font-size: 0.9em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.test-button:hover:not(:disabled) {
  background: rgba(var(--primary-rgb), 0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3);
}

.test-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.test-button i {
  font-size: 0.85em;
}

/* Per-event rows */
.section-title {
  color: var(--color-text);
  font-size: 0.95em;
  font-weight: 600;
  margin: 8px 0 0 0;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.7;
}

.event-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

/* Layout only. CustomSelect owns the control's chrome. */
.sound-select {
  width: 150px;
  height: 32px;
  font-size: 0.85em;
}

.event-volume {
  width: 130px;
}

/* A live value, not a caption: it reads at body contrast, and reserves the
   width of its widest string so the controls beside it never shift. */
.event-volume-readout {
  color: var(--color-text);
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
  min-width: 4ch;
  text-align: right;
}

button.preview-button {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary) !important;
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
  padding: 0;
}

.preview-button:hover:not(:disabled) {
  background: var(--color-primary);
  color: var(--color-white) !important;
}

.preview-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.preview-button i {
  font-size: 0.75em;
}

@media (max-width: 640px) {
  .event-row {
    flex-direction: column;
    align-items: stretch;
  }

  .event-controls {
    justify-content: space-between;
  }

  .sound-select {
    max-width: none;
    flex: 1;
  }
}

/* Info Card */
.sound-info {
  margin-top: 8px;
}

.info-card {
  display: flex;
  gap: 16px;
  padding: 16px;
  background: rgba(var(--blue-rgb), 0.1);
  border: 1px solid rgba(var(--blue-rgb), 0.3);
  border-radius: 8px;
}

.info-card i {
  color: var(--color-blue);
  font-size: 1.2em;
  flex-shrink: 0;
  margin-top: 2px;
}

.info-content h4 {
  color: var(--color-text);
  font-size: 0.95em;
  font-weight: 600;
  margin: 0 0 6px 0;
}

.info-content p {
  color: var(--color-text-muted);
  font-size: 0.85em;
  line-height: 1.5;
  margin: 0;
  opacity: 0.9;
}
</style>
