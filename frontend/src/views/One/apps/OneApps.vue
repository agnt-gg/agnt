<template>
  <section class="za za-page" :class="{ 'has-studio-panels': studioPanels }" aria-label="Apps" data-testid="one-apps">
    <!-- In Studio the sections and the create button are Studio's own panels (AppsScreen). -->
    <aside v-if="!studioPanels" class="za-sub" aria-label="Apps sections">
      <h2>Apps</h2>
      <template v-for="item in SECTIONS" :key="item.id">
      <!-- MCP servers and email & webhooks are for builders: grouped under their own label. -->
      <div v-if="item.id === 'mcp'" class="sub-label">Advanced</div>
      <button
        type="button"
        class="sub-item"
        :class="{ on: section === item.id }"
        :data-page="item.id"
        :aria-current="section === item.id ? 'page' : null"
        @click="go(item.id)"
      >
        <AppsGlyph :name="item.icon" /><span>{{ item.label }}</span>
        <span class="count">
          <span v-if="item.id === 'connections' && needsYou" v-tooltip="needYou(needsYou)" class="needs-pill">{{ needsYou }}</span>{{ counts[item.id] }}
        </span>
      </button>
      </template>
    </aside>

    <div class="za-main">
      <AppsConnections
        v-if="section === 'connections'"
        :rows="scope === 'team' ? teamRows : personalRows"
        :scope="scope"
        :team-name="team?.name || ''"
        :members="members"
        :can-manage="canManageTeam"
        :user-name="userName"
        :busy="busy"
        :checking="checking"
        :flash-id="flashId"
        @act="act"
      />
      <AppsPlugins v-else-if="section === 'plugins'" :rows="pluginList" :busy="busy" :preset-query="pluginQuery" @act="act" />
      <AppsMcp v-else-if="section === 'mcp'" :rows="mcpList" :busy="busy" @act="act" />
      <AppsTriggers v-else :rows="triggerList" :locked="lockedTriggers" @act="act" />
    </div>

    <ConnectionDrawer
      v-if="openConnection"
      :row="openConnection"
      :busy="busy[openConnection.id] || null"
      :user-name="userName"
      :team-name="team?.name || 'Team'"
      :members="members"
      :can-manage="canManageTeam"
      @act="act"
      @close="layer = null"
    />
    <PluginDrawer
      v-if="openPlugin"
      :row="openPlugin"
      :connection="openPlugin.provider ? personalRows.find((row) => row.id === openPlugin.provider.id) || null : null"
      :busy="pluginBusy(openPlugin)"
      @act="act"
      @close="layer = null"
    />
    <AddConnectionModal
      v-if="layer?.type === 'add'"
      :items="pickerItems"
      :team="scope === 'team' ? team : null"
      :team-options="teamOptions"
      :connect="connectFromPicker"
      :create-custom="createCustomApp"
      :team-connect="connectForTeam"
      @ask-annie="askAnnieForPlugin"
      @close="layer = null"
    />
    <UpgradeModal :open="showUpgrade" reason="Email and webhook triggers are included with AGNT Pro." @close="showUpgrade = false" />
  </section>
</template>

