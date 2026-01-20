<template>
  <div class="terminal-container" @click.self="handleContainerClick" tabindex="0" @keydown.self="handleContainerKeydown">
    <div v-if="showInitialNarration && !showTerminal" class="narration">
      {{ narrationText }}
    </div>
    <div
      v-if="showTerminal"
      class="terminal-screen"
      :class="{ 'glitch-active': isGlitching && showGlitch }"
      ref="terminalScreenRef"
      @click.self="handleContainerClick"
    >
      <div class="scanline-overlay"></div>
      <!-- Default slot for the specific screen content -->
      <slot></slot>
    </div>
  </div>
  <SongPlayer />
</template>

<script>
import { ref, onMounted, watch, nextTick, onUnmounted, provide } from 'vue';
import SongPlayer from '@/views/Terminal/_components/SongPlayer.vue';

export default {
  name: 'TerminalLayout',
  components: { SongPlayer },
  props: {
    showInitialNarration: {
      type: Boolean,
      default: false,
    },
    narrationText: {
      type: String,
      default: 'Initializing...',
    },
    initialDelay: {
      type: Number,
      default: 50, // Default minimal delay if narration is off
    },
    showGlitch: {
      type: Boolean,
      default: true,
    },
    soundEnabled: {
      type: Boolean,
      default: true,
    },
  },
  emits: ['focus-request', 'terminal-ready'], // Declare emitted events
  setup(props, { emit }) {
    const showTerminal = ref(false);
    const isGlitching = ref(false);
    const glitchDuration = 1000;
    const terminalScreenRef = ref(null);
    const hasUserInteracted = ref(false); // To track user interaction
    const currentAudio = ref(null); // Track currently playing audio

    // --- Mobile Detection ---
    const isMobile = ref(false);
    const checkMobile = () => {
      isMobile.value = window.innerWidth <= 800; // Breakpoint at 800px
    };

    provide('isMobile', isMobile);

    // --- Sound Effects ---
    const sounds = {
      buttonClick: '/sounds/mouse-click.mp3',
      shutterClick: '/sounds/shutter-click.mp3',
      typewriterKeyPress: '/sounds/typewriter-keypress.mp3',
      chaChingMoney: '/sounds/cha-ching-money.mp3',
      getOuttaHereNerd: '/sounds/go-on-nerd-go-outside.mp3',
      // Add other sounds here like:
      // keyPress: '/sounds/key-press.mp3',
      // notification: '/sounds/notification.mp3',
    };

    const setInteracted = () => {
      if (!hasUserInteracted.value) {
        hasUserInteracted.value = true;
        // console.log("User interaction detected. Sounds are now operational.");
      }
    };

    const playSound = (soundName, volume = null) => {
      // Check localStorage for sound settings
      const savedEnabled = localStorage.getItem('soundsEnabled');
      const soundsEnabled = savedEnabled === null ? true : savedEnabled === 'true';

      // console.log(`playSound: ${soundName}, volume: ${volume}, interacted: ${hasUserInteracted.value}, enabled: ${soundsEnabled}`);

      if (!soundsEnabled || !props.soundEnabled) {
        // console.log('Sound is disabled.');
        return;
      }

      if (!hasUserInteracted.value) {
        // console.warn(`Sound "${soundName}" suppressed: User interaction pending.`);
        return; // Suppress sound if no interaction yet
      }

      const soundPath = sounds[soundName];
      if (!soundPath) {
        console.warn(`Sound "${soundName}" not found.`);
        return;
      }

      try {
        // Stop any currently playing sound
        if (currentAudio.value) {
          currentAudio.value.pause();
          currentAudio.value.currentTime = 0;
          currentAudio.value = null;
        }

        const audio = new Audio(soundPath);

        // Get saved volume or use provided/default
        const savedVolume = localStorage.getItem('soundVolume');
        let finalVolume;

        if (volume !== null && typeof volume === 'number' && volume >= 0 && volume <= 1) {
          // Use provided volume
          finalVolume = volume;
        } else if (savedVolume !== null) {
          // Use saved volume
          finalVolume = parseFloat(savedVolume);
        } else {
          // Use default
          finalVolume = 0.3;
        }

        audio.volume = finalVolume;

        // Track this audio as the current one
        currentAudio.value = audio;

        // Clear the reference when the sound finishes
        audio.addEventListener('ended', () => {
          if (currentAudio.value === audio) {
            currentAudio.value = null;
          }
        });

        audio.play().catch((error) => {
          // This catch handles errors other than NotAllowedError post-interaction
          console.warn(`Could not play sound "${soundName}" (post-interaction attempt):`, error);
          // Clear the reference on error
          if (currentAudio.value === audio) {
            currentAudio.value = null;
          }
        });
      } catch (error) {
        console.error(`Error creating or playing sound "${soundName}":`, error);
      }
    };

    // --- Global Click Handler for Any Element with data-sound ---
    const handleGlobalButtonClick = (event) => {
      setInteracted(); // Mark interaction

      // First check if the clicked element itself has data-sound
      let elementWithSound = event.target.hasAttribute('data-sound') ? event.target : null;

      // If not, check if any parent element has data-sound
      if (!elementWithSound) {
        elementWithSound = event.target.closest('[data-sound]');
      }

      if (elementWithSound) {
        const soundName = elementWithSound.getAttribute('data-sound');
        if (soundName) {
          playSound(soundName);
        }
        return; // Exit early if we found and played a sound
      }

      // Fallback: Check if it's a button without data-sound attribute
      const button = event.target.closest('button');
      if (button && !button.hasAttribute('data-sound')) {
        // Default to buttonClick for buttons without explicit sound
        playSound('buttonClick');
      }
    };

    const handleContainerClick = (event) => {
      setInteracted(); // Mark interaction
      // Only emit focus request if clicking directly on the container or terminal screen
      // not on any child elements
      // if (event.target === event.currentTarget) {
      //   emit('focus-request');
      // }
    };

    const handleContainerKeydown = (event) => {
      setInteracted(); // Mark interaction
      // Only handle keydown if it's directly on the container
      if (event.target === event.currentTarget) {
        if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Enter') {
          emit('focus-request');
        }
      }
    };

    // Listen for sound settings changes
    const handleSoundSettingsChange = (event) => {
      const { enabled, volume } = event.detail;
      // Update soundEnabled prop would require parent component support
      // For now, we'll handle it via localStorage in playSound function
      console.log('Sound settings changed:', { enabled, volume });
    };

    onMounted(() => {
      checkMobile();
      window.addEventListener('resize', checkMobile);
      window.addEventListener('sounds-settings-changed', handleSoundSettingsChange);

      // Load saved sound settings
      const savedEnabled = localStorage.getItem('soundsEnabled');
      if (savedEnabled !== null) {
        // Settings will be checked in playSound function
        console.log('Loaded sound settings:', { enabled: savedEnabled === 'true' });
      }

      setTimeout(() => {
        showTerminal.value = true;
        // Add the global click listener once the terminal screen exists
        nextTick(() => {
          if (terminalScreenRef.value) {
            terminalScreenRef.value.addEventListener('click', handleGlobalButtonClick, true); // Use capture phase
          }
        });
      }, props.initialDelay);
    });

    // --- Lifecycle: Cleanup Listener ---
    onUnmounted(() => {
      window.removeEventListener('resize', checkMobile);
      if (terminalScreenRef.value) {
        terminalScreenRef.value.removeEventListener('click', handleGlobalButtonClick, true);
      }
    });

    // Watch for the terminal becoming visible
    watch(showTerminal, async (newValue) => {
      if (newValue) {
        if (props.showGlitch) {
          isGlitching.value = true;
          setTimeout(() => {
            isGlitching.value = false;
            emit('terminal-ready');
          }, glitchDuration);
        } else {
          await nextTick();
          emit('terminal-ready');
        }
      }
    });

    // --- Provide the playSound function to children ---
    provide('playSound', playSound);

    return {
      showTerminal,
      isGlitching,
      terminalScreenRef,
      handleContainerClick,
      handleContainerKeydown,
      // No need to return sound functions unless used in template
    };
  },
};
</script>

