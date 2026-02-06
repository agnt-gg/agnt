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
            <TransitionGroup name="message" tag="div" class="message-flow">
              <MessageItem
                v-for="message in displayMessages"
                :key="message.id"
                :message="message"
                :status="getMessageStatus(message)"
                :runningTools="getRunningToolsForMessage(message)"
                :imageCache="imageCache"
                :dataCache="dataCache"
                @toggle-tool="toggleToolCallExpansion"
                @provider-connected="handleProviderConnected"
              />
            </TransitionGroup>

            <!-- Processing State -->
            <ProcessingState v-if="isProcessing" text="Annie is working..." />
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
import { useRoute } from 'vue-router';
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
import { API_CONFIG } from '@/tt.config.js';
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
    const cleanup = useCleanup();
    const baseScreenRef = ref(null);
    const conversationSpace = ref(null);
    const isMobile = inject('isMobile', ref(false));

    // App Version (dynamic)
    const { appVersion, fetchVersion } = useAppVersion();

    // Core State
    const terminalLines = ref([]);
    const currentConversationId = ref(null);
    const messagesFromStore = computed(() => store.state.chat.messages);
    const expandedToolCalls = ref({});
    const runningToolCalls = ref({});
    const messageStates = ref({});

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
        emit('screen-change', 'SecretsScreen');
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
    const checkLocalServer = async () => {
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
        const appLower = app.toLowerCase();
        return ['anthropic', 'openai', 'openai-codex', 'openai-codex-cli', 'gemini', 'grokai', 'groq', 'openrouter', 'togetherai'].includes(appLower);
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

      // Check if the selected provider is in the connected apps (case-insensitive)
      return connectedApps.some((app) => app.toLowerCase() === selectedProvider.toLowerCase());
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
      tokenLimit: 16000,
      utilizationPercent: 0,
      model: 'N/A',
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

    const handleUserInputSubmit = async (input, files = null) => {
      if (!input || !input.trim()) return;

      const command = input.trim().toLowerCase();
      if (command === 'clear' || command === 'cls') {
        clearConversation();
        return;
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
        // Convert files to data URLs for preview (especially images)
        const filePromises = files.map(async (file) => {
          const fileData = {
            name: file.name,
            type: file.type,
            size: file.size,
          };

          // For images, create data URL for preview
          if (file.type.startsWith('image/')) {
            return new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                fileData.dataUrl = e.target.result;
                resolve(fileData);
              };
              reader.onerror = () => {
                console.error('Error reading file:', file.name);
                resolve(fileData); // Resolve without dataUrl on error
              };
              reader.readAsDataURL(file);
            });
          }

          return fileData;
        });

        userMessage.files = await Promise.all(filePromises);
      }

      store.commit('chat/ADD_MESSAGE', userMessage);
      terminalLines.value.push(`> ${input}${files && files.length > 0 ? ` [${files.length} file(s) attached]` : ''}`);

      // Scroll to bottom when user sends a message
      nextTick(() => scrollToBottom());

      clearInput();

      // Use store-based streaming instead of component-based
      await store.dispatch('chat/startStreamingConversation', {
        userInput: input,
        files: files, // Pass files to the store action
        provider: store.state.aiProvider.selectedProvider,
        model: store.state.aiProvider.selectedModel,
      });
    };

    // Stream event handler for component-specific logic
    const handleStreamEvent = (eventName, data) => {
      switch (eventName) {
        case 'conversation_started':
          currentConversationId.value = data.conversationId;
          break;
        case 'assistant_message':
          messageStates.value[data.id] = {
            type: 'thinking',
            text: 'Annie is thinking...',
          };
          break;
        case 'tool_start':
          runningToolCalls.value[`${data.assistantMessageId}-${data.toolCall.id}`] = true;
          messageStates.value[data.assistantMessageId] = {
            type: 'tool',
            text: `Running ${data.toolCall.name}...`,
          };
          break;
        case 'tool_end':
          runningToolCalls.value[`${data.assistantMessageId}-${data.toolCall.id}`] = false;
          const message = displayMessages.value.find((m) => m.id === data.assistantMessageId);
          if (message && !isAnyToolRunningInMessage(message)) {
            messageStates.value[data.assistantMessageId] = {
              type: 'thinking',
              text: 'Annie is processing results...',
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

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/${contentId}`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Check if this is a conversation-type output
        if (data.content_type === 'conversation') {
          const conversationData = JSON.parse(data.content);

          // Clear existing chat
          store.commit('chat/RESET_CHAT');

          // Restore conversation ID
          currentConversationId.value = conversationData.conversationId;

          // IMPORTANT: Set the savedOutputId so autosave updates this conversation instead of creating a new one
          store.commit('chat/SET_SAVED_OUTPUT_ID', contentId);

          // Restore all messages
          conversationData.messages.forEach((msg) => {
            store.commit('chat/ADD_MESSAGE', msg);
          });

          terminalLines.value.push(
            `Loaded conversation from ${new Date(conversationData.createdAt).toLocaleDateString()} (${conversationData.messages.length} messages)`
          );
        } else {
          // Legacy HTML format - handle as before
          const output = data.output || data;
          const content = output.content || '';
          const createdAt = output.created_at ? new Date(output.created_at) : new Date();

          // Add the saved output as an assistant message
          store.commit('chat/ADD_MESSAGE', {
            id: generateMessageId(),
            role: 'assistant',
            content: content,
            timestamp: Date.now(),
            metadata: ['Loaded from saved outputs', `Created: ${createdAt.toLocaleDateString()}`],
          });

          terminalLines.value.push(`Loaded saved output from ${createdAt.toLocaleDateString()}`);
        }

        // Scroll to top immediately and after render to prevent scroll position carry-over
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

    const initializeScreen = async () => {
      document.body.setAttribute('data-page', 'terminal-chat');

      // Clear agent context so orchestrator chats aren't labeled with old agent names
      store.commit('chat/CLEAR_CURRENT_AGENT');

      // Fetch app version for display
      await fetchVersion();

      // Register stream event callback for this component
      store.dispatch('chat/registerStreamEventCallback', handleStreamEvent);

      // CRITICAL: Fetch connected apps FIRST before any other checks
      await store.dispatch('appAuth/fetchConnectedApps');

      // CRITICAL: Check local server and auto-switch BEFORE setting up welcome messages
      await checkLocalServer();

      // If local server is running and no other provider is set, auto-switch
      if (isLocalServerRunning.value) {
        await autoSwitchToLocalIfNeeded();
      }

      // Wait for next tick to ensure provider state is fully updated
      await nextTick();

      // Poll for local server status every 5 seconds
      const localServerCheckInterval = setInterval(() => {
        checkLocalServer();
      }, 5000);

      // Store interval ID for cleanup
      cleanup.setInterval(localServerCheckInterval);

      // Ensure a valid model is selected for the current provider
      await store.dispatch('aiProvider/ensureValidModel');

      // Check if we're loading a saved output
      const contentId = route.query['content-id'];

      if (contentId) {
        // Clear existing chat and load the saved output
        store.commit('chat/RESET_CHAT');
        terminalLines.value = ['Loading saved output...'];
        await loadSavedOutput(contentId);
      } else if (store.state.chat.messages.length === 0) {
        store.commit('chat/RESET_CHAT');

        // Determine which message to show based on provider selection AND connection status
        const selectedProvider = store.state.aiProvider?.selectedProvider;
        const connectedApps = store.state.appAuth?.connectedApps || [];

        // Check if the selected provider is actually connected (or if it's Local and server is running)
        let isProviderActuallyConnected = false;
        if (selectedProvider) {
          if (selectedProvider.toLowerCase() === 'local') {
            isProviderActuallyConnected = isLocalServerRunning.value;
          } else {
            isProviderActuallyConnected = connectedApps.some((app) => app.toLowerCase() === selectedProvider.toLowerCase());
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

      await store.dispatch('userStats/fetchStats');
      await store.dispatch('workflows/fetchWorkflows', { activeOnly: true });
      await store.dispatch('goals/fetchGoals');

      // Listen for global new-chat trigger
      window.addEventListener('trigger-new-chat', clearConversation);

      await nextTick();
      // scrollToBottom();
      if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
        MathJax.typesetPromise();
      }

      // Check for AI provider connection and show tutorial if needed
      if (!hasConnectedAIProvider.value) {
        cleanup.setTimeout(() => {
          noProviderTutorial.value.initializeTutorial();
        }, 1000); // Show after 1 second
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

      // Reset store (this will clear image cache)
      store.commit('chat/RESET_CHAT');
      currentConversationId.value = null;
      terminalLines.value = ['Chat cleared by user.'];
      clearInput();
      focusInput();
      suggestions.value = [...initialSuggestions];

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
                isProviderActuallyConnected = connectedApps.some((app) => app.toLowerCase() === selectedProvider.toLowerCase());
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

    watch(
      displayMessages,
      (newMessages, oldMessages) => {
        nextTick(() => {
          if (typeof MathJax !== 'undefined' && MathJax.typesetPromise) {
            // Add a small delay to ensure DOM is fully updated before MathJax rendering
            cleanup.setTimeout(() => {
              try {
                MathJax.typesetPromise().catch((err) => {
                  console.error('MathJax rendering error:', err);
                });
              } catch (err) {
                console.error('MathJax rendering error:', err);
              }
            }, 10);
          }
        });
      },
      { deep: true }
    );

    // Watch for route query parameter changes to load saved outputs
    watch(
      () => route.query['content-id'],
      async (newContentId, oldContentId) => {
        if (newContentId && newContentId !== oldContentId) {
          // Force scroll to top FIRST
          scrollToTop();
          // Clear existing chat and load the saved output
          store.commit('chat/RESET_CHAT');
          terminalLines.value = ['Loading saved output...'];
          await loadSavedOutput(newContentId);
          // Scroll to top again after loading
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
      }
    );

    // Watch for remote streaming to show "Annie is thinking..." in message bubble
    watch(
      () => store.state.chat.isRemoteStreaming,
      (remoteStreaming) => {
        if (remoteStreaming) {
          // Find the last assistant message (the one being streamed from other tab)
          const lastAssistantMsg = [...displayMessages.value].reverse().find(m => m.role === 'assistant');
          if (lastAssistantMsg) {
            messageStates.value[lastAssistantMsg.id] = {
              type: 'thinking',
              text: 'Annie is thinking...',
            };
          }
        }
      }
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
      handlePanelAction,
      handleScreenChange,
      handleProviderConnected,
      executeSuggestion,
      toggleToolCallExpansion,
      getMessageStatus,
      getRunningToolsForMessage,
      clearConversation,
      saveConversation,
      useTutorial,
      initializeScreen,
      isMobile,
      isMonitoringCollapsed,
      toggleMonitoringPanel,
      hasConnectedAIProvider,
      imageCache,
      dataCache,
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
