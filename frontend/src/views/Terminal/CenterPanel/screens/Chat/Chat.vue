<template>
  <BaseScreen
    class="chat-screen-wrapper"
    ref="baseScreenRef"
    screenId="ChatScreen"
    channel-key="orchestrator:default"
    :useTutorialHook="useTutorial"
    :terminalLines="terminalLines"
    :disableInputInitially="!hasConnectedAIProvider"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="handleScreenChange"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <div class="automation-interface" :class="{ 'mobile-view': isMobile }">
        <!-- Automation Engine Status -->
        <EngineHeader v-if="!isMobile" />

        <!-- Context Monitoring Panel -->
        <div v-if="!isMobile" class="monitoring-panel" :class="{ collapsed: isMonitoringCollapsed }">
          <div class="monitoring-header" @click="toggleMonitoringPanel">
            <span class="monitoring-title">System Monitoring</span>
            <span class="monitoring-toggle" :class="{ expanded: !isMonitoringCollapsed }">
              {{ isMonitoringCollapsed ? '▶' : '▼' }}
            </span>
          </div>
          <div class="monitoring-content" v-show="!isMonitoringCollapsed">
            <ContextMonitor
              :contextStatus="contextStatus"
              :lastManaged="lastContextManaged"
              :tokenUsage="lastTokenUsage"
              :cacheMetrics="lastCacheMetrics"
              :estimatedCost="lastEstimatedCost"
              :totalTokenUsage="totalTokenUsage"
              :totalCost="totalCost"
              :totalCacheMetrics="totalCacheMetrics"
              :executionsCount="executionsCount"
            />
            <SystemHealthPanel
              :contextManaged="contextManaged"
              :errorsCaught="errorsCaught"
              :toolTruncations="toolTruncations"
              :toolsLoadedCount="toolsLoadedCount"
              :cacheMetrics="lastCacheMetrics"
            />
            <ActivityFeed :activities="systemActivities" @clear="clearActivities" />
          </div>
        </div>

        <!-- Conversation Canvas -->
        <div class="conversation-canvas-wrapper">
          <div class="conversation-canvas" ref="conversationSpace">
            <div class="conversation-container">
              <TransitionGroup :name="bulkLoading ? '' : 'message'" tag="div" class="message-flow">
                <MessageItem
                  v-for="message in displayMessages"
                  :key="message.id"
                  :message="message"
                  :status="getMessageStatus(message)"
                  :runningTools="getRunningToolsForMessage(message)"
                  :imageCache="imageCache"
                  :dataCache="dataCache"
                  :avatarUrl="
                    message.agentIcon &&
                    (message.agentIcon.startsWith('http') || message.agentIcon.startsWith('data:') || message.agentIcon.startsWith('/'))
                      ? message.agentIcon
                      : null
                  "
                  @toggle-tool="toggleToolCallExpansion"
                  @provider-connected="handleProviderConnected"
                  @edit-message="handleEditMessage"
                />
              </TransitionGroup>

              <!-- Processing State -->
              <ProcessingState v-if="isProcessing" :text="`${activeAgentName} is working...`" />
            </div>
          </div>
          <ChatScrollControls :target-getter="getConversationEl" />
        </div>

        <!-- Quick Actions -->
        <QuickActions
          v-if="!isMobile && hasConnectedAIProvider"
          :suggestions="suggestions"
          :isLoading="isLoadingSuggestions"
          @execute="executeSuggestion"
        />

        <!-- Chat Actions Bar for Clear and Save Buttons -->
        <ChatActions v-if="!isMobile && hasConnectedAIProvider" @clear="confirmClearConversation" @save="saveConversation" />

        <SimpleModal ref="confirmModal" />
      </div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, reactive, onMounted, onUnmounted, nextTick, computed, watch, inject } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { useCleanup } from '@/composables/useCleanup';
