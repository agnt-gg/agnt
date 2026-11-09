<template>
  <!--
    Desktop builds that update themselves render ONLY from main's update state
    (electron/autoUpdate.js). The agnt.gg "download it yourself" notice is for
    everything else: browser, Docker, deb/rpm and dev builds.

    The two states that ask for a decision (ready, notice) open a dialog with
    the release notes; the transient ones stay a banner.
  -->
  <Transition name="update-dialog-fade">
    <div v-if="isDialog" class="update-overlay" :data-testid="view === 'ready' ? 'update-ready' : 'update-notice'" @click.self="dismiss">
      <section ref="dialogElement" class="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title" @keydown="onDialogKeydown">
        <button type="button" class="update-dialog-close" aria-label="Close" @click="dismiss">×</button>

        <header class="update-dialog-head">
          <div class="update-dialog-status" :class="{ 'is-waiting': !!blockedText }">{{ statusText }}</div>
          <h2 id="update-dialog-title" class="update-dialog-title">AGNT v{{ targetVersion }}</h2>
          <p v-if="releaseName" class="update-dialog-subtitle">{{ releaseName }}</p>
          <p class="update-dialog-meta">
            v{{ fromVersion }} → v{{ targetVersion }}<template v-if="release?.date"> · {{ release.date }}</template>
            <template v-if="view === 'ready' && state.needsPermission"> · Windows will ask for permission</template>
          </p>
          <div v-if="changeGroups.length" class="change-counts">
            <button v-for="group in changeGroups" :key="group.status" type="button" class="change-count" :class="'is-' + group.status" @click="showGroup(group.status)">
              <b>{{ group.changes.length }}</b>
              <span>{{ group.label }}</span>
            </button>
          </div>
        </header>

        <div v-if="changeGroups.length" ref="changeListElement" class="change-list">
          <section v-for="group in visibleGroups" :key="group.status" class="change-group" :class="'is-' + group.status" :data-group="group.status">
            <h4>{{ group.label }}</h4>
            <ul>
              <li v-for="(change, index) in group.changes" :key="index">
                <span><strong v-if="change.lead">{{ change.lead }}</strong><template v-if="change.lead"> — </template>{{ change.rest }}</span>
                <span v-if="change.plan" class="plan-badge">{{ change.plan }}</span>
              </li>
            </ul>
          </section>
          <button v-if="hasMoreChanges" type="button" class="show-all-changes" :aria-expanded="String(showAllChanges)" @click="showAllChanges = !showAllChanges">
            {{ showAllChanges ? 'Show less' : `Show all ${totalChanges} changes` }}
          </button>
        </div>

        <footer class="update-dialog-foot">
          <p v-if="view === 'ready' && blockedText" class="update-dialog-warning">{{ blockedText }}</p>
          <a v-else class="changelog-link" :href="CHANGELOG_URL" target="_blank" rel="noopener noreferrer">Release notes on agnt.gg ↗</a>
          <button type="button" class="update-dialog-btn is-secondary dismiss-btn" @click="dismiss">Later</button>
          <template v-if="view === 'ready'">
            <button v-if="state.blocked" ref="primaryButton" type="button" class="update-dialog-btn is-primary download-btn" :disabled="installing" @click="install(true)">
              {{ installing ? 'Restarting…' : 'Restart anyway' }}
            </button>
            <button v-else-if="state.needsExplicitInstall" ref="primaryButton" type="button" class="update-dialog-btn is-primary download-btn" :disabled="installing" @click="install(false)">
              {{ installing ? 'Restarting…' : 'Restart to update' }}
            </button>
            <button v-else ref="primaryButton" type="button" class="update-dialog-btn is-primary download-btn" :disabled="installing" @click="install(false)">
              {{ installing ? 'Restarting…' : 'Restart now' }}
            </button>
          </template>
          <button v-else ref="primaryButton" type="button" class="update-dialog-btn is-primary download-btn" @click="openDownloads">Download</button>
        </footer>
      </section>
    </div>
  </Transition>

  <Transition name="slide-down">
    <!-- Downloading: informational only; there is nothing to click yet. -->
    <div v-if="view === 'downloading'" class="update-banner" data-testid="update-downloading">
      <div class="update-content">
        <div class="update-icon">⬇️</div>
        <div class="update-text">
          <span class="update-title">Downloading Update</span>
          <span class="update-version">v{{ state.available?.version }} · {{ state.percent ?? 0 }}%</span>
        </div>
      </div>
    </div>

    <!-- macOS: downloaded, but Squirrel is still unpacking and verifying it.
         Nothing to click yet; a restart now would install nothing. -->
    <div v-else-if="view === 'preparing'" class="update-banner" data-testid="update-preparing">
      <div class="update-content">
        <div class="update-icon">⬇️</div>
        <div class="update-text">
          <span class="update-title">Preparing Update</span>
          <span class="update-version">v{{ state.available?.version }} · almost ready</span>
        </div>
      </div>
    </div>

    <div v-else-if="view === 'installing'" class="update-banner" data-testid="update-installing">
      <div class="update-content">
        <div class="update-icon">⬇️</div>
        <div class="update-text">
          <span class="update-title">Installing v{{ state.available?.version }}</span>
          <span class="update-version">AGNT will restart</span>
        </div>
      </div>
    </div>

    <div v-else-if="view === 'error'" class="update-banner is-error" data-testid="update-error">
      <div class="update-content">
        <div class="update-icon">⚠️</div>
        <div class="update-text">
          <span class="update-title">Update failed</span>
          <span class="update-version">{{ state.error?.message }}</span>
        </div>
      </div>
      <div class="update-actions">
        <button class="update-btn download-btn" :disabled="retrying" @click="retry">{{ retrying ? 'Checking…' : 'Retry' }}</button>
        <button class="update-btn dismiss-btn" @click="dismiss">Later</button>
      </div>
    </div>

    <div v-else-if="view === 'installed'" class="update-banner" :class="{ 'is-error': !state.installed?.ok }" data-testid="update-installed">
      <div class="update-content">
        <div class="update-icon">{{ state.installed?.ok ? '✅' : '⚠️' }}</div>
        <div class="update-text">
          <span class="update-title">{{ state.installed?.ok ? `Updated to v${state.installed.to}` : 'The update did not install' }}</span>
          <span class="update-version">
            {{ state.installed?.ok ? `from v${state.installed.from}` : `Still running v${state.installed?.running}; v${state.installed?.to} will be offered again.` }}
          </span>
        </div>
      </div>
      <div class="update-actions">
        <button class="update-btn dismiss-btn" @click="dismiss">OK</button>
      </div>
    </div>

  </Transition>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, inject, nextTick } from 'vue';

