<template>
  <div class="field-group wide-group" :class="{ 'locked-section': !isPro }">
    <SimpleModal ref="simpleModal" />
    <div class="theme-selector-group">
      <h3 style="margin-bottom: 12px">
        Custom Theme
        <span v-if="!isPro" class="pro-badge-label"> <i class="fas fa-lock"></i> PRO </span>
      </h3>

      <div class="theme-options" :class="{ locked: !isPro }">
        <Tooltip
          v-for="theme in availableThemes"
          :key="theme.id"
          :text="isPro ? `Switch to ${theme.name} theme` : 'Upgrade to PRO to unlock theme customization'"
          width="auto"
        >
          <button
            @click="isPro ? selectTheme(theme.id) : null"
            class="theme-option"
            :class="{ active: currentTheme === theme.id, disabled: !isPro }"
            :disabled="!isPro"
          >
            <i :class="theme.icon"></i>
            <span class="theme-name">{{ theme.name }}</span>
            <i v-if="!isPro" class="fas fa-lock lock-icon"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- Font Selector -->
    <div class="sf-row" :class="{ locked: !isPro }">
      <label>Font</label>
      <select :value="fontFamily" @change="isPro ? setFontFamily($event.target.value) : null" :disabled="!isPro">
        <option value="sans">Sans-serif</option>
        <option value="mono">Monospace</option>
      </select>
    </div>

    <!-- Scale Slider -->
    <div class="sf-row" :class="{ locked: !isPro }">
      <label
        >Scale <span class="value-badge">{{ uiScale }}%</span></label
      >
      <div class="slider-notched">
        <input type="range" min="75" max="125" step="25" :value="uiScale" @input="handleScaleInput" :disabled="!isPro" />
        <div class="slider-ticks">
          <span class="slider-tick" style="left: 0%">75</span>
          <span class="slider-tick" style="left: 50%">100</span>
          <span class="slider-tick" style="left: 100%">125</span>
        </div>
      </div>
    </div>

    <!-- Mode Toggles -->
    <div class="mode-toggle-group" :class="{ locked: !isPro }">
      <Tooltip
        :text="
          isPro ? (useCustomBackground ? 'Disable Custom Background' : 'Enable Custom Background') : 'Upgrade to PRO to unlock custom backgrounds'
        "
        width="auto"
      >
        <button
          @click="isPro ? toggleUseCustomBackground() : null"
          class="mode-toggle custom-bg-toggle"
          :class="{ active: useCustomBackground, disabled: !isPro }"
          :disabled="!isPro"
        >
          <i class="fas fa-image"></i>
          <span class="toggle-label">Custom Background</span>
          <i v-if="!isPro" class="fas fa-lock lock-icon"></i>
        </button>
      </Tooltip>
      <Tooltip :text="isPro ? (isGreyscaleMode ? 'Disable Greyscale' : 'Enable Greyscale') : 'Upgrade to PRO to unlock greyscale mode'" width="auto">
        <button
          @click="isPro ? toggleGreyscaleMode() : null"
          class="mode-toggle greyscale-toggle"
          :class="{ active: isGreyscaleMode, disabled: !isPro }"
          :disabled="!isPro"
        >
          <i class="fas fa-adjust"></i>
          <span class="toggle-label">Greyscale</span>
          <i v-if="!isPro" class="fas fa-lock lock-icon"></i>
        </button>
      </Tooltip>
    </div>

    <!-- Background settings (only when custom bg is on) -->
    <div v-if="useCustomBackground && isPro" class="background-settings">
      <!-- Background Media Upload -->
      <div class="sf-row">
        <label>Background</label>
        <div class="sf-upload">
          <button type="button" class="sf-upload-btn" @click="$refs.fileInput.click()">Choose File</button>
          <span class="sf-upload-name">{{ bgFileName }}</span>
          <button v-if="currentThemeBackgroundImage" type="button" class="sf-upload-clear" @click="removeBackgroundImage">&times;</button>
        </div>
        <input ref="fileInput" type="file" accept="image/*,video/*" @change="handleMediaUpload" style="display: none" />
      </div>

      <!-- Background Preview -->
      <div class="sf-row" v-if="currentThemeBackgroundImage">
        <label></label>
        <div class="current-background">
          <video v-if="isVideoBackground" :src="currentThemeBackgroundImage" class="background-preview" autoplay loop muted></video>
          <img v-else :src="currentThemeBackgroundImage" alt="Current background" class="background-preview" />
        </div>
      </div>

      <!-- Opacity Slider -->
      <div class="sf-row">
        <label
          >Opacity <span class="value-badge">{{ bgOpacity }}%</span></label
        >
        <input type="range" min="50" max="100" step="1" :value="bgOpacity" @input="setBgOpacity(parseInt($event.target.value))" />
      </div>

      <!-- Blur Slider -->
      <div class="sf-row">
        <label
          >Blur <span class="value-badge">{{ bgBlur }}px</span></label
        >
        <input type="range" min="0" max="20" step="1" :value="bgBlur" @input="setBgBlur(parseInt($event.target.value))" />
      </div>
    </div>

    <div v-if="!isPro" class="locked-overlay">
      <i class="fas fa-lock"></i>
      <p>Upgrade to PRO to unlock</p>
    </div>
  </div>
