<!-- PluginBuilder.vue — the Plugin Forge.

     One idea: the conversation IS the builder. Before anything exists the
     page is a single question and a composer. Once a draft exists the chat
     stays pinned on the left and the plugin it is producing sits on the
     right (Overview · Test · Code), so the input is never below the fold.

     Install state is the only status the page needs, and it is derived, not
     stored: the draft's fingerprint against the fingerprint of what was last
     installed (pluginBuilder.installedHash), plus whether the plugin is still
     installed at all (installedNames, owned by the parent's list).

     Test runs the INSTALLED tool through POST /tools/:type/execute — the same
     path an agent uses. There is no pre-install sandbox, so Test is gated on
     "installed and unchanged" and says so rather than implying isolation. -->
<template>
  <div class="forge" :class="{ 'is-mobile': mobileView }">
    <header class="forge-bar">
      <button class="crumb-back" @click="$emit('back')">
        <i class="fas fa-arrow-left"></i>
        <span>Plugin Forge</span>
      </button>
      <span class="crumb-sep">/</span>
      <span class="crumb-current">{{ hasDraft && isGenerationComplete ? displayName : 'New plugin' }}</span>
      <span v-if="isGenerationComplete" class="status-pill" :class="installState">{{ installStateLabel }}</span>
      <span class="bar-spacer"></span>
      <template v-if="hasDraft">
        <button class="text-button" :disabled="isBusy" @click="startOver">Start over</button>
        <BaseButton class="btn-compact"
          variant="secondary"
          :disabled="installState !== 'installed' || isBusy"
          v-tooltip="installState === 'installed' ? 'Publish this plugin to the marketplace' : 'Install your latest changes first'"
          @click="$emit('publish', pluginName)"
        >
          <i class="fas fa-cloud-upload-alt"></i> Publish…
        </BaseButton>
        <BaseButton class="btn-compact" variant="primary" :disabled="!isGenerationComplete || isBusy || installState === 'installed'" @click="buildAndInstall">
          <i class="fas" :class="isBuilding ? 'fa-spinner fa-spin' : installState === 'installed' ? 'fa-check' : 'fa-download'"></i>
          {{ installLabel }}
        </BaseButton>
      </template>
    </header>

    <!-- START: nothing exists yet, so the page is one question. -->
    <section v-if="!hasDraft" class="forge-start">
      <h2 class="start-title">What should your plugin do?</h2>
      <p class="start-sub">Describe it in plain words. You'll see it, test it and install it right here.</p>
      <div class="composer composer-large">
        <textarea
          ref="startInputRef"
          v-model="draftMessage"
          rows="3"
          placeholder="e.g. Connect to Notion so agents can create pages and search my workspace…"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <div class="composer-row">
          <span class="model-label" v-tooltip="'Uses the model selected in chat'">{{ modelLabel }}</span>
          <button class="send-button" :disabled="!canSend" aria-label="Generate plugin" @click="send">
            <i class="fas fa-arrow-up"></i>
          </button>
        </div>
      </div>
      <div class="starters">
        <button v-for="starter in starters" :key="starter.label" class="starter" @click="useStarter(starter)">{{ starter.label }}</button>
      </div>
      <p class="start-alt">
        Bundling agents, workflows or tools you already have?
        <button class="text-link" @click="$emit('open-pack')">Make a pack instead</button>
      </p>
    </section>

    <!-- WORKING: chat pinned left, the plugin on the right. -->
    <div v-else class="forge-split">
      <nav v-if="mobileView" class="pane-tabs mobile-tabs">
        <button v-for="tab in paneTabs" :key="tab.key" class="pane-tab" :class="{ active: paneTab === tab.key }" @click="paneTab = tab.key">
          {{ tab.label }}
        </button>
      </nav>

      <section v-show="!mobileView || paneTab === 'chat'" class="forge-chat">
        <div ref="messagesRef" class="chat-messages">
          <div v-for="message in conversation" :key="message.id" class="message" :class="message.role">{{ message.content }}</div>
          <div v-if="isGenerating" class="message assistant">
            <div class="steps">
              <span v-for="step in steps" :key="step.key" class="step" :class="step.state">
                <i class="fas" :class="step.state === 'done' ? 'fa-check' : step.state === 'active' ? 'fa-spinner fa-spin' : 'fa-circle'"></i>
                {{ step.label }}
              </span>
            </div>
          </div>
        </div>
        <div class="composer">
          <textarea
            v-model="draftMessage"
            rows="2"
            :placeholder="isGenerationComplete ? 'Ask for a change…' : 'Describe your plugin…'"
            :disabled="isBusy"
            @keydown.enter.exact.prevent="send"
          ></textarea>
          <div class="composer-row">
            <span class="model-label" v-tooltip="'Uses the model selected in chat'">{{ modelLabel }}</span>
            <button class="send-button" :disabled="!canSend" aria-label="Send" @click="send">
              <i class="fas" :class="isGenerating ? 'fa-spinner fa-spin' : 'fa-arrow-up'"></i>
            </button>
          </div>
        </div>
      </section>

      <section v-show="!mobileView || paneTab !== 'chat'" class="forge-pane">
        <nav v-if="!mobileView" class="pane-tabs">
          <button v-for="tab in paneTabs" :key="tab.key" class="pane-tab" :class="{ active: paneTab === tab.key }" @click="paneTab = tab.key">
            {{ tab.label }}
          </button>
        </nav>

        <div v-if="!isGenerationComplete" class="pane-empty">
          <i class="fas" :class="isGenerating ? 'fa-spinner fa-spin' : 'fa-puzzle-piece'"></i>
          <p>{{ isGenerating ? 'Building your plugin…' : 'Your plugin shows up here as soon as it is generated.' }}</p>
        </div>

        <!-- OVERVIEW -->
        <div v-else-if="paneTab === 'overview'" class="pane-body">
          <div class="overview-head">
            <span class="overview-icon"><SvgIcon :name="manifest.icon || 'custom'" /></span>
            <div>
              <h3 class="overview-name">{{ displayName }}</h3>
              <span class="meta">v{{ manifest.version || '0.0.0' }} · {{ toolCountLabel }}</span>
            </div>
          </div>
          <p v-if="manifest.description" class="overview-description">{{ manifest.description }}</p>

          <article v-for="tool in tools" :key="tool.type" class="tool-row">
            <div class="tool-row-head">
              <span class="tool-title">{{ toolTitle(tool) }}</span>
              <i v-if="resultFor(tool)" class="fas result-mark" :class="resultFor(tool).ok ? 'fa-check ok' : 'fa-times bad'"></i>
              <span class="bar-spacer"></span>
              <button class="text-link" @click="openTest(tool)">Test <i class="fas fa-chevron-right"></i></button>
            </div>
            <code class="tool-type">{{ tool.type }}</code>
            <p v-if="tool.schema?.description" class="tool-description">{{ tool.schema.description }}</p>
            <div v-if="parametersOf(tool).length" class="chips">
              <span v-for="param in parametersOf(tool)" :key="param.name" class="chip">{{ param.name }}{{ param.required ? '' : '?' }}</span>
            </div>
          </article>

          <div v-if="capabilities.length" class="callout">
            <i class="fas fa-shield-alt"></i>
            <span>Asks for: {{ capabilities.join(', ') }}</span>
          </div>
        </div>

        <!-- TEST -->
        <div v-else-if="paneTab === 'test'" class="pane-body test-layout">
          <nav class="test-tools">
            <button
              v-for="tool in tools"
              :key="tool.type"
              class="test-tool"
              :class="{ active: selectedToolType === tool.type }"
              @click="selectTool(tool)"
            >
              <span>{{ toolTitle(tool) }}</span>
              <i v-if="resultFor(tool)" class="fas" :class="resultFor(tool).ok ? 'fa-check ok' : 'fa-times bad'"></i>
            </button>
          </nav>

          <div v-if="selectedTool" class="test-body">
            <div v-if="installState !== 'installed'" class="callout">
              <i class="fas fa-info-circle"></i>
              <span>{{ installState === 'changed' ? 'Your latest changes are not installed yet. Install them to test what you see.' : 'Install the plugin to run its tools.' }}</span>
              <span class="bar-spacer"></span>
              <BaseButton class="btn-compact" variant="secondary" :disabled="isBusy" @click="buildAndInstall">{{ installLabel }}</BaseButton>
            </div>

            <div class="test-fields">
              <label v-for="param in visibleParameters" :key="param.name" class="field">
                <span class="field-label">
                  {{ param.name }}
                  <em v-if="param.required" class="field-required">required</em>
                </span>
                <BaseSelect
                  v-if="param.inputType === 'select' && param.options.length"
                  v-model="testArgs[param.name]"
                  :options="param.options.map((option) => ({ value: option, label: String(option) }))"
                />
                <input v-else-if="param.inputType === 'checkbox' || param.type === 'boolean'" v-model="testArgs[param.name]" type="checkbox" class="field-checkbox" />
                <textarea v-else-if="param.inputType === 'textarea' || param.inputType === 'codearea'" v-model="testArgs[param.name]" rows="3" class="field-input"></textarea>
                <input v-else v-model="testArgs[param.name]" :type="param.type === 'number' ? 'number' : 'text'" class="field-input" />
                <span v-if="param.description" class="field-hint">{{ param.description }}</span>
              </label>
              <p v-if="!visibleParameters.length" class="meta">This tool takes no inputs.</p>
            </div>

            <div class="test-actions">
              <BaseButton class="btn-compact" variant="primary" :disabled="installState !== 'installed' || isTesting || isBusy" @click="runTest">
                <i class="fas" :class="isTesting ? 'fa-spinner fa-spin' : 'fa-play'"></i> Run
              </BaseButton>
              <span class="meta">Runs the installed tool for real, exactly as an agent would call it.</span>
            </div>

            <div v-if="selectedResult" class="test-result" :class="selectedResult.ok ? 'ok' : 'bad'">
              <div class="test-result-head">
                <i class="fas" :class="selectedResult.ok ? 'fa-check' : 'fa-times'"></i>
                <span>{{ selectedResult.ok ? 'Passed' : 'Failed' }} · {{ selectedResult.ms }} ms</span>
                <span class="bar-spacer"></span>
                <button v-if="!selectedResult.ok" class="text-link" :disabled="isBusy" @click="askToFix">Ask to fix</button>
              </div>
              <pre class="code-block">{{ selectedResult.output }}</pre>
            </div>
          </div>
        </div>

        <!-- CODE -->
        <div v-else-if="paneTab === 'code'" class="pane-body code-layout">
          <nav class="file-list">
            <button
              v-for="file in generatedFiles"
              :key="file.name"
              class="file-item"
              :class="{ active: activePreviewFile === file.name }"
              @click="selectFile(file.name)"
            >
              {{ file.name }}
            </button>
          </nav>
          <div class="file-editor">
            <div class="file-editor-head">
              <span>{{ activePreviewFile || 'Select a file' }}</span>
              <button v-if="activePreviewFile" class="text-link" @click="copyFileContent"><i class="fas fa-copy"></i> Copy</button>
            </div>
            <textarea v-if="activePreviewFile" v-model="fileContentModel" class="code-block code-editor" spellcheck="false"></textarea>
          </div>
        </div>
      </section>
    </div>

    <SimpleModal ref="modalRef" />
  </div>
</template>

<script>
import { ref, computed, watch, inject, nextTick, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import BaseSelect from '@/views/Terminal/_components/BaseSelect.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { API_CONFIG } from '@/tt.config.js';
import { apiFetch } from '@/utils/apiFetch.js';

const STEP_ORDER = ['manifest', 'code', 'package', 'complete'];
const STEPS = [
  { key: 'manifest', label: 'Manifest' },
  { key: 'code', label: 'Tool code' },
  { key: 'package', label: 'Package' },
];

const STARTERS = [
  { label: 'Notion pages & databases', prompt: 'Connect to Notion so agents can create pages, query databases and search my workspace.' },
  { label: 'Slack messages', prompt: 'Send and read Slack messages in channels and DMs.' },
  { label: 'Stripe payments', prompt: 'Look up Stripe customers, payments and subscriptions, and create payment links.' },
  { label: 'Wrap a REST API', prompt: 'Wrap this REST API as plugin tools (paste the docs URL or endpoints): ' },
];

/** Tool parameters in manifest order, normalised for the test form. */
function parametersOf(tool) {
  const parameters = tool?.schema?.parameters || {};
  return Object.entries(parameters).map(([name, spec]) => ({
    name,
    type: spec?.type || 'string',
    inputType: spec?.inputType || 'text',
    description: spec?.description || '',
    required: Boolean(spec?.required),
    options: Array.isArray(spec?.options) ? spec.options : [],
    default: spec?.default,
    conditional: spec?.conditional || null,
  }));
}

/** Form values → tool args: numbers become numbers, blanks are omitted. */
function toToolArgs(parameters, values) {
  const args = {};
  for (const param of parameters) {
    const value = values[param.name];
    if (value === '' || value === undefined || value === null) continue;
    args[param.name] = param.type === 'number' ? Number(value) : value;
  }
  return args;
}

function formatOutput(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default {
  name: 'PluginBuilder',
  components: { BaseButton, BaseSelect, SvgIcon, SimpleModal },
  props: {
    // Names of installed plugins, owned by the parent's list.
    installedNames: { type: Array, default: () => [] },
  },
  emits: ['show-alert', 'plugin-installed', 'back', 'publish', 'open-pack'],
  setup(props, { emit }) {
    const store = useStore();
    const mobileView = inject('isMobile', ref(false));
    const playSound = inject('playSound', () => {});
    const builder = computed(() => store.state.pluginBuilder);

    const modalRef = ref(null);
    const messagesRef = ref(null);
    const startInputRef = ref(null);
    const draftMessage = ref('');
    const paneTab = ref(mobileView.value ? 'chat' : 'overview');
    const selectedToolType = ref(null);
    const testArgs = ref({});
    const isTesting = ref(false);

    const isGenerating = computed(() => builder.value.isGenerating);
    const isBuilding = computed(() => builder.value.isBuilding);
    const isBusy = computed(() => isGenerating.value || isBuilding.value);
    const conversation = computed(() => builder.value.conversation);
    const activePreviewFile = computed(() => builder.value.activePreviewFile);
    const isGenerationComplete = computed(() => store.getters['pluginBuilder/isGenerationComplete']);
    const generatedFiles = computed(() => store.getters['pluginBuilder/generatedFiles']);
    const pluginName = computed(() => store.getters['pluginBuilder/pluginName']);
    const tools = computed(() => store.getters['pluginBuilder/pluginTools']);

    // The edited manifest wins, but a half-typed edit must not blank the page.
    const manifest = computed(() => {
      const edited = builder.value.editedFiles['manifest.json'];
      if (edited !== undefined) {
        try {
          return JSON.parse(edited);
        } catch {
          // fall through to the last good manifest
        }
      }
      return builder.value.generatedManifest || {};
    });

    const hasDraft = computed(() => isGenerationComplete.value || isGenerating.value || conversation.value.length > 0);
    const displayName = computed(() => {
      if (manifest.value.displayName) return manifest.value.displayName;
      return String(pluginName.value)
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    });
    const toolCountLabel = computed(() => `${tools.value.length} ${tools.value.length === 1 ? 'tool' : 'tools'}`);
    const capabilities = computed(() => {
      const permissions = manifest.value.permissions;
      return Array.isArray(permissions?.capabilities) ? permissions.capabilities : [];
    });

    /** 'draft' (never installed) | 'changed' (installed, edited since) | 'installed'. */
    const installState = computed(() => {
      if (!isGenerationComplete.value) return 'draft';
      const present = props.installedNames.includes(pluginName.value);
      if (!present || !builder.value.installedHash) return 'draft';
      return store.getters['pluginBuilder/draftHash'] === builder.value.installedHash ? 'installed' : 'changed';
    });
    const installStateLabel = computed(
      () => ({ draft: 'Draft · not installed', changed: 'Changes not installed', installed: 'Installed' })[installState.value],
    );
    const installLabel = computed(() => {
      if (isBuilding.value) return 'Installing…';
      if (installState.value === 'installed') return 'Installed';
      return installState.value === 'changed' ? 'Install changes' : 'Install & try';
    });

    const modelLabel = computed(() => {
      const { selectedProvider, selectedModel } = store.state.aiProvider || {};
      return selectedProvider && selectedModel ? `${selectedProvider} / ${selectedModel}` : 'No model selected';
    });
    const canSend = computed(() => Boolean(draftMessage.value.trim()) && !isBusy.value);

    const steps = computed(() => {
      const current = STEP_ORDER.indexOf(builder.value.generationProgress);
      return STEPS.map((step, index) => ({
        ...step,
        state: current > index ? 'done' : current === index ? 'active' : 'pending',
      }));
    });

    const paneTabs = computed(() => [
      ...(mobileView.value ? [{ key: 'chat', label: 'Chat' }] : []),
      { key: 'overview', label: 'Overview' },
      { key: 'test', label: 'Test' },
      { key: 'code', label: 'Code' },
    ]);

    // ── chat ──────────────────────────────────────────────────────────────
    async function send(text) {
      const message = (typeof text === 'string' ? text : draftMessage.value).trim();
      if (!message || isBusy.value) return;
      const { selectedProvider, selectedModel } = store.state.aiProvider || {};
      if (!selectedProvider || !selectedModel) {
        emit('show-alert', 'No model selected', 'Pick an AI provider and model in the chat model picker first.');
        return;
      }
      playSound('typewriterKeyPress');
      draftMessage.value = '';
      let result;
      if (isGenerationComplete.value) {
        result = await store.dispatch('pluginBuilder/regeneratePlugin', { instructions: message });
      } else {
        store.dispatch('pluginBuilder/setPluginDescription', message);
        result = await store.dispatch('pluginBuilder/generatePlugin', { description: message });
      }
      // The failure is already in the conversation; keep the text so it can be resent.
      if (!result?.success) draftMessage.value = message;
    }

    function useStarter(starter) {
      draftMessage.value = starter.prompt;
      nextTick(() => startInputRef.value?.focus());
    }

    function scrollChatToEnd() {
      nextTick(() => {
        const element = messagesRef.value;
        if (element) element.scrollTop = element.scrollHeight;
      });
    }
    watch(() => [conversation.value.length, isGenerating.value, builder.value.generationProgress], scrollChatToEnd);

    // ── install ───────────────────────────────────────────────────────────
    async function buildAndInstall() {
      if (isBusy.value) return;
      const result = await store.dispatch('pluginBuilder/buildAndInstallPlugin');
      if (!result.success) {
        emit('show-alert', 'Install failed', result.error || 'The plugin could not be built.');
        return;
      }
      emit('plugin-installed');
      if (!mobileView.value || paneTab.value !== 'chat') paneTab.value = 'test';
    }

    async function startOver() {
      const lose = store.getters['pluginBuilder/hasUninstalledWork'];
      const confirmed = await modalRef.value?.showModal({
        title: 'Start a new plugin?',
        message: lose
          ? `“${displayName.value}” has changes that are not installed. Starting over discards them.`
          : 'This clears the Forge. The installed plugin is not affected.',
        confirmText: 'Start over',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: lose ? 'btn-danger' : 'btn-primary',
      });
      if (!confirmed) return;
      store.dispatch('pluginBuilder/resetAll');
      draftMessage.value = '';
      selectedToolType.value = null;
      paneTab.value = mobileView.value ? 'chat' : 'overview';
    }

    // ── test ──────────────────────────────────────────────────────────────
    const selectedTool = computed(() => tools.value.find((tool) => tool.type === selectedToolType.value) || null);
    const selectedParameters = computed(() => parametersOf(selectedTool.value));
    const visibleParameters = computed(() =>
      selectedParameters.value.filter((param) => !param.conditional || testArgs.value[param.conditional.field] === param.conditional.value),
    );
    const resultFor = (tool) => store.getters['pluginBuilder/testResultFor'](pluginName.value, tool.type);
    const selectedResult = computed(() => (selectedTool.value ? resultFor(selectedTool.value) : null));

    function selectTool(tool) {
      selectedToolType.value = tool.type;
      testArgs.value = Object.fromEntries(
        parametersOf(tool).map((param) => [param.name, param.default ?? (param.type === 'boolean' ? false : '')]),
      );
    }

    function openTest(tool) {
      selectTool(tool);
      paneTab.value = 'test';
    }

    // Keep a valid selection as tools appear, change or disappear.
    watch(
      tools,
      (list) => {
        if (!list.some((tool) => tool.type === selectedToolType.value)) {
          if (list.length) selectTool(list[0]);
          else selectedToolType.value = null;
        }
      },
      { immediate: true },
    );

    async function runTest() {
      const tool = selectedTool.value;
      if (!tool || isTesting.value) return;
      const missing = visibleParameters.value.filter((param) => param.required && (testArgs.value[param.name] === '' || testArgs.value[param.name] == null));
      if (missing.length) {
        emit('show-alert', 'Missing inputs', `Fill in: ${missing.map((param) => param.name).join(', ')}`);
        return;
      }
      const args = toToolArgs(visibleParameters.value, testArgs.value);
      isTesting.value = true;
      const started = performance.now();
      let result;
      try {
        const response = await apiFetch(`${API_CONFIG.BASE_URL}/tools/${encodeURIComponent(tool.type)}/execute`, {
          method: 'POST',
          body: JSON.stringify({ args }),
        });
        const data = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
        result = data.success
          ? { ok: true, output: formatOutput(data.result) }
          : { ok: false, output: formatOutput(data.details || data.error || 'Tool execution failed'), error: data.error || 'Tool execution failed' };
      } catch (error) {
        result = { ok: false, output: error.message, error: error.message };
      } finally {
        isTesting.value = false;
      }
      store.dispatch('pluginBuilder/recordTestResult', {
        pluginName: pluginName.value,
        toolType: tool.type,
        result: { ...result, args, ms: Math.round(performance.now() - started), at: Date.now() },
      });
    }

    function askToFix() {
      const tool = selectedTool.value;
      const result = selectedResult.value;
      if (!tool || !result) return;
      if (mobileView.value) paneTab.value = 'chat';
      send(
        `The "${toolTitle(tool)}" tool (${tool.type}) failed when run with ${JSON.stringify(result.args)}. ` +
          `Error: ${result.error || result.output}. Fix it.`,
      );
    }

    // ── code ──────────────────────────────────────────────────────────────
    function selectFile(fileName) {
      store.dispatch('pluginBuilder/setActivePreviewFile', fileName);
    }

    const fileContentModel = computed({
      get: () => (activePreviewFile.value ? store.getters['pluginBuilder/getFileContent'](activePreviewFile.value) : ''),
      set: (content) => {
        if (activePreviewFile.value) store.dispatch('pluginBuilder/updateFile', { fileName: activePreviewFile.value, content });
      },
    });

    async function copyFileContent() {
      try {
        await navigator.clipboard.writeText(fileContentModel.value);
      } catch (error) {
        emit('show-alert', 'Copy failed', error.message);
      }
    }

    watch(
      generatedFiles,
      (files) => {
        if (files.length && !files.some((file) => file.name === activePreviewFile.value)) selectFile(files[0].name);
      },
      { immediate: true },
    );

    function toolTitle(tool) {
      return tool.schema?.title || tool.type;
    }

    onMounted(() => {
      scrollChatToEnd();
      if (!hasDraft.value) startInputRef.value?.focus();
    });

    return {
      mobileView,
      modalRef,
      messagesRef,
      startInputRef,
      draftMessage,
      paneTab,
      paneTabs,
      starters: STARTERS,
      isGenerating,
      isBuilding,
      isBusy,
      isTesting,
      conversation,
      activePreviewFile,
      isGenerationComplete,
      generatedFiles,
      pluginName,
      tools,
      manifest,
      hasDraft,
      displayName,
      toolCountLabel,
      capabilities,
      installState,
      installStateLabel,
      installLabel,
      modelLabel,
      canSend,
      steps,
      selectedToolType,
      selectedTool,
      visibleParameters,
      selectedResult,
      testArgs,
      fileContentModel,
      send,
      useStarter,
      buildAndInstall,
      startOver,
      selectTool,
      openTest,
      runTest,
      askToFix,
      resultFor,
      selectFile,
      copyFileContent,
      parametersOf,
      toolTitle,
    };
  },
};
</script>

<style scoped>
.forge {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-lg);
  overflow: hidden;
}

/* ── bar ── */
.forge-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--terminal-border-color);
  min-height: 60px;
  flex-wrap: wrap;
}

