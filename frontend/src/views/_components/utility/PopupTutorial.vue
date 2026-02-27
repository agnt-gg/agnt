<template>
  <div v-if="popupVisible" ref="popup" class="popup-tutorial" :style="popupStyle">
    <button @click="closeTutorial(true)" class="close-button">&times;</button>
    <h3>{{ currentStep.title }}</h3>
    <p>{{ currentStep.content }}</p>
    <div v-if="currentStep.media" class="media-container">
      <button v-if="currentStep.audioContent" @click="toggleAudio" class="audio-button">
        {{ isAudioPlaying ? '🔇' : '🔊' }}
      </button>
      <img v-if="currentStep.media.type === 'gif'" :src="currentStep.media.src" class="tutorial-media" />
      <video v-else-if="currentStep.media.type === 'video'" :src="currentStep.media.src" class="tutorial-media" autoplay loop muted playsinline />
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar" :style="{ width: progressPercentage }"></div>
    </div>
    <div v-if="!currentStep.hideButton" class="button-container">
      <button v-if="currentStepIndex > 0" @click="previousStep" class="back-button">Back</button>
      <button v-if="!currentStep.link" @click="nextStep" class="next-button">
        {{ currentStep.buttonText || 'Next' }}
      </button>
      <button v-else @click="handleLink" class="next-button">
        {{ currentStep.buttonText || 'Next' }}
      </button>
      <button v-if="currentStep.showSkipButton && !currentStep.enforceStep" @click="skipStep" class="skip-button">
        {{ currentStep.skipButtonText || 'Skip' }}
      </button>
    </div>
    <div v-if="!isCentered && !currentStep.hideArrow" :class="['popup-arrow', arrowClass]"></div>
  </div>
  <div v-if="highlightStyle" class="highlight-border" :style="highlightStyle"></div>
  <SimpleModal ref="modal" />
</template>

