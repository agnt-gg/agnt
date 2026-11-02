<template>
  <!-- SimpleModal for confirmations - outside v-if so ref is always available -->
  <SimpleModal ref="modal" />

  <Transition name="modal-fade">
    <div v-if="show" class="onboarding-overlay" @click.self="handleSkip">
      <div class="onboarding-modal" role="dialog" aria-modal="true" aria-label="Set up AGNT">
        <button type="button" class="onboarding-close" aria-label="Skip setup" data-action="skip-setup" @click="handleSkip">×</button>

        <!-- The first run IS the setup: your AI, Google, your phone
             (FirstRunSetup, shared with AGNT One's first chat). Theme, display
             name and workspace folder all have defaults and live in Settings. -->
        <FirstRunSetup v-if="currentStepId === 'setup'" frame="modal" @finish="afterSetup" />

        <!-- Import from other AI tools: only when this machine has something
             worth offering, and reachable nowhere else. -->
        <div v-else-if="currentStepId === 'import'" class="step import-step">
          <h2>Bring your setup with you</h2>
          <p class="subtitle">You've already built things in other AI tools.</p>
          <HarnessImport :importer="harnessImport" />
        </div>

        <!-- Referral bonus: only for someone who joined through an invite. -->
        <div v-else-if="currentStepId === 'referral'" class="step referral-step">
          <div class="celebration-icon">🎉</div>
          <h2>30 days of AGNT Pro, free</h2>
          <p class="subtitle">You joined through an invite, so you can try AGNT Pro free for 30 days.</p>
          <div class="bonus-display">
            <div class="bonus-amount">+{{ referralBalance }} pts</div>
            <p class="bonus-label">Referral Score</p>
          </div>
          <p class="description">Start AGNT Pro any time and your first 30 days are free: unlimited agents, workflows and automations on this computer. Cloud hosting starts with your first paid month. Invite your own friends and each one who becomes a paying customer earns you a free month.</p>
        </div>

        <div v-if="currentStepId !== 'setup'" class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn-primary" data-action="next" @click="nextStep">{{ nextLabel }} →</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import FirstRunSetup from '@/views/_components/feature/FirstRunSetup.vue';
import HarnessImport from '@/components/HarnessImport.vue';
import { useHarnessImport } from '@/composables/useHarnessImport.js';
import { useJourney } from '@/composables/useJourney.js';

export default {
  name: 'OnboardingModal',
  components: { SimpleModal, FirstRunSetup, HarnessImport },
  props: {
    show: { type: Boolean, default: true },
  },
  emits: ['complete', 'skip'],
  setup(props, { emit }) {
    const store = useStore();
    const modal = ref(null);
    const journey = useJourney();

    // Owned here rather than inside HarnessImport, because whether the import
    // step EXISTS is this component's question and the answer lives in the
    // composable. A child cannot decide whether it should be rendered.
    const harnessImport = useHarnessImport();
    const referralBalance = computed(() => store.state.userStats?.referralBalance || 0);
    const connectedApps = computed(() => (store.getters['appAuth/connectedApps'] ?? store.state.appAuth?.connectedApps) || []);

    /**
     * The screens this run shows, in order. NAMED, NOT NUMBERED: the two
     * after the setup are conditional, and addressing steps by index is how a
     * conditional step once made a gate guard the wrong screen.
     */
    const steps = computed(() => {
      const list = ['setup'];
      if (harnessImport.hasAnythingToImport.value) list.push('import');
      if (referralBalance.value > 0) list.push('referral');
      return list;
    });
    const index = ref(0);
    const currentStepId = computed(() => steps.value[index.value] || 'setup');
    const isLast = computed(() => index.value >= steps.value.length - 1);
    // What the setup's done screen asked for; put in the composer at the end.
    const pendingAsk = ref(null);
    const nextLabel = computed(() => (!isLast.value ? 'Continue' : pendingAsk.value ? 'Ask Annie' : 'Start'));

    const complete = () => {
      const ask = pendingAsk.value;
      emit('complete', 'ChatScreen');
      // Opens the chat and types the request in; nothing is sent until Enter.
      if (ask) journey.usePrompt(ask);
    };
    const nextStep = () => {
      if (isLast.value) return complete();
      index.value += 1;
    };
    const afterSetup = ({ ask } = {}) => {
      pendingAsk.value = ask || null;
      nextStep();
    };

    const handleSkip = async () => {
      if (!modal.value) {
        console.error('Modal ref not available');
        return;
      }
      const hasProvider = connectedApps.value.length > 0;
      const message = hasProvider
        ? 'Are you sure you want to skip setup?<br/>You can always restart it from Tour Settings.'
        : 'You haven\'t connected an AI provider yet.<br/><br/>Chat, agents, and workflows <strong>won\'t work</strong> without one. You can add a provider later in Settings &gt; Connectors.';
      const confirmed = await modal.value.showModal({
        title: hasProvider ? 'Skip setup?' : 'Skip Without Provider?',
        message,
        confirmText: 'Skip Anyway',
        cancelText: 'Go Back',
        showCancel: true,
        confirmClass: 'btn-danger',
      });
      if (confirmed) emit('skip');
    };

    onMounted(() => {
      // Deliberately NOT awaited: a filesystem scan must never sit in front of
      // the setup. It resolves long before the step it controls is reached,
      // and to "nothing found" if it cannot answer.
      harnessImport.detect();
    });

    return {
      modal,
      steps,
      currentStepId,
      harnessImport,
      referralBalance,
      nextLabel,
      nextStep,
      afterSetup,
      handleSkip,
    };
  },
};
</script>

<style scoped>
.onboarding-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* --color-popup is a SURFACE token for dropdowns/popovers; in light mode it
     is rgba(255,255,255,0.98), so using it as a backdrop produced a white
     wash over a white app — no scrim, and the modal read as a card that had
     landed in the wrong place rather than a layer above. */
  background: var(--scrim);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99;
  padding: 20px;
}

