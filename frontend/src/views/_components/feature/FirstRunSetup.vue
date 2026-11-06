<!-- The first-run setup (services/firstRunSetup.js): connect your AI, then
     Google, then your phone. One component for both frames: Studio shows it
     in the onboarding modal, AGNT One in the first chat.

     Every connection goes through the pipeline the rest of the app uses, so
     nothing here signs in its own way: useAiProviderConnect for the AI (plans,
     keys and local models), useProviderConnection for Google, and the Text
     Annie card itself for the phone. -->
<template>
  <section class="frs" :class="`frs--${frame}`" data-testid="first-run-setup" :aria-busy="!ready">
    <SimpleModal ref="modal" />

    <div v-if="!ready" class="frs-loading" aria-hidden="true"><span></span><span></span><span></span></div>

    <template v-else>
      <p v-if="hello" class="frs-hello" data-testid="frs-hello">
        <img class="frs-hello-mark" src="/images/agnt-logo-mark.svg" alt="" />
        <span><template v-for="(part, i) in hello" :key="i"><b v-if="part.bold">{{ part.text }}</b><template v-else>{{ part.text }}</template></template></span>
      </p>

      <div class="frs-card">
        <!-- ── Where you are ─────────────────────────────────────────────── -->
        <ol v-if="view !== 'done'" class="frs-stepper" aria-label="Setup steps">
          <template v-for="(step, index) in SETUP_STEPS" :key="step.id">
            <li>
              <button
                type="button"
                class="frs-step"
                :class="{ 'is-current': view === step.id, 'is-done': status[step.id] }"
                :aria-current="view === step.id ? 'step' : undefined"
                :data-step-tab="step.id"
                @click="show(step.id)"
              >
                <span class="frs-num">
                  <svg v-if="status[step.id]" viewBox="0 0 24 24" aria-hidden="true"><path :d="CHECK" /></svg>
                  <template v-else>{{ index + 1 }}</template>
                </span>
                {{ step.label }}
                <span v-if="step.pro" class="frs-pro">Pro</span>
              </button>
            </li>
            <li v-if="index < SETUP_STEPS.length - 1" class="frs-bar" :class="{ 'is-done': status[step.id] }" aria-hidden="true"></li>
          </template>
        </ol>

        <!-- ── 1 · Your AI ──────────────────────────────────────────────── -->
        <div v-if="view === 'ai'" class="frs-body" data-step="ai">
          <template v-if="status.ai && !changingAi">
            <div class="frs-success" data-testid="frs-ai-connected">
              <span class="frs-logo frs-logo--xl"><SvgIcon :name="iconOf(activeAi)" /></span>
              <div>
                <h2 class="frs-success-title">
                  <span class="frs-ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="CHECK" /></svg></span>
                  {{ activeAiLabel }} is connected
                </h2>
                <p class="frs-success-sub">{{ activeAiIsPlan ? "I'll think with your plan from now on, at no extra charge." : `I'll think with ${activeAiLabel} from now on.` }}</p>
              </div>
            </div>
            <p v-if="otherAis.length" class="frs-also">
              Also connected:
              <span v-for="ai in otherAis" :key="ai.id" class="frs-chip"><span class="frs-mini"><SvgIcon :name="iconOf(ai)" /></span>{{ labelOf(ai) }}</span>
              <span class="frs-hint">· switch any time in the model picker</span>
            </p>
            <div class="frs-foot">
              <button type="button" class="frs-link" data-action="change-ai" @click="changingAi = true">Use a different AI</button>
              <button type="button" class="frs-btn frs-btn--accent" data-action="continue" :disabled="!!connecting" @click="continueFrom('ai')">Continue <span aria-hidden="true">→</span></button>
            </div>
          </template>

          <template v-else-if="!showKeys">
            <h2 class="frs-title">Connect your AI</h2>
            <p class="frs-lead">Sign in with the plan you already pay for. Usage is included, and AGNT never adds a charge.</p>
            <div class="frs-hero">
              <div v-for="plan in plans.hero" :key="plan.id" class="frs-plan" :data-provider="plan.id">
                <div class="frs-plan-head">
                  <span class="frs-logo frs-logo--lg"><SvgIcon :name="iconOf(plan)" /></span>
                  <div>
                    <div class="frs-plan-name">{{ labelOf(plan) }}</div>
                    <div class="frs-plan-sub">{{ HERO_PLAN_NAMES[plan.id] }}</div>
                  </div>
                </div>
                <button type="button" class="frs-btn frs-btn--ink frs-btn--block" :disabled="!!connecting" @click="signIn(plan)">
                  {{ connecting === plan.id ? 'Connecting…' : `Sign in with ${SIGN_IN_NAMES[plan.id] || labelOf(plan)}` }}
                </button>
              </div>
            </div>
            <template v-if="plans.more.length">
              <p class="frs-more-label">More plans that work</p>
              <div class="frs-more">
                <button v-for="plan in plans.more" :key="plan.id" type="button" class="frs-pill" :data-provider="plan.id" :disabled="!!connecting" @click="signIn(plan)">
                  <span class="frs-mini"><SvgIcon :name="iconOf(plan)" /></span>{{ connecting === plan.id ? 'Connecting…' : labelOf(plan) }}
                </button>
              </div>
            </template>
            <p class="frs-alt">
              No plan?
              <button type="button" class="frs-inline" data-action="api-key" @click="showKeys = true">Paste an API key</button>
              <span class="frs-tag">pay per token</span>
              <span class="frs-sep" aria-hidden="true">·</span>
              <button type="button" class="frs-inline" data-action="local" :disabled="!!connecting" @click="signIn(LOCAL_PROVIDER)">Run a model on this computer</button>
            </p>
            <div class="frs-foot">
              <button v-if="changingAi" type="button" class="frs-link" @click="changingAi = false">← Keep {{ activeAiLabel }}</button>
              <button v-else type="button" class="frs-link frs-link--flash" data-action="flash" @click="skip('ai')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="BOLT" /></svg>Start with AGNT Flash for now
              </button>
            </div>
          </template>

          <template v-else>
            <button type="button" class="frs-back" data-action="plans" @click="showKeys = false">← Sign in with a plan instead</button>
            <h2 class="frs-title">Paste an API key</h2>
            <p class="frs-lead">A developer account, billed by them for what you use. Separate from any subscription.</p>
            <ProviderLanes
              :providers="allProviders"
              :connected-ids="connectedApps"
              :codex-status="codexStatus"
              :active-id="selectedProvider"
              :show-lanes="['api']"
              :headings="false"
              dense
              @connect="signIn"
              @submit-credential="saveApiKey"
            />
            <div class="frs-foot">
              <button type="button" class="frs-link frs-link--flash" data-action="flash" @click="skip('ai')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="BOLT" /></svg>Start with AGNT Flash for now
              </button>
            </div>
          </template>
        </div>

        <!-- ── 2 · Google ───────────────────────────────────────────────── -->
        <div v-else-if="view === 'google'" class="frs-body" data-step="google">
          <template v-if="status.google">
            <div class="frs-success" data-testid="frs-google-connected">
              <span class="frs-logo frs-logo--xl frs-logo--plain" v-html="GOOGLE_G"></span>
              <div>
                <h2 class="frs-success-title">
                  <span class="frs-ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="CHECK" /></svg></span>
                  Google is connected
                </h2>
                <p class="frs-success-sub">Gmail, Calendar, Drive and the rest of your Google account are ready for me to work in.</p>
              </div>
            </div>
            <div class="frs-foot">
              <span></span>
              <button type="button" class="frs-btn frs-btn--accent" data-action="continue" @click="continueFrom('google')">Continue <span aria-hidden="true">→</span></button>
            </div>
          </template>
          <template v-else>
            <h2 class="frs-title">Connect Google</h2>
            <p class="frs-lead">Your mail, calendar and files in one sign-in, so I can work where your day already happens.</p>
            <div class="frs-gcard">
              <ul class="frs-suite">
                <li v-for="app in GOOGLE_SUITE" :key="app.label"><span class="frs-gicon"><SvgIcon :name="app.icon" /></span>{{ app.label }}</li>
              </ul>
              <button type="button" class="frs-btn frs-btn--google frs-btn--block" data-action="google" :disabled="connectingGoogle" @click="signInGoogle">
                <!-- eslint-disable-next-line vue/no-v-html -- static brand mark, never user data -->
                <span class="frs-g" v-html="GOOGLE_G"></span>{{ connectingGoogle ? 'Opening Google…' : 'Sign in with Google' }}
              </button>
              <p class="frs-fine frs-center">You choose what to allow on Google's screen. Disconnect any time from Apps.</p>
            </div>
            <p class="frs-try">Then try <span>“Summarize my unread emails from today”</span> · <span>“What is on my calendar this week?”</span></p>
            <p class="frs-fine">Not on Google? Microsoft 365, Slack, Notion, GitHub and more connect from Apps whenever you like.</p>
            <div class="frs-foot">
              <button type="button" class="frs-link" data-action="skip" @click="skip('google')">Skip for now</button>
            </div>
          </template>
        </div>

        <!-- ── 3 · Your phone ───────────────────────────────────────────── -->
        <div v-else-if="view === 'phone'" class="frs-body" data-step="phone">
          <h2 class="frs-title">Text Annie from your phone <span class="frs-pro frs-pro--lg">Pro</span></h2>
          <p class="frs-lead">Message me from iMessage, RCS or SMS. I answer from this AGNT, with its tools and models. No app to install.</p>
          <TextAnnieCard class="frs-phone" :show-header="false" @state="phoneState = $event" />
          <div class="frs-foot">
            <button v-if="!status.phone" type="button" class="frs-link" data-action="skip" @click="skip('phone')">{{ phoneOffered ? 'Skip for now' : 'Skip and finish setup' }}</button>
            <span v-else></span>
            <button v-if="status.phone" type="button" class="frs-btn frs-btn--accent" data-action="continue" @click="continueFrom('phone')">Finish <span aria-hidden="true">→</span></button>
          </div>
        </div>

        <!-- ── Done ─────────────────────────────────────────────────────── -->
        <div v-else class="frs-done" data-step="done">
          <img class="frs-done-mark" src="/images/agnt-logo-mark.svg" alt="" />
          <h2 class="frs-done-title">{{ everythingDone ? "You're all set." : "You're ready to go." }}</h2>
          <p class="frs-lead frs-center">{{ doneLead }}</p>
          <ul class="frs-ticks">
            <li v-for="step in SETUP_STEPS" :key="step.id">
              <span v-if="status[step.id]" class="frs-tick is-done">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="CHECK" /></svg>{{ tickLabel(step.id) }}
              </span>
              <button v-else type="button" class="frs-tick" :data-step-tab="step.id" @click="show(step.id)">Connect {{ tickLabel(step.id) }}</button>
            </li>
          </ul>
          <div class="frs-aha">
            <span class="frs-aha-kicker">{{ offer.kicker }}</span>
            <span class="frs-aha-title">{{ offer.title }}</span>
            <p class="frs-aha-text">{{ offer.text }}</p>
            <div class="frs-aha-actions">
              <button type="button" class="frs-btn frs-btn--accent" data-action="ask" @click="emit('finish', { ask: offer.prompt })">Ask Annie</button>
              <button type="button" class="frs-link" data-action="start" @click="emit('finish', { ask: null })">I'll take it from here</button>
            </div>
          </div>
          <p v-if="!everythingDone" class="frs-fine frs-center">Anything you skipped is a click away in Settings.</p>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import ProviderLanes from '@/components/ProviderLanes.vue';
