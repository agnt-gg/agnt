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

    <div class="mode-toggle-group" :class="{ locked: !isPro }">
      <Tooltip
        :text="isPro ? (useCustomBackground ? 'Disable Custom Background' : 'Enable Custom Background') : 'Upgrade to PRO to unlock custom backgrounds'"
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
      <Tooltip
        :text="isPro ? (isGreyscaleMode ? 'Disable Greyscale' : 'Enable Greyscale') : 'Upgrade to PRO to unlock greyscale mode'"
        width="auto"
      >
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

    <div v-if="!isPro" class="locked-overlay">
      <i class="fas fa-lock"></i>
      <p>Upgrade to PRO to unlock</p>
    </div>

    <div class="background-image-group" v-if="useCustomBackground && isPro">
      <label class="theme-label">Background Media</label>
      <div class="background-controls">
        <div class="current-background" v-if="currentThemeBackgroundImage">
          <video v-if="isVideoBackground" :src="currentThemeBackgroundImage" class="background-preview" autoplay loop muted></video>
          <img v-else :src="currentThemeBackgroundImage" alt="Current background" class="background-preview" />
          <Tooltip text="Remove background media" width="auto">
            <button @click="removeBackgroundImage" class="remove-bg-btn">
              <i class="fas fa-times"></i>
            </button>
          </Tooltip>
        </div>
        <div class="upload-controls">
          <input ref="fileInput" type="file" accept="image/*,video/*" @change="handleMediaUpload" class="file-input" style="display: none" />
          <Tooltip text="Upload background image or video" width="auto">
            <button @click="$refs.fileInput.click()" class="upload-btn">
              <i class="fas fa-upload"></i>
              <span class="upload-label">{{ currentThemeBackgroundImage ? 'Change Media' : 'Upload Media' }}</span>
            </button>
          </Tooltip>
        </div>
      </div>
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
        // {
        //   id: 'light',
        //   name: 'Light',
        //   icon: 'fas fa-sun',
        // },
        {
          id: 'dark',
          name: 'Dark',
          icon: 'fas fa-moon',
        },
        {
          id: 'cyberpunk',
          name: 'Cyberpunk',
          icon: 'fas fa-microchip',
        },
      ],
    };
  },
  computed: {
    ...mapGetters('theme', ['currentTheme', 'isGreyscaleMode', 'currentThemeBackgroundImage', 'useCustomBackground']),
    ...mapGetters('userAuth', ['planType']),
    isPro() {
      return this.planType !== 'free';
    },
    isVideoBackground() {
      if (!this.currentThemeBackgroundImage) return false;
      // Check if the data URL indicates a video format
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
    ]),
    selectTheme(themeId) {
      this.setTheme(themeId);
    },
    async handleMediaUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      // Validate file type
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

      // Validate file size (max 5MB for images, 20MB for videos)
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

      const reader = new FileReader();
      reader.onload = (e) => {
        const mediaDataUrl = e.target.result;
        this.setCustomBackgroundImage({
          theme: this.currentTheme,
          imageDataUrl: mediaDataUrl,
        });
      };
      reader.readAsDataURL(file);

      // Clear the input so the same file can be selected again
      event.target.value = '';
    },
    removeBackgroundImage() {
      this.removeCustomBackgroundImage(this.currentTheme);
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
.field-group.locked-section .mode-toggle-group {
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
  color: #ffd700;
  background: rgba(255, 215, 0, 0.15);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 215, 0, 0.4);
  font-weight: 600;
  margin-left: 8px;
}

.pro-locked-message {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text);
  background: rgba(255, 215, 0, 0.05);
  border: 1px solid rgba(255, 215, 0, 0.2);
  border-radius: 8px;
  margin-top: 8px;
}

.pro-locked-message i {
  font-size: 3em;
  color: #ffd700;
  margin-bottom: 16px;
}

.pro-locked-message h4 {
  margin: 0 0 8px 0;
  color: var(--color-text);
  font-size: 1.2em;
}

.pro-locked-message p {
  margin: 0;
  color: var(--color-light-med-navy);
  font-size: 0.95em;
}

body.dark .pro-locked-message h4 {
  color: var(--color-dull-white);
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
  border: 2px solid #ffd700;
  pointer-events: all;
  z-index: 10;
  white-space: nowrap;
}

.locked-overlay i {
  font-size: 1.2em;
  color: #ffd700;
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
  /* background: var(--color-ultra-light-navy);
  color: var(--color-dark-navy); */
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 70px;
  height: 32px;
  font-size: var(--font-size-sm);
  position: relative;
}

.theme-option:hover:not(.disabled) {
  border-color: var(--color-med-navy);
  /* background: var(--color-white); */
  transform: translateY(-1px);
}

.theme-option.active {
  border-color: var(--color-pink);
  background: var(--color-pink);
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
  color: #ffd700;
}

.theme-name {
  font-size: var(--font-size-xs);
  font-weight: 500;
  white-space: nowrap;
}

/* Dark theme styles */
body.dark .theme-option {
  border-color: var(--color-dull-navy);
  background: var(--color-ultra-dark-navy);
  color: var(--color-dull-white);
}

body.dark .theme-option:hover:not(.disabled) {
  border-color: var(--color-med-navy);
}