</template>

<script>
import { mapActions, mapGetters } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ThemeSelector',
  components: {
    SimpleModal,
    Tooltip,
  },
  data() {
    return {
      availableThemes: [
        { id: 'dark', name: 'Dark', icon: 'fas fa-moon' },
        { id: 'cyberpunk', name: 'Cyberpunk', icon: 'fas fa-microchip' },
        { id: 'midnight', name: 'Midnight', icon: 'fas fa-star' },
        { id: 'ember', name: 'Ember', icon: 'fas fa-fire' },
        { id: 'nord', name: 'Nord', icon: 'fas fa-snowflake' },
        { id: 'hacker', name: 'Hacker', icon: 'fas fa-terminal' },
        { id: 'light', name: 'Light', icon: 'fas fa-sun' },
        { id: 'rose', name: 'Rose', icon: 'fas fa-heart' },
      ],
      bgFileName: 'No file',
    };
  },
  computed: {
    ...mapGetters('theme', [
      'currentTheme',
      'isGreyscaleMode',
      'currentThemeBackgroundImage',
      'useCustomBackground',
      'fontFamily',
      'uiScale',
      'bgOpacity',
      'bgBlur',
    ]),
    ...mapGetters('userAuth', ['planType']),
    isPro() {
      return this.planType !== 'free';
    },
    isVideoBackground() {
      if (!this.currentThemeBackgroundImage) return false;
      return this.currentThemeBackgroundImage.startsWith('data:video/');
    },
  },
  methods: {
    ...mapActions('theme', [
      'setTheme',
      'toggleGreyscaleMode',
      'toggleUseCustomBackground',
      'setCustomBackgroundImage',
      'removeCustomBackgroundImage',
      'setFontFamily',
      'setUiScale',
      'setBgOpacity',
      'setBgBlur',
    ]),
    selectTheme(themeId) {
      this.setTheme(themeId);
    },
    async handleMediaUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');

      if (!isImage && !isVideo) {
        await this.$refs.simpleModal.showModal({
          title: 'Invalid File Type',
          message: 'Please select a valid image or video file.',
          confirmText: 'OK',
          showCancel: false,
        });
        return;
      }

      const maxSize = isVideo ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > maxSize) {
        const maxSizeMB = isVideo ? '20MB' : '5MB';
        await this.$refs.simpleModal.showModal({
          title: 'File Too Large',
          message: `File is too large. Please select a ${isVideo ? 'video' : 'image'} smaller than ${maxSizeMB}.`,
          confirmText: 'OK',
          showCancel: false,
        });
        return;
      }

      this.bgFileName = file.name;

      const reader = new FileReader();
      reader.onload = (e) => {
        this.setCustomBackgroundImage({
          theme: this.currentTheme,
          imageDataUrl: e.target.result,
        });
      };
      reader.readAsDataURL(file);

      event.target.value = '';
    },
    removeBackgroundImage() {
      this.removeCustomBackgroundImage(this.currentTheme);
      this.bgFileName = 'No file';
    },
    handleScaleInput(event) {
      if (!this.isPro) return;
      this.setUiScale(parseInt(event.target.value, 10));
    },
  },
};
</script>

