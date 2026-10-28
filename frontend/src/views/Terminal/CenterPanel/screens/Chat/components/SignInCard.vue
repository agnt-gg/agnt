<template>
  <div class="signin-card" :class="`is-${phase}`" role="group" :aria-label="title">
    <div class="signin-head">
      <i class="fas signin-icon" :class="icon" aria-hidden="true"></i>
      <span class="signin-title">{{ title }}</span>
      <!-- The REAL address, from the backend's view of the page, not the
           model's arguments: the person should see where they are typing. -->
      <span v-if="host" class="signin-host" v-tooltip="pageUrl">{{ host }}</span>
    </div>
    <p class="signin-text">{{ message }}</p>
    <div v-if="phase === 'waiting-here' || phase === 'waiting-window'" class="signin-actions">
      <button v-if="phase === 'waiting-here'" type="button" class="signin-button is-primary" :disabled="busy" @click="signInHere">
        Sign in here
      </button>
      <button
        v-if="phase === 'waiting-here' && state?.canUseWindow"
        type="button"
        class="signin-button"
        :disabled="busy"
        @click="answer('window')"
      >
        Use a browser window
      </button>
      <button type="button" class="signin-button" :class="{ 'is-primary': phase === 'waiting-window' }" :disabled="busy" @click="answer('done')">
        I'm signed in
      </button>
      <button type="button" class="signin-button is-quiet" :disabled="busy" @click="answer('cancel')">Cancel</button>
    </div>
    <p v-if="problem" class="signin-problem">{{ problem }}</p>
  </div>
</template>

<script>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { apiFetch } from '@/utils/apiFetch.js';
import { requestLiveFocus } from './browserLiveRegistry.js';
import { signInOutcome, hostOf } from './signInCards.js';

/** How often a waiting card asks what the sign-in is doing. Bounded: only while the call runs. */
const POLL_MS = 1500;

/**
 * The sign-in step, in the chat: where to sign in, and the answers.
 *
 * The tool call (browser action="signin") is WAITING on the backend
 * (services/browserSignIn.js). This card reads that wait's state and answers
 * for the person: sign in here (the live browser comes forward, fullscreen),
 * use a browser window instead, I'm signed in, or cancel. Signing in here
 * usually needs no button at all — the wait sees the page get through.
 */