import TextAnnieCard from '@/views/Terminal/CenterPanel/screens/Settings/components/PhoneAccessSection/TextAnnieCard.vue';
import { useAiProviderConnect } from '@/composables/useAiProviderConnect.js';
import { useProviderConnection } from '@/composables/useProviderConnection.js';
import { ownAiIds, readFacts } from '@/composables/useJourney.js';
import { LOCAL_PROVIDER, isSubscriptionProvider, providerLabel, resolveProviderKey } from '@/store/app/aiProvider.js';
import * as textAnnie from '@/services/textAnnieService.js';
import {
  HERO_PLAN_NAMES,
  SETUP_STEPS,
  SIGN_IN_NAMES,
  allDone,
  finishOffer,
  nextStep,
  phoneEligible,
  planTiles,
  setupStatus,
} from '@/services/firstRunSetup.js';
// nextStep: where Continue and Skip go. The first screen is decided on mount.

const props = defineProps({
  /** 'modal': the onboarding modal is the card. 'chat': the card sits in the first chat. */
  frame: { type: String, default: 'chat', validator: (value) => ['chat', 'modal'].includes(value) },
  /** Open at this step ('ai' | 'google' | 'phone'), as a checklist's step asks; null: decide. */
  start: { type: String, default: null },
});
/** `finish` carries `{ ask }`: a request to put in the composer, or null. */
const emit = defineEmits(['finish']);