<style scoped>
.field-group {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-left: 2px;
  position: relative;
}

.field-group.locked-section .theme-selector-group,
.field-group.locked-section .mode-toggle-group,
.field-group.locked-section .sf-row {
  pointer-events: none;
  user-select: none;
}

.theme-selector-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.theme-label {
  font-weight: 600;
  font-size: var(--font-size-sm);
  color: var(--color-med-navy);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

body.dark .theme-label {
  color: var(--color-dull-white);
}

.pro-badge-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--color-yellow);
  background: rgba(255, 215, 0, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 215, 0, 0.4);
  font-weight: 600;
  margin-left: 8px;
}

.theme-options {
  display: flex;
  flex-direction: row;
  gap: 8px;
  flex-wrap: wrap;
  position: relative;
}

.locked-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  background: rgba(0, 0, 0, 0.8);
  padding: 12px 16px;
  border-radius: 8px;
  border: 2px solid var(--color-yellow);
  pointer-events: all;
  z-index: 10;
  white-space: nowrap;
}

.locked-overlay i {
  font-size: 1.2em;
  color: var(--color-yellow);
  margin-right: 6px;
}

.locked-overlay p {
  margin: 0;
  color: #fff;
  font-weight: 600;
  font-size: 0.85em;
  display: inline;
}

.theme-option {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--color-light-navy);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 70px;
  height: 32px;
  font-size: var(--font-size-sm);
  position: relative;
}

.theme-option:hover:not(.disabled) {
  border-color: var(--color-med-navy);
  transform: translateY(-1px);
}

.theme-option.active {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-white);
}

.theme-option.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-ultra-light-navy);
}

.theme-option.disabled:hover {
  transform: none;
}

.theme-option i {
  font-size: 14px;
  flex-shrink: 0;
}

.lock-icon {
  font-size: 10px;
  margin-left: auto;
  color: var(--color-yellow);
}

.theme-name {
  font-size: var(--font-size-xs);
  font-weight: 500;
  white-space: nowrap;
}

/* ── Settings Rows ── */
.sf-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sf-row label {
  flex: 0 0 110px;
  font-size: var(--font-size-sm);
  letter-spacing: 0.5px;
  color: var(--color-med-navy);
  text-align: left;
}

.sf-row select {
  flex: 1;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-family: inherit;
  padding: 4px 8px;
  border-radius: 4px;
}

.sf-row select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.sf-row input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 4px;
  background: var(--color-darker-2);
  border: none;
  border-radius: 2px;
  padding: 0;
  cursor: pointer;
}

.sf-row input[type='range']::-webkit-slider-runnable-track {
  height: 4px;
  background: var(--color-darker-2);
  border-radius: 2px;
}

.sf-row input[type='range']::-moz-range-track {
  height: 4px;
  background: var(--color-darker-2);
  border-radius: 2px;
}

.sf-row input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  margin-top: -4px;
}

.sf-row input[type='range']::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-primary);
  border: none;
  cursor: pointer;
}

.value-badge {
  font-size: var(--font-size-xs);
  color: var(--color-primary);
  margin-left: 4px;
}

/* ── Scale Slider with Tick Marks ── */
.slider-notched {
  position: relative;
  flex: 1;
}

.slider-notched input[type='range'] {
  width: 100%;
}

