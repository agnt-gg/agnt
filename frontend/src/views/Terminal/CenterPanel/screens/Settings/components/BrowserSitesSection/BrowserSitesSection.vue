<template>
  <div class="browser-sites">
    <p class="browser-sites-intro">
      The AGNT browser keeps one profile for every conversation and workflow. Sign in to a site once — here, or
      when Annie asks — and the agent stays signed in.
    </p>

    <form class="browser-sites-signin" @submit.prevent="startSignIn">
      <input
        v-model="address"
        type="text"
        class="browser-sites-input"
        placeholder="accounts.google.com"
        aria-label="Site to sign in to"
        :disabled="Boolean(signIn) || busy"
      />
      <button type="submit" class="browser-sites-button is-primary" :disabled="!address.trim() || Boolean(signIn) || busy">
        Open sign-in window
      </button>
    </form>

    <div v-if="signIn" class="browser-sites-window" role="status">
      <i class="fas fa-key" aria-hidden="true"></i>
      <span class="browser-sites-window-text">
        A browser window is open at <strong>{{ signIn.host || 'the site' }}</strong>. Sign in there, then close the window.
      </span>
      <button type="button" class="browser-sites-button is-primary" :disabled="busy" @click="answer('done')">I'm signed in</button>
      <button type="button" class="browser-sites-button is-quiet" :disabled="busy" @click="answer('cancel')">Cancel</button>
    </div>
    <p v-else-if="lastMessage" class="browser-sites-note">{{ lastMessage }}</p>
    <p v-if="problem" class="browser-sites-problem">{{ problem }}</p>

    <div class="browser-sites-list">
      <div class="browser-sites-head">
        <span>Sites with saved logins and cookies</span>
        <button type="button" class="browser-sites-icon" aria-label="Refresh" v-tooltip="'Refresh'" :disabled="loading" @click="loadSites">
          <i class="fas fa-sync-alt" :class="{ 'fa-spin': loading }" aria-hidden="true"></i>
        </button>
      </div>
      <p v-if="loading && !sites.length" class="browser-sites-empty">Reading the AGNT browser…</p>
      <p v-else-if="signingIn" class="browser-sites-empty">The list comes back when the sign-in window closes.</p>
      <p v-else-if="!sites.length" class="browser-sites-empty">No sites yet.</p>
      <ul v-else class="browser-sites-rows">
        <li v-for="site in sites" :key="site.site" class="browser-sites-row">
          <span class="browser-sites-name">{{ site.site }}</span>
          <span class="browser-sites-meta">{{ describe(site) }}</span>
          <template v-if="confirming === site.site">
            <button type="button" class="browser-sites-button is-danger" :disabled="busy" @click="forget(site.site)">Sign out of {{ site.site }}</button>
            <button type="button" class="browser-sites-button is-quiet" :disabled="busy" @click="confirming = null">Keep</button>
          </template>
          <button v-else type="button" class="browser-sites-button" :disabled="busy || Boolean(signIn)" @click="confirming = site.site">Sign out</button>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
import { onBeforeUnmount, onMounted, ref, computed } from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import { apiFetch } from '@/utils/apiFetch.js';

/** How often an open sign-in window is checked on. Only while one is open. */
const POLL_MS = 1500;

const LAST_MESSAGES = {
  finished: (host) => `The sign-in window closed. ${host ? `${host} is` : 'The site is'} in the list below if the sign-in worked.`,
  cancelled: () => 'Sign-in cancelled.',
  'timed-out': () => 'The sign-in window was closed after waiting 10 minutes.',
};

/**
 * Settings › Browser: the logins the agent has, and a way to add one.
 *
 * One profile serves every conversation and workflow (backend
 * services/browserSites.js), so this list is what the agent is signed in to.
 * "Open sign-in window" opens a plain browser window on that profile — the
 * same window the agent opens for Google, which refuses automated browsers.
 */