<style scoped>
@keyframes glitch {
  0% {
    transform: translate(0);
    opacity: 0.8;
  }
  10% {
    transform: translate(-3px, 2px);
    text-shadow: -2px 0 red, 2px 0 cyan;
  }
  20% {
    transform: translate(3px, -2px);
    text-shadow: -2px 0 blue, 2px 0 yellow;
  }
  30% {
    transform: translate(-2px, 1px) skewX(-5deg);
    opacity: 0.7;
  }
  40% {
    transform: translate(2px, -1px) skewX(5deg);
  }
  50% {
    transform: translate(0);
    opacity: 1;
    text-shadow: none;
  }
  60% {
    transform: translate(-3px, 2px) skewX(-5deg);
    filter: blur(0.5px);
    color: var(--color-red);
  }
  70% {
    transform: translate(3px, -2px) skewX(5deg);
    filter: blur(0);
  }
  80% {
    transform: translate(-1px, 1px);
  }
  90% {
    transform: translate(1px, -1px);
    color: #aaffaa;
  }
  100% {
    transform: translate(0);
    color: var(--color-green);
  }
}

.terminal-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: transparent; /* Base background */
  color: var(--color-green); /* Default text color for children */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--terminal-container-padding, 0);
  box-sizing: border-box;
  overflow: hidden;
  cursor: text; /* Indicate text input is possible */
  outline: none; /* Remove browser focus outline */
  user-select: text; /* Allow text selection */
}