.crumb-back,
.text-button,
.text-link {
  background: none;
  border: none;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  font: inherit;
  cursor: pointer;
}

.crumb-back {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--text-secondary);
}

.crumb-back:hover,
.text-button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.crumb-sep {
  color: var(--text-quaternary);
}

.crumb-current {
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.bar-spacer {
  flex: 1;
}

/* BaseButton is width:100% by design (forms); in a row it must size to its label. */
.btn-compact {
  width: auto;
  flex: 0 0 auto;
  padding: var(--spacing-sm) var(--spacing-md);
  font-size: var(--font-size-sm);
}

.btn-compact.primary,
.btn-compact.primary:hover,
.btn-compact.primary:focus {
  background: var(--fill-accent);
  border-color: var(--fill-accent);
  color: var(--on-fill-accent);
}

/* A dimmed fill still reads as live; an unavailable primary drops fill AND ink together. */
.btn-compact.primary.is-disabled {
  background: transparent;
  border-color: var(--terminal-border-color);
  color: var(--text-tertiary);
}

.text-button {
  color: var(--text-secondary);
}

.text-link {
  color: var(--color-secondary);
  padding: 0;
}

.text-link:hover:not(:disabled) {
  text-decoration: underline;
}

.text-button:disabled,
.text-link:disabled {
  opacity: 0.5;
  cursor: default;
}

.status-pill {
  font-size: var(--font-size-xs);
  padding: var(--spacing-xxs) var(--spacing-sm);
  border-radius: var(--border-radius-lg);
  color: var(--status-blue-text);
  background: color-mix(in srgb, var(--color-secondary) 12%, transparent);
}

.status-pill.changed {
  color: var(--status-amber-text);
  background: color-mix(in srgb, var(--color-yellow) 12%, transparent);
}

.status-pill.installed {
  color: var(--status-green-text);
  background: color-mix(in srgb, var(--color-green) 12%, transparent);
}

/* ── start ── */
.forge-start {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xl) var(--spacing-lg);
  text-align: center;
  overflow-y: auto;
}

