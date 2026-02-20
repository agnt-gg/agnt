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
import { ref, computed, inject, onMounted } from 'vue';

export default {
  name: 'SoundsSettings',
  setup() {
    const playSound = inject('playSound', () => {});
    const soundsEnabled = ref(true);
    const volumePercent = ref(30); // Default 30%

    // Computed volume (0-1 range)
    const volume = computed(() => volumePercent.value / 100);

    // Load settings from localStorage on mount
    onMounted(() => {
      const savedEnabled = localStorage.getItem('soundsEnabled');
      const savedVolume = localStorage.getItem('soundVolume');

      if (savedEnabled !== null) {
        soundsEnabled.value = savedEnabled === 'true';
      }

      if (savedVolume !== null) {
        volumePercent.value = parseFloat(savedVolume) * 100;
      }
    });

    const handleToggleChange = () => {
      localStorage.setItem('soundsEnabled', soundsEnabled.value.toString());

      // Emit event to update TerminalLayout
      window.dispatchEvent(
        new CustomEvent('sounds-settings-changed', {
          detail: { enabled: soundsEnabled.value, volume: volume.value },
        })
      );

      // Play a sound when enabling
      if (soundsEnabled.value) {
        playSound('buttonClick', volume.value);
      }
    };

    const handleVolumeChange = () => {
      localStorage.setItem('soundVolume', volume.value.toString());

      // Emit event to update TerminalLayout
      window.dispatchEvent(
        new CustomEvent('sounds-settings-changed', {
          detail: { enabled: soundsEnabled.value, volume: volume.value },
        })
      );
    };

    const playTestSound = () => {
      if (soundsEnabled.value) {
        playSound('chaChingMoney', volume.value);
      }
    };

    return {
      soundsEnabled,
      volumePercent,
      volume,
      handleToggleChange,
      handleVolumeChange,
      playTestSound,
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
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  transition: all 0.2s ease;
  gap: 20px;
}

.control-row.master-control {
  border-color: rgba(var(--green-rgb), 0.3);
  background: rgba(var(--green-rgb), 0.08);
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
  color: var(--color-green);
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
  background-color: var(--color-green);
  border-color: var(--color-green);
}

input:checked + .slider:before {
  transform: translateX(24px);
  background-color: var(--color-darker-3);
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
  background: var(--color-green);
  cursor: pointer;
  box-shadow: 0 0 8px rgba(var(--green-rgb), 0.5);
  transition: all 0.2s ease;
}

.volume-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 12px rgba(var(--green-rgb), 0.8);
}

.volume-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-green);
  cursor: pointer;
  border: none;
  box-shadow: 0 0 8px rgba(var(--green-rgb), 0.5);
  transition: all 0.2s ease;
}

.volume-slider::-moz-range-thumb:hover {
  transform: scale(1.2);
  box-shadow: 0 0 12px rgba(var(--green-rgb), 0.8);
}

.volume-slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Test Button */
.test-button {
  padding: 10px 20px;
  background: var(--color-green);
  color: var(--color-darker-3);
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
  background: rgba(var(--green-rgb), 0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
}

.test-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.test-button i {
  font-size: 0.85em;
}

/* Info Card */
.sound-info {
  margin-top: 8px;
}

.info-card {
  display: flex;
  gap: 16px;
  padding: 16px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
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