.slider-ticks {
  display: none;
  position: relative;
  height: 12px;
  margin-top: 2px;
  margin-left: calc(12px / 2);
  margin-right: calc(12px / 2);
}

.slider-tick {
  position: absolute;
  font-size: var(--font-size-xs);
  color: var(--color-med-navy);
  /* transform: translateX(-50%); */
}

.slider-tick::before {
  content: '';
  display: block;
  width: 1px;
  height: 4px;
  background: var(--color-med-navy);
  margin: 0 auto 2px;
}

/* ── Upload Row ── */
.sf-upload {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sf-upload-btn {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  font-family: inherit;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.sf-upload-btn:hover {
  background: var(--color-darker-2);
  border-color: var(--color-primary);
}

.sf-upload-name {
  flex: 1;
  font-size: var(--font-size-xs);
  color: var(--color-med-navy);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sf-upload-clear {
  background: none;
  border: none;
  color: var(--color-med-navy);
  cursor: pointer;
  font-size: var(--font-size-lg);
  padding: 0 2px;
  font-family: inherit;
  transition: color 0.15s;
}

.sf-upload-clear:hover {
  color: var(--color-red);
}

/* ── Background Preview ── */
.current-background {
  position: relative;
  display: inline-block;
  max-width: 200px;
}

.background-preview {
  width: 100%;
  max-width: 200px;
  height: 80px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color);
}

.background-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ── Mode Toggles ── */
.mode-toggle-group {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  position: relative;
}

.mode-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  cursor: pointer;
  transition: all 0.2s ease;
  height: 32px;
  font-size: var(--font-size-sm);
  position: relative;
}

.mode-toggle:hover:not(.disabled) {
  border-color: var(--color-med-navy);
  transform: translateY(-1px);
}

.mode-toggle.active {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-white);
}

.mode-toggle.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mode-toggle.disabled:hover {
  transform: none;
}

.mode-toggle i {
  font-size: 14px;
  flex-shrink: 0;
}

.toggle-label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  white-space: nowrap;
}

.wide-group {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
}

/* ── Dark Theme ── */
body.dark .theme-option {
  border-color: var(--color-dull-navy);
  background: var(--color-ultra-dark-navy);
  color: var(--color-dull-white);
}

body.dark .theme-option:hover:not(.disabled) {
  border-color: var(--color-med-navy);
}

body.dark .theme-option.active {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-white);
}

body.dark .theme-option.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-ultra-dark-navy);
}

body.dark .mode-toggle {
  border-color: var(--color-dull-navy);
  color: var(--color-dull-white);
}

body.dark .mode-toggle:hover:not(.disabled) {
  background: var(--color-ultra-dark-navy);
}

body.dark .mode-toggle.active {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: var(--color-white);
}

body.dark .mode-toggle.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

body.dark .sf-row label {
  color: var(--color-med-navy);
}

/* ── Cyberpunk overrides ── */
body.dark.cyberpunk .theme-option {
  background: rgba(0, 0, 0, 0.3);
  border-color: var(--color-dull-navy);
}

body.dark.cyberpunk .theme-option:hover:not(.disabled) {
  background: rgba(0, 0, 0, 0.5);
  border-color: var(--color-primary);
}

body.dark.cyberpunk .theme-option.active {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

body.dark.cyberpunk .theme-option.disabled {
  opacity: 0.5;
  background: rgba(0, 0, 0, 0.3);
}

body.dark.cyberpunk .mode-toggle {
  background: rgba(0, 0, 0, 0.3);
  border-color: var(--color-dull-navy);
}

body.dark.cyberpunk .mode-toggle:hover:not(.disabled) {
  background: rgba(0, 0, 0, 0.3);
}

body.dark.cyberpunk .mode-toggle.active {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

body.dark.cyberpunk .mode-toggle.disabled {
  opacity: 0.5;
  background: rgba(0, 0, 0, 0.3);
}
</style>