.start-title {
  margin: 0;
  font-size: var(--font-size-xxxl);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}

.start-sub {
  margin: 0;
  color: var(--text-secondary);
}

.starters {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--spacing-sm);
  max-width: 680px;
}

.starter {
  font: inherit;
  font-size: var(--font-size-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--terminal-border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.starter:hover {
  border-color: var(--color-primary);
  color: var(--text-primary);
}

.start-alt {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-tertiary);
}

/* ── composer (shared by start and chat) ── */
.composer {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  border: 1px solid var(--border-strong);
  border-radius: var(--border-radius-md);
  background: var(--color-darker-0);
  padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-xs) var(--spacing-md);
  transition: border-color var(--transition-fast);
}

.composer:focus-within {
  border-color: var(--color-primary);
}

.composer-large {
  width: 100%;
  max-width: 680px;
  text-align: left;
}

.composer textarea {
  width: 100%;
  min-height: 0;
  height: auto;
  padding: 0;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-weight: var(--font-weight-normal);
  line-height: 1.45;
  box-shadow: none;
}

.composer textarea::placeholder {
  color: var(--text-quaternary);
}

.composer-large textarea {
  font-size: var(--font-size-lg);
}

.composer-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.model-label {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-sm);
  padding: var(--spacing-xxs) var(--spacing-sm);
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.send-button {
  margin-left: auto;
  width: 34px;
  height: 34px;
  border-radius: var(--border-radius-md);
  border: none;
  background: var(--fill-accent);
  color: var(--on-fill-accent);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.send-button:disabled {
  background: var(--surface-active);
  color: var(--text-quaternary);
  cursor: default;
}

/* ── split ── */
.forge-split {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(300px, 38%) 1fr;
}

.forge.is-mobile .forge-split {
  display: flex;
  flex-direction: column;
}

.forge-chat {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--terminal-border-color);
}