const CHECK = 'M5 12.5l4.5 4.5L19 7.5';
const BOLT = 'M13.4 2.2L4.6 13.1c-.4.5 0 1.2.6 1.2h5.6l-1.3 7c-.1.7.8 1.1 1.2.5l8.7-10.9c.4-.5 0-1.2-.6-1.2h-5.6l1.3-7c.2-.7-.7-1.1-1.1-.5z';
// Google's own mark, in its own colours, as its sign-in button guidelines ask.
// Inline because SvgIcon paints every icon in the theme's text colour.
const GOOGLE_G =
  '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const GOOGLE_SUITE = Object.freeze([
  { label: 'Gmail', icon: 'gmail' },
  { label: 'Calendar', icon: 'clock' },
  { label: 'Drive', icon: 'google-drive' },
  { label: 'Docs', icon: 'document' },
  { label: 'Sheets', icon: 'table' },
  { label: 'Slides', icon: 'google-slides' },
  { label: 'Meet', icon: 'video' },
]);

const store = useStore();
const modal = ref(null);

// ── The account ──────────────────────────────────────────────────────────
const allProviders = computed(() => store.state.appAuth?.allProviders || []);
const connectedApps = computed(() => (store.getters['appAuth/connectedApps'] ?? store.state.appAuth?.connectedApps) || []);
const codexStatus = computed(() => store.state.appAuth?.codexStatus || {});
const selectedProvider = computed(() => String(store.state.aiProvider?.selectedProvider || ''));
const phoneState = ref(null);