import { API_CONFIG } from '@/tt.config.js';
import { useElectron } from '@/composables/useElectron';
import { CHANGELOG_URL, fetchReleases, findRelease, groupChanges } from '@/services/releaseNotes.js';

const { electron } = useElectron();
// Vuex's injection key. Optional: specs mount this without a store.
const store = inject('store', null);

// ── desktop self-update: main owns the state; this only renders it ─────────
const state = ref(null); // see preload.js autoUpdate.state()
const installing = ref(false);
const retrying = ref(false);
const dismissedKey = ref(null); // a dismissal hides THIS state, not future ones

// ── agnt.gg notice: browser, Docker, deb/rpm, dev ─────────────────────────
const updateInfo = ref(null);
const currentVersion = ref('');
const showNotice = ref(false);

const unsubscribers = [];

/** A key that changes whenever there is something new to say. */
function keyOf(s) {
  if (!s) return null;
  if (s.installed) return `installed:${s.installed.to}`;
  return `${s.phase}:${s.available?.version || ''}:${s.blocked?.reason || ''}:${s.error?.message || ''}`;
}

const selfUpdating = computed(() => !!state.value?.enabled);

// The version waiting to be installed, whichever path found it. This
// component is always mounted (App.vue), so it is the ONE writer of the
// toolbar's "update" pill. That used to be NewsPanel, which meant the pill
// only appeared after someone happened to open Settings.
const availableVersion = computed(() => {
  if (selfUpdating.value) return state.value?.available?.version || null;
  return updateInfo.value?.updateAvailable ? updateInfo.value.latestVersion || null : null;
});
watch(availableVersion, (version) => store?.dispatch('shell/setUpdateAvailable', version ? { version } : null), { immediate: true });