<script setup>
// The Apps page in AGNT One (approved mockup: projects/agnt-connections-zapier-mockup).
// Sections read the stores through appsModel and report every click here as an
// action; this component runs it on the real paths: sign-ins through
// useAppSignIn, plugins through pluginLifecycle, servers and triggers through
// their stores, team connections through the team server.
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useStore } from 'vuex';
import UpgradeModal from '@/components/UpgradeModal.vue';
import { useAppCards } from '@/composables/useAppCards.js';
import { useLicense } from '@/composables/useLicense';
import { findAppCard } from '@/services/appCards.js';
import { capabilityLabel } from '@/services/pluginDirectory.js';
import { requestUpdate, uninstallPlugin } from '@/services/pluginLifecycle.js';
import { escapeDisclosure } from '@/services/studioApps.js';
import { AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';
import { teamRequest } from '@/utils/teamClient.js';
import { useAppSignIn } from '@/views/Focused/useAppSignIn.js';
import { useTeam } from '@/views/One/team/useTeam.js';
import { TEAM_CONNECTION_PROVIDERS } from '@/views/_components/team/teamConnectionProviders.js';
import AddConnectionModal from './AddConnectionModal.vue';
import AppsConnections from './AppsConnections.vue';
import AppsGlyph from './AppsGlyph.vue';
import AppsMcp from './AppsMcp.vue';
import AppsPlugins from './AppsPlugins.vue';
import AppsTriggers from './AppsTriggers.vue';
import ConnectionDrawer from './ConnectionDrawer.vue';
import PluginDrawer from './PluginDrawer.vue';
import {
  SECTIONS,
  catalogueRows,
  connectionRows,
  customProviderData,
  customProviderId,
  mcpRows,
  mcpTestResult,
  needYou,
  plural,
  pluginRows,
  randomSuffix,
  sectionOfTab,
  tabOfSection,
  teamConnectionRows,
  teamProviderOptions,
  triggerRows,
} from './appsModel.js';

const props = defineProps({
  tab: { type: String, default: '' },
  // False while the page is hidden behind another view (a plugin's full details, an editor).
  active: { type: Boolean, default: true },
  // Studio draws the sections and the create button in its own left and right panels.
  studioPanels: { type: Boolean, default: false },
});
const emit = defineEmits(['open-integrations', 'open-mcp-manager', 'summary']);

const nav = inject('focusedNav');
const store = useStore();
const { cards } = useAppCards();
const findCard = (id) => findAppCard(cards.value, id);
const signIn = useAppSignIn({ store, nav, findCard });
const teamState = useTeam(store).state;
const { hasMail, hasHostedWebhooks } = useLicense();

const MODEL_IDS = new Set(AI_PROVIDERS_WITH_API.map((id) => String(id).toLowerCase()));
const section = computed(() => sectionOfTab(props.tab));
const scope = ref('personal');
const busy = reactive({});
const checking = ref(false);
const flashId = ref(null);
const layer = ref(null);
const pluginQuery = ref(null);
const mcpTests = reactive({});
const teamConnections = ref([]);
const showUpgrade = ref(false);

// ── What the sections show ───────────────────────────────────────────────
const catalogue = computed(() => store.state.appAuth?.allProviders || []);
const installed = computed(() => store.getters['apps/installed'] || []);
const team = computed(() => teamState.team || null);
const members = computed(() => teamState.members || []);
const canManageTeam = computed(() => ['owner', 'admin'].includes(team.value?.role));
const userName = computed(() => store.getters['userAuth/userPseudonym'] || store.getters['userAuth/userEmail'] || 'You');

const personalRows = computed(() =>
  connectionRows({ cards: cards.value, catalogue: catalogue.value, health: store.state.appAuth?.connectionHealth?.providers, installed: installed.value }),
);
const teamOptions = computed(() => teamProviderOptions(TEAM_CONNECTION_PROVIDERS, MODEL_IDS));
const teamRows = computed(() => teamConnectionRows(teamConnections.value, teamOptions.value));
const pluginList = computed(() =>
  pluginRows({ installed: installed.value, available: store.getters['apps/available'], connections: personalRows.value, catalogue: catalogue.value, modelIds: MODEL_IDS }),
);
const mcpList = computed(() => mcpRows(store.state.mcpServers?.servers, mcpTests));
const lockedTriggers = computed(() => ({ email: !hasMail.value, webhooks: !hasHostedWebhooks.value }));
const triggerList = computed(() =>
  triggerRows(hasHostedWebhooks.value ? store.state.webhooks?.webhooks : [], hasMail.value ? store.state.emailListeners?.emailListeners : []),
);
const pickerItems = computed(() => catalogueRows({ catalogue: catalogue.value, connections: personalRows.value, modelIds: MODEL_IDS }));
const needsYou = computed(() => personalRows.value.filter((row) => row.status !== 'ready').length);
const counts = computed(() => ({
  connections: (scope.value === 'team' ? teamRows.value : personalRows.value).length,
  plugins: pluginList.value.length,
  mcp: mcpList.value.length,
  triggers: triggerList.value.length,
}));
const openConnection = computed(() => {
  if (layer.value?.type !== 'connection') return null;
  return [...personalRows.value, ...teamRows.value].find((row) => row.id === layer.value.id) || null;
});
const openPlugin = computed(() => (layer.value?.type === 'plugin' ? pluginList.value.find((row) => row.id === layer.value.id) || null : null));
const pluginBusy = (row) => (row.provider && busy[row.provider.id] === 'signin' ? 'signin' : busy[`plugin:${row.id}`] || null);

// ── Moving around ────────────────────────────────────────────────────────
function go(target) {
  layer.value = null;
  const tab = tabOfSection(target);
  nav.go({ page: 'connectors', ...(tab ? { tab } : {}) });
}
const quiet = (promise) => Promise.resolve(promise).catch((error) => console.warn('[apps]', error?.message || error));
const errorText = (error) => error?.message || String(error);

const loadWebhooks = () => { if (hasHostedWebhooks.value) quiet(store.dispatch('webhooks/fetchWebhooks')); };
const loadEmailListeners = () => { if (hasMail.value) quiet(store.dispatch('emailListeners/fetchEmailListeners')); };
function loadServersAndTriggers() {
  quiet(store.dispatch('mcpServers/fetchServers'));
  loadWebhooks();
  loadEmailListeners();
}
// The licence usually arrives after the page mounts: load each kind of trigger once it is included.
watch(() => hasHostedWebhooks.value, (included) => { if (included) loadWebhooks(); });
watch(() => hasMail.value, (included) => { if (included) loadEmailListeners(); });
// Opening a section shows it as it is now.
watch(section, (now) => {
  if (now === 'mcp') quiet(store.dispatch('mcpServers/fetchServers'));
  if (now === 'triggers') {
    loadWebhooks();
    loadEmailListeners();
  }
});
async function loadTeamConnections() {
  if (!team.value) {
    teamConnections.value = [];
    return;
  }
  try {
    const list = await teamRequest(`/${team.value.id}/connections`);
    teamConnections.value = Array.isArray(list) ? list : [];
  } catch (error) {
    nav.toast(`Couldn’t load ${team.value.name}’s connections. ${errorText(error)}`);
  }
}
watch(() => [scope.value, team.value?.id], () => { if (scope.value === 'team') loadTeamConnections(); });
watch(team, (value) => { if (!value && scope.value === 'team') scope.value = 'personal'; });
watch(() => props.tab, () => { layer.value = null; });
watch(() => props.active, (active) => {
  if (!active) return;
  quiet(store.dispatch('appAuth/fetchAllProviders', { forceRefresh: true }));
  loadServersAndTriggers();
});
watch(flashId, (id) => { if (id) setTimeout(() => { if (flashId.value === id) flashId.value = null; }, 2600); });

// ── Connections ──────────────────────────────────────────────────────────
const isModel = (id) => MODEL_IDS.has(String(id || '').toLowerCase());
/** The app card for a sign-in, or one built from its catalogue entry when nothing uses it yet. */
function cardFor(id, fallback = {}) {
  const card = findCard(id);
  if (card) return card;
  const wanted = String(id).toLowerCase();
  const entry = catalogue.value.find((candidate) => String(candidate.id).toLowerCase() === wanted) || {};
  const type = entry.connectionType ?? entry.connection_type ?? fallback.connectionType ?? '';
  return { providerId: entry.id ? String(entry.id) : id, name: entry.name || fallback.name || id, connectionType: String(type).toLowerCase(), apps: [] };
}

async function runSignIn(card, key = card.providerId) {
  if (busy[key]) return false;
  busy[key] = 'signin';
  try {
    return await signIn.signIn(card);
  } finally {
    delete busy[key];
  }
}

/** The connection-health check, which checks every sign-in at once; `ids` show "Testing…" meanwhile. */
async function runHealthCheck(ids) {
  const keys = ids.filter((id) => !busy[id]);
  keys.forEach((id) => { busy[id] = 'test'; });
  try {
    const health = await store.dispatch('appAuth/checkConnectionHealth');
    if (!health) throw new Error('The check did not answer.');
    return true;
  } catch (error) {
    nav.toast(`Couldn’t check connections. ${errorText(error)}`);
    return false;
  } finally {
    keys.forEach((id) => { delete busy[id]; });
  }
}
async function testConnection(row) {
  if (row.team) return testTeamConnection(row);
  if (!(await runHealthCheck([row.id]))) return;
  const now = personalRows.value.find((candidate) => candidate.id === row.id);
  if (now?.status === 'ready') nav.toast(`${row.name} works.`);
  else nav.toast(`${row.name} needs you to reconnect.${now?.problem ? ` ${now.problem}.` : ''}`);
}
async function checkAll() {
  if (checking.value) return;
  checking.value = true;
  try {
    if (await runHealthCheck([])) nav.toast(`Checked ${plural(personalRows.value.length, 'connection')} · ${needYou(needsYou.value)}`);
  } finally {
    checking.value = false;
  }
}

async function disconnectConnection(row) {
  if (row.team) return disconnectTeam([row]);
  if (row.ai) return nav.go({ page: 'settings' });
  const done = await signIn.disconnect(row.card);
  if (done && layer.value?.id === row.id) layer.value = null;
}

// ── Team connections ─────────────────────────────────────────────────────
async function connectForTeam({ providerId, name }) {
  try {
    await teamRequest(`/${team.value.id}/connections`, { method: 'POST', body: JSON.stringify({ providerId, name }) });
    await loadTeamConnections();
    layer.value = null;
    nav.toast(`${name} connected for ${team.value.name}.`);
  } catch (error) {
    nav.toast(`Couldn’t connect ${name}. ${errorText(error)}`);
  }
}
async function testTeamConnection(row) {
  if (busy[row.id]) return;
  busy[row.id] = 'test';
  try {
    const result = await teamRequest(`/${team.value.id}/connections/${row.teamConnectionId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ operation: { name: 'github.listRepositories' } }),
    });
    nav.toast(`${row.name} works · ${plural(result?.repositories?.length ?? 0, 'repository', 'repositories')}`);
  } catch (error) {
    nav.toast(`${row.name} didn’t work. ${errorText(error)}`);
  } finally {
    delete busy[row.id];
  }
}
async function disconnectTeam(rows, clear) {
  const one = rows.length === 1 ? rows[0] : null;
  const confirmed = await nav.confirm({
    title: one ? `Disconnect ${one.name}?` : `Disconnect ${plural(rows.length, 'team connection')}?`,
    message: 'Teammates and the team’s automations lose it. You can connect it for the team again.',
    confirmText: 'Disconnect',
    danger: true,
  });
  if (!confirmed) return;
  let done = 0;
  for (const row of rows) {
    try {
      await teamRequest(`/${team.value.id}/connections/${row.teamConnectionId}`, { method: 'DELETE' });
      done += 1;
    } catch (error) {
      nav.toast(`Couldn’t disconnect ${row.name}. ${errorText(error)}`);
    }
  }
  clear?.();
  if (rows.some((row) => row.id === layer.value?.id)) layer.value = null;
  await loadTeamConnections();
  if (done) nav.toast(one ? `${one.name} disconnected.` : `${plural(done, 'team connection')} disconnected.`);
}

// ── Add connection ───────────────────────────────────────────────────────
async function connectFromPicker(item) {
  if (item.ai) {
    layer.value = null;
    return nav.go({ page: 'settings' });
  }
  return runSignIn(cardFor(item.id, item), item.id);
}
async function createCustomApp(form) {
  const name = form.name.trim();
  const id = customProviderId(name, catalogue.value.map((entry) => entry.id), randomSuffix());
  await store.dispatch('appAuth/createProvider', customProviderData(form, id));
  const saved = await signIn.saveKey({ providerId: id, name, connectionType: 'apikey', apps: [] }, form.key);
  if (!saved) throw new Error(`${name} was added, but its key wasn’t saved. ${signIn.error.value || ''} Find it in the list and press Connect.`.replace(/\s+/g, ' ').trim());
  layer.value = null;
  scope.value = 'personal';
  if (section.value !== 'connections') go('connections');
  flashId.value = id;
}
function askAnnieForPlugin(name) {
  layer.value = null;
  nav.ask(`Build a plugin that connects AGNT to ${name || 'an app I use'} with its sign-in page.`);
}

// ── Plugins ──────────────────────────────────────────────────────────────
const refreshPlugins = () =>
  Promise.all([quiet(store.dispatch('apps/fetchInstalled', { force: true })), quiet(store.dispatch('apps/fetchAvailable', { force: true }))]);

async function updatePlugin(row, { silent = false } = {}) {
  const key = `plugin:${row.id}`;
  if (busy[key]) return 'busy';
  busy[key] = 'update';
  try {
    let result = await requestUpdate(row.id);
    if (result.requiresConsent) {
      if (silent) return 'consent';
      const added = (result.permissionDiff?.added || []).map((cap) => `<b>${escapeDisclosure(capabilityLabel(cap))}</b>`);
      const confirmed = await nav.confirm({
        title: `${row.label} wants new access`,
        message: `The new version adds access the installed one does not have:<br><br>${added.join('<br>') || '<b>New permissions</b>'}<br><br>Nothing has been installed. Allow this and update?`,
        confirmText: 'Allow and update',
      });
      if (!confirmed) return 'declined';
      result = await requestUpdate(row.id, { acceptedPermissions: true });
      if (result.requiresConsent) throw new Error('The update still needs your consent. Please retry.');
    }
    if (!silent) nav.toast(`${row.label} updated${result.version ? ` to v${result.version}` : ''}.`);
    return 'updated';
  } catch (error) {
    nav.toast(`Couldn’t update ${row.label}. ${errorText(error)}`);
    return 'failed';
  } finally {
    delete busy[key];
    await refreshPlugins();
  }
}
async function updateMany(rows, clear) {
  const outcomes = [];
  for (const row of rows.filter((candidate) => candidate.update)) outcomes.push([row, await updatePlugin(row, { silent: true })]);
  clear?.();
  const updated = outcomes.filter(([, outcome]) => outcome === 'updated').length;
  const consent = outcomes.filter(([, outcome]) => outcome === 'consent').map(([row]) => row.label);
  nav.toast([`${plural(updated, 'plugin')} updated.`, consent.length ? `${consent.join(', ')} ${consent.length === 1 ? 'asks' : 'ask'} for new access: update ${consent.length === 1 ? 'it' : 'each'} on its own to review.` : ''].filter(Boolean).join(' '));
}

const UNINSTALL_MESSAGE = 'Its tools stop working for every agent and workflow that uses them.<br><br>Agents, workflows and widgets it added that you edited are kept as your own.';
async function uninstallOne(row) {
  const confirmed = await nav.confirm({ title: `Uninstall ${row.label}?`, message: UNINSTALL_MESSAGE, confirmText: 'Uninstall', danger: true });
  if (!confirmed) return;
  const key = `plugin:${row.id}`;
  busy[key] = 'uninstall';
  try {
    await uninstallPlugin(row.id);
    if (layer.value?.id === row.id) layer.value = null;
    nav.toast(`${row.label} uninstalled.`);
    quiet(store.dispatch('tools/refreshAllTools'));
  } catch (error) {
    nav.toast(`Couldn’t uninstall ${row.label}. ${errorText(error)}`);
  } finally {
    delete busy[key];
    await refreshPlugins();
  }
}
async function uninstallMany(rows, clear) {
  const confirmed = await nav.confirm({
    title: `Uninstall ${plural(rows.length, 'plugin')}?`,
    message: 'Their tools stop working for every agent and workflow that uses them.<br><br>Agents, workflows and widgets they added that you edited are kept as your own.',
    confirmText: 'Uninstall',
    danger: true,
  });
  if (!confirmed) return;
  let done = 0;
  for (const row of rows) {
    try {
      await uninstallPlugin(row.id);
      done += 1;
    } catch (error) {
      nav.toast(`Couldn’t uninstall ${row.label}. ${errorText(error)}`);
    }
  }
  clear?.();
  quiet(store.dispatch('tools/refreshAllTools'));
  await refreshPlugins();
  if (done) nav.toast(`${plural(done, 'plugin')} uninstalled.`);
}

// ── MCP servers ──────────────────────────────────────────────────────────
async function testServer(row, { report = true } = {}) {
  const key = `mcp:${row.id}`;
  if (busy[key]) return;
  busy[key] = 'test';
  try {
    const result = mcpTestResult(await store.dispatch('mcpServers/testConnection', row.id));
    mcpTests[row.id] = result;
    if (report) nav.toast(result.ok ? `${row.name} responded.` : `${row.name} didn’t respond. ${result.message}`);
  } finally {
    delete busy[key];
  }
}
async function testServers(rows, clear) {
  // One at a time: each test starts the server's process.
  for (const row of rows) await testServer(row, { report: false });
  clear?.();
  const failing = rows.filter((row) => mcpTests[row.id] && !mcpTests[row.id].ok).map((row) => row.name);
  nav.toast(failing.length ? `${listOrCount(failing)} didn’t respond.` : `${plural(rows.length, 'server')} responded.`);
}
const listOrCount = (names) => (names.length <= 3 ? names.join(', ') : plural(names.length, 'server'));
async function removeServers(rows, clear) {
  const one = rows.length === 1 ? rows[0] : null;
  const confirmed = await nav.confirm({
    title: one ? `Remove ${one.name}?` : `Remove ${plural(rows.length, 'server')}?`,
    message: 'Annie and your agents stop seeing its tools. You can add it again from the MCP library.',
    confirmText: 'Remove',
    danger: true,
  });
  if (!confirmed) return;
  let done = 0;
  for (const row of rows) {
    const result = await store.dispatch('mcpServers/deleteServer', row.id);
    if (result?.success) {
      done += 1;
      delete mcpTests[row.id];
    } else nav.toast(`Couldn’t remove ${row.name}. ${result?.error || ''}`.trim());
  }
  clear?.();
  quiet(store.dispatch('mcpServers/fetchServers'));
  if (done) nav.toast(one ? `${one.name} removed.` : `${plural(done, 'server')} removed.`);
}

// ── Email & webhooks ─────────────────────────────────────────────────────
async function copyTrigger(row) {
  const text = row.kind === 'Email' ? row.address : row.url;
  try {
    await navigator.clipboard.writeText(text);
    nav.toast(row.kind === 'Email' ? 'Address copied.' : 'Webhook URL copied.');
  } catch (error) {
    nav.toast(`Couldn’t copy. ${errorText(error)}`);
  }
}
async function removeWebhooks(rows, clear) {
  const hooks = rows.filter((row) => row.kind === 'Webhook');
  if (!hooks.length) return;
  const one = hooks.length === 1 ? hooks[0] : null;
  const confirmed = await nav.confirm({
    title: one ? 'Remove this webhook?' : `Remove ${plural(hooks.length, 'webhook')}?`,
    message: one ? `${one.workflow} stops receiving calls to its URL.` : 'Their workflows stop receiving calls to their URLs.',
    confirmText: 'Remove',
    danger: true,
  });
  if (!confirmed) return;
  let done = 0;
  for (const row of hooks) {
    const result = await store.dispatch('webhooks/deleteWebhook', row.workflowId);
    if (result?.success) done += 1;
    else nav.toast(`Couldn’t remove the webhook for ${row.workflow}. ${result?.error || ''}`.trim());
  }
  clear?.();
  if (done) nav.toast(one ? 'Webhook removed.' : `${plural(done, 'webhook')} removed.`);
}

// ── Every click the sections report ──────────────────────────────────────
const ACTIONS = {
  add: () => { layer.value = { type: 'add' }; },
  scope: (value) => { scope.value = value === 'team' && team.value ? 'team' : 'personal'; },
  open: (row) => { layer.value = { type: section.value === 'plugins' ? 'plugin' : 'connection', id: row.id }; },
  signin: (row) => {
    if (row.provider) return runSignIn(cardFor(row.provider.id, row.provider), row.provider.id);
    if (row.team) return null;
    if (row.ai || isModel(row.id)) return nav.go({ page: 'settings' });
    return runSignIn(row.card, row.id);
  },
  test: (row) => testConnection(row),
  'check-all': () => checkAll(),
  disconnect: (row) => disconnectConnection(row),
  'show-plugins': (row) => {
    pluginQuery.value = { q: row.appName };
    go('plugins');
  },
  'open-plugin': (row, name) => {
    if (pluginList.value.some((plugin) => plugin.id === name)) layer.value = { type: 'plugin', id: name };
    else nav.go({ page: 'connectors', item: `app:${name}` });
  },
  market: (row, name) => nav.go({ page: 'connectors', item: `app:${name}` }),
  'ai-models': () => nav.go({ page: 'settings' }),
  'edit-app': () => {
    layer.value = null;
    emit('open-integrations');
  },
  'open-connection': (row) => {
    if (personalRows.value.some((candidate) => candidate.id === row.provider.id)) layer.value = { type: 'connection', id: row.provider.id };
    else runSignIn(cardFor(row.provider.id, row.provider), row.provider.id);
  },
  try: (row) => nav.ask(row.plugin?.prompt || `Use ${row.label} to `),
  update: (row) => updatePlugin(row),
  'bulk-update': (rows, clear) => updateMany(rows, clear),
  uninstall: (row) => uninstallOne(row),
  'bulk-uninstall': (rows, clear) => uninstallMany(rows, clear),
  details: (row) => nav.go({ page: 'connectors', item: `app:${row.id}` }),
  browse: () => nav.go({ page: 'market' }),
  build: () => nav.studio('PluginsScreen'),
  'mcp-test': (row) => testServer(row),
  'mcp-bulk-test': (rows, clear) => testServers(rows, clear),
  'mcp-remove': (row) => removeServers([row]),
  'mcp-bulk-remove': (rows, clear) => removeServers(rows, clear),
  'mcp-manage': () => emit('open-mcp-manager'),
  workflows: () => nav.go({ page: 'library', tab: 'workflows' }),
  'open-workflow': (row) => nav.go({ page: 'library', tab: 'workflows', item: row.workflowId }),
  copy: (row) => copyTrigger(row),
  'remove-webhook': (row) => removeWebhooks([row]),
  'bulk-remove-webhooks': (rows, clear) => removeWebhooks(rows, clear),
  upgrade: () => { showUpgrade.value = true; },
};
function act(name, row, extra) {
  const run = ACTIONS[name];
  if (!run) return console.warn(`[apps] no action "${name}"`);
  return Promise.resolve(run(row, extra)).catch((error) => {
    console.error(`[apps] ${name}:`, error);
    nav.toast(errorText(error));
  });
}

// ── For Studio's panels: what the page shows, and its actions by name ──────
const summary = computed(() => ({
  section: section.value,
  counts: counts.value,
  needsYou: needsYou.value,
  broken: personalRows.value.filter((row) => row.status !== 'ready').map((row) => ({ id: row.id, name: row.name, problem: row.problem || '', status: row.status })),
}));
watch(summary, (value) => emit('summary', value), { immediate: true, deep: true });
/** A connection's fix (Reconnect / Connect), by its id. */
function fix(id) {
  const row = personalRows.value.find((candidate) => candidate.id === id);
  if (row) return act('signin', row);
  return undefined;
}
defineExpose({ act, fix, go });

// Escape closes the open drawer or dialog, unless a confirm dialog sits above it.
function onKeydown(event) {
  if (event.key !== 'Escape' || !layer.value || document.querySelector('.modal-overlay')) return;
  layer.value = null;
}
onMounted(() => {
  loadServersAndTriggers();
  document.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown));
</script>

<style src="./appsPage.css"></style>