// "Has its own AI" is the journey's count (custom endpoints included), so the
// setup and the getting-started checklist can never disagree about step 1.
const status = computed(() =>
  setupStatus({ aiConnected: readFacts(store).aiModels > 0, connectedIds: connectedApps.value, textAnnieState: phoneState.value }),
);
const everythingDone = computed(() => allDone(status.value));
const plans = computed(() => planTiles(allProviders.value, { codexStatus: codexStatus.value }));
/** Unknown until the service answers; only a known "no" changes the copy. */
const phoneOffered = computed(() => phoneEligible(phoneState.value) !== false);

const recordFor = (id) => allProviders.value.find((p) => String(p?.id || '').toLowerCase() === id) || { id, name: providerLabel(id) };
const labelOf = (provider) => providerLabel(provider) || 'your AI';
const iconOf = (provider) => provider?.icon || 'puzzle-piece';

const ownAis = computed(() => ownAiIds(connectedApps.value));
/** The AI Annie thinks with: the one in use if it is the account's own, else the best one connected. */
const activeAiId = computed(() => {
  const inUse = resolveProviderKey(selectedProvider.value);
  if (inUse && ownAis.value.includes(inUse)) return inUse;
  return ownAis.value.find((id) => isSubscriptionProvider(id)) || ownAis.value[0] || null;
});
const activeAi = computed(() => (activeAiId.value ? recordFor(activeAiId.value) : null));
const activeAiLabel = computed(() => (activeAi.value ? labelOf(activeAi.value) : 'Your AI'));
const activeAiIsPlan = computed(() => !!activeAiId.value && isSubscriptionProvider(activeAiId.value));
const otherAis = computed(() => ownAis.value.filter((id) => id !== activeAiId.value).map(recordFor));