export default {
  name: 'BrowserSitesSection',
  setup() {
    const sites = ref([]);
    const signingIn = ref(false);
    const loading = ref(false);
    const busy = ref(false);
    const problem = ref('');
    const address = ref('');
    const signIn = ref(null);
    const last = ref(null);
    const confirming = ref(null);
    let timer = null;
    let stopped = false;

    const lastMessage = computed(() => {
      if (!last.value) return '';
      const describeLast = LAST_MESSAGES[last.value.outcome];
      return describeLast ? describeLast(last.value.host) : (last.value.error || 'The sign-in did not complete.');
    });

    async function loadSites() {
      loading.value = true;
      try {
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/browser-agent/sites`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || 'Could not read the AGNT browser.');
        sites.value = body.sites || [];
        signingIn.value = Boolean(body.signingIn);
      } catch (err) {
        problem.value = err.message;
      } finally {
        loading.value = false;
      }
    }

    async function checkSignIn() {
      timer = null;
      if (stopped) return;
      try {
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/browser-agent/signin?scope=settings`);
        const body = await response.json().catch(() => ({}));
        const wasOpen = Boolean(signIn.value);
        signIn.value = body?.signIn || null;
        last.value = body?.last || null;
        // The window just closed: the list is what tells whether it worked.
        if (wasOpen && !signIn.value) await loadSites();
      } catch {
        // The next check answers; a missed one is not worth showing.
      }
      if (!stopped && signIn.value) timer = setTimeout(checkSignIn, POLL_MS);
    }

    function normalised(value) {
      const trimmed = value.trim();
      return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    }

    async function startSignIn() {
      if (!address.value.trim() || busy.value) return;
      busy.value = true;
      problem.value = '';
      last.value = null;
      try {
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/browser-agent/signin/start`, {
          method: 'POST',
          body: JSON.stringify({ url: normalised(address.value) }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || 'Could not open a sign-in window.');
        signIn.value = body.signIn || { host: '' };
        signingIn.value = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(checkSignIn, POLL_MS);
      } catch (err) {
        problem.value = err.message;
      } finally {
        busy.value = false;
      }
    }

    async function answer(route) {
      if (!signIn.value?.id || busy.value) return;
      busy.value = true;
      try {
        await apiFetch(`${API_CONFIG.BASE_URL}/browser-agent/signin/${route}`, {
          method: 'POST',
          body: JSON.stringify({ scope: 'settings', id: signIn.value.id }),
        });
      } catch {
        problem.value = 'That did not go through. Try again.';
      } finally {
        busy.value = false;
      }
    }

    async function forget(site) {
      busy.value = true;
      problem.value = '';
      try {
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/browser-agent/sites/forget`, {
          method: 'POST',
          body: JSON.stringify({ site }),
        });
        const body = await response.json().catch(() => ({}));
        if (Array.isArray(body?.sites)) sites.value = body.sites;
        if (!response.ok || body?.success === false) {
          problem.value = body?.error || `Some of ${site}'s cookies could not be removed.`;
        }
      } catch {
        problem.value = `Could not sign out of ${site}.`;
      } finally {
        confirming.value = null;
        busy.value = false;
      }
    }

    function describe(site) {
      const count = `${site.cookies} cookie${site.cookies === 1 ? '' : 's'}`;
      if (site.expires) return `${count} · until ${new Date(site.expires).toLocaleDateString()}`;
      return site.session ? `${count} · this session` : count;
    }

    onMounted(async () => {
      await checkSignIn();
      if (!signIn.value) await loadSites();
    });
    onBeforeUnmount(() => {
      stopped = true;
      if (timer) clearTimeout(timer);
    });

    return {
      sites, signingIn, loading, busy, problem, address, signIn, lastMessage, confirming,
      loadSites, startSignIn, answer, forget, describe,
    };
  },
};
</script>

<style scoped>
.browser-sites {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: var(--font-size-sm);
}
.browser-sites-intro,
.browser-sites-note,
.browser-sites-empty {
  margin: 0;
  color: var(--color-text-muted);
  line-height: 1.5;
}
.browser-sites-problem {
  margin: 0;
  color: var(--color-red);
}
.browser-sites-signin {
  display: flex;
  gap: 8px;
}
.browser-sites-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  background: var(--color-darker-0);
  color: var(--color-text);
  font: inherit;
}
.browser-sites-window {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--color-green);
  border-radius: 6px;
  color: var(--color-text);
}
.browser-sites-window .fa-key {
  color: var(--text-green);
}
.browser-sites-window-text {
  flex: 1;
  min-width: 200px;
}
.browser-sites-list {
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
}
.browser-sites-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--terminal-border-color);
  color: var(--color-text);
  font-weight: 600;
}
.browser-sites-list > .browser-sites-empty {
  padding: 10px;
}
.browser-sites-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.browser-sites-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
}
.browser-sites-row + .browser-sites-row {
  border-top: 1px solid var(--terminal-border-color);
}
.browser-sites-name {
  color: var(--color-text);
  font-family: var(--font-family-mono, monospace);
}
.browser-sites-meta {
  flex: 1;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
.browser-sites-button {
  padding: 4px 10px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
  white-space: nowrap;
}
.browser-sites-button.is-primary {
  border-color: var(--color-green);
  color: var(--text-green);
  font-weight: 600;
}
.browser-sites-button.is-danger {
  border-color: var(--color-red);
  color: var(--color-red);
}
.browser-sites-button.is-quiet {
  border-color: transparent;
  color: var(--color-text-muted);
}
.browser-sites-button:disabled {
  opacity: 0.6;
  cursor: default;
}
.browser-sites-icon {
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}
</style>