import BaseScreen from '../../BaseScreen.vue';
import EngineHeader from './components/EngineHeader.vue';
import MessageItem from './components/MessageItem.vue';
import ProcessingState from './components/ProcessingState.vue';
import QuickActions from './components/QuickActions.vue';
import ChatActions from './components/ChatActions.vue';
import ContextMonitor from './components/ContextMonitor.vue';
import SystemHealthPanel from './components/SystemHealthPanel.vue';
import ActivityFeed from './components/ActivityFeed.vue';
import { useTutorial } from './useTutorial.js';
import { useAppVersion } from '@/composables/useAppVersion.js';
import { API_CONFIG, DEPLOYMENT_CONFIG } from '@/tt.config.js';
import { resolveProviderKey, AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';
import PopupTutorial from '../../../../_components/utility/PopupTutorial.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import ChatScrollControls from '@/views/_components/chat/ChatScrollControls.vue';

export default {
  name: 'ChatScreen',
  components: {
    BaseScreen,
    EngineHeader,
    MessageItem,
    ProcessingState,
    QuickActions,
    ChatActions,
    ContextMonitor,
    SystemHealthPanel,
    ActivityFeed,
    PopupTutorial,
    SimpleModal,
    ChatScrollControls,
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const route = useRoute();
    const router = useRouter();
    const cleanup = useCleanup();
    const baseScreenRef = ref(null);
    const conversationSpace = ref(null);
    const isMobile = inject('isMobile', ref(false));

    // App Version (dynamic)
    const { appVersion, fetchVersion } = useAppVersion();

    // Core State
    const terminalLines = ref([]);
    const currentConversationId = ref(null);
    const messagesFromStore = computed(() => {
      // Never show agent conversation messages in the main chat.
      // Check both the mirror flag (currentAgentId) and the conversation slot's
      // own agentId — the latter survives MIGRATE_CONVERSATION_ID which renames
      // agent-<id> to a server UUID after the first streamed message.
      if (store.state.chat.currentAgentId) return [];
      const activeId = store.state.chat.activeConversationId;
      if (activeId) {
        const conv = store.state.chat.conversations[activeId];
        if (conv && conv.agentId) return [];
      }
      return store.state.chat.messages;
    });
    const expandedToolCalls = ref({});
    const runningToolCalls = ref({});
    const messageStates = ref({});

    // Suppress TransitionGroup animations during bulk message loads (e.g. loading saved outputs)
    const bulkLoading = ref(false);

    // Image cache from Vuex store
    const imageCache = computed(() => store.state.chat.imageCache);

    // Data cache from Vuex store (for DATA_REF resolution)
    const dataCache = computed(() => store.state.chat.dataCache);

    // Computed property to ensure all messages have a valid key
    const displayMessages = computed(() => {
      const allMsgs = messagesFromStore.value || [];
      const validMsgs = allMsgs.filter((msg) => msg && typeof msg.id !== 'undefined' && msg.id !== null);
      if (validMsgs.length < allMsgs.length) {
        console.warn('[ChatScreen] Some messages were filtered out due to missing or invalid IDs.');
      }
      return validMsgs.map((msg) => ({
        ...msg,
        expandedToolCalls: expandedToolCalls.value[msg.id] || [],
      }));
    });

    const isProcessing = ref(false);
    let localMessageIdCounter = 0;
    const generateMessageId = () => `msg-${Date.now()}-${localMessageIdCounter++}`;

    // Resolve the active agent name from the most recent assistant message (for @ mention responses)
    // If the latest assistant message has no agentName, it's Annie (the default orchestrator)
    const activeAgentName = computed(() => {
      const msgs = displayMessages.value;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          return msgs[i].agentName || 'Annie';
        }
      }
      return 'Annie';
    });

    // No provider tutorial
    const noProviderTutorial = ref({
      config: [
        {
          target: '.conversation-canvas',
          position: 'center',
          title: '⚠️ No AI Provider Connected!',
          content: "You need to connect an AI provider before you can chat. Let's set one up in the Integrations section.",
          buttonText: 'Go to Integrations',
          hideArrow: true,
        },
      ],
      startTutorial: false,
      currentStep: 0,
      onTutorialClose: () => {
        noProviderTutorial.value.startTutorial = false;
        noProviderTutorial.value.currentStep = 0;
      },
      nextStep: () => {
        // Navigate to Secrets screen
        emit('screen-change', 'ConnectorsScreen');
        noProviderTutorial.value.onTutorialClose();
      },
      initializeTutorial: () => {
        noProviderTutorial.value.startTutorial = true;
        noProviderTutorial.value.currentStep = 0;
      },
    });

    // Check for connected AI providers
    const isLocalServerRunning = ref(false);

    // Check if local server is running
    // Note: Browser console may show ERR_CONNECTION_REFUSED when server is not running.
    // This is expected behavior and the errors are handled silently.
    // Disabled in hosted environments to prevent CORS errors.
    const checkLocalServer = async () => {
      // Skip in hosted mode to prevent CORS errors
      if (DEPLOYMENT_CONFIG.DISABLE_LOCAL_LLM) {
        isLocalServerRunning.value = false;
        return;
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1000);

        const response = await fetch('http://127.0.0.1:1234/v1/models', {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store',
        });

        clearTimeout(timeoutId);
        const wasRunning = isLocalServerRunning.value;
        isLocalServerRunning.value = response.ok;

        // Auto-switch to Local provider if:
        // 1. Local server just became available (wasn't running before, now is)
        // 2. No other provider is currently connected
        if (response.ok && !wasRunning) {
          await autoSwitchToLocalIfNeeded();
        }
      } catch (error) {
        // Silently handle connection errors - local server is optional
        isLocalServerRunning.value = false;
      }
    };

    // Automatically switch to Local provider ONLY if no other provider is configured
    const autoSwitchToLocalIfNeeded = async () => {
      const selectedProvider = store.state.aiProvider?.selectedProvider;
      const connectedApps = store.state.appAuth?.connectedApps || [];

      // Check if any non-Local AI provider is connected
      const connectedAIProviders = connectedApps.filter((app) => {
        const appKey = resolveProviderKey(app);
        return appKey !== 'local' && AI_PROVIDERS_WITH_API.includes(appKey);
      });

      // ONLY auto-switch to Local if:
      // 1. No provider is selected at all (null/undefined), AND
      // 2. No other AI providers are connected
      // This prevents switching away from a valid, connected provider
      if (!selectedProvider && connectedAIProviders.length === 0) {
        console.log('[Auto-Switch] Switching to Local provider - LM Studio detected and no other providers configured');

        // Fetch local models first
        await store.dispatch('aiProvider/fetchLocalModels');

        // Set Local as the provider
        await store.dispatch('aiProvider/setProvider', 'Local');

        // If we're showing the setup screen, refresh the conversation to show Annie
        if (displayMessages.value.length === 1 && displayMessages.value[0].showProviderSetup) {
          clearConversation();
        }

        terminalLines.value.push('[Auto-Switch] Local AI provider connected via LM Studio');
      } else if (selectedProvider) {
        console.log(`[Auto-Switch] Skipping auto-switch - provider already selected: ${selectedProvider}`);
      } else if (connectedAIProviders.length > 0) {
        console.log(`[Auto-Switch] Skipping auto-switch - other providers connected: ${connectedAIProviders.join(', ')}`);
      }
    };

    const hasConnectedAIProvider = computed(() => {
      // Check if a provider is selected AND connected
      const selectedProvider = store.state.aiProvider?.selectedProvider;
      const connectedApps = store.state.appAuth?.connectedApps || [];
      const customProviders = store.state.aiProvider?.customProviders || [];

      if (!selectedProvider) return false;

      // Local provider is only available when the local server is running
      if (selectedProvider.toLowerCase() === 'local') {
        return isLocalServerRunning.value;
      }

      // Check if it's a custom provider (custom providers are always "connected")
      const isCustomProvider = customProviders.some((cp) => cp.id === selectedProvider);
      if (isCustomProvider) {
        return true;
      }

      // Check if the selected provider is in the connected apps
      // resolveProviderKey maps display names like "Z-AI" to keys like "zai"
      const providerKey = resolveProviderKey(selectedProvider);
      return connectedApps.some((app) => app.toLowerCase() === providerKey);
    });

    // Disable input when no provider connected
    const isInputDisabled = computed(() => !hasConnectedAIProvider.value);

    // Per-conversation monitoring state. Each conversation has its own
    // health counters, cache/token stats, context status, and activity feed,
    // so switching conversations preserves each one's exact state instead of
    // blending metrics from every active stream into a single panel.
    const monitoringStates = reactive({});

    const defaultMonitoringState = () => ({
      contextStatus: {
        currentTokens: 0,
        tokenLimit: 0,
        utilizationPercent: 0,
        model: store.state.aiProvider?.selectedModel || 'N/A',
        messagesCount: 0,
        breakdown: null,
      },
      lastContextManaged: null,
      contextManaged: false,
      errorsCaught: 0,
      toolTruncations: 0,
      toolsLoadedCount: 0,
      // Last-call stats (most recent LLM turn only)
      lastTokenUsage: null,
      lastCacheMetrics: null,
      lastEstimatedCost: null,
      // Conversation-wide cumulative stats. Accumulated from every
      // agent_execution_completed event and hydrated from the DB summary
      // when reopening a conversation.
      totalTokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      totalCost: 0,
      totalCacheMetrics: {
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        uncachedTokens: 0,
        hitRate: '0',
      },
      executionsCount: 0,
      systemActivities: [],
    });

    // Lazy-initialize per-conversation monitoring state. Every event that
    // carries a conversationId (via the 3rd callback arg) lands in its own
    // slot — whether or not that conversation is currently in view.
    const getMonitoringState = (convId) => {
      if (!convId) return null;
      if (!monitoringStates[convId]) {
        monitoringStates[convId] = defaultMonitoringState();
      }
      return monitoringStates[convId];
    };

    // Computed views bound to the user's currently-viewed conversation.
    // Template bindings and panel props go through these, so switching
    // conversations instantly shows that conversation's saved state.
    const activeMonitoring = computed(() => {
      const convId = store.state.chat.activeConversationId;
      return (convId && monitoringStates[convId]) || defaultMonitoringState();
    });
    const contextStatus = computed(() => activeMonitoring.value.contextStatus);
    const lastContextManaged = computed(() => activeMonitoring.value.lastContextManaged);
    const contextManaged = computed(() => activeMonitoring.value.contextManaged);
    const errorsCaught = computed(() => activeMonitoring.value.errorsCaught);
    const toolTruncations = computed(() => activeMonitoring.value.toolTruncations);
    const toolsLoadedCount = computed(() => activeMonitoring.value.toolsLoadedCount);
    const lastTokenUsage = computed(() => activeMonitoring.value.lastTokenUsage);
    const lastCacheMetrics = computed(() => activeMonitoring.value.lastCacheMetrics);
    const lastEstimatedCost = computed(() => activeMonitoring.value.lastEstimatedCost);
    const totalTokenUsage = computed(() => activeMonitoring.value.totalTokenUsage);
    const totalCost = computed(() => activeMonitoring.value.totalCost);
    const totalCacheMetrics = computed(() => activeMonitoring.value.totalCacheMetrics);
    const executionsCount = computed(() => activeMonitoring.value.executionsCount);
    const systemActivities = computed(() => activeMonitoring.value.systemActivities);

    // Known context windows for common models (static data, no API call needed)
    const MODEL_CONTEXT_WINDOWS = {
      // OpenAI
      'gpt-5.2': 400000,
      'gpt-5.1': 400000,
      'gpt-5': 400000,
      'gpt-5-mini': 400000,
      'gpt-5-nano': 400000,
      'o4-mini': 200000,
      o3: 200000,
      'o3-mini': 200000,
      'gpt-4.1': 1000000,
      'gpt-4.1-mini': 1000000,
      'gpt-4.1-nano': 1000000,
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      // Anthropic
      'claude-opus-4-6': 200000,
      'claude-sonnet-4-6': 200000,
      'claude-opus-4-5-20251101': 200000,
      'claude-sonnet-4-5-20250929': 200000,
      'claude-haiku-4-5-20251001': 200000,
      'claude-sonnet-4-20250514': 200000,
      'claude-opus-4-20250514': 200000,
      'claude-3-5-sonnet-20241022': 200000,
      'claude-3-5-haiku-20241022': 200000,
      // Google
      'gemini-3.1-pro-preview': 1048576,
      'gemini-3-flash-preview': 1048576,
      'gemini-2.5-pro': 1048576,
      'gemini-2.5-flash': 1048576,
      'gemini-2.5-flash-lite': 1048576,
      // Grok
      'grok-4-0709': 256000,
      'grok-3': 131072,
      'grok-3-mini': 131072,
      // Groq
      'llama-3.3-70b-versatile': 131072,
      'llama-3.1-8b-instant': 131072,
      // DeepSeek
      'deepseek-chat': 128000,
      'deepseek-reasoner': 128000,
      // Cerebras
      'llama3.1-8b': 131072,
    };

    const getContextWindowForModel = (model) => {
      if (!model) return 0;
      // Exact match first
      if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];
      // Prefix match for versioned model IDs (e.g. claude-sonnet-4-6-20250101)
      for (const [key, val] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
        if (model.startsWith(key)) return val;
      }
      return 0;
    };

    // Seed the tokenLimit/model on the ACTIVE conversation's monitoring slot
    // when the user changes provider/model. Other conversations keep whatever
    // tokenLimit was recorded during their last context_status event.
    const updateContextWindow = () => {
      const model = store.state.aiProvider?.selectedModel;
      if (!model) return;
      const convId = store.state.chat.activeConversationId;
      if (!convId) return;
      const ms = getMonitoringState(convId);
      const contextWindow = getContextWindowForModel(model);
      ms.contextStatus = {
        ...ms.contextStatus,
        model,
        tokenLimit: contextWindow || ms.contextStatus.tokenLimit,
      };
    };

    // Update immediately and whenever model changes
    updateContextWindow();

    // Quick Actions
    const initialSuggestions = [
      { id: 1, text: 'What can you do?', icon: '🤔' },
      { id: 2, text: 'List all available tools', icon: '🛠️' },
      { id: 4, text: 'What skills do you have?', icon: '📁' },
    ];
    const suggestions = ref([...initialSuggestions]);
    const isLoadingSuggestions = ref(false);

    // Monitoring Panel State
    const isMonitoringCollapsed = ref(true); // Collapsed by default

    const toggleMonitoringPanel = () => {
      isMonitoringCollapsed.value = !isMonitoringCollapsed.value;
    };

    const handleUserInputSubmit = async (input, files = null, mentionedAgents = null) => {
      if (!input || !input.trim()) return;

      const command = input.trim().toLowerCase();
      if (command === 'clear' || command === 'cls') {
        clearConversation();
        return;
      }

      // --- Handle slash commands (client-side actions) ---
      const slashMatch = input.trim().match(/^\/(\S+)/);
      if (slashMatch && (!mentionedAgents || mentionedAgents.length === 0)) {
        const cmd = slashMatch[1].toLowerCase().replace(/\s+/g, '-');
        switch (cmd) {
          case 'new-chat':
          case 'newchat':
          case 'new':
            clearConversation();
            clearInput();
            return;
          case 'clear':
          case 'clear-chat':
          case 'clearchat':
            clearConversation();
            clearInput();
            return;
          case 'export':
          case 'export-chat':
          case 'exportchat':
            clearInput();
            saveConversation();
            return;
          case 'help':
            clearInput();
            store.commit('chat/SCOPED_ADD_MESSAGE', {
              conversationId: store.state.chat.activeConversationId || 'main',
              message: {
                id: `help-${Date.now()}`,
                role: 'assistant',
                content:
                  `**Available Commands**\n\n` +
                  `- \`/new-chat\` — Start a new conversation\n` +
                  `- \`/clear\` — Clear current conversation\n` +
                  `- \`/export\` — Save conversation to outputs\n` +
                  `- \`/help\` — Show this help message\n\n` +
                  `**Mentions**\n\n` +
                  `- \`@AgentName\` — Direct your message to a specific agent\n`,
                timestamp: Date.now(),
              },
            });
            return;
        }
        // Unknown slash command — fall through and send as a regular message
      }

      // Ensure a conversation slot exists for the active conversation
      const convId = store.state.chat.activeConversationId || currentConversationId.value || `temp-${Date.now()}`;
      store.commit('chat/ENSURE_CONVERSATION', convId);
      if (!store.state.chat.activeConversationId) {
        store.commit('chat/SET_ACTIVE_CONVERSATION', convId);
      }

      // Create user message with file attachments if present
      const userMessage = {
        id: generateMessageId(),
        role: 'user',
        content: input,
        timestamp: Date.now(),
      };

      // Add file metadata to message if files are attached
      if (files && files.length > 0) {
        const filePromises = files.map(async (file) => {
          const fileData = {
            name: file.name,
            type: file.type,
            size: file.size,
          };

          if (file.type.startsWith('image/')) {
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                fileData.dataUrl = e.target.result;
                resolve(fileData);
              };
              reader.onerror = () => {
                console.error('Error reading file:', file.name);
                resolve(fileData);
              };
              reader.readAsDataURL(file);
            });
          }

          return fileData;
        });

        userMessage.files = await Promise.all(filePromises);
      }

      // Add to the scoped conversation (mirror sync keeps flat state in sync)
      store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: convId, message: userMessage });
      terminalLines.value.push(`> ${input}${files && files.length > 0 ? ` [${files.length} file(s) attached]` : ''}`);

      nextTick(() => scrollToBottom());

      clearInput();

      // If multiple agents are mentioned, send requests in parallel
      const agents = mentionedAgents && mentionedAgents.length > 0 ? mentionedAgents : [null];
      await Promise.all(
        agents.map((agent) =>
          store.dispatch('chat/startStreamingConversation', {
            userInput: input,
            files: files,
            provider: store.state.aiProvider.selectedProvider,
            model: store.state.aiProvider.selectedModel,
            reasoningValue: store.state.aiProvider.reasoningValue,
            reasoningEnabled: store.state.aiProvider.reasoningEnabled,
            mentionedAgent: agent,
          }),
        ),
      );
    };

    // Edit & resend: truncate from edited message, re-add with new content, resend
    const handleEditMessage = async ({ messageId, newContent }) => {
      const convId = store.state.chat.activeConversationId;
      if (!convId || store.state.chat.isStreaming) return;

      // Truncate conversation from this message onward
      store.commit('chat/SCOPED_TRUNCATE_FROM', { conversationId: convId, messageId });

      // Add the edited message as a new user message
      const editedMessage = {
        id: generateMessageId(),
        role: 'user',
        content: newContent,
        timestamp: Date.now(),
      };
      store.commit('chat/SCOPED_ADD_MESSAGE', { conversationId: convId, message: editedMessage });

      nextTick(() => scrollToBottom());

      // Resend from this point
      await store.dispatch('chat/startStreamingConversation', {
        userInput: newContent,
        provider: store.state.aiProvider.selectedProvider,
        model: store.state.aiProvider.selectedModel,
        reasoningValue: store.state.aiProvider.reasoningValue,
        reasoningEnabled: store.state.aiProvider.reasoningEnabled,
      });
    };

    // Stream event handler. Monitoring state (counters, token/cache stats,
    // activity feed, context status) is always routed to the SOURCE
    // conversation's slot via `streamConvId` — so per-conversation history
    // survives switching tabs/convos. View-only effects (messageStates,
    // runningToolCalls, isProcessing, focusInput, displayMessages lookups)
    // only run when the user is currently viewing that conversation.
    const handleStreamEvent = (eventName, data, streamConvId) => {
      const activeId = store.state.chat.activeConversationId;
      const isActiveView = !streamConvId || !activeId || streamConvId === activeId;
      const ms = streamConvId ? getMonitoringState(streamConvId) : null;

      switch (eventName) {
        case 'conversation_started':
          if (isActiveView) currentConversationId.value = data.conversationId;
          break;
        case 'assistant_message': {
          if (!isActiveView) break;
          const name = data.agentName || 'Annie';
          messageStates.value[data.id] = {
            type: 'thinking',
            text: `${name} is thinking...`,
          };
          break;
        }
        case 'reasoning_delta': {
          if (!isActiveView) break;
          const msg = displayMessages.value.find((m) => m.id === data.assistantMessageId);
          const rName = msg?.agentName || 'Annie';
          messageStates.value[data.assistantMessageId] = {
            type: 'thinking',
            text: `${rName} is reasoning...`,
          };
          break;
        }
        case 'tool_start':
          if (isActiveView) {
            runningToolCalls.value[`${data.assistantMessageId}-${data.toolCall.id}`] = true;
            messageStates.value[data.assistantMessageId] = {
              type: 'tool',
              text: `Running ${data.toolCall.name}...`,
            };
          }
          if (ms) addActivityTo(ms, { type: 'tool', text: `Running ${data.toolCall.name}` });
          break;
        case 'tool_end': {
          if (isActiveView) {
            runningToolCalls.value[`${data.assistantMessageId}-${data.toolCall.id}`] = false;
            const message = displayMessages.value.find((m) => m.id === data.assistantMessageId);
            if (message && !isAnyToolRunningInMessage(message)) {
              const teName = message.agentName || 'Annie';
              messageStates.value[data.assistantMessageId] = {
                type: 'thinking',
                text: `${teName} is processing results...`,
              };
            }
          }
          if (ms) {
            if (data.toolCall.error) {
              ms.errorsCaught++;
              addActivityTo(ms, {
                type: 'error',
                text: `Error handled in ${data.toolCall.name || 'tool'}: ${data.toolCall.error}`,
              });
            } else {
              addActivityTo(ms, { type: 'success', text: `${data.toolCall.name} completed` });
            }
          }
          break;
        }
        case 'context_status':
          if (ms) {
            ms.contextStatus = {
              currentTokens: data.currentTokens,
              tokenLimit: data.tokenLimit,
              utilizationPercent: data.utilizationPercent,
              model: data.model,
              messagesCount: data.messagesCount,
              // Per-component breakdown so ContextMonitor can render a
              // segmented bar (system / tools / messages / output buffer).
              breakdown: data.breakdown || null,
            };
          }
          break;
        case 'context_managed':
          if (ms) {
            ms.contextManaged = true;
            ms.lastContextManaged = {
              originalTokens: data.originalTokens,
              managedTokens: data.managedTokens,
              reduction: data.reduction,
              strategy: data.strategy,
            };
            addActivityTo(ms, {
              type: 'context',
              text: `Context reduced: ${data.originalTokens.toLocaleString()} → ${data.managedTokens.toLocaleString()} tokens`,
            });
            const convIdForTimeout = streamConvId;
            cleanup.setTimeout(() => {
              const s = monitoringStates[convIdForTimeout];
              if (s) s.contextManaged = false;
            }, 5000);
          }
          break;
        case 'tool_output_managed':
          if (ms) {
            ms.toolTruncations++;
            addActivityTo(ms, {
              type: 'truncation',
              text: `${data.toolName} output truncated: ${data.originalSize} → ${data.managedSize} chars`,
            });
          }
          break;
        case 'image_generated':
          console.log(`Image cached: ${data.imageId} for message ${data.assistantMessageId}`);
          break;
        case 'files_processed':
          if (ms) addActivityTo(ms, { type: 'info', text: `Processed ${data.fileCount} file(s): ${data.fileNames.join(', ')}` });
          break;
        case 'final_content':
          if (isActiveView) {
            delete messageStates.value[data.assistantMessageId];
            updateSuggestionsWithAI(displayMessages.value.slice(-2)[0]?.content, data.content);
          }
          break;
        case 'error':
          if (ms) {
            ms.errorsCaught++;
            addActivityTo(ms, { type: 'error', text: `System error handled: ${data.error}` });
          }
          if (isActiveView) isProcessing.value = false;
          break;
        case 'agent_execution_completed':
          if (ms) {
            ms.lastTokenUsage = data.tokenUsage || null;
            ms.lastCacheMetrics = data.cacheMetrics || null;
            ms.lastEstimatedCost = data.estimatedCost != null ? data.estimatedCost : null;
            if (data.toolCallsCount > 0) ms.toolsLoadedCount = data.toolCallsCount;

            // Accumulate conversation-wide totals. Each event carries the
            // per-turn totals already summed by the backend tokenAccumulator,
            // so we just add turn-over-turn here.
            if (data.tokenUsage) {
              ms.totalTokenUsage.inputTokens += data.tokenUsage.inputTokens || 0;
              ms.totalTokenUsage.outputTokens += data.tokenUsage.outputTokens || 0;
              ms.totalTokenUsage.totalTokens += data.tokenUsage.totalTokens || 0;
            }
            if (data.estimatedCost != null) {
              ms.totalCost += Number(data.estimatedCost) || 0;
            }
            if (data.cacheMetrics) {
              ms.totalCacheMetrics.cacheReadTokens += data.cacheMetrics.cacheReadTokens || 0;
              ms.totalCacheMetrics.cacheCreationTokens += data.cacheMetrics.cacheCreationTokens || 0;
              ms.totalCacheMetrics.uncachedTokens += data.cacheMetrics.uncachedTokens || 0;
              const totalIn = ms.totalTokenUsage.inputTokens;
              ms.totalCacheMetrics.hitRate = totalIn > 0 ? ((ms.totalCacheMetrics.cacheReadTokens / totalIn) * 100).toFixed(1) : '0';
            }
            // Only count events that actually carried token usage. Some
            // agent_execution_completed events fire without tokenUsage (e.g.
            // early failures, aborts), and counting them inflates the "N calls"
            // label past what the activity feed shows.
            if (data.tokenUsage && (data.tokenUsage.totalTokens || 0) > 0) {
              ms.executionsCount += 1;
            }

            if (data.tokenUsage) {
              const t = data.tokenUsage;
              let text = `Tokens: ${t.inputTokens?.toLocaleString()} in / ${t.outputTokens?.toLocaleString()} out`;
              if (data.cacheMetrics && parseFloat(data.cacheMetrics.hitRate) > 0) {
                text += ` (${data.cacheMetrics.hitRate}% cached)`;
              }
              if (data.estimatedCost > 0) {
                text += ` · $${data.estimatedCost < 0.01 ? data.estimatedCost.toFixed(6) : data.estimatedCost.toFixed(4)}`;
              }
              addActivityTo(ms, { type: 'system', text });
            }
          }
          break;
        case 'done':
          if (isActiveView) {
            isProcessing.value = false;
            Object.keys(messageStates.value).forEach((msgId) => {
              delete messageStates.value[msgId];
            });
            focusInput();
          }
          break;
      }
    };

    // Append an activity to a specific monitoring state slot (per-conversation).
    const addActivityTo = (ms, activity) => {
      const newActivity = {
        id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        ...activity,
      };
      ms.systemActivities.push(newActivity);
      if (ms.systemActivities.length > 50) {
        ms.systemActivities.splice(0, ms.systemActivities.length - 50);
      }
    };

    // Clear the activity feed for the conversation currently in view.
    const clearActivities = () => {
      const convId = store.state.chat.activeConversationId;
      const ms = convId ? monitoringStates[convId] : null;
      if (ms) ms.systemActivities = [];
    };

    const getRunningToolsForMessage = (message) => {
      if (!message || !message.toolCalls) return [];
      return message.toolCalls.filter((tc) => isRunning(message.id, tc.id)).map((tc) => tc.id);
    };

    const isRunning = (messageId, toolCallId) => {
      return !!runningToolCalls.value[`${messageId}-${toolCallId}`];
    };

    const isAnyToolRunningInMessage = (message) => {
      if (!message || !message.toolCalls) return false;
      return message.toolCalls.some((tc) => isRunning(message.id, tc.id));
    };

    const getMessageStatus = (message) => {
      if (!message || message.role !== 'assistant') return null;
      const local = messageStates.value[message.id];
      if (local) return local;

      // Local messageStates is wiped when Chat.vue unmounts. Fall back to the
      // store's per-conversation streaming flag ONLY for the trailing message
      // (last element overall — not last assistant) so we never flag a prior
      // completed assistant message while a new user turn is in flight.
      const convId = store.state.chat.activeConversationId;
      const conv = convId ? store.state.chat.conversations[convId] : null;
      if (!conv?.isStreaming) return null;
      const msgs = displayMessages.value;
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'assistant' || last.id !== message.id) return null;
      return { type: 'streaming', text: '' };
    };

    const updateSuggestionsWithAI = async (lastUserMessage, lastAssistantMessage) => {
      if (isLoadingSuggestions.value) return;

      isLoadingSuggestions.value = true;
      const token = localStorage.getItem('token');

      try {
        const recentHistory = displayMessages.value.slice(-10).map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const headers = {
          'Content-Type': 'application/json',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/orchestrator/suggestions`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            history: recentHistory,
            lastUserMessage,
            lastAssistantMessage,
            provider: store.state.aiProvider.selectedProvider,
            model: store.state.aiProvider.selectedModel,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.suggestions && Array.isArray(data.suggestions)) {
            suggestions.value = data.suggestions;
          }
        } else {
          console.error('Failed to fetch suggestions');
        }
      } catch (error) {
        console.error('Error fetching AI suggestions:', error);
      } finally {
        isLoadingSuggestions.value = false;
      }
    };

    const executeSuggestion = (suggestion) => {
      handleUserInputSubmit(suggestion.text);
    };

    const toggleToolCallExpansion = (messageId, toolCallIndex) => {
      const key = `${messageId}-${toolCallIndex}`;
      if (!expandedToolCalls.value[messageId]) {
        expandedToolCalls.value[messageId] = [];
      }
      const index = expandedToolCalls.value[messageId].indexOf(toolCallIndex);
      if (index > -1) {
        expandedToolCalls.value[messageId].splice(index, 1);
      } else {
        expandedToolCalls.value[messageId].push(toolCallIndex);
      }
    };

    const scrollToBottom = () => {
      if (conversationSpace.value) {
        conversationSpace.value.scrollTop = conversationSpace.value.scrollHeight;
      }
      baseScreenRef.value?.scrollToBottom();
    };

    // Handed to ChatScrollControls so it can attach listeners to the
    // conversation pane without us plumbing the ref through props.
    const getConversationEl = () => conversationSpace.value;

    // Keyboard navigation for the conversation pane. The textarea is at most
    // ~150px tall (4 lines), so PageUp/PageDown route to the chat (Home jumps
    // to top, End jumps to bottom) — but Home/End are left alone whenever an
    // editable element is focused so the user can move the cursor inside it.
    const handleChatKeyboardScroll = (event) => {
      const el = conversationSpace.value;
      if (!el) return;

      // Don't steal keys while a modal is open — the user is interacting with
      // the modal (buttons, inputs, etc.), not the chat behind it.
      if (document.querySelector('.modal-overlay')) return;

      const active = document.activeElement;
      const isEditable =
        !!active &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

      // Don't steal keys when a non-chat input is focused (e.g. a search box
      // teleported to body, or a popover field). The chat textarea inside
      // .input-container / .chat-input-container is still fair game for
      // PageUp/PageDown.
      const insideModalInput =
        isEditable &&
        !active.closest?.('.input-container, .chat-input-container, .automation-interface');
      if (insideModalInput) return;

      // Home/End have native cursor-movement semantics inside any editable
      // element — never hijack them while the user is typing.
      if (isEditable && (event.key === 'Home' || event.key === 'End')) return;

      const page = Math.max(80, Math.floor(el.clientHeight * 0.85));

      if (event.key === 'PageUp') {
        event.preventDefault();
        try { el.scrollBy({ top: -page, behavior: 'smooth' }); }
        catch (e) { el.scrollTop = Math.max(0, el.scrollTop - page); }
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        try { el.scrollBy({ top: page, behavior: 'smooth' }); }
        catch (e) { el.scrollTop = el.scrollTop + page; }
      } else if (event.key === 'Home') {
        event.preventDefault();
        try { el.scrollTo({ top: 0, behavior: 'smooth' }); }
        catch (e) { el.scrollTop = 0; }
      } else if (event.key === 'End') {
        event.preventDefault();
        try { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }
        catch (e) { el.scrollTop = el.scrollHeight; }
      }
    };

    const scrollToTop = () => {
      // Scroll the base screen to top
      if (baseScreenRef.value && baseScreenRef.value.$el) {
        const scrollContainer = baseScreenRef.value.$el.querySelector('.screen-content');
        if (scrollContainer) {
          scrollContainer.scrollTop = 0;
        }
      }
      // Also scroll conversation space to top
      if (conversationSpace.value) {
        conversationSpace.value.scrollTop = 0;
      }
    };

    const clearInput = () => baseScreenRef.value?.clearInput();
    const focusInput = () => baseScreenRef.value?.focusInput();

    const saveConversation = async () => {
      const token = localStorage.getItem('token');

      if (!token) {
        console.error('No authentication token found');
        return null;
      }

      try {
        // Generate a title from the first user message or use a default
        const firstUserMessage = displayMessages.value.find((msg) => msg.role === 'user');
        const conversationTitle = firstUserMessage
          ? firstUserMessage.content.substring(0, 100) + (firstUserMessage.content.length > 100 ? '...' : '')
          : 'Untitled Conversation';

        // Helper function to resolve image references in content
        const resolveImageReferences = (content) => {
          if (!content || typeof content !== 'string') return content;

          const imageRefPattern = /\{\{IMAGE_REF:([^}]+)\}\}/g;
          return content.replace(imageRefPattern, (match, imageId) => {
            const cached = imageCache.value.get(imageId);
            if (cached && cached.data) {
              console.log(`[Save] Resolved image reference: ${imageId}`);
              return cached.data; // Return the actual data URL
            }
            console.warn(`[Save] Image reference not found in cache: ${imageId}`);
            return match; // Keep the reference if not found
          });
        };

        const conversationData = {
          conversationId: currentConversationId.value,
          title: conversationTitle,
          messages: displayMessages.value.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: resolveImageReferences(msg.content), // Resolve image refs before saving
            timestamp: msg.timestamp,
            metadata: msg.metadata || [],
            toolCalls: msg.toolCalls || [],
            files: msg.files || [], // Include uploaded files (reference images)
            agentName: msg.agentName || undefined,
            agentIcon: msg.agentIcon || undefined,
          })),
          createdAt: displayMessages.value[0]?.timestamp || Date.now(),
          updatedAt: Date.now(),
        };

        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            content: JSON.stringify(conversationData),
            contentType: 'conversation',
            conversationId: currentConversationId.value,
            isShareable: false,
            title: conversationTitle, // Add title for preview
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        terminalLines.value.push(`Conversation saved successfully (ID: ${result.id})`);

        // Dispatch event to notify OutputList to refresh
        window.dispatchEvent(new CustomEvent('conversation-saved', { detail: { id: result.id } }));

        return result.id;
      } catch (error) {
        console.error('Error saving conversation:', error);
        terminalLines.value.push(`Failed to save conversation: ${error.message}`);
        return null;
      }
    };

    const loadSavedOutput = async (contentId) => {
      const token = localStorage.getItem('token');

      if (!token) {
        console.error('No authentication token found');
        return;
      }

      // Check if this conversation already exists in memory (by savedOutputId).
      // If so, just switch to it — don't re-fetch from DB, which would overwrite
      // any in-flight or unsaved messages (e.g. an assistant response still streaming).
      const conversations = store.state.chat.conversations;
      for (const [convId, conv] of Object.entries(conversations)) {
        if (conv.savedOutputId === contentId) {
          store.commit('chat/SET_ACTIVE_CONVERSATION', convId);
          currentConversationId.value = convId;
          terminalLines.value.push(`Switched to conversation (${conv.messages.length} messages)`);
          scrollToTop();
          await nextTick();
          scrollToTop();
          return;
        }
      }

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${contentId}`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.content_type === 'conversation') {
          const conversationData = JSON.parse(data.content);

          // Use the saved conversation's ID as the slot key
          const convId = conversationData.conversationId || `saved-${contentId}`;

          // Suppress enter animations when bulk-loading all messages at once
          bulkLoading.value = true;

          // Create or switch to the conversation slot
          store.commit('chat/ENSURE_CONVERSATION', convId);
          store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: convId, messages: conversationData.messages });
          store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: convId, id: contentId });
          store.commit('chat/SCOPED_SET_SAVED_OUTPUT_TITLE', { conversationId: convId, title: conversationData.title || null });
          store.commit('chat/SET_ACTIVE_CONVERSATION', convId);

          // Also update legacy flat state for components that read it directly
          currentConversationId.value = convId;

          terminalLines.value.push(
            `Loaded conversation from ${new Date(conversationData.createdAt).toLocaleDateString()} (${conversationData.messages.length} messages)`,
          );

          // Re-enable animations after DOM settles
          await nextTick();
          bulkLoading.value = false;
        } else {
          // Legacy HTML format
          const output = data.output || data;
          const content = output.content || '';
          const createdAt = output.created_at ? new Date(output.created_at) : new Date();

          store.commit('chat/ADD_MESSAGE', {
            id: generateMessageId(),
            role: 'assistant',
            content: content,
            timestamp: Date.now(),
            metadata: ['Loaded from saved outputs', `Created: ${createdAt.toLocaleDateString()}`],
          });

          terminalLines.value.push(`Loaded saved output from ${createdAt.toLocaleDateString()}`);
        }

        scrollToTop();
        await nextTick();
        scrollToTop();
      } catch (error) {
        console.error('Error loading saved output:', error);
        store.commit('chat/ADD_MESSAGE', {
          id: generateMessageId(),
          role: 'assistant',
          content: `Sorry, I couldn't load that saved output. Error: ${error.message}`,
          timestamp: Date.now(),
          metadata: ['Error'],
        });
      }
    };

    let screenInitialized = false;
    const initializeScreen = async () => {
      // Always switch back to the main conversation when entering main chat.
      // This handles returning from agent chat where the active conversation
      // and mirror state are still pointing at the agent's conversation.
      if (store.state.chat.currentAgentId) {
        store.dispatch('chat/switchToMainChat');
      } else {
        const activeId = store.state.chat.activeConversationId;
        const activeConv = activeId ? store.state.chat.conversations[activeId] : null;
        if (activeConv && activeConv.agentId) {
          store.dispatch('chat/switchToMainChat');
        }
      }

      // Skip heavy init on KeepAlive reactivation
      if (screenInitialized) return;
      screenInitialized = true;

      // Clear agent context so orchestrator chats aren't labeled with old agent names
      store.commit('chat/CLEAR_CURRENT_AGENT');

      // Register stream event callback (sync dispatch, no need to await)
      store.dispatch('chat/registerStreamEventCallback', handleStreamEvent);

      // PRIORITY: If loading a saved output, start immediately — don't wait on provider checks
      const contentId = route.query['content-id'];
      let contentLoadPromise = null;
      if (contentId) {
        terminalLines.value = ['Loading saved output...'];
        contentLoadPromise = loadSavedOutput(contentId);
      }

      // PHASE 1: Get connected apps (runs in parallel with content load)
      // fetchConnectedApps has built-in deduplication (joins in-flight promise from initializeStore)
      const versionPromise = fetchVersion(); // fire early, don't block on it
      const localServerPromise = checkLocalServer(); // fire early, don't block on 1s timeout
      await store.dispatch('appAuth/fetchConnectedApps');

      // ensureValidModel is a synchronous commit internally
      store.dispatch('aiProvider/ensureValidModel');

      // PHASE 2: Check local server result (may already be resolved or will resolve soon)
      // Use a short race so we don't wait the full 1s timeout if LM Studio isn't running
      await Promise.race([localServerPromise, new Promise((r) => setTimeout(r, 200))]);

      if (isLocalServerRunning.value) {
        await autoSwitchToLocalIfNeeded();
      }

      // Ensure a conversation slot exists on startup
      if (!store.state.chat.activeConversationId) {
        const initConvId = `temp-${Date.now()}`;
        store.commit('chat/ENSURE_CONVERSATION', initConvId);
        store.commit('chat/SET_ACTIVE_CONVERSATION', initConvId);
      }

      // Wait for content load if it was started early
      if (contentLoadPromise) {
        await contentLoadPromise;
      } else if (store.state.chat.messages.length === 0) {
        store.commit('chat/RESET_CHAT');

        // Ensure version is available before building welcome message
        await versionPromise;

        // Determine which message to show based on provider selection AND connection status
        const selectedProvider = store.state.aiProvider?.selectedProvider;
        const connectedApps = store.state.appAuth?.connectedApps || [];
        const customProviders = store.state.aiProvider?.customProviders || [];

        // Check if the selected provider is actually connected (or if it's Local and server is running)
        let isProviderActuallyConnected = false;
        if (selectedProvider) {
          if (selectedProvider.toLowerCase() === 'local') {
            isProviderActuallyConnected = isLocalServerRunning.value;
          } else if (customProviders.some((cp) => cp.id === selectedProvider)) {
            // Custom providers are connected by virtue of existing in the list.
            isProviderActuallyConnected = true;
          } else {
            const providerKey = resolveProviderKey(selectedProvider);
            isProviderActuallyConnected = connectedApps.some((app) => app.toLowerCase() === providerKey);
          }
        }

        // Show Annie welcome if provider is selected AND connected
        // Show setup message if NO provider selected OR provider not connected
        if (selectedProvider && isProviderActuallyConnected) {
          // Show normal Annie welcome message when a provider is selected AND connected
          store.commit('chat/ADD_MESSAGE', {
            id: generateMessageId(),
            role: 'assistant',
            content: "Hi! I'm Annie, your personal AI assistant. What can I help you build today?",
            timestamp: Date.now(),
            metadata: ['AGNT Status: Online', `Version: ${appVersion.value || '...'}`],
          });
          terminalLines.value = ['AI Assistant: Orchestrator online. JavaScript execution tool available.'];
        } else {
          // Show "no provider" message when NO provider is selected OR provider is not connected
          store.commit('chat/ADD_MESSAGE', {
            id: generateMessageId(),
            role: 'assistant',
            content: `<div class="setup-message">
  <div class="setup-header">
    <div class="setup-icon">🚀</div>
    <h2>Welcome to AGNT!</h2>
  </div>

  <div class="setup-content">
    <div class="setup-step">
      <div class="step-number">1</div>
      <div class="step-text">
        <h3>Connect an AI Provider</h3>
        <p>Choose from the AI providers below to get started with intelligent automation.</p>
      </div>
    </div>
  </div>
</div>`,
            timestamp: Date.now(),
            metadata: ['Setup Required', 'No AI Provider Connected'],
            showProviderSetup: true, // Special flag to show provider setup UI
            showProviderNote: true, // Special flag to show note after provider buttons
            contentType: 'html', // Mark as HTML content
          });
          terminalLines.value = ['Please connect an AI provider to begin.'];
        }
      } else {
        const lastMessages = displayMessages.value.slice(-2);
        const lastUser = lastMessages.find((m) => m.role === 'user');
        const lastAssistant = lastMessages.find((m) => m.role === 'assistant');

        if (lastUser && lastAssistant) {
          await updateSuggestionsWithAI(lastUser.content, lastAssistant.content);
        }
      }

      // PHASE 3: Fire-and-forget background data (don't block the UI)
      // Note: userStats, workflows (summary), and goals are already fetched by initializeStore
      // Only fetch active workflows for status updates and await the version promise
      Promise.allSettled([store.dispatch('workflows/fetchWorkflows', { activeOnly: true }), versionPromise]);

      // Set up polling and event listeners
      cleanup.setInterval(() => {
        checkLocalServer();
      }, 30000);
      window.addEventListener('trigger-new-chat', clearConversation);
      window.addEventListener('keydown', handleChatKeyboardScroll);

      await nextTick();
      if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise();
      }

      // Check for AI provider connection and show tutorial if needed
      if (!hasConnectedAIProvider.value) {
        cleanup.setTimeout(() => {
          noProviderTutorial.value.initializeTutorial();
        }, 1000);
      }

      focusInput();
    };

    const handlePanelAction = (action, payload) => {
      if (action === 'edit-workflow') {
        emit('screen-change', 'WorkflowForgeScreen', { workflowId: payload });
      } else if (action === 'deploy-workflow' && payload.workflowId) {
        console.log('Panel action:', action, payload);
        store.commit('chat/ADD_MESSAGE', {
          id: generateMessageId(),
          role: 'system',
          content: `Action from panel: Deploy workflow ${payload.workflowId}`,
          timestamp: Date.now(),
        });
      }
      focusInput();
    };

    // Reset the monitoring slot for a specific conversation (e.g. explicit
    // "Clear chat" action). Per-conversation state is otherwise preserved
    // across switches, so no generic reset is needed.
    const resetMonitoringStateFor = (convId) => {
      if (!convId) return;
      monitoringStates[convId] = defaultMonitoringState();
      const model = store.state.aiProvider?.selectedModel;
      monitoringStates[convId].contextStatus.tokenLimit = getContextWindowForModel(model);
    };

    const confirmModal = ref(null);
    // User-initiated clear (button click) routes through this so we don't wipe
    // history on a misclick. Programmatic clears (post-send, post-restore, the
    // 'trigger-new-chat' window event) keep calling clearConversation directly.
    const confirmClearConversation = async () => {
      const confirmed = await confirmModal.value?.showModal({
        title: 'Start a new chat?',
        message: 'Your current conversation will be saved. You can pick it back up anytime from your saved chats.',
        confirmText: 'New chat',
        confirmClass: 'btn-primary',
      });
      if (confirmed) clearConversation();
    };

    const clearConversation = () => {
      // Clear local component state
      expandedToolCalls.value = {};
      runningToolCalls.value = {};
      messageStates.value = {};

      // Prepare for new chat without aborting background streams
      store.commit('chat/PREPARE_NEW_CHAT');

      // Create a fresh conversation slot and switch to it
      // SET_ACTIVE_CONVERSATION → syncMirror will reset the global mirror
      // (messages, isStreaming, etc.) to the new empty conversation state
      const newConvId = `temp-${Date.now()}`;
      store.commit('chat/ENSURE_CONVERSATION', newConvId);
      store.commit('chat/SET_ACTIVE_CONVERSATION', newConvId);
      currentConversationId.value = null;
      terminalLines.value = ['Chat cleared by user.'];
      clearInput();
      focusInput();

      suggestions.value = [...initialSuggestions];
      // New conversation gets its own fresh monitoring slot (lazy-created on
      // first access). No need to touch other conversations' slots.
      resetMonitoringStateFor(newConvId);

      // Remove content-id query param to allow reloading the same conversation
      if (route.query['content-id']) {
        router.replace('/chat');
      }

      // Re-add the initial welcome message
      nextTick(() => {
        if (store.state.chat.messages.length === 0) {
          const selectedProvider = store.state.aiProvider?.selectedProvider;
          const connectedApps = store.state.appAuth?.connectedApps || [];
          const customProviders = store.state.aiProvider?.customProviders || [];

          // Check if the selected provider is actually connected
          let isProviderActuallyConnected = false;
          if (selectedProvider) {
            if (selectedProvider.toLowerCase() === 'local') {
              isProviderActuallyConnected = isLocalServerRunning.value;
            } else {
              // Check if it's a custom provider
              const isCustomProvider = customProviders.some((cp) => cp.id === selectedProvider);
              if (isCustomProvider) {
                isProviderActuallyConnected = true;
              } else {
                // Check built-in providers
                const providerKey = resolveProviderKey(selectedProvider);
                isProviderActuallyConnected = connectedApps.some((app) => app.toLowerCase() === providerKey);
              }
            }
          }

          if (selectedProvider && isProviderActuallyConnected) {
            // Show normal Annie welcome message when a provider is selected AND connected
            store.commit('chat/ADD_MESSAGE', {
              id: generateMessageId(),
              role: 'assistant',
              content: "Hi! I'm Annie, your personal AI assistant. What can I help you build today?",
              timestamp: Date.now(),
              metadata: ['AGNT Status: Online', `Version: ${appVersion.value || '...'}`],
            });
          } else {
            // Show "no provider" message when NO provider is selected OR provider is not connected
            store.commit('chat/ADD_MESSAGE', {
              id: generateMessageId(),
              role: 'assistant',
              content: `<div class="setup-message">
  <div class="setup-header">
    <div class="setup-icon">🚀</div>
    <h2>Welcome to AGNT!</h2>
  </div>
  
  <div class="setup-content">
    <div class="setup-step">
      <div class="step-number">1</div>
      <div class="step-text">
        <h3>Connect an AI Provider</h3>
        <p>Choose from the AI providers below to get started with intelligent automation.</p>
      </div>
    </div>
  </div>
</div>`,
              timestamp: Date.now(),
              metadata: ['Setup Required', 'No AI Provider Connected'],
              showProviderSetup: true, // Special flag to show provider setup UI
              showProviderNote: true, // Special flag to show note after provider buttons
              contentType: 'html', // Mark as HTML content
            });
          }
        }
        scrollToBottom();
      });

      // Notify OutputList to deselect the current conversation
      window.dispatchEvent(new CustomEvent('chat-cleared'));
    };

    onUnmounted(() => {
      // Unregister stream event callback when component unmounts
      store.dispatch('chat/unregisterStreamEventCallback', handleStreamEvent);
      window.removeEventListener('trigger-new-chat', clearConversation);
      window.removeEventListener('keydown', handleChatKeyboardScroll);
    });

    // MathJax typesetting is handled per-message in MessageItem.vue (after streaming completes).
    // A global watcher here would fire on every stream chunk, causing flicker with morphdom.

    // Watch for route query parameter changes to load saved outputs
    watch(
      () => route.query['content-id'],
      async (newContentId, oldContentId) => {
        if (newContentId && newContentId !== oldContentId) {
          scrollToTop();
          terminalLines.value = ['Loading saved output...'];
          await loadSavedOutput(newContentId);
          await nextTick();
          scrollToTop();
        }
      },
    );

    // Fetch the conversation's aggregated monitoring summary from the backend
    // and populate its slot. Only hits the DB once per slot per session and
    // only for real server-assigned conversation IDs (skips `temp-*` slots
    // that don't exist in the DB yet). Does not overwrite slots that already
    // have live data — live events are authoritative for the current session.
    const hydrateMonitoringFromDb = async (convId) => {
      if (!convId || typeof convId !== 'string') return;
      if (convId.startsWith('temp-')) return;
      const ms = getMonitoringState(convId);
      if (!ms || ms._hydrated) return;
      ms._hydrated = true;

      try {
        const token = localStorage.getItem('token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch(`${API_CONFIG.BASE_URL}/executions/conversation/${encodeURIComponent(convId)}/summary`, { headers });
        if (!response.ok) return;
        const summary = await response.json();
        if (!summary || !summary.executionsCount || !summary.latest) return;

        // Don't clobber slots that received live events while the fetch
        // was in flight — live session data wins over historical.
        if (ms.lastTokenUsage) return;

        const latest = summary.latest;
        ms.lastTokenUsage = latest.tokenUsage || null;
        ms.lastCacheMetrics = latest.cacheMetrics || null;
        ms.lastEstimatedCost = latest.estimatedCost != null ? latest.estimatedCost : null;
        if (latest.toolCallsCount > 0) ms.toolsLoadedCount = latest.toolCallsCount;

        // Seed conversation-wide totals from the DB rollup so the panel shows
        // correct cumulative cost/cache stats across page reloads.
        const cum = summary.cumulative;
        if (cum) {
          ms.totalTokenUsage = {
            inputTokens: cum.inputTokens || 0,
            outputTokens: cum.outputTokens || 0,
            totalTokens: cum.totalTokens || 0,
          };
          ms.totalCost = Number(cum.estimatedCost) || 0;
          if (cum.cacheMetrics) {
            ms.totalCacheMetrics = {
              cacheReadTokens: cum.cacheMetrics.cacheReadTokens || 0,
              cacheCreationTokens: cum.cacheMetrics.cacheCreationTokens || 0,
              uncachedTokens: cum.cacheMetrics.uncachedTokens || 0,
              hitRate: cum.cacheMetrics.hitRate || '0',
            };
          }
        }
        ms.executionsCount = summary.executionsCount || 0;
      } catch (e) {
        // Reset the hydration flag so we can retry later if the user
        // stays on this conversation and the network recovers.
        ms._hydrated = false;
        console.warn('[Chat] Failed to hydrate monitoring state:', e.message);
      }
    };

    // Switching conversations no longer resets monitoring — each conversation
    // owns its own persistent monitoring slot (see `monitoringStates`).
    // Initialize the tokenLimit from the current model whenever we land on
    // a conversation whose slot hasn't yet received a context_status event,
    // and hydrate token/cache/cost from the DB so historical state survives
    // page reloads and cold starts.
    watch(
      () => store.state.chat.activeConversationId,
      (newId) => {
        if (!newId) return;
        const ms = getMonitoringState(newId);
        if (ms && !ms.contextStatus.tokenLimit) {
          const model = store.state.aiProvider?.selectedModel;
          ms.contextStatus.tokenLimit = getContextWindowForModel(model);
          if (!ms.contextStatus.model || ms.contextStatus.model === 'N/A') {
            ms.contextStatus.model = model || 'N/A';
          }
        }
        hydrateMonitoringFromDb(newId);
      },
      { immediate: true },
    );

    const handleScreenChange = (screenName) => {
      emit('screen-change', screenName);
    };

    const handleProviderConnected = async (provider) => {
      console.log('Provider connected in Chat.vue:', provider);

      // Refresh connected apps to update hasConnectedAIProvider
      await store.dispatch('appAuth/fetchConnectedApps');

      // Clear the conversation and show normal welcome message
      clearConversation();

      // Add a small delay to ensure the provider state is updated
      await nextTick();

      terminalLines.value.push(`[Provider] Successfully connected to ${provider.name}`);
    };

    // Pass emit function to tutorial so it can emit screen-change directly
    const tutorialWithCallback = useTutorial(emit);

    // Watch for local server status changes
    watch(isLocalServerRunning, async (isRunning, wasRunning) => {
      const selectedProvider = store.state.aiProvider?.selectedProvider;

      // Server became available (false -> true)
      if (isRunning && !wasRunning) {
        console.log('[Auto-Switch] Local server detected - checking if auto-switch needed');
        await autoSwitchToLocalIfNeeded();

        // Force update the message if we're showing the setup screen
        await nextTick();
        const currentMessage = displayMessages.value[0];
        if (currentMessage && currentMessage.showProviderSetup) {
          console.log('[Auto-Switch] Replacing setup message with Annie welcome');

          // Clear and show Annie message
          store.commit('chat/RESET_CHAT');
          expandedToolCalls.value = {};
          runningToolCalls.value = {};
          messageStates.value = {};
          currentConversationId.value = null;
          suggestions.value = [...initialSuggestions];

          terminalLines.value = ['[Auto-Switch] Local AI provider connected via LM Studio'];

          await nextTick();

          store.commit('chat/ADD_MESSAGE', {
            id: generateMessageId(),
            role: 'assistant',
            content: "Hi! I'm Annie, your personal AI assistant. What can I help you build today?",
            timestamp: Date.now(),
            metadata: ['AGNT Status: Online', `Version: ${appVersion.value || '...'}`],
          });

          // Enable input after connection
          await nextTick();
          if (baseScreenRef.value) {
            baseScreenRef.value.setInputDisabled(false);
          }
          focusInput();
        }
      }
      // Server disconnected (true -> false) AND Local was the selected provider
      else if (!isRunning && wasRunning && selectedProvider?.toLowerCase() === 'local') {
        console.log('[Auto-Switch] Local server disconnected - switching to provider setup');

        // Clear messages and reset state
        store.commit('chat/RESET_CHAT');
        expandedToolCalls.value = {};
        runningToolCalls.value = {};
        messageStates.value = {};
        currentConversationId.value = null;
        suggestions.value = [...initialSuggestions];

        terminalLines.value = ['[Auto-Switch] Local AI provider disconnected'];

        // Wait for next tick to ensure state is updated
        await nextTick();

        // Force show provider setup message
        store.commit('chat/ADD_MESSAGE', {
          id: generateMessageId(),
          role: 'assistant',
          content: `<div class="setup-message">
  <div class="setup-header">
    <div class="setup-icon">🚀</div>
    <h2>Welcome to AGNT!</h2>
  </div>
  
  <div class="setup-content">
    <div class="setup-step">
      <div class="step-number">1</div>
      <div class="step-text">
        <h3>Connect an AI Provider</h3>
        <p>Choose from the AI providers below to get started with intelligent automation.</p>
      </div>
    </div>
  </div>
</div>`,
          timestamp: Date.now(),
          metadata: ['Setup Required', 'No AI Provider Connected'],
          showProviderSetup: true,
          showProviderNote: true,
          contentType: 'html',
        });

        // Disable input after disconnection
        await nextTick();
        if (baseScreenRef.value) {
          baseScreenRef.value.setInputDisabled(true);
        }
      }
    });

    // Reset context monitor for the active conversation when the user
    // switches provider or model. Other conversations keep their own
    // recorded state (they'll update on their next stream event).
    watch(
      () => [store.state.aiProvider?.selectedProvider, store.state.aiProvider?.selectedModel],
      () => {
        const convId = store.state.chat.activeConversationId;
        if (!convId) return;
        const ms = getMonitoringState(convId);
        const model = store.state.aiProvider?.selectedModel;
        ms.contextStatus = {
          currentTokens: 0,
          tokenLimit: getContextWindowForModel(model),
          utilizationPercent: 0,
          model: model || 'N/A',
          messagesCount: 0,
        };
      },
    );

    // Watch for provider connection changes and update input state
    watch(
      hasConnectedAIProvider,
      (hasProvider) => {
        if (baseScreenRef.value) {
          baseScreenRef.value.setInputDisabled(!hasProvider);
        }

        // Show tutorial when provider is disconnected
        if (!hasProvider && tutorialWithCallback.startTutorial) {
          tutorialWithCallback.startTutorial.value = true;
        }
      },
      { immediate: true },
    );

    // Watch store's streaming states to update local processing state.
    // Active = local streaming (this tab) OR remote streaming (other tabs)
    // OR an async tool still running after the LLM turn finished — so the
    // "working..." indicator stays up while background work is in flight.
    watch(
      () => {
        const c = store.state.chat;
        return (
          c.isStreaming ||
          c.isRemoteStreaming ||
          (c.activeAsyncTools && c.activeAsyncTools.size > 0)
        );
      },
      (streaming) => {
        isProcessing.value = streaming;

        // Clear ALL message states when streaming stops (including manual stop)
        // This ensures "Annie is processing results..." and "Running tool..." messages are removed
        if (!streaming) {
          Object.keys(messageStates.value).forEach((msgId) => {
            delete messageStates.value[msgId];
          });

          // Also clear all running tool call states
          Object.keys(runningToolCalls.value).forEach((key) => {
            delete runningToolCalls.value[key];
          });
        }
      },
      { immediate: true },
    );

    // Watch for remote streaming to show thinking state in message bubble
    watch(
      () => store.state.chat.isRemoteStreaming,
      (remoteStreaming) => {
        if (remoteStreaming) {
          // Find the last assistant message (the one being streamed from other tab)
          const lastAssistantMsg = [...displayMessages.value].reverse().find((m) => m.role === 'assistant');
          if (lastAssistantMsg) {
            const rsName = lastAssistantMsg.agentName || 'Annie';
            messageStates.value[lastAssistantMsg.id] = {
              type: 'thinking',
              text: `${rsName} is thinking...`,
            };
          }
        }
      },
      { immediate: true },
    );

    // Sync conversation ID from store
    watch(
      () => store.state.chat.currentConversationId,
      (newId) => {
        if (newId) {
          currentConversationId.value = newId;
        }
      },
    );

    // Auto-scroll to bottom when new messages arrive (if user is already near bottom)
    watch(
      displayMessages,
      () => {
        if (!conversationSpace.value) return;

        const el = conversationSpace.value;
        const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;

        if (isNearBottom) {
          nextTick(() => scrollToBottom());
        }
      },
      { deep: true },
    );

    return {
      ...tutorialWithCallback,
      baseScreenRef,
      conversationSpace,
      terminalLines,
      displayMessages,
      isProcessing,
      suggestions,
      isLoadingSuggestions,
      contextStatus,
      lastContextManaged,
      contextManaged,
      errorsCaught,
      toolTruncations,
      toolsLoadedCount,
      lastTokenUsage,
      lastCacheMetrics,
      lastEstimatedCost,
      totalTokenUsage,
      totalCost,
      totalCacheMetrics,
      executionsCount,
      systemActivities,
      clearActivities,
      handleUserInputSubmit,
      handleEditMessage,
      handlePanelAction,
      handleScreenChange,
      handleProviderConnected,
      executeSuggestion,
      toggleToolCallExpansion,
      getMessageStatus,
      getRunningToolsForMessage,
      clearConversation,
      confirmClearConversation,
      confirmModal,
      getConversationEl,
      saveConversation,
      activeAgentName,
      useTutorial,
      initializeScreen,
      isMobile,
      isMonitoringCollapsed,
      toggleMonitoringPanel,
      hasConnectedAIProvider,
      imageCache,
      dataCache,
      bulkLoading,
    };
  },
};
</script>