const view = computed(() => {
  const s = state.value;
  if (selfUpdating.value) {
    if (dismissedKey.value === keyOf(s)) return null;
    if (s.installed) return 'installed';
    if (s.phase === 'ready') return 'ready';
    if (s.phase === 'downloading') return 'downloading';
    if (s.phase === 'preparing') return 'preparing';
    if (s.phase === 'installing') return 'installing';
    if (s.phase === 'error') return 'error';
    return null;
  }
  return showNotice.value && updateInfo.value ? 'notice' : null;
});

// ── the dialog: what the waiting version changes ─────────────────────────────────────────
const PREVIEW_CHANGES = 4;
const release = ref(null); // the feed entry for exactly availableVersion, if the feed has it yet
const showAllChanges = ref(false);
const dialogElement = ref(null);
const primaryButton = ref(null);
const changeListElement = ref(null);
let releasesRequest = null; // one feed request per mount; a failure clears it so a later version can retry
let focusBeforeDialog = null;

const isDialog = computed(() => view.value === 'ready' || view.value === 'notice');
const targetVersion = computed(() => availableVersion.value || '');
const fromVersion = computed(() => (selfUpdating.value ? state.value?.currentVersion : currentVersion.value) || '');
const releaseName = computed(() => (release.value?.title || '').replace(/\s+—\s+AGNT v[\d.]+$/, ''));
const statusText = computed(() => {
  if (view.value === 'notice') return 'Update available';
  return blockedText.value ? 'Waiting on running work' : 'Update ready';
});
const changeGroups = computed(() => groupChanges(release.value));
const totalChanges = computed(() => changeGroups.value.reduce((sum, group) => sum + group.changes.length, 0));
// Collapsed: the first few changes of the first group (New, when there is one).
const visibleGroups = computed(() => {
  if (showAllChanges.value || !changeGroups.value.length) return changeGroups.value;
  const [first] = changeGroups.value;
  return [{ ...first, changes: first.changes.slice(0, PREVIEW_CHANGES) }];
});
const hasMoreChanges = computed(() => totalChanges.value > Math.min(PREVIEW_CHANGES, changeGroups.value[0]?.changes.length ?? 0));

async function loadRelease(version) {
  release.value = null;
  showAllChanges.value = false;
  if (!version) return;
  try {
    releasesRequest ||= fetchReleases();
    const releases = await releasesRequest;
    if (availableVersion.value === version) release.value = findRelease(releases, version);
  } catch (error) {
    releasesRequest = null;
    console.warn('[Update] release notes unavailable:', error?.message);
  }
}
watch(availableVersion, loadRelease, { immediate: true });