// ── Where you are ────────────────────────────────────────────────────────
const ready = ref(false);
const view = ref('ai');
const skipped = reactive({});
const showKeys = ref(false);
const changingAi = ref(false);

function show(step) {
  view.value = step || 'done';
  showKeys.value = false;
  changingAi.value = false;
}
function skip(step) {
  skipped[step] = true;
  show(nextStep(status.value, skipped, step));
}
async function continueFrom(step) {
  // Connected but not in use (AGNT Flash was picked first): Continue uses it.
  if (step === 'ai' && activeAiId.value && resolveProviderKey(selectedProvider.value) !== activeAiId.value) {
    await signIn(recordFor(activeAiId.value));
  }
  show(nextStep(status.value, skipped, step));
}
// A different AI chosen while changing it: show what is now in use.
watch(selectedProvider, () => {
  changingAi.value = false;
});

// ── Connecting ───────────────────────────────────────────────────────────
const { connect, saveApiKey } = useAiProviderConnect(modal, { store, source: 'first-run-setup' });
const { handleProviderToggle } = useProviderConnection(modal);
const connecting = ref(null);
const connectingGoogle = ref(false);

async function signIn(provider) {
  if (!provider || connecting.value) return;
  connecting.value = provider.id;
  try {
    await connect(provider);
  } finally {
    connecting.value = null;
  }
}
async function signInGoogle() {
  // handleProviderToggle DISCONNECTS a provider that is connected, so it is
  // only ever called while Google is not.
  if (status.value.google || connectingGoogle.value) return;
  connectingGoogle.value = true;
  try {
    await handleProviderToggle('google');
  } finally {
    connectingGoogle.value = false;
  }
}

