<template>
  <BaseScreen
    class="chat-screen-wrapper"
    ref="baseScreenRef"
    screenId="ChatScreen"
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
        <EngineHeader
          v-if="!isMobile"
          :systemActivity="systemActivity"
          :activeWorkflows="activeWorkflows"
          :avgResponseTime="avgResponseTime"
          :successRate="successRate"
        />

        <!-- Context Monitoring Panel -->
        <div v-if="!isMobile" class="monitoring-panel" :class="{ collapsed: isMonitoringCollapsed }">
          <div class="monitoring-header" @click="toggleMonitoringPanel">
            <span class="monitoring-title">System Monitoring</span>
            <span class="monitoring-toggle" :class="{ expanded: !isMonitoringCollapsed }">
              {{ isMonitoringCollapsed ? '▶' : '▼' }}
            </span>
          </div>
          <div class="monitoring-content" v-show="!isMonitoringCollapsed">
            <ContextMonitor :contextStatus="contextStatus" :lastManaged="lastContextManaged" />
            <SystemHealthPanel
              :systemHealth="systemHealth"
              :contextManaged="contextManaged"
              :errorsCaught="errorsCaught"
              :toolTruncations="toolTruncations"
            />
            <ActivityFeed :activities="systemActivities" @clear="clearActivities" />
          </div>
        </div>

        <!-- Conversation Canvas -->
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
                :avatarUrl="message.agentIcon && (message.agentIcon.startsWith('http') || message.agentIcon.startsWith('data:') || message.agentIcon.startsWith('/')) ? message.agentIcon : null"
                @toggle-tool="toggleToolCallExpansion"
                @provider-connected="handleProviderConnected"
                @edit-message="handleEditMessage"
              />
            </TransitionGroup>

            <!-- Processing State -->
            <ProcessingState v-if="isProcessing" :text="`${activeAgentName} is working...`" />
          </div>
        </div>

        <!-- Quick Actions -->
        <QuickActions
          v-if="!isMobile && hasConnectedAIProvider"
          :suggestions="suggestions"
          :isLoading="isLoadingSuggestions"
          @execute="executeSuggestion"
        />

        <!-- Chat Actions Bar for Clear and Save Buttons -->
        <ChatActions v-if="!isMobile && hasConnectedAIProvider" @clear="clearConversation" @save="saveConversation" />
      </div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, computed, watch, inject } from 'vue';
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

    // Business Metrics
    const systemActivity = ref(94);
    const activeWorkflows = computed(() => (store.getters['workflows/activeWorkflows'] || []).length);
    const avgResponseTime = computed(() => (store.getters['userStats/agentActivityLastFetchTime'] ? 50 + Math.floor(Math.random() * 50) : 127));
    const successRate = computed(() => store.getters['userStats/roiPercentage'] || 97);

    // Context Monitoring State
    const contextStatus = ref({
      currentTokens: 0,
      tokenLimit: 0,
      utilizationPercent: 0,
      model: store.state.aiProvider?.selectedModel || 'N/A',
      messagesCount: 0,
    });
    const lastContextManaged = ref(null);
    const systemHealth = ref({
      memoryUsage: null,
      activeProcesses: ['EmailReceiver', 'WebhookReceiver'],
      errorsCaught: 0,
      uptime: null,
    });
    const contextManaged = ref(false);
    const errorsCaught = ref(0);
    const toolTruncations = ref(0);
    const systemActivities = ref([]);

    // Known context windows for common models (static data, no API call needed)
    const MODEL_CONTEXT_WINDOWS = {
      // OpenAI
      'gpt-5.2': 400000, 'gpt-5.1': 400000, 'gpt-5': 400000, 'gpt-5-mini': 400000, 'gpt-5-nano': 400000,
      'o4-mini': 200000, 'o3': 200000, 'o3-mini': 200000,
      'gpt-4.1': 1000000, 'gpt-4.1-mini': 1000000, 'gpt-4.1-nano': 1000000,
      'gpt-4o': 128000, 'gpt-4o-mini': 128000,
      // Anthropic
      'claude-opus-4-6': 200000, 'claude-sonnet-4-6': 200000,
      'claude-opus-4-5-20251101': 200000, 'claude-sonnet-4-5-20250929': 200000, 'claude-haiku-4-5-20251001': 200000,
      'claude-sonnet-4-20250514': 200000, 'claude-opus-4-20250514': 200000,
      'claude-3-5-sonnet-20241022': 200000, 'claude-3-5-haiku-20241022': 200000,
      // Google
      'gemini-3.1-pro-preview': 1048576, 'gemini-3-flash-preview': 1048576,
      'gemini-2.5-pro': 1048576, 'gemini-2.5-flash': 1048576, 'gemini-2.5-flash-lite': 1048576,
      // Grok
      'grok-4-0709': 256000, 'grok-3': 131072, 'grok-3-mini': 131072,
      // Groq
      'llama-3.3-70b-versatile': 131072, 'llama-3.1-8b-instant': 131072,
      // DeepSeek
      'deepseek-chat': 128000, 'deepseek-reasoner': 128000,
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

    const updateContextWindow = () => {
      const model = store.state.aiProvider?.selectedModel;
      if (!model) return;
      const contextWindow = getContextWindowForModel(model);
      contextStatus.value = {
        ...contextStatus.value,
        model,
        tokenLimit: contextWindow || contextStatus.value.tokenLimit,
      };
    };

    // Update immediately and whenever model changes
    updateContextWindow();

    // Quick Actions
    const initialSuggestions = [
      { id: 1, text: 'What can you do?', icon: '🤔' },
      { id: 2, text: 'List all available tools', icon: '🛠️' },
      { id: 4, text: "List files in './'", icon: '📁' },
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
                content: `**Available Commands**\n\n` +
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
      await Promise.all(agents.map(agent =>
        store.dispatch('chat/startStreamingConversation', {
          userInput: input,
          files: files,
          provider: store.state.aiProvider.selectedProvider,
          model: store.state.aiProvider.selectedModel,
          reasoningEnabled: store.state.aiProvider.reasoningEnabled,
          mentionedAgent: agent,
        })
      ));
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
        reasoningEnabled: store.state.aiProvider.reasoningEnabled,
      });
    };

    // Stream event handler for component-specific logic
    const handleStreamEvent = (eventName, data) => {
      switch (eventName) {
        case 'conversation_started':
          currentConversationId.value = data.conversationId;
          break;
        case 'assistant_message': {
          const name = data.agentName || 'Annie';
          messageStates.value[data.id] = {
            type: 'thinking',
            text: `${name} is thinking...`,
          };
          break;
        }
        case 'reasoning_delta': {
          // Use the specific message's agentName, not the global activeAgentName
          const msg = displayMessages.value.find(m => m.id === data.assistantMessageId);
          const rName = msg?.agentName || 'Annie';
          messageStates.value[data.assistantMessageId] = {
            type: 'thinking',
            text: `${rName} is reasoning...`,
          };
          break;
        }
        case 'tool_start':
          runningToolCalls.value[`${data.assistantMessageId}-${data.toolCall.id}`] = true;
          messageStates.value[data.assistantMessageId] = {
            type: 'tool',
            text: `Running ${data.toolCall.name}...`,
          };
          break;
        case 'tool_end': {
          runningToolCalls.value[`${data.assistantMessageId}-${data.toolCall.id}`] = false;
          const message = displayMessages.value.find((m) => m.id === data.assistantMessageId);
          if (message && !isAnyToolRunningInMessage(message)) {
            const teName = message.agentName || 'Annie';
            messageStates.value[data.assistantMessageId] = {
              type: 'thinking',
              text: `${teName} is processing results...`,
            };
          }
          if (data.toolCall.error) {
            errorsCaught.value++;
            addActivity({
              type: 'error',
              text: `Error handled in ${data.toolCall.name || 'tool'}: ${data.toolCall.error}`,
            });
          }
          break;
        }
        case 'context_status':
          contextStatus.value = {
            currentTokens: data.currentTokens,
            tokenLimit: data.tokenLimit,
            utilizationPercent: data.utilizationPercent,
            model: data.model,
            messagesCount: data.messagesCount,
          };
          break;
        case 'context_managed':
          contextManaged.value = true;
          lastContextManaged.value = {
            originalTokens: data.originalTokens,
            managedTokens: data.managedTokens,
            reduction: data.reduction,
            strategy: data.strategy,
          };
          addActivity({
            type: 'context',
            text: `Context reduced: ${data.originalTokens.toLocaleString()} → ${data.managedTokens.toLocaleString()} tokens`,
          });
          cleanup.setTimeout(() => {
            contextManaged.value = false;
          }, 5000);
          break;
        case 'tool_output_managed':
          toolTruncations.value++;
          addActivity({
            type: 'truncation',
            text: `${data.toolName} output truncated: ${data.originalSize} → ${data.managedSize} chars`,
          });
          break;
        case 'image_generated':
          // Image is now handled by the store
          console.log(`Image cached: ${data.imageId} for message ${data.assistantMessageId}`);
          break;
        case 'files_processed':
          addActivity({
            type: 'info',
            text: `Processed ${data.fileCount} file(s): ${data.fileNames.join(', ')}`,
          });
          break;
        case 'final_content':
          delete messageStates.value[data.assistantMessageId];
          updateSuggestionsWithAI(displayMessages.value.slice(-2)[0]?.content, data.content);
          break;
        case 'error':
          errorsCaught.value++;
          addActivity({
            type: 'error',
            text: `System error handled: ${data.error}`,
          });
          isProcessing.value = false;
          break;
        case 'done':
          isProcessing.value = false;
          Object.keys(messageStates.value).forEach((msgId) => {
            const msg = displayMessages.value.find((m) => m.id === msgId);
            if (!msg || msg.content) {
              delete messageStates.value[msgId];
            }
          });
          focusInput();
          break;
      }
    };

    const addActivity = (activity) => {
      const newActivity = {
        id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        ...activity,
      };
      systemActivities.value.push(newActivity);

      // Keep only the last 50 activities
      if (systemActivities.value.length > 50) {
        systemActivities.value = systemActivities.value.slice(-50);
      }
    };

    const clearActivities = () => {
      systemActivities.value = [];
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
      return messageStates.value[message.id] || null;
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
            `Loaded conversation from ${new Date(conversationData.createdAt).toLocaleDateString()} (${conversationData.messages.length} messages)`
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
      await Promise.race([
        localServerPromise,
        new Promise(r => setTimeout(r, 200)),
      ]);

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

        // Check if the selected provider is actually connected (or if it's Local and server is running)
        let isProviderActuallyConnected = false;
        if (selectedProvider) {
          if (selectedProvider.toLowerCase() === 'local') {
            isProviderActuallyConnected = isLocalServerRunning.value;
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
      Promise.allSettled([
        store.dispatch('workflows/fetchWorkflows', { activeOnly: true }),
        versionPromise,
      ]);

      // Set up polling and event listeners
      cleanup.setInterval(() => {
        checkLocalServer();
      }, 30000);
      window.addEventListener('trigger-new-chat', clearConversation);

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

      // Reset context monitor to show model's full context window with 0 tokens used
      const model = store.state.aiProvider?.selectedModel;
      contextStatus.value = {
        currentTokens: 0,
        tokenLimit: getContextWindowForModel(model),
        utilizationPercent: 0,
        model: model || 'N/A',
        messagesCount: 0,
      };
      suggestions.value = [...initialSuggestions];

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
      }
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

    // Reset context monitor when user switches provider or model
    watch(
      () => [store.state.aiProvider?.selectedProvider, store.state.aiProvider?.selectedModel],
      () => {
        const model = store.state.aiProvider?.selectedModel;
        contextStatus.value = {
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
      { immediate: true }
    );

    // Watch store's streaming states to update local processing state
    // Includes both local streaming (this tab) and remote streaming (other tabs)
    watch(
      () => store.state.chat.isStreaming || store.state.chat.isRemoteStreaming,
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
      { immediate: true }
    );

    // Watch for remote streaming to show thinking state in message bubble
    watch(
      () => store.state.chat.isRemoteStreaming,
      (remoteStreaming) => {
        if (remoteStreaming) {
          // Find the last assistant message (the one being streamed from other tab)
          const lastAssistantMsg = [...displayMessages.value].reverse().find(m => m.role === 'assistant');
          if (lastAssistantMsg) {
            const rsName = lastAssistantMsg.agentName || 'Annie';
            messageStates.value[lastAssistantMsg.id] = {
              type: 'thinking',
              text: `${rsName} is thinking...`,
            };
          }
        }
      },
      { immediate: true }
    );

    // Sync conversation ID from store
    watch(
      () => store.state.chat.currentConversationId,
      (newId) => {
        if (newId) {
          currentConversationId.value = newId;
        }
      }
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
      { deep: true }
    );

    return {
      ...tutorialWithCallback,
      baseScreenRef,
      conversationSpace,
      terminalLines,
      displayMessages,
      isProcessing,
      systemActivity,
      activeWorkflows,
      avgResponseTime,
      successRate,
      suggestions,
      isLoadingSuggestions,
      contextStatus,
      lastContextManaged,
      systemHealth,
      contextManaged,
      errorsCaught,
      toolTruncations,
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
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
}

.message-leave-active {
  transition: opacity 0.3s ease-in, transform 0.3s ease-in;
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