/** A count tile opens the full list at that group. */
async function showGroup(status) {
  showAllChanges.value = true;
  await nextTick();
  changeListElement.value?.querySelector(`[data-group="${status}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

// Focus moves into the dialog when it opens and back where it was when it closes.
watch(isDialog, async (open) => {
  if (open) {
    focusBeforeDialog = document.activeElement;
    await nextTick();
    primaryButton.value?.focus({ preventScroll: true });
  } else if (focusBeforeDialog?.isConnected) {
    focusBeforeDialog.focus({ preventScroll: true });
    focusBeforeDialog = null;
  }
});

/** Escape is Later; Tab cycles inside the dialog. */
function onDialogKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    dismiss();
    return;
  }
  if (event.key !== 'Tab' || !dialogElement.value) return;
  const controls = [...dialogElement.value.querySelectorAll('button, a[href]')].filter((control) => !control.disabled);
  if (!controls.length) return;
  const index = controls.indexOf(document.activeElement);
  const next = controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length];
  event.preventDefault();
  next.focus();
}

const LABELS = { goals: ['goal', 'goals'], chats: ['chat', 'chats'], workflows: ['workflow', 'workflows'], tools: ['tool run', 'tool runs'] };

/** "2 goals, 1 chat still running" or "Can't tell what's running". */
const blockedText = computed(() => {
  const b = state.value?.blocked;
  if (!b) return '';
  if (b.reason === 'busy') {
    const parts = Object.entries(LABELS)
      .map(([k, [one, many]]) => [Number(b.busy?.[k]) || 0, one, many])
      .filter(([n]) => n > 0)
      .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
    return `${parts.join(', ')} still running`;
  }
  return "Can't tell what's running";
});

function applyState(s) {
  const wasKey = keyOf(state.value);
  state.value = s;
  // New news clears an old dismissal; the same state stays dismissed.
  if (keyOf(s) !== wasKey && dismissedKey.value && dismissedKey.value !== keyOf(s)) dismissedKey.value = null;
  if (s?.phase !== 'installing') installing.value = false;
}

onMounted(async () => {
  if (electron?.autoUpdate) {
    unsubscribers.push(electron.autoUpdate.onState(applyState));
    try {
      applyState(await electron.autoUpdate.state());
    } catch (e) {
      console.log('[Update] auto-update state unavailable:', e?.message);
    }
    if (selfUpdating.value) return; // main handles everything from here
  }
  await checkNotice();
});

onUnmounted(() => {
  for (const off of unsubscribers) {
    try {
      off?.();
    } catch {
      /* listener already gone */
    }
  }
});

async function install(force) {
  if (!electron?.autoUpdate) return;
  installing.value = true;
  try {
    const r = await electron.autoUpdate.install({ force });
    // On refusal main has already set `blocked` in the state it pushed.
    if (!r?.ok) installing.value = false;
  } catch {
    installing.value = false;
  }
}

async function retry() {
  retrying.value = true;
  try {
    await electron?.autoUpdate?.check();
  } finally {
    retrying.value = false;
  }
}

async function checkNotice() {
  try {
    if (electron?.getAppVersion) {
      try {
        currentVersion.value = await electron.getAppVersion();
      } catch {
        /* fall through to the API */
      }
    }
    if (!currentVersion.value) {
      try {
        const data = await (await fetch(`${API_CONFIG.BASE_URL}/version`)).json();
        currentVersion.value = data.version;
      } catch (e) {
        console.error('[Update] Failed to get version from API:', e);
      }
    }

    let result = null;
    if (electron?.checkForUpdates) {
      try {
        result = await electron.checkForUpdates();
      } catch {
        result = null;
      }
    }
    if (!result || result.error) {
      try {
        result = await (await fetch(`${API_CONFIG.BASE_URL}/updates/check`)).json();
        if (result.currentVersion) currentVersion.value = result.currentVersion;
      } catch (e) {
        console.error('[Update] Failed to check local backend API:', e);
      }
    }
    if (result?.updateAvailable) {
      updateInfo.value = result;
      if (localStorage.getItem('agnt_dismissed_update') !== result.latestVersion) showNotice.value = true;
    }
  } catch (error) {
    console.error('[Update] Error checking for updates:', error);
  }
}

function openDownloads() {
  if (electron?.openDownloadPage) electron.openDownloadPage();
  else window.open('https://agnt.gg/downloads', '_blank');
  showNotice.value = false;
}

function dismiss() {
  if (selfUpdating.value) {
    // Later hides this banner; the download stays, and on macOS and AppImage it
    // still installs on the next quit.
    dismissedKey.value = keyOf(state.value);
    return;
  }
  showNotice.value = false;
  if (updateInfo.value?.latestVersion) localStorage.setItem('agnt_dismissed_update', updateInfo.value.latestVersion);
}

defineExpose({
  async checkNow() {
    if (selfUpdating.value) return electron.autoUpdate.check();
    await checkNotice();
    return updateInfo.value;
  },
});
</script>

<style scoped>
.update-banner {
  position: fixed;
  top: calc(50% - 100px);
  height: fit-content;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: min(640px, calc(100vw - 32px));
  background: linear-gradient(135deg, rgba(var(--green-rgb), 0.15) 0%, rgba(var(--green-rgb), 0.05) 100%);
  border: 1px solid rgba(var(--green-rgb), 0.4);
  border-radius: 12px;
  padding: 12px 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}

.update-banner.is-error {
  background: linear-gradient(135deg, rgba(var(--red-rgb, 254, 78, 78), 0.15) 0%, rgba(var(--red-rgb, 254, 78, 78), 0.05) 100%);
  border-color: rgba(var(--red-rgb, 254, 78, 78), 0.45);
}

.update-content {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.update-icon {
  font-size: 24px;
}

.update-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.update-title {
  font-family: var(--font-family-primary);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-green);
}

.is-error .update-title {
  color: var(--color-red, #fe4e4e);
}

.update-version {
  font-family: var(--font-family-mono);
  font-size: 12px;
  color: var(--fg-dim, rgba(255, 255, 255, 0.6));
  overflow-wrap: anywhere;
}

.update-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.update-btn {
  font-family: var(--font-family-mono);
  font-size: 12px;
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.update-banner .download-btn {
  background: var(--color-green, var(--color-green));
  color: var(--on-fill-success);
}

.update-banner .download-btn:hover {
  background: #14d974;
  transform: translateY(-1px);
}

.update-banner .download-btn:disabled,
.update-banner .download-btn:disabled:hover {
  opacity: 0.6;
  cursor: default;
  transform: none;
  background: var(--color-green, var(--color-green));
}

.update-banner .dismiss-btn {
  background: transparent;
  color: var(--fg-dim, rgba(255, 255, 255, 0.6));
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.update-banner .dismiss-btn:hover {
  background: var(--surface-active);
  color: var(--fg, #fff);
}

/* ── Update dialog: theme tokens only ── */
.update-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--scrim);
}

.update-dialog,
.update-dialog * {
  box-sizing: border-box;
}

.update-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: calc(100vh - 48px);
  overflow: hidden;
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 16px;
  box-shadow: var(--shadow-overlay);
  font-family: var(--font-family-primary);
  color: var(--text-primary);
  text-align: left;
}

.update-dialog::before {
  content: '';
  flex: none;
  height: 3px;
  background: var(--gradient-brand);
}

.update-dialog-close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 9px;
  font: inherit;
  font-size: 24px;
  font-weight: 300;
  line-height: 1;
  color: var(--text-secondary);
}

.update-dialog-head {
  display: grid;
  gap: 6px;
  padding: 22px 24px 20px;
  background: var(--gradient-wash);
}

.update-dialog-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.update-dialog-status::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-green);
  box-shadow: var(--glow-success);
}

.update-dialog-status.is-waiting::before {
  background: var(--text-yellow);
  box-shadow: none;
}

.update-dialog-title {
  margin: 2px 0 0;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.15;
  color: var(--text-primary);
}

.update-dialog-subtitle {
  margin: 0;
  font-size: 15px;
  color: var(--text-secondary);
}

.update-dialog-meta {
  margin: 0;
  font-size: 13.5px;
  color: var(--text-secondary);
}

.change-counts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
}

.change-count {
  display: grid;
  justify-items: start;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  font: inherit;
  text-align: left;
}

.change-count b {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: var(--text-primary);
}

.change-count span {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

/* The colour lives on a fill (the dot), never on text, so it reads in every theme. */
.change-count span::before,
.change-group h4::before {
  content: '';
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--change-dot);
}

.is-new {
  --change-dot: var(--text-green);
}

.is-updated {
  --change-dot: var(--text-blue);
}

.is-bug {
  --change-dot: var(--text-orange);
}

.change-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 24px 8px;
  border-top: 1px solid var(--terminal-border-color);
  scrollbar-width: thin;
}

.change-group {
  padding-top: 16px;
}

.change-group h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.change-group ul {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.change-group li {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 0 -10px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 14.5px;
  line-height: 1.45;
  color: var(--text-secondary);
}

.change-group li > span:first-child {
  flex: 1;
  min-width: 0;
}

.change-group li strong {
  font-weight: 600;
  color: var(--text-primary);
}

.plan-badge {
  flex: none;
  margin-top: 2px;
  padding: 0 7px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  line-height: 17px;
  color: var(--text-secondary);
}

.show-all-changes {
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% + 20px);
  margin: 6px -10px 10px;
  padding: 9px 10px;
  border-radius: 8px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  color: var(--text-secondary);
}

.show-all-changes::after {
  content: '›';
  margin-left: auto;
  font-size: 18px;
  line-height: 1;
  transition: transform 0.2s;
}

.show-all-changes[aria-expanded='true']::after {
  transform: rotate(-90deg);
}

.update-dialog-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid var(--terminal-border-color);
}

.changelog-link,
.update-dialog-warning {
  margin: 0 auto 0 0;
  font-size: 13.5px;
  color: var(--text-secondary);
}

.changelog-link {
  font-weight: 400;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.update-dialog-btn {
  min-height: 38px;
  padding: 0 16px;
  border-radius: 9px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}

.update-dialog-btn.is-secondary {
  border: 1px solid var(--terminal-border-color);
  color: var(--text-secondary);
}

.update-dialog-btn.is-primary {
  background: var(--fill-accent);
  color: var(--on-fill-accent);
}

.update-dialog-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.update-dialog-close:hover,
.change-count:hover,
.show-all-changes:hover,
.update-dialog-btn.is-secondary:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
  opacity: 1;
}

.change-group li:hover {
  background: var(--surface-hover);
}

.changelog-link:hover {
  color: var(--text-primary);
}

.update-dialog-close:focus-visible,
.change-count:focus-visible,
.show-all-changes:focus-visible,
.update-dialog-btn:focus-visible,
.changelog-link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

@media (max-width: 560px) {
  .update-overlay {
    padding: 0;
    place-items: end stretch;
  }

  .update-dialog {
    width: 100%;
    max-height: calc(100vh - 56px);
    border-bottom: 0;
    border-radius: 16px 16px 0 0;
  }

  .update-dialog::before {
    width: 36px;
    height: 4px;
    margin: 8px auto 0;
    border-radius: 2px;
    background: var(--border-strong);
  }

  .update-dialog-head {
    padding-top: 14px;
  }

  .update-dialog-title {
    font-size: 22px;
  }

  .update-dialog-close {
    top: 12px;
    right: 8px;
    width: 44px;
    height: 44px;
  }

  .change-count {
    padding: 10px 12px;
  }

  .update-dialog-foot {
    flex-wrap: wrap;
    padding-bottom: calc(14px + env(safe-area-inset-bottom));
  }

  .changelog-link,
  .update-dialog-warning {
    flex-basis: 100%;
  }

  .update-dialog-btn {
    flex: 1;
    min-height: 44px;
  }
}

.update-dialog-fade-enter-active,
.update-dialog-fade-leave-active {
  transition: opacity 0.2s ease;
}

.update-dialog-fade-enter-from,
.update-dialog-fade-leave-to {
  opacity: 0;
}

/* Transition animations */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}

.slide-down-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-20px);
}
</style>