// A sign-in finishes in a browser or a popup; coming back to the app is the
// moment to look again (in-flight refreshes coalesce).
let refreshing = null;
function refreshConnections() {
  refreshing ||= store
    .dispatch('appAuth/fetchConnectedApps', { forceRefresh: true })
    .catch((error) => console.warn('[FirstRunSetup] connected apps unavailable:', error?.message || error))
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function loadPhoneState() {
  try {
    phoneState.value = await textAnnie.getStatus();
  } catch (error) {
    // Offline or not signed in to the service: the phone step says so itself.
    console.warn('[FirstRunSetup] Text Annie status unavailable:', error?.message || error);
  }
}

onMounted(async () => {
  window.addEventListener('focus', refreshConnections);
  try {
    await Promise.all([
      allProviders.value.length ? null : store.dispatch('appAuth/fetchAllProviders'),
      store.dispatch('appAuth/fetchConnectedApps'),
      loadPhoneState(),
    ]);
  } catch (error) {
    console.warn('[FirstRunSetup] could not load the account:', error?.message || error);
  } finally {
    // Always open on step 1, unless all three are done: an AI found already
    // signed in on this computer is confirmed there in one click (and can be
    // changed), rather than chosen silently. Continue passes over done steps.
    show(startStep(props.start) || (allDone(status.value) ? null : 'ai'));
    ready.value = true;
  }
});
const startStep = (step) => (SETUP_STEPS.some((s) => s.id === step) ? step : null);
// Asked for another step while open (the checklist again): go there.
watch(
  () => props.start,
  (step) => {
    if (ready.value && startStep(step)) show(step);
  },
);
onBeforeUnmount(() => window.removeEventListener('focus', refreshConnections));

// ── Copy ─────────────────────────────────────────────────────────────────
const aiPhrase = computed(() => (activeAiIsPlan.value ? `your ${activeAiLabel.value} plan` : activeAiLabel.value));
const hello = computed(() => {
  if (view.value === 'ai') return [{ text: "Hi, I'm Annie.", bold: true }, { text: ' Three quick connections and I can do real work for you.' }];
  if (view.value === 'google') {
    const lead = status.value.ai ? [{ text: `I'm running on ${aiPhrase.value}. ` }] : [];
    return [...lead, { text: 'Next, give me somewhere to work.', bold: true }];
  }
  if (view.value === 'phone') return [{ text: 'Last one. ' }, { text: 'Text me from anywhere.', bold: true }];
  return null;
});

const joinList = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);
const doneLead = computed(() => {
  const parts = [];
  if (status.value.ai) parts.push(activeAiIsPlan.value ? `on your ${activeAiLabel.value} plan` : `running on ${activeAiLabel.value}`);
  if (status.value.google) parts.push('connected to your Google account');
  if (status.value.phone) parts.push('a text away');
  return parts.length ? `I'm ${joinList(parts)}.` : "I'm on AGNT Flash for now. Connect the rest whenever you like.";
});
const tickLabel = (step) => (step === 'ai' ? (status.value.ai ? activeAiLabel.value : 'your AI') : step === 'google' ? 'Google' : 'your phone');
const offer = computed(() => finishOffer(status.value));
</script>

<style scoped>
/* Theme tokens only: the card renders in every theme, light by default. */
.frs {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  color: var(--text-primary);
  text-align: left;
}
.frs--modal {
  max-width: none;
}
/* The app's typography gives every li a bottom margin and an ol's last li
   16px; inside a centred row that lifted step 3 by 6px. These lists are
   layout, not prose. */
.frs li {
  margin: 0;
}
.frs-loading {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 48px 0;
}
.frs-loading span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--terminal-border-color);
  animation: frs-pulse 1s ease-in-out infinite;
}
.frs-loading span:nth-child(2) { animation-delay: 0.15s; }
.frs-loading span:nth-child(3) { animation-delay: 0.3s; }
@keyframes frs-pulse { 50% { opacity: 0.35; } }

.frs-hello {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 0 0 14px;
  font-size: 16px;
  line-height: 1.35;
  color: var(--text-secondary);
  text-align: center;
}
.frs-hello b { font-weight: 600; color: var(--text-primary); }
.frs-hello-mark { width: 20px; height: auto; flex: none; }

.frs-card {
  padding: 20px 26px 16px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 18px;
  background: var(--color-darker-0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 28px 50px -36px rgba(30, 30, 70, 0.35);
}
.frs--modal .frs-card {
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

/* Stepper */
.frs-stepper {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 18px;
  padding: 0;
  list-style: none;
}
.frs-step {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 2px 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 13.5px;
  color: var(--text-tertiary, var(--text-secondary));
  white-space: nowrap;
  cursor: pointer;
}
.frs-step.is-current { color: var(--text-primary); font-weight: 600; }
.frs-step.is-done { color: var(--text-secondary); }
.frs-num {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--terminal-border-color);
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
}
.frs-step.is-current .frs-num { border-color: transparent; background: var(--fill-accent); color: var(--on-fill-accent); }
.frs-step.is-done .frs-num { border-color: transparent; background: rgba(var(--green-rgb), 0.2); color: var(--status-green-text); }
.frs-num svg, .frs-ok svg, .frs-tick svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.frs-bar { width: 28px; height: 1.5px; background: var(--terminal-border-color); }
.frs-bar.is-done { background: rgba(var(--green-rgb), 0.7); }
.frs-pro {
  display: inline-block;
  padding: 3px 6px 2px;
  border-radius: 5px;
  background: var(--surface-active, var(--surface-hover));
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  line-height: 1;
  text-transform: uppercase;
}
.frs-pro--lg { background: rgba(var(--pink-rgb), 0.1); color: var(--color-pink); font-size: 11px; vertical-align: middle; }

/* Type */
.frs-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 27px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.025em;
  color: var(--text-primary);
}
.frs-lead { margin: 6px 0 18px; max-width: 600px; font-size: 15.5px; line-height: 1.45; color: var(--text-secondary); }
.frs-fine { margin: 10px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--text-tertiary, var(--text-secondary)); }
.frs-center { text-align: center; margin-left: auto; margin-right: auto; }

