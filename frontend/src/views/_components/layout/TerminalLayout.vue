<template>
  <div class="terminal-container" @click.self="handleContainerClick" tabindex="0" @keydown.self="handleContainerKeydown">
    <!-- Background layer for custom images/videos -->
    <div id="bg-layer" v-if="hasBgLayer">
      <video
        v-if="bgType === 'video'"
        :src="bgSrc"
        autoplay
        loop
        muted
        playsinline
      ></video>
      <img
        v-else
        :src="bgSrc"
        alt=""
      />
    </div>

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
  <SimpleModal ref="authRedirectModal" />
</template>

<script>
import { ref, computed, onMounted, watch, nextTick, onUnmounted, provide } from 'vue';
import { useStore } from 'vuex';
import SongPlayer from '@/views/Terminal/_components/SongPlayer.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { getSoundEvent, resolveSound } from '@/services/soundPreferences';
import { isVoiceFloorHeld } from '@/voice/voiceFloor.js';

export default {
  name: 'TerminalLayout',
  components: { SongPlayer, SimpleModal },
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
    const store = useStore();
    const showTerminal = ref(false);
    const isGlitching = ref(false);
    const glitchDuration = 1000;
    const terminalScreenRef = ref(null);
    const hasUserInteracted = ref(false); // To track user interaction
    const currentAudio = ref(null); // Track currently playing audio
    const authRedirectModal = ref(null); // SimpleModal for auth-redirect notice

    // Map structured failure reasons (from authGuard / userAuth.classifyAuthError)
    // to user-facing copy. Transient failures keep their tone different from
    // definitive rejections so users do not panic over an outage.
    const AUTH_REASON_COPY = {
      no_token: {
        title: 'Sign in required',
        message: (from) => `You need to sign in to view ${from || 'that page'}.`,
      },
      http_401: {
        title: 'Session expired',
        message: (from) => `Your session is no longer valid. Sign in again to continue${from ? ` to ${from}` : ''}.`,
      },
      http_403: {
        title: 'Access denied',
        message: (from) => `Your account does not have access. Sign in with a different account or contact support${from ? ` (tried ${from})` : ''}.`,
      },
      unauthenticated_response: {
        title: 'Sign in required',
        message: (from) => `We could not confirm your sign-in. Please sign in again${from ? ` to continue to ${from}` : ''}.`,
      },
      http_5xx: {
        title: 'Sign-in service is down',
        message: (from) => `Our sign-in service is having trouble right now. Try again shortly${from ? ` (you were heading to ${from})` : ''}.`,
      },
      timeout: {
        title: 'Sign-in service is slow',
        message: (from) => `Sign-in is taking too long to respond. Try again in a moment${from ? ` (you were heading to ${from})` : ''}.`,
      },
      network_error: {
        title: 'Cannot reach sign-in service',
        message: (from) => `Check your internet connection and try again${from ? ` (you were heading to ${from})` : ''}.`,
      },
      unknown: {
        title: 'Sign in required',
        message: (from) => `Please sign in to continue${from ? ` to ${from}` : ''}.`,
      },
    };

    // Debounce repeated auth-redirect events (route guard fires per nav, can
    // stack while user clicks around). Track open state so we don't queue
    // duplicates while one is already open.
    let authModalOpen = false;
    const handleAuthRedirect = async (event) => {
      if (authModalOpen) return;
      const detail = event?.detail || {};
      const from = detail.from || '';
      const reason = detail.reason || 'unknown';

      // When there's simply no token (fresh visit or intentional logout),
      // skip the modal entirely — the auth guard already redirected to the
      // login page, so showing "You need to sign in" is just noise.
      if (reason === 'no_token') return;

      const copy = AUTH_REASON_COPY[reason] || AUTH_REASON_COPY.unknown;
      // Surface the structured detail in DevTools so admins debugging a stuck
      // user can see exactly which reason fired and any HTTP status / message.
      console.warn('[TerminalLayout] auth-redirect modal', detail);
      authModalOpen = true;
      try {
        // Token + user are cleared by createAuthGuard ONLY for definitive
        // rejections (401/403/etc.) — transient failures (5xx, network,
        // timeout) leave the token intact so users are not logged out by
        // an outage. The modal copy reflects which case occurred.
        await authRedirectModal.value?.showModal({
          title: copy.title,
          message: copy.message(from),
          confirmText: 'OK',
          showCancel: false,
        });
      } finally {
        authModalOpen = false;
      }
    };

    // --- Background Layer ---
    const useCustomBackground = computed(() => store.getters['theme/useCustomBackground']);
    const currentThemeBackgroundImage = computed(() => store.getters['theme/currentThemeBackgroundImage']);
    const currentBackgroundType = computed(() => store.getters['theme/currentBackgroundType']);
    const defaultBackgroundImage = computed(() => store.state.theme.defaultBackgroundImage);

    // True when the user's custom-background setting is on. A chat-set
    // background turns that setting on, so there is only the one condition.
    const backgroundLayerActive = computed(() => store.getters['theme/backgroundLayerActive']);

    const bgSrc = computed(() => {
      if (!backgroundLayerActive.value) return null;
      return currentThemeBackgroundImage.value || defaultBackgroundImage.value;
    });

    // The custom background type comes from the store (set when the Blob is loaded);
    // the default fallback image is always an image.
    const bgType = computed(() => {
      if (!bgSrc.value) return 'image';
      return currentThemeBackgroundImage.value ? currentBackgroundType.value || 'image' : 'image';
    });

    const hasBgLayer = computed(() => backgroundLayerActive.value && !!bgSrc.value);

    // Background set from a chat turn. chatUnified.js re-dispatches the
    // `appearance:background` frontend event here as a window event because the
    // background is global-scope, not chat-channel-scope.
    //
    // A null url means clear. Either way this goes through the same theme
    // actions the Settings panel uses, so the change is instant, persists
    // across reloads, and shows up in Settings — there is no second background
    // system for the assistant.
    const onAppearanceBackground = async (event) => {
      const detail = (event && event.detail) || {};
      try {
        if (!detail.url) {
          await store.dispatch('theme/clearAssistantBackground');
          return;
        }
        await store.dispatch('theme/applyAssistantBackground', {
          url: detail.url,
          type: detail.kind,
          fileName: detail.fileName,
        });
      } catch (error) {
        // Never let a background failure escape as an unhandled rejection — it
        // would surface as a generic app error with no hint of the cause.
        console.error('[TerminalLayout] failed to apply background:', error);
      }
    };
    onMounted(() => window.addEventListener('agnt:appearance-background', onAppearanceBackground));
    onUnmounted(() => window.removeEventListener('agnt:appearance-background', onAppearanceBackground));

    // --- Mobile Detection ---
    const isMobile = ref(false);
    const checkMobile = () => {
      isMobile.value = window.innerWidth <= 800; // Breakpoint at 800px
    };

    provide('isMobile', isMobile);

    // --- Sound Effects ---
    // The catalog and every enable/volume decision live in
    // `@/services/soundPreferences`, so Settings and playback can never
    // disagree about which sounds exist or how loud they should be.

    const setInteracted = () => {
      if (!hasUserInteracted.value) {
        hasUserInteracted.value = true;
        // console.log("User interaction detected. Sounds are now operational.");
      }
    };

    const playSound = (soundName, volume = null) => {
      if (!props.soundEnabled) return;

      /**
       * NOTHING IS PLAYED INTO AN OPEN MICROPHONE.
       *
       * A live voice session hears whatever comes out of the speakers. The
       * Realtime server treats any speech it hears as the user barging in and
       * truncates the assistant's own unplayed audio, so the completion chime
       * cut her off mid-sentence — and it fires at run completion, which is
       * exactly when she is most likely to still be talking, because speech
       * lags the text stream by seconds. See isVoiceFloorHeld.
       *
       * Every sound is suppressed, not just that one: they all reach the same
       * microphone, and a rule that lists which sounds are dangerous would have
       * to be updated by whoever adds the next one. During a voice session the
       * user is talking, not clicking, so there is nothing to lose.
       */
      if (isVoiceFloorHeld()) return;

      if (!hasUserInteracted.value) {
        // Suppress until the browser has an interaction to attach playback to.
        return;
      }

      // An unregistered id is a caller bug, not a user preference — say so.
      if (!getSoundEvent(soundName)) {
        console.warn(`Sound "${soundName}" not found.`);
        return;
      }

      // null means "stay silent": master off, this event off, or level zero.
      const resolved = resolveSound(soundName, volume);
      if (!resolved) return;

      try {
        // Stop any currently playing sound
        if (currentAudio.value) {
          currentAudio.value.pause();
          currentAudio.value.currentTime = 0;
          currentAudio.value = null;
        }

        const audio = new Audio(resolved.src);
        audio.volume = resolved.volume;

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
      window.addEventListener('auth-redirect', handleAuthRedirect);

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
      window.removeEventListener('sounds-settings-changed', handleSoundSettingsChange);
      window.removeEventListener('auth-redirect', handleAuthRedirect);
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
      hasBgLayer,
      bgSrc,
      bgType,
      authRedirectModal,
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
    color: var(--color-dull-white);
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
  /* NOT 100vh: this box is overflow:hidden and the composer is its bottom-most
     descendant, so any height above what is on screen deletes the composer.
     See --app-height in styles/base/_layout.css. */
  height: var(--app-height);
  background-color: transparent; /* Base background */
  color: var(--color-text, var(--color-dull-white)); /* Default text color for children */
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
  color: var(--text-primary);
  font-size: 1.5em;
  text-align: center;
  max-width: 80ch;
  line-height: 1.6;
  text-shadow: 0 0 5px rgba(255, 255, 255, 0.3);
}

/* ── Background Layer ── */
#bg-layer {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
}

#bg-layer img,
#bg-layer video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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
  background: var(--color-darker-0);
  border-radius: 0;
}

::-webkit-scrollbar-thumb {
  background: var(--color-duller-navy);
  border-radius: 0;
  border: 2px solid var(--color-darker-0);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-med-navy);
}

/* Remove default browser scrollbar styles */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-duller-navy) transparent;
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
  background-color: var(--color-darker-0);
  border-color: var(--terminal-border-color);
}

body.dark label,
body.dark .label {
  color: var(--color-med-navy);
}
</style>

<style>
div#left-sidebar {
  display: none !important;
}
</style>