export default {
  name: 'SignInCard',
  props: {
    toolCall: { type: Object, required: true },
    /** The conversation whose browser this is; '' for the shared one, null while unknown. */
    conversationId: { type: String, default: null },
  },
  setup(props) {
    const state = ref(null);
    const busy = ref(false);
    const problem = ref('');
    let timer = null;
    let stopped = false;
    /** The sign-in we already brought the live browser forward for — once each, never again. */
    let focusedFor = null;

    const outcome = computed(() => signInOutcome(props.toolCall));
    const running = computed(() => !outcome.value);
    const group = computed(() => props.conversationId || '');

    const phase = computed(() => {
      if (outcome.value) return outcome.value.signedIn ? 'signed-in' : 'not-signed-in';
      if (!state.value) return 'starting';
      if (state.value.status === 'finishing') return 'finishing';
      if (state.value.status === 'opening-window') return 'opening-window';
      return state.value.mode === 'window' ? 'waiting-window' : 'waiting-here';
    });

    const pageUrl = computed(() => outcome.value?.url || state.value?.url || '');
    const host = computed(() => hostOf(pageUrl.value));
    const provider = computed(() => state.value?.provider || host.value || 'the site');

    const title = computed(() => ({
      'signed-in': 'Signed in',
      'not-signed-in': 'Not signed in',
    }[phase.value] || `Sign in to ${provider.value}`));

    const icon = computed(() => ({
      'signed-in': 'fa-check-circle',
      'not-signed-in': 'fa-times-circle',
    }[phase.value] || 'fa-key'));

    const message = computed(() => {
      switch (phase.value) {
        case 'starting': return 'Opening the sign-in page…';
        case 'waiting-here': return 'The page is open in the live browser. Sign in there; I carry on by myself as soon as you are through.';
        case 'opening-window': return 'Opening a browser window…';
        case 'waiting-window': return `A browser window is open at ${host.value || 'the sign-in page'}. Sign in there, then close the window.`;
        case 'finishing': return 'Finishing up…';
        case 'signed-in': return 'Saved. Every conversation and workflow uses this login from now on.';
        default: return outcome.value?.error || 'The sign-in did not complete.';
      }
    });

    async function poll() {
      timer = null;
      if (stopped || !running.value || props.conversationId === null) return;
      try {
        const query = new URLSearchParams({ conversationId: props.conversationId });
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/browser-agent/signin?${query}`);
        if (response.ok) {
          const body = await response.json();
          if (body?.signIn) state.value = body.signIn;
        }
      } catch {
        // A missed poll is not a problem worth showing; the next one answers.
      }
      if (!stopped && running.value) timer = setTimeout(poll, POLL_MS);
    }

    // Bring the live browser forward the moment a sign-in here is waiting:
    // that is where the person has to type, and finding it was the bug.
    watch(() => [state.value?.id, phase.value], ([id, current]) => {
      if (current === 'waiting-here' && id && focusedFor !== id) {
        focusedFor = id;
        requestLiveFocus(group.value, true);
      }
    });

    // Over: step the live browser back so the chat (and this answer) shows.
    watch(running, (isRunning) => {
      if (isRunning) return;
      if (timer) clearTimeout(timer);
      timer = null;
      if (focusedFor) requestLiveFocus(group.value, false);
    });

    function signInHere() {
      requestLiveFocus(group.value, true);
    }

    async function answer(route) {
      if (busy.value || !state.value?.id) return;
      busy.value = true;
      problem.value = '';
      try {
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/browser-agent/signin/${route}`, {
          method: 'POST',
          body: JSON.stringify({ conversationId: props.conversationId, id: state.value.id }),
        });
        const body = await response.json().catch(() => ({}));
        if (body?.signIn) state.value = body.signIn;
        if (response.status === 409) problem.value = 'That sign-in has already ended.';
        else if (!response.ok) problem.value = body?.error || 'That did not go through. Try again.';
      } catch {
        problem.value = 'That did not go through. Try again.';
      } finally {
        busy.value = false;
      }
    }

    watch(() => props.conversationId, () => { if (running.value && !timer) poll(); });
    if (running.value) poll();

    onBeforeUnmount(() => {
      stopped = true;
      if (timer) clearTimeout(timer);
    });

    return {
      state, busy, problem, phase, title, icon, message, host, pageUrl, signInHere, answer,
    };
  },
};
</script>

<style scoped>
/* A step in the run the person has to act on: one compact card, the weight of
   a Connect card, never a banner. */
.signin-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 2px;
  padding: 8px 10px;
  border: 1px solid var(--color-green);
  border-radius: 6px;
  background: var(--color-darker-0);
  font-size: var(--font-size-xs);
  max-width: 560px;
}
.signin-card.is-signed-in {
  border-color: rgba(25, 239, 131, 0.35);
}
.signin-card.is-not-signed-in {
  border-color: var(--terminal-border-color);
}
.signin-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.signin-icon {
  color: var(--text-green);
  font-size: 12px;
}
.is-not-signed-in .signin-icon {
  color: var(--color-text-muted);
}
.signin-title {
  color: var(--color-text);
  font-weight: 600;
}
.signin-host {
  margin-left: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-family: var(--font-family-mono, monospace);
  font-size: 11px;
}
.signin-text {
  margin: 0;
  color: var(--color-text-muted);
  line-height: 1.45;
}
.signin-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.signin-button {
  padding: 3px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
}
.signin-button.is-primary {
  border-color: var(--color-green);
  color: var(--text-green);
  font-weight: 600;
}
.signin-button.is-primary:hover:not(:disabled) {
  background: var(--color-green);
  color: var(--color-darker-0);
}
.signin-button.is-quiet {
  border-color: transparent;
  color: var(--color-text-muted);
}
.signin-button:hover:not(:disabled) {
  border-color: var(--color-text-muted);
}
.signin-button:disabled {
  opacity: 0.6;
  cursor: default;
}
.signin-problem {
  margin: 0;
  color: var(--color-red);
}
</style>