/* Logos */
.frs-logo, .frs-mini {
  flex: none;
  display: grid;
  place-items: center;
  background: var(--surface-active, var(--surface-hover));
}
.frs-logo { width: 34px; height: 34px; border-radius: 10px; }
.frs-logo--lg { width: 54px; height: 54px; border-radius: 15px; }
.frs-logo--xl { width: 56px; height: 56px; border-radius: 15px; background: var(--color-darker-1); }
.frs-logo :deep(svg) { width: 18px; height: 18px; }
.frs-logo--lg :deep(svg), .frs-logo--xl :deep(svg) { width: 30px; height: 30px; }
.frs-mini { width: 22px; height: 22px; border-radius: 7px; background: transparent; }
.frs-mini :deep(svg) { width: 14px; height: 14px; }

/* Buttons */
.frs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 42px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: 11px;
  font: inherit;
  font-size: 14.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.frs-btn:disabled { opacity: 0.6; cursor: default; }
.frs-btn--block { width: 100%; }
/* Ink inverts with the theme: dark on light, light on dark. */
.frs-btn--ink { background: var(--text-primary); color: var(--color-background); }
.frs-btn--accent { background: var(--fill-accent); color: var(--on-fill-accent); }
.frs-btn--google { height: 48px; padding-left: 6px; background: var(--text-primary); color: var(--color-background); font-size: 15.5px; }
.frs-g { width: 34px; height: 34px; display: grid; place-items: center; margin-right: 2px; border-radius: 9px; background: var(--color-white); }
.frs-g :deep(svg) { width: 19px; height: 19px; }
.frs-link, .frs-inline, .frs-back {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: var(--text-secondary);
  text-decoration: underline;
  text-decoration-color: var(--terminal-border-color);
  text-underline-offset: 3px;
  cursor: pointer;
}
.frs-link { font-size: 13.5px; }
.frs-link--flash { display: inline-flex; align-items: center; gap: 6px; }
.frs-link--flash svg { width: 13px; height: 13px; fill: var(--color-pink); }
.frs-back { display: block; margin: -2px 0 12px; font-size: 13.5px; text-decoration: none; }
.frs-inline { font-weight: 600; }
.frs-inline:disabled { opacity: 0.6; cursor: default; }