body.dark .theme-option.active {
  border-color: var(--color-pink);
  background: var(--color-pink);
  color: var(--color-white);
}

body.dark .theme-option.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-ultra-dark-navy);
}

/* Greyscale toggle */
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
  border: 1px solid var(--color-light-navy);
  border-radius: 6px;
  /* background: var(--color-ultra-light-navy); */
  color: var(--color-dark-navy);
  cursor: pointer;
  transition: all 0.2s ease;
  height: 32px;
  font-size: var(--font-size-sm);
  position: relative;
}

.mode-toggle:hover:not(.disabled) {
  border-color: var(--color-med-navy);
  background: var(--color-white);
  transform: translateY(-1px);
}

.mode-toggle.active {
  border-color: var(--color-pink);
  background: var(--color-pink);
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

body.dark .mode-toggle {
  border-color: var(--color-dull-navy);
  color: var(--color-dull-white);
}

body.dark .mode-toggle:hover:not(.disabled) {
  background: var(--color-ultra-dark-navy);
}

body.dark .mode-toggle.active {
  border-color: var(--color-pink);
  background: var(--color-pink);
  color: var(--color-white);
}

body.dark .mode-toggle.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wide-group {
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
}

/* Background Image Upload Styles */
.background-image-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.background-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.current-background {
  position: relative;
  display: inline-block;
  max-width: 200px;
}

.background-preview {
  width: 100%;
  max-width: 200px;
  height: 100px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--color-light-navy);
}

.remove-bg-btn {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--color-light-navy);
  background: var(--color-white);
  color: var(--color-dark-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  transition: all 0.2s ease;
}

.remove-bg-btn:hover {
  background: var(--color-pink);
  color: var(--color-white);
  border-color: var(--color-pink);
}

.upload-controls {
  display: flex;
  align-items: center;
}

.upload-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--color-light-navy);
  border-radius: 6px;
  background: var(--color-ultra-light-navy);
  color: var(--color-dark-navy);
  cursor: pointer;
  transition: all 0.2s ease;
  height: 32px;
  font-size: var(--font-size-sm);
}

.upload-btn:hover {
  border-color: var(--color-med-navy);
  background: var(--color-white);
  transform: translateY(-1px);
}

.upload-btn i {
  font-size: 14px;
  flex-shrink: 0;
}

.upload-label {
  font-size: var(--font-size-xs);
  font-weight: 500;
  white-space: nowrap;
}

/* Dark theme styles for background upload */
body.dark .background-preview {
  border-color: var(--color-dull-navy);
}

body.dark .remove-bg-btn {
  border-color: var(--color-dull-navy);
  background: var(--color-ultra-dark-navy);
  color: var(--color-dull-white);
}

body.dark .remove-bg-btn:hover {
  background: var(--color-pink);
  color: var(--color-white);
  border-color: var(--color-pink);
}

body.dark .upload-btn {
  border-color: var(--color-dull-navy);
  background: var(--color-ultra-dark-navy);
  color: var(--color-dull-white);
}

body.dark .upload-btn:hover {
  border-color: var(--color-med-navy);
  background: var(--color-ultra-dark-navy);
}

/* Cyberpunk theme styles for background upload */
body.dark.cyberpunk .background-preview {
  border-color: var(--color-dull-navy);
}

body.dark.cyberpunk .remove-bg-btn {
  background: rgba(0, 0, 0, 0.3);
  border-color: var(--color-dull-navy);
  color: var(--color-dull-white);
}

body.dark.cyberpunk .remove-bg-btn:hover {
  background: var(--color-green);
  color: var(--color-black-navy);
  border-color: var(--color-green);
}

body.dark.cyberpunk .upload-btn {
  background: rgba(0, 0, 0, 0.3);
  border-color: var(--color-dull-navy);
  color: var(--color-dull-white);
}

body.dark.cyberpunk .upload-btn:hover {
  background: rgba(0, 0, 0, 0.5);
  border-color: var(--color-green);
}

/* Cyberpunk theme styles */
body.dark.cyberpunk .theme-option {
  background: rgba(0, 0, 0, 0.3);
  border-color: var(--color-dull-navy);
  /* font-family: monospace; */
}

body.dark.cyberpunk .theme-option:hover:not(.disabled) {
  background: rgba(0, 0, 0, 0.5);
  border-color: var(--color-green);
}

body.dark.cyberpunk .theme-option.active {
  border-color: var(--color-green);
  background: var(--color-green);
  /* color: var(--color-black-navy); */
}

body.dark.cyberpunk .theme-option.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: rgba(0, 0, 0, 0.3);
}

body.dark.cyberpunk .mode-toggle {
  background: rgba(0, 0, 0, 0.3);
  border-color: var(--color-dull-navy);
  /* font-family: monospace; */
}

body.dark.cyberpunk .mode-toggle:hover:not(.disabled) {
  background: rgba(0, 0, 0, 0.3);
}

body.dark.cyberpunk .mode-toggle.active {
  border-color: var(--color-green);
  background: var(--color-green);
  /* color: var(--color-black-navy); */
}

body.dark.cyberpunk .mode-toggle.disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: rgba(0, 0, 0, 0.3);
}
</style>