.narration {
  color: var(--color-white);
  font-size: 1.5em;
  text-align: center;
  max-width: 80ch;
  line-height: 1.6;
  text-shadow: 0 0 5px rgba(255, 255, 255, 0.3);
}

.terminal-screen {
  width: 100%;
  height: 100%;
  padding: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  position: relative;
  user-select: text;
  overflow: hidden; /* Ensure no double scrollbars */
  /* max-width: var(--terminal-width);
  max-height: var(--terminal-height); */
  background-color: var(--color-background);
  border-radius: var(--terminal-screen-border-radius, 0);
  border: var(--terminal-screen-border, none);
  box-shadow: var(--terminal-screen-box-shadow, none);
}

.terminal-screen:focus {
  border: none;
}

.scanline-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(to bottom, rgba(36, 32, 32, 0.25) 50%, rgba(0, 0, 0, 0.5) 50%);
  background-size: 100% 4px;
  z-index: 2; /* Lower than content */
  pointer-events: none;
  border-radius: inherit;
  /* opacity: var(--terminal-screen-lines, 0); */
  opacity: 0; /* DISABLE FOR NOW */
}

/* Ensure slotted content is above the scanlines and can scroll */
:slotted(*) {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  user-select: text;
}

/* Global scrollbar styling */

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: rgba(25, 239, 131, 0.05);
  border-radius: 0;
}

::-webkit-scrollbar-thumb {
  background: rgba(25, 239, 131, 0.3);
  border-radius: 0;
  border: 2px solid rgba(25, 239, 131, 0.05);
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(25, 239, 131, 0.5);
}

/* Remove default browser scrollbar styles */
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(25, 239, 131, 0.3) transparent;
}

.terminal-screen .cursor {
  display: inline-block;
  width: 4px;
  height: 0.75em;
  background-color: var(--color-green, #19ef83);
  box-shadow: 0 0 5px var(--color-green, #19ef83);
  animation: blink 1s step-end infinite;
  margin-left: -8px;
  margin-bottom: -1px;
  vertical-align: baseline;
  position: relative;
  opacity: 1;
}

/* Ensure form elements are interactive */
input,
textarea,
select,
button {
  pointer-events: auto !important;
  user-select: text !important;
  cursor: auto !important;
}

/* Allow text selection in the terminal */
.terminal-line {
  user-select: text !important;
}

.terminal-container select.input {
  padding: 2px 12px 0px 12px !important;
}

body.dark input[type='text'],
body.dark input[type='number'],
body.dark textarea {
  color: var(--color-dull-white);
  background-color: rgba(0, 10, 0, 0.3);
  border-color: rgba(18, 224, 255, 0.1);
}

body.dark label,
body.dark .label {
  color: var(--color-green);
}
</style>

<style>
div#left-sidebar {
  display: none !important;
}
</style>