<style scoped>
.automation-interface {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.mobile-view :deep(.message-avatar) {
  display: none;
}

.monitoring-panel {
  background: var(--color-darker-0);
  border-bottom: 1px solid rgba(127, 129, 147, 0.1);
  transition: all 0.3s ease;
  border-radius: 0;
}

.monitoring-panel.collapsed {
  border-bottom: 1px solid rgba(127, 129, 147, 0.05);
  border-radius: 0 0 8px 8px;
}

.monitoring-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: 0 0 8px 8px;
}

.monitoring-header:hover {
  background: var(--color-darker-0);
}

.monitoring-title {
  font-size: 0.75em;
  font-weight: 600;
  color: var(--color-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.monitoring-toggle {
  font-size: 0.8em;
  color: var(--color-med-navy);
  transition: all 0.2s ease;
  user-select: none;
}

.monitoring-toggle.expanded {
  color: var(--color-blue);
}

.monitoring-content {
  display: flex;
  gap: 8px;
  padding: 0 16px 8px 16px;
  flex-wrap: wrap;
  transition: all 0.3s ease;
  border-radius: 0;
}

.monitoring-content > * {
  flex: 1;
  min-width: 280px;
}

.conversation-canvas-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.conversation-canvas {
  flex: 1;
  overflow-y: scroll !important;
  padding: 48px 0px 32px;
  scrollbar-width: thin !important;
}

.conversation-canvas::-webkit-scrollbar {
  width: 10px !important;
  display: block !important;
}

.conversation-canvas::-webkit-scrollbar-track {
  background: var(--color-darker-2) !important;
}

.conversation-canvas::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.4) !important;
  border-radius: 4px;
}

.conversation-canvas::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.6) !important;
}

.conversation-container {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.message-flow {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-left: -44px;
  min-width: 0;
}

.message-enter-active {
  transition:
    opacity 0.3s ease-out,
    transform 0.3s ease-out;
}

.message-leave-active {
  transition:
    opacity 0.3s ease-in,
    transform 0.3s ease-in;
}

.message-enter-from {
  opacity: 0;
  transform: translateY(15px);
}

.message-leave-to {
  opacity: 0;
  transform: translateY(15px);
}
/* 
.chat-screen-wrapper :deep(.scrollable-content) {
  padding: 8px;
} */

@media (max-width: 768px) {
  .conversation-canvas {
    margin-top: 32px;
    padding: 16px 8px 0;
  }

  .conversation-container {
    max-width: 100%;
  }

  .message-content {
    max-width: 100%;
  }
}
</style>