<script>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useStore } from 'vuex';
import { useCleanup } from '@/composables/useCleanup';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'PopupTutorial',
  components: { SimpleModal },
  props: {
    config: {
      type: Array,
      default: () => [],
    },
    startTutorial: {
      type: Boolean,
      default: false,
    },
    tutorialId: {
      type: String,
      required: true,
    },
    tourMode: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['close', 'navigate'],
  setup(props, { emit }) {
    const router = useRouter();
    const store = useStore();
    const cleanup = useCleanup();
    const popup = ref(null);
    const modal = ref(null);
    const currentStepIndex = ref(0);
    const popupVisible = ref(false);
    const popupStyle = ref({});
    const arrowClass = ref('');
    const isCentered = ref(false);
    const highlightStyle = ref(null);
    const completedSteps = ref([]);
    const isElectron = ref(false);
    const currentHighlightTargetElement = ref(null);
    const audio = ref(null);
    const isAudioPlaying = ref(false);

    const currentStep = computed(() => props.config[currentStepIndex.value] || {});
    const totalSteps = computed(() => props.config.length);
    const progressPercentage = computed(() => `${((currentStepIndex.value + 1) / totalSteps.value) * 100}%`);

    const showPopup = async () => {
      // Check if onboarding modal is showing - if so, don't show tours
      const shouldShowOnboarding = store.getters['userAuth/shouldShowOnboarding'];
      if (shouldShowOnboarding) {
        console.log('PopupTutorial: Onboarding modal is active. Not showing popup tutorial.');
        closeTutorial();
        return;
      }

      // Check if tours are enabled globally
      const toursEnabled = localStorage.getItem('tours_enabled');
      if (toursEnabled === 'false') {
        console.log('PopupTutorial: Tours are disabled globally. Not showing popup.');
        closeTutorial();
        return;
      }

      // Pre-check for out-of-bounds index
      if (currentStepIndex.value >= props.config.length) {
        console.warn('PopupTutorial: showPopup called with index out of bounds. Closing.', currentStepIndex.value);
        closeTutorial();
        return;
      }

      stopAudio();
      highlightStyle.value = null;
      window.removeEventListener('scroll', handleScroll, true);
      currentHighlightTargetElement.value = null;

      const step = currentStep.value;
      if (!step || Object.keys(step).length === 0) {
        console.warn('PopupTutorial: Current step is undefined or empty (after boundary check). Closing tutorial.');
        closeTutorial();
        return;
      }

      // Ensure popupVisible is true to attempt rendering
      if (!popupVisible.value) {
        popupStyle.value = {
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          visibility: 'hidden',
        };
      }
      popupVisible.value = true;

      let retries = 0;
      const maxRetries = 15;
      const retryDelay = 20;

      while (!popup.value && retries < maxRetries) {
        await new Promise((resolve) => cleanup.setTimeout(resolve, retryDelay));
        await nextTick();
        retries++;
      }

      if (!popup.value) {
        // Extended Debugging Here:
        const stepTitleForDebug = step ? step.title : 'STEP_IS_NULL_OR_UNDEFINED';
        console.error(`[DEBUG] Popup.value is null. Step Title: "${stepTitleForDebug}". Index: ${currentStepIndex.value}. Retries: ${retries}`);

        popupVisible.value = false; // Hide if ref failed

        if (!step) {
          console.error("[DEBUG] CRITICAL: 'step' object is null/undefined when popup.value is null. Forcing close.");
          closeTutorial();
          return;
        }

        const enforceStepValue = step.enforceStep;
        console.log(`[DEBUG] For step "${step.title}", about to check enforceStep. Value:`, enforceStepValue, `(Type: ${typeof enforceStepValue})`);

        if (enforceStepValue) {
          console.error(`[DEBUG] Enforced step path taken for "${step.title}" because step.enforceStep is TRUTHY. Halting on this step.`);
        } else {
          console.warn(`[DEBUG] Non-enforced step path taken for "${step.title}" because step.enforceStep is FALSY. Attempting to skip/move next.`);
          moveToNextStep(true); // This should lead to closeTutorial() if "Tour Complete!" is the current step
        }
        return; // Essential: Exit showPopup after handling popup.value failure
      }

      // From this point, popup.value should be available.

      if (!props.startTutorial) {
        popupVisible.value = false;
        return;
      }

      if (step.onBefore) {
        try {
          await step.onBefore();
          await nextTick();
        } catch (error) {
          console.error('PopupTutorial: Error in onBefore hook for step:', step.title, error);
        }
      }

      if (!props.startTutorial) {
        popupVisible.value = false;
        return;
      }

      // Moved playAudio call earlier, before async positioning logic
      if (step.audioContent) {
        playAudio();
      }

      currentHighlightTargetElement.value = null;
      let positioningSuccessful = true;

      if (step.position === 'center') {
        setCenteredPosition();
      } else {
        if (!popup.value) {
          console.error(`[DEBUG] Popup.value became null before setPositionRelativeToTarget for step:`, step.title);
          popupVisible.value = false;
          if (step.enforceStep) {
            console.error('[DEBUG] Halting on enforced step (popup.value null before setPositionRelativeToTarget):', step.title);
          } else {
            console.warn('[DEBUG] Skipping non-enforced step (popup.value null before setPositionRelativeToTarget):', step.title);
            moveToNextStep(true);
          }
          return;
        }
        positioningSuccessful = await setPositionRelativeToTarget(step);
      }

      if (!positioningSuccessful) {
        console.log(`[DEBUG] showPopup not proceeding for "${step.title}" as positioning indicated failure/skip.`);
        return;
      }

      // Final check for visibility and step validity before onActive/autoProgress
      if (popupVisible.value && props.startTutorial && currentStepIndex.value < props.config.length && popupStyle.value.visibility === 'visible') {
        if (step.onActive) {
          try {
            step.onActive();
          } catch (error) {
            console.error('PopupTutorial: Error in onActive hook for step:', step.title, error);
          }
        }

        if (step.autoProgress) {
          cleanup.setTimeout(nextStep, step.autoProgress);
        }
      } else if (props.startTutorial && currentStepIndex.value >= props.config.length) {
        // This case should ideally be handled by moveToNextStep directly leading to closeTutorial
        // Or by the pre-check at the top of showPopup
        console.warn('[DEBUG] At end of showPopup, index is out of bounds. Closing.', currentStepIndex.value);
        closeTutorial();
        return;
      } else if (props.startTutorial && popupStyle.value.visibility !== 'visible' && step.target && popupVisible.value) {
        console.warn(`[DEBUG] Popup not visible after positioning for step: "${step.title}". Target: ${step.target}`);
        if (!step.enforceStep) {
          console.warn(`[DEBUG] Non-enforced, not visible: Skipping "${step.title}".`);
          moveToNextStep(true);
        } else {
          console.error(`[DEBUG] Enforced, not visible: Halting on "${step.title}".`);
          popupVisible.value = false;
          highlightStyle.value = null;
        }
        return;
      } else if (props.startTutorial && !popupVisible.value) {
        console.log(`[DEBUG] Popup hidden at end of showPopup for step: "${step.title}".`);
        if (currentStepIndex.value < props.config.length && !step.enforceStep) {
          console.warn(`[DEBUG] Popup hidden, non-enforced: Attempting skip for "${step.title}".`);
          moveToNextStep(true);
          return;
        }
      }
    };

    const setCenteredPosition = () => {
      isCentered.value = true;
      popupStyle.value = {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        visibility: 'visible',
      };
      arrowClass.value = '';
      highlightStyle.value = null;
      window.removeEventListener('scroll', handleScroll, true);
      currentHighlightTargetElement.value = null;
    };

    const getTargetElement = (target) => {
      return document.querySelector(target);
    };

    const updateHighlightPosition = (currentElementRect) => {
      const targetRect =
        currentElementRect || (currentHighlightTargetElement.value ? currentHighlightTargetElement.value.getBoundingClientRect() : null);

      if (currentHighlightTargetElement.value && targetRect) {
        const computedStyle = window.getComputedStyle(currentHighlightTargetElement.value);
        let targetBorderRadius = computedStyle.borderRadius || '16px';
        let numericBorderRadius = parseFloat(targetBorderRadius);
        if (isNaN(numericBorderRadius) || numericBorderRadius < 16) {
          numericBorderRadius = 16;
        }

        highlightStyle.value = {
          top: `${targetRect.top - 8}px`,
          left: `${targetRect.left - 8}px`,
          width: `${targetRect.width + 8}px`,
          height: `${targetRect.height + 8}px`,
          zIndex: 998,
          borderRadius: `${numericBorderRadius}px`,
        };
      } else {
        highlightStyle.value = null;
      }
    };

    const updatePopupPosition = (currentElementRect) => {
      if (!popupVisible.value || !currentHighlightTargetElement.value || !popup.value || isCentered.value) {
        return;
      }

      const step = currentStep.value;
      if (!step || !step.target || step.position === 'center') return;

      const targetRect =
        currentElementRect || (currentHighlightTargetElement.value ? currentHighlightTargetElement.value.getBoundingClientRect() : null);
      if (!targetRect) return;

      // Ensure popup.value is available before calling getBoundingClientRect on it
      if (!popup.value) {
        console.warn('PopupTutorial: popup.value is null in updatePopupPosition. Skipping position update.');
        return;
      }
      const popupRect = popup.value.getBoundingClientRect();

      let top, left;
      const electronOffset = isElectron.value ? 40 : 0;

      switch (step.position) {
        case 'top':
          top = Math.max(targetRect.top - popupRect.height - 20, electronOffset);
          left = targetRect.left + (targetRect.width - popupRect.width) / 2;
          break;
        case 'bottom':
          top = Math.max(targetRect.bottom + 20, electronOffset);
          left = targetRect.left + (targetRect.width - popupRect.width) / 2;
          break;
        case 'left':
          top = Math.max(targetRect.top + (targetRect.height - popupRect.height) / 2, electronOffset);
          left = targetRect.left - popupRect.width - 20;
          break;
        case 'right':
          top = Math.max(targetRect.top + (targetRect.height - popupRect.height) / 2, electronOffset);
          left = targetRect.right + 20;
          break;
        default:
          return;
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (left < 0) left = 0;
      if (left + popupRect.width > viewportWidth) left = viewportWidth - popupRect.width;
      if (top < 0) top = 0;
      if (top + popupRect.height > viewportHeight) top = viewportHeight - popupRect.height;

      if (isElectron.value) {
        top = Math.max(top, electronOffset);
      }

      popupStyle.value = {
        ...popupStyle.value, // Preserve existing styles like visibility
        top: `${top}px`,
        left: `${left}px`,
      };
    };

    const handleScroll = () => {
      if (currentHighlightTargetElement.value && popup.value && !isCentered.value) {
        requestAnimationFrame(() => {
          if (currentHighlightTargetElement.value) {
            // Re-check in case element disappeared
            const targetRect = currentHighlightTargetElement.value.getBoundingClientRect();
            updateHighlightPosition(targetRect);
            updatePopupPosition(targetRect);
          } else {
            // If target disappeared during scroll, clear highlight and potentially popup
            highlightStyle.value = null;
            // Optionally, you might want to hide or re-evaluate popup here too
          }
        });
      }
    };

    const setPositionRelativeToTarget = async (step) => {
      isCentered.value = false;

      const targetElement = getTargetElement(step.target);

      if (!targetElement) {
        popupVisible.value = false;
        highlightStyle.value = null;
        window.removeEventListener('scroll', handleScroll, true);
        currentHighlightTargetElement.value = null;
        if (step.enforceStep) {
          await showMissingTargetAlert(step);
        } else {
          console.warn(`PopupTutorial: Target element "${step.target}" not found for step: "${step.title}". Skipping.`);
          moveToNextStep(true);
        }
        return;
      }

      currentHighlightTargetElement.value = targetElement;

      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

      await nextTick();

      if (!popup.value) {
        console.warn(
          `PopupTutorial: Popup element ref (popup.value) is null in setPositionRelativeToTarget for step: "${step.title}". Cannot measure.`
        );
        if (step.enforceStep) {
          console.error('PopupTutorial: Popup element rendering failed for an enforced step (popup.value is null). Not skipping.');
          popupVisible.value = false;
          highlightStyle.value = null;
          // No moveToNextStep(true) here for enforced steps
        } else {
          console.warn(`PopupTutorial: Popup element ref (popup.value) is null for non-enforced step: "${step.title}". Skipping.`);
          popupVisible.value = false;
          highlightStyle.value = null;
          moveToNextStep(true);
        }
        return;
      }

      const popupRect = popup.value.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();

      let top, left;
      const electronOffset = isElectron.value ? 40 : 0;

      switch (step.position) {
        case 'top':
          top = Math.max(targetRect.top - popupRect.height - 20, electronOffset);
          left = targetRect.left + (targetRect.width - popupRect.width) / 2;
          arrowClass.value = 'popup-arrow-bottom';
          break;
        case 'bottom':
          top = Math.max(targetRect.bottom + 20, electronOffset);
          left = targetRect.left + (targetRect.width - popupRect.width) / 2;
          arrowClass.value = 'popup-arrow-top';
          break;
        case 'left':
          top = Math.max(targetRect.top + (targetRect.height - popupRect.height) / 2, electronOffset);
          left = targetRect.left - popupRect.width - 20;
          arrowClass.value = 'popup-arrow-right';
          break;
        case 'right':
          top = Math.max(targetRect.top + (targetRect.height - popupRect.height) / 2, electronOffset);
          left = targetRect.right + 20;
          arrowClass.value = 'popup-arrow-left';
          break;
      }

      if (step.hideArrow) {
        arrowClass.value = 'popup-arrow-hidden';
      }

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (left < 0) left = 0;
      if (left + popupRect.width > viewportWidth) left = viewportWidth - popupRect.width;
      if (top < 0) top = 0;
      if (top + popupRect.height > viewportHeight) top = viewportHeight - popupRect.height;

      if (isElectron.value) {
        top = Math.max(top, electronOffset);
      }

      popupStyle.value = {
        top: `${top}px`,
        left: `${left}px`,
        visibility: 'visible',
      };

      updateHighlightPosition(targetRect); // Pass initial targetRect
      // updatePopupPosition is not strictly needed here as popupStyle is fully set
      // but handleScroll will take over if scrolling occurs.
      window.addEventListener('scroll', handleScroll, true);
    };

    const showMissingTargetAlert = async (step) => {
      popupVisible.value = false;
      highlightStyle.value = null;
      window.removeEventListener('scroll', handleScroll, true);
      currentHighlightTargetElement.value = null;

      await nextTick();

      const message = step.missingTargetMessage || 'Please complete the required action to continue.';
      await modal.value.showModal({
        title: 'Action Required',
        message,
        confirmText: 'Got it!',
        showCancel: false,
        confirmClass: 'btn-primary',
      });

      if (step.enforceStep) {
        currentStepIndex.value--;
      }

      cleanup.setTimeout(() => {
        showPopup();
      }, 1000);
    };

    const loadCompletedSteps = () => {
      const savedSteps = localStorage.getItem(`tutorial_${props.tutorialId}`);
      if (savedSteps) {
        completedSteps.value = JSON.parse(savedSteps);
      }
    };

    const saveCompletedStep = (stepIndex) => {
      if (!completedSteps.value.includes(stepIndex)) {
        completedSteps.value.push(stepIndex);
        localStorage.setItem(`tutorial_${props.tutorialId}`, JSON.stringify(completedSteps.value));
      }
    };

    const previousStep = async () => {
      stopAudio();
      if (currentStepIndex.value > 0) {
        let newIndex = currentStepIndex.value - 1;

        while (newIndex >= 0) {
          const step = props.config[newIndex];
          const targetElement = getTargetElement(step.target);

          if (targetElement || step.position === 'center') {
            currentStepIndex.value = newIndex;
            showPopup();
            break;
          } else if (step.enforceStep) {
            currentStepIndex.value = newIndex;
            await showMissingTargetAlert(step);
            break;
          } else {
            newIndex--;
          }
        }

        if (newIndex < 0) {
          closeTutorial();
        }

        completedSteps.value = completedSteps.value.filter((step) => step < currentStepIndex.value);
        localStorage.setItem(`tutorial_${props.tutorialId}`, JSON.stringify(completedSteps.value));
      }
    };

    const skipStep = () => {
      saveCompletedStep(currentStepIndex.value);
      moveToNextStep(true);
    };

    const nextStep = () => {
      saveCompletedStep(currentStepIndex.value);

      // Check for navigateToScreen property first
      if (currentStep.value.navigateToScreen) {
        console.log('[PopupTutorial] Emitting navigate event to:', currentStep.value.navigateToScreen);
        emit('navigate', currentStep.value.navigateToScreen);
        closeTutorial();
        return;
      }

      // Check for custom action
      if (currentStep.value.customAction && typeof currentStep.value.customAction === 'function') {
        currentStep.value.customAction();
        closeTutorial();
        return;
      }

      if (currentStep.value.simulateClick) {
        const targetElement = getTargetElement(currentStep.value.target);
        if (targetElement) {
          targetElement.click();
        }
      }

      moveToNextStep();
    };

    const moveToNextStep = (skipped = false) => {
      if (currentStep.value.link) {
        closeTutorial();
        router.push(currentStep.value.link);
      } else {
        do {
          currentStepIndex.value++;
        } while (currentStepIndex.value < props.config.length && completedSteps.value.includes(currentStepIndex.value));

        if (currentStepIndex.value >= props.config.length) {
          closeTutorial();
        } else {
          showPopup();
        }
      }
    };

    const handleLink = () => {
      if (currentStep.value.link) {
        saveCompletedStep(currentStepIndex.value);
        closeTutorial();
        router.push(currentStep.value.link);
      }
    };

    const startTutorial = () => {
      // Check if onboarding modal is showing - if so, don't start tours
      const shouldShowOnboarding = store.getters['userAuth/shouldShowOnboarding'];
      if (shouldShowOnboarding) {
        console.log('PopupTutorial: Onboarding modal is active. Not starting tutorial.');
        emit('close');
        return;
      }

      // Check if tours are enabled globally
      const toursEnabled = localStorage.getItem('tours_enabled');
      if (toursEnabled === 'false') {
        console.log('PopupTutorial: Tours are disabled globally. Not starting tutorial.');
        emit('close');
        return;
      }

      // Check if auto-start is enabled
      const autoStartTours = localStorage.getItem('tours_auto_start');
      if (autoStartTours === 'false' && !props.tourMode) {
        console.log('PopupTutorial: Auto-start tours is disabled. Not starting tutorial automatically.');
        emit('close');
        return;
      }

      currentStepIndex.value = 0;
      while (currentStepIndex.value < props.config.length && completedSteps.value.includes(currentStepIndex.value)) {
        currentStepIndex.value++;
      }

      if (currentStepIndex.value < props.config.length) {
        showPopup();
      } else {
        emit('close');
      }
    };

    const closeTutorial = (markComplete = false) => {
      // When the user explicitly dismisses (X button), mark all steps complete
      // so the tour won't restart on next visit
      if (markComplete && props.config.length > 0) {
        const allSteps = props.config.map((_, i) => i);
        localStorage.setItem(`tutorial_${props.tutorialId}`, JSON.stringify(allSteps));
        completedSteps.value = allSteps;
      }

      popupVisible.value = false;
      highlightStyle.value = null;
      stopAudio();
      window.removeEventListener('scroll', handleScroll, true);
      currentHighlightTargetElement.value = null;
      emit('close');
    };

    const playAudio = () => {
      if (!currentStep.value || !currentStep.value.audioContent) {
        // console.debug("playAudio: No current step or audioContent for current step:", currentStep.value ? currentStep.value.title : "N/A");
        return;
      }

      // Ensure any previous audio instance is properly handled/cleared
      if (audio.value) {
        audio.value.pause();
        audio.value.removeAttribute('src'); // More robust way to clear src
        audio.value.load(); // Reset internal state
        audio.value = null; // Allow it to be garbage collected
      }
      // console.debug(`playAudio: [${currentStep.value.title}] Attempting to play ${currentStep.value.audioContent}`);
      audio.value = new Audio(currentStep.value.audioContent);

      const playPromise = audio.value.play();

      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // console.debug(`playAudio: [${currentStep.value.title}] Playback started successfully.`);
            isAudioPlaying.value = true;
          })
          .catch((error) => {
            console.error(`playAudio: [${currentStep.value.title}] Error playing audio: ${error.name} - ${error.message}`, error);
            if (error.name === 'NotAllowedError') {
              console.warn(
                `playAudio: [${currentStep.value.title}] Autoplay was prevented by the browser. User interaction might be required for this step's audio. The speaker icon should still work.`
              );
            }
            isAudioPlaying.value = false;
          });
      }

      audio.value.onended = () => {
        // console.debug(`playAudio: [${currentStep.value.title}] Audio ended.`);
        isAudioPlaying.value = false;
      };

      audio.value.onerror = (e) => {
        console.error(`playAudio: [${currentStep.value.title}] Audio element error:`, e);
        if (e.target && e.target.error) {
          console.error(`playAudio: [${currentStep.value.title}] MediaError code: ${e.target.error.code}, message: ${e.target.error.message}`);
        }
        isAudioPlaying.value = false;
      };
    };

    const stopAudio = () => {
      if (audio.value) {
        // console.debug("stopAudio: Stopping and clearing audio.");
        audio.value.pause();
        audio.value.currentTime = 0;
        audio.value.removeAttribute('src'); // Clear src before nullifying
        audio.value.load(); // Important to reset after changing src or to stop download
        audio.value = null;
      }
      isAudioPlaying.value = false;
    };

    const toggleAudio = () => {
      if (isAudioPlaying.value) {
        stopAudio();
      } else {
        playAudio();
      }
    };

    watch(
      () => props.startTutorial,
      (newStartTutorial) => {
        // Check if onboarding modal is showing
        const shouldShowOnboarding = store.getters['userAuth/shouldShowOnboarding'];
        if (shouldShowOnboarding) {
          console.log('PopupTutorial: Onboarding modal is active. Not starting tutorial from watch.');
          closeTutorial();
          return;
        }

        // Check if tours are enabled before starting
        const toursEnabled = localStorage.getItem('tours_enabled');
        if (toursEnabled === 'false') {
          console.log('PopupTutorial: Tours are disabled globally. Not starting tutorial from watch.');
          closeTutorial();
          return;
        }

        if (newStartTutorial) {
          startTutorial();
        } else {
          closeTutorial();
        }
      },
      { immediate: true }
    );

    onMounted(() => {
      loadCompletedSteps();
      isElectron.value = window.electron !== undefined;
    });

    onUnmounted(() => {
      window.removeEventListener('scroll', handleScroll, true);
      stopAudio();
      currentHighlightTargetElement.value = null;
    });

    return {
      currentStep,
      popupVisible,
      popupStyle,
      arrowClass,
      isCentered,
      highlightStyle,
      previousStep,
      nextStep,
      handleLink,
      closeTutorial,
      popup,
      currentStepIndex,
      totalSteps,
      progressPercentage,
      isElectron,
      skipStep,
      modal,
      playAudio,
      stopAudio,
      toggleAudio,
      isAudioPlaying,
      currentHighlightTargetElement,
      handleScroll,
      updateHighlightPosition,
    };
  },
};
</script>