.forge.is-mobile .forge-chat {
  flex: 1;
  border-right: none;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.message {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-normal);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
}

.message.assistant {
  padding-left: var(--spacing-sm);
  border-left: 2px solid var(--terminal-border-color);
  color: var(--text-secondary);
}

.message.user {
  align-self: flex-end;
  max-width: 82%;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--border-radius-md);
  background: var(--surface-active);
}

.steps {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  font-size: var(--font-size-xs);
}

.step {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--text-tertiary);
}

.step.done {
  color: var(--status-green-text);
}

.step.active {
  color: var(--status-blue-text);
}

.step .fa-circle {
  font-size: 0.6em;
}

.forge-chat .composer {
  margin: 0 var(--spacing-md) var(--spacing-md);
}

/* ── pane ── */
.forge-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

.forge.is-mobile .forge-pane {
  flex: 1;
}

.pane-tabs {
  display: flex;
  gap: var(--spacing-xxs);
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--terminal-border-color);
}

.pane-tab {
  font: inherit;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  padding: var(--spacing-sm) var(--spacing-md);
  color: var(--text-secondary);
  cursor: pointer;
}

.pane-tab:hover {
  color: var(--text-primary);
}

.pane-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--color-primary);
}

.pane-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-md) var(--spacing-lg);
}

