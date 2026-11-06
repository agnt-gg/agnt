<template>
  <div class="one-welcome" data-testid="one-welcome">
    <!-- The empty chat. Before the account's first chat it is the first-run
         setup (your AI, Google, your phone), until that is finished; the top-bar
         capsule can open it again at any step. Then Annie's tour: four lines.
         After the first chat it is a greeting. The composer below is the real
         one (BaseScreen), centred by focused.css, never a copy. -->
    <FirstRunSetup v-if="showSetup" frame="chat" :start="setupRequest" @finish="finishSetup" />
    <template v-else>
      <img class="one-welcome-mark" src="/images/agnt-logo-mark.svg" alt="" />
      <template v-if="firstRun">
        <h1 class="one-welcome-title">Hi, I'm Annie.</h1>
        <p class="one-welcome-lead">Tell me what you want done. I'll plan it, connect what I need, and do it.</p>
        <ul class="one-lowdown" data-testid="one-lowdown">
          <li v-for="line in LOWDOWN" :key="line.verb">
            <span class="one-lowdown-icon">
              <!-- eslint-disable-next-line vue/no-v-html -- static icons below, never user data -->
              <svg viewBox="0 0 24 24" aria-hidden="true" v-html="line.icon"></svg>
            </span>
            <span><b>{{ line.verb }}</b> {{ line.text }}</span>
          </li>
        </ul>
        <p v-if="onFlash" class="one-welcome-fine" data-testid="one-on-flash">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="BOLT" /></svg>
          You're on AGNT Flash, free to start. Nothing to set up.
        </p>
      </template>
      <template v-else>
        <h1 class="one-welcome-title">{{ greeting }}</h1>
        <!-- The approved mockup's promise: real work becomes a task you see and approve. -->
        <p class="one-welcome-sub">What can I get done for you? When it’s real work, it becomes a task: you see the plan before anything happens, and you approve every step that sends or changes something.</p>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { useStore } from 'vuex';
import FirstRunSetup from '@/views/_components/feature/FirstRunSetup.vue';
import { readFacts } from '@/composables/useJourney.js';
import { RAIL_ICONS, greetingFor, loadOneFlags, saveOneFlags } from './oneModel.js';
import { clearSetupRequest, setupRequest } from './oneSetupRequest.js';

const LOWDOWN = Object.freeze([
  { verb: 'Ask', text: 'in plain words. I work out the steps.', icon: RAIL_ICONS.chats },
  { verb: 'Connect', text: "as you go. When I need an app, I'll ask once.", icon: RAIL_ICONS.apps },
  { verb: 'Keep', text: 'what works. Anything good can run on its own.', icon: RAIL_ICONS.routines },
]);
const BOLT = 'M13.4 2.2L4.6 13.1c-.4.5 0 1.2.6 1.2h5.6l-1.3 7c-.1.7.8 1.1 1.2.5l8.7-10.9c.4-.5 0-1.2-.6-1.2h-5.6l1.3-7c.2-.7-.7-1.1-1.1-.5z';

const store = useStore();
// The account's very first chat, not this conversation's: a returning person
// opening a new chat is greeted, not toured.
const firstRun = computed(() => readFacts(store).chats === 0);
// The provider list holds display names ('AGNT'); same rule as Chat.vue.
const onFlash = computed(() => String(store.state.aiProvider?.selectedProvider || '').toLowerCase() === 'agnt');
const greeting = computed(() => greetingFor(store.getters['userAuth/userPseudonym']));

// Finished or not is the account's, kept with the capsule's flags.
const account = computed(() => store.getters['userAuth/userEmail'] || store.state.userAuth?.user?.id || null);
const setupDone = ref(loadOneFlags(account.value).setup);
watch(account, (who) => {
  setupDone.value = loadOneFlags(who).setup;
});
const showSetup = computed(() => !!setupRequest.value || (firstRun.value && !setupDone.value));

function finishSetup({ ask } = {}) {
  saveOneFlags(account.value, { ...loadOneFlags(account.value), setup: true });
  setupDone.value = true;
  clearSetupRequest();
  // "Ask Annie" types the request into this chat's composer, focused, so the person
  // can change it before sending. It never sends on its own.
  if (ask) window.dispatchEvent(new CustomEvent('agnt:ask-annie', { detail: { text: ask, send: false } }));
}
</script>