<style scoped>
.popup-tutorial {
  position: fixed;
  background-color: var(--color-popup, var(--color-background));
  border-radius: 16px;
  border: 3px solid var(--color-primary);
  padding: 16px;
  max-width: 360px;
  width: fit-content;
  z-index: 1000;
  transition: opacity 0.3s ease-in-out, top 0.4s ease-out, left 0.4s ease-out;
  z-index: 999;
}

.popup-tutorial h3 {
  margin-top: 0;
  margin-bottom: 8px;
  color: var(--color-text);
}
.popup-tutorial p {
  color: var(--color-text-muted);
  line-height: 1.35;
}
.button-container {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
}
.back-button {
  background-color: var(--terminal-muted-color);
  color: var(--color-text) !important;
  border: none;
  padding: 8px 15px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.3s ease;
}
.back-button:hover {
  background-color: var(--color-darker-2);
}
.next-button {
  background-image: linear-gradient(45deg, var(--color-secondary), var(--color-primary));
  color: var(--color-white) !important;
  border: none;
  padding: 8px 15px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.3s ease;
  text-decoration: none;
  display: inline-block;
  line-height: 100%;
}
.next-button:hover {
  background-color: var(--color-primary);
}
.close-button {
  position: absolute;
  top: 0px;
  right: 0px;
  padding: 3px 8px 8px 8px;
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--color-text-muted);
}
.close-button:hover {
  color: var(--color-text);
}
.popup-arrow {
  position: absolute;
  width: 0;
  height: 0;
  border-style: solid;
}
.popup-arrow-top {
  border-width: 0 10px 10px 10px;
  border-color: transparent transparent var(--color-primary) transparent;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
}
.popup-arrow-bottom {
  border-width: 10px 10px 0 10px;
  border-color: var(--color-primary) transparent transparent transparent;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
}
.popup-arrow-left {
  border-width: 10px 10px 10px 0;
  border-color: transparent var(--color-primary) transparent transparent;
  left: -10px;
  top: 50%;
  transform: translateY(-50%);
}
.popup-arrow-right {
  border-width: 10px 0 10px 10px;
  border-color: transparent transparent transparent var(--color-primary);
  right: -10px;
  top: 50%;
  transform: translateY(-50%);
}
.highlight-border {
  position: fixed;
  border: 4px solid var(--color-primary);
  pointer-events: none;
  transition: top 0.1s ease-out, left 0.1s ease-out, width 0.1s ease-out, height 0.1s ease-out, border-radius 0.3s ease-in-out;
}

.progress-bar-container {
  width: 100%;
  height: 6px;
  background-color: var(--terminal-muted-color);
  margin-top: 8px;
  border-radius: 4px;
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--color-secondary), var(--color-primary));
  transition: width 0.3s ease-in-out;
}
.skip-button {
  background-color: var(--terminal-muted-color);
  color: var(--color-text) !important;
  border: none;
  padding: 8px 15px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.3s ease;
  margin-left: 8px;
}
.skip-button:hover {
  background-color: var(--color-darker-2);
}
.media-container {
  position: relative;
  margin-top: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.tutorial-media {
  max-width: 100%;
  /* max-height: 200px; */
  border-radius: 4px;
  border: 1px solid var(--terminal-border-color);
}

.audio-button {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  margin-top: 4px;
  margin-left: 0px;
  color: var(--color-text);
  transition: color 0.3s ease;
}

.audio-button:hover {
  color: var(--color-primary);
}
</style>