.pane-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  color: var(--text-tertiary);
  padding: var(--spacing-xl);
  text-align: center;
}

.pane-empty i {
  font-size: var(--font-size-xxl);
  opacity: 0.6;
}

.meta {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

/* overview */
.overview-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-sm);
}

.overview-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--border-radius-md);
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
  flex-shrink: 0;
}

.overview-name {
  margin: 0;
  font-size: var(--font-size-xl);
  color: var(--text-primary);
}

.overview-description {
  margin: 0 0 var(--spacing-md);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.tool-row {
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
  background: var(--surface-raised);
  padding: var(--spacing-sm) var(--spacing-md);
  margin-bottom: var(--spacing-sm);
}

.tool-row-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.tool-title {
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.tool-type {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.tool-description {
  margin: var(--spacing-xs) 0 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-sm);
}

.chip {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  padding: var(--spacing-xxs) var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  background: var(--color-darker-0);
  color: var(--text-secondary);
}

.result-mark,
.ok {
  color: var(--status-green-text);
}

.bad {
  color: var(--color-red);
}

.callout {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  margin: var(--spacing-md) 0;
}

/* test */
.test-layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: var(--spacing-md);
  align-items: start;
}

.forge.is-mobile .test-layout {
  grid-template-columns: 1fr;
}

.test-tools {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xxs);
}