/* --color-popup is translucent in several themes; layered over the solid page
   background it keeps its tint but stops the screen behind ghosting through
   (and content showing through the pinned action bar). */
.onboarding-modal {
  background: linear-gradient(var(--color-popup), var(--color-popup)), var(--color-background);
  border: 1px solid var(--terminal-border-color);
  border-radius: 24px;
  padding: 36px 40px 28px;
  max-width: 780px;
  width: 100%;
  max-height: 92vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
  position: relative;
}

.onboarding-close {
  position: absolute;
  top: 14px;
  right: 16px;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.onboarding-close:hover {
  background: var(--surface-hover);
  color: var(--color-text);
}

.step {
  text-align: center;
  width: 100%;
  padding-top: 12px;
}

.step h2 {
  font-size: 1.8em;
  margin: 12px 0;
  color: var(--color-text);
}

.subtitle {
  font-size: 1.1em;
  color: var(--color-text-muted);
  margin-bottom: 16px;
}

.description {
  font-size: 1em;
  color: var(--color-text-muted);
  opacity: 0.8;
  line-height: 1.6;
}

/* Referral Step */
.celebration-icon {
  font-size: 4em;
  margin-bottom: 16px;
  animation: bounce 1s ease-in-out;
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-20px);
  }
}

.bonus-display {
  background: rgba(var(--primary-rgb), 0.12);
  border: 2px solid var(--color-primary);
  border-radius: 16px;
  padding: 32px;
  margin: 24px 0;
}

.bonus-amount {
  font-size: 3em;
  font-weight: 700;
  color: var(--color-primary);
  margin-bottom: 8px;
}

.bonus-label {
  font-size: 1.1em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* Modal Actions: pinned to the bottom of the modal's scroll area, so the
   button stays in reach while a long import list scrolls under it. */
.modal-actions {
  position: sticky;
  bottom: -28px;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin: 32px -40px -28px;
  padding: 20px 40px 24px;
  border-top: 1px solid var(--color-darker-1);
  background: linear-gradient(var(--color-popup), var(--color-popup)), var(--color-background);
  border-radius: 0 0 24px 24px;
}

.spacer {
  flex: 1;
}

.btn-primary {
  padding: 12px 24px;
  border-radius: 999px;
  border: none;
  background: var(--color-primary);
  color: var(--on-fill-accent);
  font-family: var(--font-family-primary);
  font-size: 1em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(var(--primary-rgb), 0.3);
}

/* Transitions */
.modal-fade-enter-active {
  transition: opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-fade-leave-active {
  transition: opacity 0.25s ease-out;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .onboarding-modal {
  animation: modal-scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-fade-leave-active .onboarding-modal {
  animation: modal-scale-out 0.25s ease-out forwards;
}

@keyframes modal-scale-in {
  0% {
    transform: scale(0.95) translateY(10px);
    opacity: 0;
  }
  100% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

@keyframes modal-scale-out {
  0% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
  100% {
    transform: scale(0.97) translateY(8px);
    opacity: 0;
  }
}

@media (max-width: 768px) {
  .onboarding-modal {
    padding: 28px 18px 20px;
  }

  .modal-actions {
    margin: 24px -18px -20px;
    padding: 16px 18px 20px;
  }
}
</style>