/* 1 · the plans: the two cards carry the screen */
.frs-hero { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.frs-plan {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  background: var(--color-darker-0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 14px 26px -22px rgba(30, 30, 70, 0.35);
}
.frs-plan-head { display: flex; align-items: center; gap: 14px; }
.frs-plan-name { font-size: 21px; font-weight: 600; letter-spacing: -0.015em; color: var(--text-primary); }
.frs-plan-sub { margin-top: 2px; font-size: 14px; color: var(--text-tertiary, var(--text-secondary)); }
.frs-plan .frs-btn { height: 46px; font-size: 15px; }
.frs-more-label { margin: 20px 0 8px; font-size: 12.5px; color: var(--text-tertiary, var(--text-secondary)); }
.frs-more { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 6px; }
.frs-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px 0 6px;
  border: 0;
  border-radius: 10px;
  background: var(--surface-active, var(--surface-hover));
  font: inherit;
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
  cursor: pointer;
}
.frs-pill:hover:not(:disabled) { color: var(--text-primary); }
.frs-pill:disabled { opacity: 0.6; cursor: default; }
/* 1 · the fallback: one quiet line */
.frs-alt {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--terminal-border-color);
  font-size: 13.5px;
  color: var(--text-tertiary, var(--text-secondary));
}
.frs-tag { padding: 3px 8px 2px; border-radius: 999px; background: var(--surface-active, var(--surface-hover)); font-size: 11.5px; font-weight: 600; }
.frs-sep { opacity: 0.5; }

/* Connected */
.frs-success {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px;
  border: 1px solid rgba(var(--green-rgb), 0.45);
  border-radius: 14px;
  background: rgba(var(--green-rgb), 0.08);
}
.frs-logo--plain :deep(svg) { width: 28px; height: 28px; }
.frs-success-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 21px; font-weight: 600; letter-spacing: -0.015em; }
.frs-ok { width: 22px; height: 22px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--fill-success); color: var(--on-fill-success); }
.frs-success-sub { margin: 4px 0 0; font-size: 15px; line-height: 1.45; color: var(--text-secondary); }
.frs-also { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 14px 0 0; font-size: 13.5px; color: var(--text-tertiary, var(--text-secondary)); }
.frs-chip { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px 0 4px; border: 1px solid var(--terminal-border-color); border-radius: 9px; color: var(--text-primary); }

/* 2 · Google */
.frs-gcard { padding: 16px; border: 1px solid var(--terminal-border-color); border-radius: 14px; }
.frs-suite { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin: 0 0 18px; padding: 0; list-style: none; }
.frs-suite li { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-secondary); }
.frs-gicon { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 12px; background: var(--surface-active, var(--surface-hover)); }
.frs-gicon :deep(svg) { width: 22px; height: 22px; }
.frs-try { margin: 14px 0 0; font-size: 13.5px; color: var(--text-tertiary, var(--text-secondary)); }
.frs-try span { color: var(--text-secondary); }

/* 3 · phone: the Text Annie card, inside this one */
.frs-phone { margin-top: 2px; }

/* Footer */
.frs-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 18px; }

/* Done */
.frs-done { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 6px 0 4px; }
.frs-done-mark { width: auto; height: 28px; margin-bottom: 14px; }
.frs-done-title { margin: 0; font-size: 34px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.05; }
.frs-ticks { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 4px 0 20px; padding: 0; list-style: none; }
.frs-tick {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border: 1px dashed var(--terminal-border-color);
  border-radius: 10px;
  background: none;
  font: inherit;
  font-size: 13.5px;
  color: var(--text-secondary);
  cursor: pointer;
}
.frs-tick.is-done { border-style: solid; color: var(--text-primary); cursor: default; }
.frs-tick.is-done svg { color: var(--status-green-text); width: 14px; height: 14px; }
.frs-aha {
  width: 100%;
  max-width: 620px;
  padding: 20px 22px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  background: var(--color-darker-0);
  text-align: left;
}
.frs-aha-kicker { display: block; font-size: 12.5px; font-weight: 600; color: var(--color-pink); }
.frs-aha-title { display: block; margin-top: 4px; font-size: 20px; font-weight: 600; letter-spacing: -0.015em; }
.frs-aha-text { margin: 8px 0 14px; font-size: 14px; line-height: 1.5; color: var(--text-secondary); }
.frs-aha-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }

@media (max-width: 600px) {
  .frs-card { padding: 16px; }
  .frs-hero { grid-template-columns: 1fr; }
  .frs-suite { grid-template-columns: repeat(4, 1fr); row-gap: 12px; }
  .frs-title { font-size: 23px; }
}
</style>