.test-tool,
.file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--border-radius-sm);
  padding: var(--spacing-sm);
  color: var(--text-secondary);
  cursor: pointer;
}

.test-tool:hover,
.file-item:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.test-tool.active,
.file-item.active {
  background: var(--surface-active);
  color: var(--text-primary);
}

.test-body .callout {
  margin-top: 0;
}

.test-fields {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.field-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.field-required {
  font-style: normal;
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-left: var(--spacing-xs);
}

.field-input {
  font: inherit;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-normal);
  padding: var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  border: 1px solid var(--terminal-border-color);
  background: var(--color-darker-0);
  color: var(--text-primary);
  outline: none;
}

.field-input:focus {
  border-color: var(--color-primary);
}

.field-checkbox {
  align-self: flex-start;
}

.field-hint {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-normal);
  color: var(--text-tertiary);
}

.test-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  flex-wrap: wrap;
  margin: var(--spacing-md) 0;
}

.test-result-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-sm);
}

.test-result.ok .test-result-head {
  color: var(--status-green-text);
}

.test-result.bad .test-result-head {
  color: var(--color-red);
}

.code-block {
  margin: 0;
  padding: var(--spacing-md);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
  background: var(--color-darker-0);
  color: var(--text-primary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow: auto;
}

/* code */
.code-layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: var(--spacing-md);
}

.forge.is-mobile .code-layout {
  grid-template-columns: 1fr;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xxs);
}

.file-item {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

.file-editor {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-width: 0;
}

.file-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.code-editor {
  min-height: 420px;
  max-height: none;
  resize: vertical;
  white-space: pre;
  outline: none;
}

.code-editor:focus {
  border-color: var(--color-primary);
}

@media (max-width: 900px) {
  .forge-split {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(320px, 45%) 1fr;
  }

  .forge-chat {
    border-right: none;
    border-bottom: 1px solid var(--terminal-border-color);
  }
}
</style>
