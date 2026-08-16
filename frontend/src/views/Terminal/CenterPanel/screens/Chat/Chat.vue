<template>
  <BaseScreen
    class="chat-screen-wrapper"
    ref="baseScreenRef"
    screenId="ChatScreen"
    channel-key="orchestrator:default"
    :conversation-id="activeConversationIdForSelector"
    :useTutorialHook="useTutorial"
    :terminalLines="terminalLines"
    :disableInputInitially="!hasConnectedAIProvider"
    @submit-input="handleUserInputSubmit"
    @panel-action="handlePanelAction"
    @screen-change="handleScreenChange"
    @base-mounted="initializeScreen"
    @command-action="handleCommandAction"
  >
    <template #default>
      <div class="automation-interface" :class="{ 'mobile-view': isMobile }">


        <!-- Context Monitoring Panel — absent until the conversation has
             actually produced a measurement. A model's window is known as soon
             as a model is picked, so rendering on that alone made a brand-new
             chat open with "0% full · 0 / 1.0M" above an empty transcript. -->
        <div
          v-if="!isMobile && hasMonitoringData"
          class="monitoring-panel"
          :class="{ collapsed: isMonitoringCollapsed }"
        >
          <!-- Six summary tiles; each expands its own detail. The panel used to
               render all three columns at once, which meant the answer to
               "what is this costing me" was always somewhere on screen but
               never at the top of it. -->
          <ContextTiles
            :collapsed="isMonitoringCollapsed"
            :contextStatus="contextStatus"
            :manifest="lastManifest"
            :totalTokenUsage="totalTokenUsage"
            :totalCost="totalCost"
            :totalUncachedCost="totalUncachedCost"
            :totalCacheMetrics="totalCacheMetrics"
            :executionsCount="executionsCount"
            :subscriptionBased="subscriptionBased"
            :rounds="turnRounds"
            :growthPerTurn="growthPerTurn"
            :lastTurnCost="lastEstimatedCost"
            :lastCacheActivityAt="lastCacheActivityAt"
            :cacheTtlMs="cacheTtlMs"
            @toggle="toggleMonitoringPanel"
          >
            <template #cost>
              <ContextMonitor
                :contextStatus="contextStatus"
                :lastManaged="lastContextManaged"
                :tokenUsage="lastTokenUsage"
                :cacheMetrics="lastCacheMetrics"
                :estimatedCost="lastEstimatedCost"
                :totalTokenUsage="totalTokenUsage"
                :totalCost="totalCost"
                :totalUncachedCost="totalUncachedCost"
                :costBreakdown="lastCostBreakdown"
                :modelMix="modelMix"
                :subscriptionBased="subscriptionBased"
                :totalCacheMetrics="totalCacheMetrics"
                :executionsCount="executionsCount"
                :rounds="turnRounds"
              />
            </template>

            <template #inventory>
              <ContextManifest :manifest="lastManifest" />
            </template>

            <template #health>
              <SystemHealthPanel
                :contextManaged="contextManaged"
                :lastManaged="lastContextManaged"
                :errorsCaught="errorsCaught"
                :toolTruncations="toolTruncations"
                :toolsLoadedCount="toolsLoadedCount"
                :cacheMetrics="lastCacheMetrics"
              />
            </template>

            <template #activity>
              <ActivityFeed :activities="systemActivities" @clear="clearActivities" />
            </template>
          </ContextTiles>
        </div>

        <!-- Conversation Canvas -->
        <div class="conversation-canvas-wrapper">
          <div class="conversation-canvas" ref="conversationSpace" @scroll.passive="scheduleScrollCapture">
            <!-- Loading state masks the heavy MessageItem mount cost during
                 conversation cold-open / switch. Without it the user sees a
                 blank canvas followed by content slowly resolving. The
                 spinner is shown while `bulkLoading` is true; loadSavedOutput
                 forces a real paint frame between flipping the flag and
                 committing the messages so the spinner is actually visible. -->
            <div v-if="bulkLoading" class="chat-loading-state">
              <div class="spinner"></div>
            </div>
            <div v-else class="conversation-container">
              <!-- Group-chat roster: who's in this room (Annie is implicit) -->
              <div v-if="chatParticipants.length > 0" class="chat-roster">
                <span class="chat-roster-label"><i class="fas fa-users"></i></span>
                <span class="chat-roster-chip is-annie">Annie</span>
                <span v-for="p in chatParticipants" :key="p.name" class="chat-roster-chip">
                  <img v-if="p.icon && (p.icon.startsWith('http') || p.icon.startsWith('data:') || p.icon.startsWith('/'))" :src="p.icon" class="chat-roster-avatar" alt="" />
                  <i v-else-if="p.icon" :class="p.icon"></i>
                  @{{ p.name }}
                </span>
              </div>
              <div v-if="hiddenMessageCount > 0" class="show-earlier-row">
                <button type="button" class="show-earlier-btn" @click="showEarlierMessages">
                  <i class="fas fa-chevron-up"></i>
                  Show earlier messages ({{ hiddenMessageCount }})
                </button>
              </div>
              <TransitionGroup :name="bulkLoading || suppressMessageTransition ? '' : 'message'" tag="div" class="message-flow">
                <template v-for="message in windowedMessages" :key="message.id">
                  <!-- Inline skill pill: right-aligned to match user bubbles. -->
                  <div v-if="message.kind === 'skill-pill'" class="inline-pill-row" :data-message-id="message.id">
                    <div class="inline-context-pill" :class="{ 'is-detached': message.detached, 'is-skill': true }">
                      <i :class="message.skill?.icon || 'fas fa-puzzle-piece'"></i>
                      <span class="pill-label">
                        <span v-if="message.detached"
                          >Skill detached: <b>{{ message.skill?.name }}</b></span
                        >
                        <span v-else
                          >Skill attached: <b>{{ message.skill?.name }}</b></span
                        >
                      </span>
                      <button
                        v-if="!message.detached && currentActiveSkillId === message.skill?.id"
                        type="button"
                        class="pill-close"
                        v-tooltip="'Detach skill'"
                        @click="handleCommandAction({ action: 'detach-skill' })"
                      >
                        <i class="fas fa-times"></i>
                      </button>
                    </div>
                  </div>

                  <!-- Inline goal widget: right-aligned to match user bubbles. -->
                  <div v-else-if="message.kind === 'goal-widget'" class="inline-pill-row" :data-message-id="message.id">
                    <div class="inline-goal-widget-wrap">
                      <GoalProgressWidget
                        :goalId="message.goalId"
                        :goalTitle="message.goalTitle || 'Goal'"
                        :taskCount="message.goalTaskCount || 0"
                        :maxIterations="message.goalMaxIterations || 20"
                      />
                      <button
                        v-if="currentActiveGoalId === message.goalId"
                        type="button"
                        class="pill-close inline-goal-detach"
                        v-tooltip="'Detach goal'"
                        @click="handleCommandAction({ action: 'detach-goal' })"
                      >
                        <i class="fas fa-times"></i> Detach
                      </button>
                    </div>
                  </div>

                  <!-- Inline goal trace event: small append-only card so the
                       LLM and the user both see goal progress in chat. -->
                  <div v-else-if="message.kind === 'goal-event'" class="inline-pill-row" :data-message-id="message.id">
                    <div class="goal-event-card" :class="`goal-event-${message.eventKind}`">
                      <div class="goal-event-head">
                        <i :class="goalEventIcon(message.eventKind)"></i>
                        <span class="goal-event-kind">{{ goalEventLabel(message.eventKind) }}</span>
                        <span v-if="message.goalTitle" class="goal-event-title">· {{ message.goalTitle }}</span>
                      </div>
                      <div v-if="message.summary" class="goal-event-summary">{{ message.summary }}</div>
                      <div v-if="message.detail" class="goal-event-detail">{{ message.detail }}</div>
                    </div>
                  </div>

                  <MessageItem
                    v-else
                    :message="message"
                    :status="getMessageStatus(message)"
                    :runningTools="getRunningToolsForMessage(message)"
                    :imageCache="imageCache"
                    :dataCache="dataCache"
                    :expandedToolCalls="expandedToolCalls"
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
                </template>
              </TransitionGroup>

              <!-- Processing State -->
              <ProcessingState v-if="isProcessing" :text="`${activeAgentName} is working...`" />

              <!-- Group-chat floor queue: agents waiting to respond -->
              <div v-if="floorState.queue.length > 0" class="floor-queue-row">
                <i class="fas fa-arrow-right"></i>
                Floor passes to {{ floorState.queue.map((a) => '@' + (a.name || 'agent')).join(', ') }}
                <span class="floor-queue-budget">(turn {{ floorState.turnsUsed + 1 }} of 6)</span>
              </div>
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
import { ref, reactive, onMounted, onUnmounted, onActivated, onDeactivated, nextTick, computed, watch, inject } from 'vue';
import { useStore } from 'vuex';
import { useRoute, useRouter } from 'vue-router';
import { useCleanup } from '@/composables/useCleanup';
import BaseScreen from '../../BaseScreen.vue';
  import { safeTruncate } from '@/utils/safeTruncate.js';
import MessageItem from './components/MessageItem.vue';
import ProcessingState from './components/ProcessingState.vue';
import QuickActions from './components/QuickActions.vue';
import ChatActions from './components/ChatActions.vue';
import ContextMonitor from './components/ContextMonitor.vue';
import SystemHealthPanel from './components/SystemHealthPanel.vue';
import ContextManifest from './components/ContextManifest.vue';
import ContextTiles from './components/ContextTiles.vue';
import { loadContextStatus, saveContextStatus } from '@/services/contextStatusCache.js';
import { hasContextActivity } from '@/services/contextActivity.js';
// The ONE place raw estimates become displayed tokens. Applied on ingest so no
// component ever sees the calibration factor, and none can apply it twice.
import { calibrateContextStatus, calibrateManifest } from '@/services/contextCalibration.js';
import { applyContextStatusRound, markPrefixBreak } from '@/services/turnRounds.js';
import ActivityFeed from './components/ActivityFeed.vue';
import GoalProgressWidget from './components/GoalProgressWidget.vue';
import { useTutorial } from './useTutorial.js';
import { useAppVersion } from '@/composables/useAppVersion.js';
import { API_CONFIG, DEPLOYMENT_CONFIG } from '@/tt.config.js';
import { resolveProviderKey, AI_PROVIDERS_WITH_API } from '@/store/app/aiProvider.js';
import PopupTutorial from '../../../../_components/utility/PopupTutorial.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import ChatScrollControls from '@/views/_components/chat/ChatScrollControls.vue';
import { useChatScrollRestore } from '@/composables/useChatScrollRestore.js';

export default {
  name: 'ChatScreen',
  components: {
    BaseScreen,
    MessageItem,
    ProcessingState,
    QuickActions,
    ChatActions,
    ContextMonitor,
    ContextManifest,
    ContextTiles,
    SystemHealthPanel,
    ActivityFeed,
    GoalProgressWidget,
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
      // Return the store objects with STABLE identity — no per-recompute
      // cloning. The old `{...msg, expandedToolCalls}` map created fresh
      // objects for every message on every recompute (including every
      // streaming chunk), so Vue could never skip re-rendering unchanged
      // MessageItems. Tool-call expansion state is passed to MessageItem as a
      // separate prop instead (see the template).
      return validMsgs;
    });

    // ---- Windowed rendering ------------------------------------------------
    // Only the most recent messages mount on conversation open; older ones
    // mount on demand via the "Show earlier" control. This caps cold-open
    // cost (markdown parse + sanitize + MathJax per MessageItem) at
    // O(window) instead of O(conversation length). All non-template logic
    // (autosave, lookups, history building) still uses the full list.
    const MESSAGE_WINDOW_INITIAL = 30;
    const MESSAGE_WINDOW_STEP = 50;
    const visibleWindow = ref(MESSAGE_WINDOW_INITIAL);
    const suppressMessageTransition = ref(false);

    const windowedMessages = computed(() => {
      const msgs = displayMessages.value;
      if (msgs.length <= visibleWindow.value) return msgs;
      return msgs.slice(msgs.length - visibleWindow.value);
    });

    const hiddenMessageCount = computed(() => Math.max(0, displayMessages.value.length - visibleWindow.value));

    const resetMessageWindow = () => {
      visibleWindow.value = MESSAGE_WINDOW_INITIAL;
    };

    const showEarlierMessages = async () => {
      const el = conversationSpace.value;
      const prevHeight = el ? el.scrollHeight : 0;
      const prevTop = el ? el.scrollTop : 0;
      // Suppress the enter transition while prepending — 50 items animating
      // in at the top reads as jank, not delight.
      suppressMessageTransition.value = true;
      visibleWindow.value += MESSAGE_WINDOW_STEP;
      await nextTick();
      // Keep the viewport anchored on the message the user was reading.
      if (el) el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
      suppressMessageTransition.value = false;
    };

    // ---- Scroll restore ----------------------------------------------------
    // Reading position is per-conversation state, like the composer draft and
    // the provider selection. It used to be discarded on every switch — worse,
    // opening a saved conversation explicitly scrolled to the TOP, so a long
    // chat reopened at its first message. This restores where the user left
    // off, including how many messages they had expanded, because a position
    // measured against 130 mounted messages cannot be reproduced against 30.
    const {
      isRestoring: isRestoringScroll,
      scheduleCapture: scheduleScrollCapture,
      flushCapture: flushScrollCapture,
      restore: restoreScroll,
      teardown: teardownScrollRestore,
    } = useChatScrollRestore({
      getEl: () => conversationSpace.value,
      getKey: () => store.state.chat.activeConversationId,
      getWindow: () => visibleWindow.value,
      setWindow: (n) => {
        visibleWindow.value = Math.max(MESSAGE_WINDOW_INITIAL, n);
      },
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

    // Group chat: distinct agent participants in this conversation (Annie is
    // implicit). Drives the roster chip row above the transcript.
    const chatParticipants = computed(() => {
      const seen = new Map();
      for (const m of displayMessages.value) {
        if (m.role === 'assistant' && m.agentName && !seen.has(m.agentName)) {
          seen.set(m.agentName, { name: m.agentName, icon: m.agentIcon || null, id: m.agentId || null });
        }
      }
      return [...seen.values()];
    });

    // Group chat: pending floor passes + turn budget for the indicator line.
    const floorState = computed(() => {
      const convId = store.state.chat.activeConversationId;
      const conv = convId ? store.state.chat.conversations[convId] : null;
      if (!conv) return { queue: [], turnsUsed: 0 };
      return { queue: conv.floorQueue || [], turnsUsed: conv.floorTurnsUsed || 0 };
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

    // Active conversation id for the provider popover — scoped mode needs a
    // key even before the first message, so fall back to the local temp id.
    const activeConversationIdForSelector = computed(
      () => store.state.chat.activeConversationId || currentConversationId.value || '',
    );

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
      // What the same traffic would have cost with caching disabled. null
      // until a priced turn arrives, so the savings row stays hidden instead
      // of claiming $0.00 on providers that have no cache pricing.
      totalUncachedCost: null,
      lastCostBreakdown: null,
      // Which models served this conversation, and what each cost. Keyed by
      // model name; a conversation frequently spans several at different rates.
      modelMix: {},
      subscriptionBased: null,
      totalCacheMetrics: {
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        uncachedTokens: 0,
        hitRate: '0',
      },
      executionsCount: 0,
      // Itemized inventory of the last request (context_manifest event):
      // which prompt sections, which tools and why, what was hidden.
      lastManifest: null,
      // When the prompt cache was last demonstrably alive. Anthropic's default
      // TTL is 5 minutes, so a conversation resumed later pays full price to
      // rewrite its entire prefix — worth knowing before sending, not after.
      lastCacheActivityAt: null,
      // The provider's prompt-cache window, supplied by the backend. Null means
      // "no basis for a claim", and the panel stays quiet rather than guessing.
      cacheTtlMs: null,
      // Every request in the CURRENT turn. A turn with six tool rounds sends
      // six requests, and the last one is usually the expensive one — the
      // panel previously showed only an aggregate and hid where the money went.
      turnRounds: [],
      // Real growth between turns, measured from the round-1 size of this turn
      // versus the previous one. Averaging total/turns would understate a
      // conversation that only recently started growing fast.
      prevTurnStartTokens: null,
      growthPerTurn: 0,
      systemActivities: [],
    });

    // Lazy-initialize per-conversation monitoring state. Every event that
    // carries a conversationId (via the 3rd callback arg) lands in its own
    // slot — whether or not that conversation is currently in view.
    const getMonitoringState = (convId) => {
      if (!convId) return null;
      if (!monitoringStates[convId]) {
        const slot = defaultMonitoringState();
        // Seed the last request size the backend reported for this
        // conversation. Done synchronously at slot creation so it is present
        // before any watcher or async hydrate runs; a live context_status
        // event overwrites it on the next turn.
        const cached = loadContextStatus(convId);
        if (cached) {
          slot.contextStatus = { ...slot.contextStatus, ...cached };
        }
        monitoringStates[convId] = slot;
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
    const totalUncachedCost = computed(() => activeMonitoring.value.totalUncachedCost);
    const lastCostBreakdown = computed(() => activeMonitoring.value.lastCostBreakdown);
    const totalCacheMetrics = computed(() => activeMonitoring.value.totalCacheMetrics);
    const lastManifest = computed(() => activeMonitoring.value.lastManifest);
    const lastCacheActivityAt = computed(() => activeMonitoring.value.lastCacheActivityAt);
    const cacheTtlMs = computed(() => activeMonitoring.value.cacheTtlMs);
    const modelMix = computed(() => Object.values(activeMonitoring.value.modelMix || {}).sort((a, b) => b.cost - a.cost));
    const subscriptionBased = computed(() => activeMonitoring.value.subscriptionBased);
    const executionsCount = computed(() => activeMonitoring.value.executionsCount);
    const systemActivities = computed(() => activeMonitoring.value.systemActivities);
    const turnRounds = computed(() => (activeMonitoring.value.turnRounds || []).filter(Boolean));
    const growthPerTurn = computed(() => activeMonitoring.value.growthPerTurn || 0);

    // The panel's whole existence hangs off this one predicate, kept in its own
    // module so "has this conversation started?" is defined once and testable
    // without mounting a 3000-line component.
    const hasMonitoringData = computed(() => hasContextActivity({
      contextStatus: contextStatus.value,
      totalTokenUsage: totalTokenUsage.value,
      totalCost: totalCost.value,
      executionsCount: executionsCount.value,
      rounds: turnRounds.value,
    }));

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
      'gpt-4o-mini': 128000,      // Anthropic — Claude 5 generation and Opus 4.7+ are 1M-context.
      // Keep in sync with backend modelMetadata (providerConfigs.js); this map
      // is only the pre-first-event seed, but a missing entry falls through to
      // 0 and the meter renders with no ceiling.
      'claude-opus-5': 1000000,
      'claude-sonnet-5': 1000000,
      'claude-fable-5': 1000000,
      'claude-opus-4-8': 1000000,
      'claude-opus-4-7': 1000000,
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
      // Kimi Code (highspeed listed before its prefix 'kimi-for-coding')
      'kimi-for-coding-highspeed': 256000,
      'kimi-for-coding': 256000,
      k3: 1048576,
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
        // Unknown model => 0 (renders as unknown). Never inherit the previous
        // model's limit — that left K3 displaying a stale 64K.
        tokenLimit: contextWindow || 0,
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

    // --- Active skill/goal context (persisted per conversation) ---
    const activeSkill = computed(() => store.getters['chat/currentActiveSkill']);
    const activeGoal = computed(() => store.getters['chat/currentActiveGoal']);
    const currentActiveSkillId = computed(() => activeSkill.value?.id || null);
    const currentActiveGoalId = computed(() => activeGoal.value?.id || null);
    const goalCreateMode = computed(() => store.state.chat.goalCreateMode);

    // Pretty labels + icons for inline goal-event cards
    const goalEventLabel = (kind) =>
      ({
        task_completed: 'Task completed',
        task_failed: 'Task failed',
        verdict: 'Verdict',
        loop_completed: 'Goal finished',
        loop_error: 'Goal error',
        iteration_start: 'Iteration',
        iteration_end: 'Iteration end',
        attached: 'Goal attached',
      })[kind] || kind;

    const goalEventIcon = (kind) =>
      ({
        task_completed: 'fas fa-check-circle',
        task_failed: 'fas fa-times-circle',
        verdict: 'fas fa-gavel',
        loop_completed: 'fas fa-flag-checkered',
        loop_error: 'fas fa-exclamation-triangle',
        iteration_start: 'fas fa-sync-alt',
        iteration_end: 'fas fa-sync-alt',
        attached: 'fas fa-bullseye',
      })[kind] || 'fas fa-bullseye';

    // Helper: push an inline pill/widget into the conversation.
    // Default role is 'user' so the LLM SEES the message (buildChatHistory
    // only forwards user|assistant). The visible UI is decided by `kind`
    // (skill-pill / goal-widget / goal-event) which the message-loop branches
    // on. For pure-UI affordances that the LLM should NOT see, callers can
    // override role to 'system'.
    const pushInlineMessage = (msg) => {
      const convId = store.state.chat.activeConversationId;
      if (!convId) return;
      store.commit('chat/SCOPED_ADD_MESSAGE', {
        conversationId: convId,
        message: { role: 'user', content: '', timestamp: Date.now(), ...msg },
      });
    };

    // Fetch the full skill record if the cached object is missing instructions.
    // Filesystem skills (`fs-*`) and very stale list cache can both have empty
    // instructions; we re-fetch by id from /api/skills/:id to be sure.
    const ensureSkillInstructions = async (skill) => {
      if (skill?.instructions && skill.instructions.trim().length > 0) return skill;
      if (!skill?.id) return skill;
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_CONFIG.BASE_URL}/skills/${skill.id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return skill;
        const data = await res.json();
        if (data?.skill?.instructions) return { ...skill, ...data.skill };
      } catch (e) {
        console.warn('[Chat] Failed to fetch full skill record:', e);
      }
      return skill;
    };

    /**
     * Handle slash-action items emitted from the command menu (skill/goal
     * attach/detach/create/status). The menu has already cleared the trigger
     * text from the input. We persist the binding AND drop a visible pill or
     * widget into the conversation at the point of invocation.
     */
    const handleCommandAction = async (item) => {
      if (!item || !item.action) return;
      const convId = store.state.chat.activeConversationId;

      switch (item.action) {
        case 'attach-skill': {
          const rawSkill = item.payload;
          if (!rawSkill) break;

          // Make sure we have the full SKILL.md instructions before we push
          // it into the conversation. The picker's cached object can be sparse
          // (especially for filesystem-discovered skills); re-fetch by id.
          const skill = await ensureSkillInstructions(rawSkill);
          await store.dispatch('chat/attachSkill', { conversationId: convId, skill });

          // Push a real role:'user' message containing the full skill content.
          // This is what the LLM will see in chat history — Annie now knows
          // the skill exists and what its instructions are. Cache-friendly:
          // the message is appended once and never mutated, so subsequent
          // turns benefit from prefix caching of the entire skill block.
          const instructions = (skill.instructions || '').trim();
          const header = `[SKILL ACTIVATED: ${skill.name}]`;
          const body = instructions
            ? `The user just attached this skill via /skill. Treat the instructions below as authoritative for the rest of the conversation (or until they detach the skill). Follow them when relevant to the user's requests.\n\n--- ${skill.name} (skill instructions) ---\n${instructions}\n--- end of skill ---`
            : `The user just attached this skill via /skill. Description: ${skill.description || '(no description)'}. ⚠️ The skill has no instructions content available — only its name and description are loaded.`;

          pushInlineMessage({
            id: `skill-pill-${skill.id}-${Date.now()}`,
            role: 'user',
            kind: 'skill-pill',
            skill: { id: skill.id, name: skill.name, icon: skill.icon, description: skill.description },
            content: `${header}\n${body}`,
          });
          break;
        }

        case 'detach-skill': {
          const prev = activeSkill.value;
          await store.dispatch('chat/detachSkill', { conversationId: convId });
          if (prev) {
            pushInlineMessage({
              id: `skill-detach-${prev.id}-${Date.now()}`,
              role: 'user',
              kind: 'skill-pill',
              detached: true,
              skill: { id: prev.id, name: prev.name, icon: prev.icon },
              content: `[SKILL DETACHED: ${prev.name}]\nThe user just detached this skill. Stop following its instructions for the remainder of the conversation.`,
            });
          }
          break;
        }

        case 'attach-goal': {
          const goal = item.payload;
          if (!goal) break;
          await store.dispatch('chat/attachGoal', { conversationId: convId, goal });

          // Auto-start the goal if it's still in planning state. Existing
          // executing/paused goals are left alone — the user may have paused
          // intentionally. We use the AUTONOMOUS execution path so the full
          // plan→execute→evaluate→replan AGI loop runs, which is what
          // produces the goal:loop_completed / loop_error / verdict events
          // our auto-fire and event-trace flows depend on. Plain
          // `executeGoal` only runs tasks once with no loop, so the goal
          // would sit dormant after first pass.
          if (goal.status === 'planning') {
            try {
              await store.dispatch('goals/executeGoalAutonomous', {
                goalId: goal.id,
                maxIterations: goal.max_iterations || 20,
              });
            } catch (e) {
              console.warn('[Chat] Failed to auto-execute attached goal:', e);
            }
          }

          // Start polling so the widget shows live task progress
          store.dispatch('goals/monitorGoalProgress', goal.id);
          store.dispatch('goals/fetchGoalTaskProgress', goal.id);

          const goalTitle = goal.title || goal.name || 'Goal';
          const goalDesc = (goal.description || '').trim();
          const goalContent =
            `[GOAL ATTACHED: ${goalTitle}]\n` +
            `Status: ${goal.status || 'unknown'}\n` +
            (goalDesc ? `Description: ${goalDesc}\n` : '') +
            `The user just attached this goal via /goal. Status updates and task results will be appended to the conversation as [goal-event] messages — read those for the latest state.`;

          pushInlineMessage({
            id: `goal-widget-${goal.id}-${Date.now()}`,
            role: 'user',
            kind: 'goal-widget',
            goalId: goal.id,
            goalTitle,
            goalTaskCount: goal.task_count || 0,
            goalMaxIterations: goal.max_iterations || 20,
            content: goalContent,
          });

          // Force autosave so the OutputList sidebar can show the running
          // indicator on this conversation (it keys off savedOutputId).
          store
            .dispatch('chat/autosaveConversation', { debounce: false, conversationId: convId })
            .catch((e) => console.warn('[Chat] attach-goal autosave failed:', e));
          break;
        }

        case 'detach-goal': {
          const prev = activeGoal.value;
          await store.dispatch('chat/detachGoal', { conversationId: convId });
          if (prev) {
            pushInlineMessage({
              id: `goal-detach-${prev.id}-${Date.now()}`,
              role: 'user',
              kind: 'skill-pill', // reuse the pill renderer; styling distinguishes via icon
              detached: true,
              skill: { id: prev.id, name: prev.title || prev.name || 'Goal', icon: 'fas fa-bullseye' },
              content: `[GOAL DETACHED: ${prev.title || prev.name || 'Goal'}]\nThe user just detached this goal. No further status updates will be appended.`,
            });
          }
          break;
        }

        case 'create-goal':
          // Enter goal-create mode — the next user submit becomes the new
          // goal's description, gets POSTed, then auto-attached and started.
          store.commit('chat/SET_GOAL_CREATE_MODE', true);
          baseScreenRef.value?.focusInput?.();
          pushInlineMessage({
            id: `goal-create-hint-${Date.now()}`,
            role: 'assistant',
            content: '🎯 **Goal create mode** — type a description for the new goal and press Enter. (Press Esc or send empty to cancel.)',
            metadata: ['Goal'],
          });
          break;

        case 'goal-status':
          // Drop a fresh widget into the conversation as a status snapshot.
          if (activeGoal.value) {
            const g = activeGoal.value;
            store.dispatch('goals/refreshGoalStatus', g.id).catch(() => {});
            pushInlineMessage({
              id: `goal-status-${g.id}-${Date.now()}`,
              kind: 'goal-widget',
              goalId: g.id,
              goalTitle: g.title || g.name || 'Goal',
              goalTaskCount: g.task_count || 0,
              goalMaxIterations: g.max_iterations || 20,
              content: `Goal status: ${g.title || g.name || 'Goal'}`,
            });
          }
          break;
      }
    };

    /**
     * Shared create-and-start path used by both the inline single-shot form
     * (`/goal research X` in one message) and the menu's "+ Create new goal"
     * two-step flow. Posts the user's description as a user message, creates
     * the goal, attaches it to the conversation, kicks off the autonomous
     * AGI loop, and drops a live goal-widget message into chat.
     */
    const createAndStartGoal = async (description) => {
      if (!description || !description.trim()) return;
      const trimmed = description.trim();
      const convId = store.state.chat.activeConversationId;

      // Show the user's description as a normal user message for context.
      store.commit('chat/SCOPED_ADD_MESSAGE', {
        conversationId: convId,
        message: {
          id: generateMessageId(),
          role: 'user',
          content: trimmed,
          timestamp: Date.now(),
        },
      });
      clearInput();

      try {
        const newGoal = await store.dispatch('goals/createGoal', { text: trimmed });
        if (!newGoal?.id) return;

        await store.dispatch('chat/attachGoal', { conversationId: convId, goal: newGoal });

        // Autonomous execution: full plan → execute → evaluate → replan loop.
        // This is what produces the goal:iteration_* / loop_completed /
        // loop_error events that the inline trace + auto-fire rely on.
        try {
          await store.dispatch('goals/executeGoalAutonomous', {
            goalId: newGoal.id,
            maxIterations: newGoal.max_iterations || 20,
          });
        } catch (e) {
          console.warn('[Chat] Failed to auto-execute newly created goal:', e);
        }

        store.dispatch('goals/monitorGoalProgress', newGoal.id);
        store.dispatch('goals/fetchGoalTaskProgress', newGoal.id);

        const newGoalTitle = newGoal.title || trimmed;
        const newGoalContent =
          `[GOAL CREATED: ${newGoalTitle}]\n` +
          `Status: ${newGoal.status || 'planning'}\n` +
          `Description: ${trimmed}\n` +
          `The user just created this goal via /goal in chat and it has been auto-started. Task results and verdicts will arrive as [goal-event] messages.`;

        store.commit('chat/SCOPED_ADD_MESSAGE', {
          conversationId: convId,
          message: {
            id: `goal-widget-${newGoal.id}-${Date.now()}`,
            role: 'user',
            content: newGoalContent,
            timestamp: Date.now(),
            kind: 'goal-widget',
            goalId: newGoal.id,
            goalTitle: newGoalTitle,
            goalTaskCount: newGoal.task_count || 0,
            goalMaxIterations: newGoal.max_iterations || 20,
          },
        });

        // Force an immediate autosave so the conversation gets a
        // savedOutputId. Without this, /goal creates a conversation that
        // has no saved row, and `streamingOutputIds` (which the OutputList
        // sidebar's running-dot relies on) can't mark anything because
        // there's no content_output id to attach the indicator to.
        // Normally the orchestrator's `conversation_started` event triggers
        // autosave, but /goal doesn't go through the orchestrator path.
        store
          .dispatch('chat/autosaveConversation', { debounce: false, conversationId: convId })
          .catch((e) => console.warn('[Chat] /goal autosave failed:', e));
      } catch (e) {
        store.commit('chat/SCOPED_ADD_MESSAGE', {
          conversationId: convId,
          message: {
            id: `goal-error-${Date.now()}`,
            role: 'assistant',
            content: `⚠️ Failed to create goal: ${e.message || e}`,
            timestamp: Date.now(),
            metadata: ['Error'],
          },
        });
      }
    };

    const handleUserInputSubmit = async (input, files = null, mentionedAgents = null) => {
      // Empty submit while in goal-create mode = cancel the mode silently.
      // Other chat surfaces stay no-op on empty submits (existing behavior).
      if (!input || !input.trim()) {
        if (goalCreateMode.value) {
          store.commit('chat/SET_GOAL_CREATE_MODE', false);
        }
        return;
      }

      // Single-shot inline form: "/goal <description>" in one message.
      // Skips the menu/two-step entirely — the rest of the message after
      // /goal becomes the goal description and we create+start immediately.
      // Bare "/goal" (no description) falls through to the regular slash
      // handler so the menu still opens for the two-step / picker flow.
      const inlineGoalMatch = input.trim().match(/^\/goal\s+(.+)/is);
      if (inlineGoalMatch && (!mentionedAgents || mentionedAgents.length === 0)) {
        await createAndStartGoal(inlineGoalMatch[1]);
        return;
      }

      // /goal create mode: the next message creates and attaches a new goal
      // instead of being chatted. Set by selecting "+ Create new goal" in
      // the /goal picker (the two-step path).
      if (goalCreateMode.value) {
        store.commit('chat/SET_GOAL_CREATE_MODE', false);
        await createAndStartGoal(input);
        return;
      }

      // Mid-turn steer: a turn is already streaming. Don't start a new POST
      // (it'd race the in-flight one). Send the text via socket so the
      // backend can drain it between tool rounds, OR — if the turn ends
      // before another round happens — the auto-fire watcher below sends
      // it as a fresh user turn.
      if (store.state.chat.isStreaming && store.state.chat.currentConversationId) {
        const resp = await store.dispatch('chat/steerInFlight', { content: input });
        if (resp?.ok) {
          clearInput();
        } else {
          console.warn('[Chat] steer failed:', resp?.error);
        }
        return;
      }

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

      // Mentioned agents respond SEQUENTIALLY, in mention order — each agent's
      // history is rendered after the previous agent finished, so every
      // participant hears the ones before it. The old Promise.all fan-out ran
      // them against identical snapshots: N parallel answers that could not
      // reference each other, which is not a conversation.
      const agents = mentionedAgents && mentionedAgents.length > 0 ? mentionedAgents : [null];
      // The address for this whole send, threaded across the sequence. Each
      // turn returns the conversation it actually wrote to (a new chat's temp
      // id is renamed mid-stream), so agent N+1 goes where agent N went — even
      // if the user switched chats while agent N was still answering.
      let sendConvId = store.state.chat.activeConversationId;
      for (const agent of agents) {
        sendConvId = await store.dispatch('chat/startStreamingConversation', {
          userInput: input,
          files: files,
          provider: store.state.aiProvider.selectedProvider,
          model: store.state.aiProvider.selectedModel,
          reasoningValue: store.state.aiProvider.reasoningValue,
          reasoningEnabled: store.state.aiProvider.reasoningEnabled,
          mentionedAgent: agent,
          conversationId: sendConvId,
        });
      }
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

      // Resend from this point, into the conversation we truncated — not
      // whichever one is active by the time this dispatch runs.
      await store.dispatch('chat/startStreamingConversation', {
        conversationId: convId,
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
        case 'steering_applied':
          // Seal the pre-steer bubble. The backend mints a NEW
          // assistantMessageId immediately after this event so post-steer
          // output renders BELOW the steer message; final_content only clears
          // the LAST id, which would leave this one stuck on
          // "...is processing results..." for the rest of the session.
          // Every tool in this round has already emitted tool_end by the time
          // the steer drains, so runningToolCalls needs no cleanup here.
          if (isActiveView && data.assistantMessageId) {
            delete messageStates.value[data.assistantMessageId];
          }
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
            // Convert to display units FIRST, once, so the round reducer, the
            // panel and the localStorage cache all hold the same unit. The
            // backend sends raw estimates plus the calibration factor.
            const status = calibrateContextStatus(data);
            // A turn is not one request. Folded by a pure reducer so the
            // per-round bookkeeping is verifiable outside this switch.
            applyContextStatusRound(ms, status);
            ms.contextStatus = {
              unit: status.unit,
              currentTokens: status.currentTokens,
              tokenLimit: status.tokenLimit,
              utilizationPercent: status.utilizationPercent,
              model: status.model,
              messagesCount: status.messagesCount,
              // Per-component breakdown so ContextMonitor can render a
              // segmented bar (system / tools / messages / output reserve).
              breakdown: status.breakdown || null,
            };
            // Survive a page reload — otherwise the panel reads "0 / 1.0M"
            // until the user happens to send another message.
            saveContextStatus(streamConvId, ms.contextStatus);
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
            // Deliberately NOT reset after a timeout. Trimming is a durable
            // fact about this conversation, not a 5-second blink - the old
            // auto-reset meant the one moment worth seeing was almost always
            // missed, and the indicator sat on "Idle" forever afterwards.
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
        case 'provider_fallback': {
          // Automatic cross-provider failover (Phase 2/4). Backend emits this
          // when the primary provider exhausted retries and the turn rolled
          // over to a fallback tier. Surface it in System Activity so the
          // user can see the switch happened (previously the event was
          // silently dropped — no frontend handler existed).
          const fromP = data?.from?.provider || 'primary';
          const fromM = data?.from?.model ? `/${data.from.model}` : '';
          const toP = data?.to?.provider || 'fallback';
          const toM = data?.to?.model ? `/${data.to.model}` : '';
          const reason = data?.reason ? ` (${data.reason})` : '';
          const text = `Provider failover: ${fromP}${fromM} → ${toP}${toM}${reason}`;
          if (ms) addActivityTo(ms, { type: 'recovery', text });
          if (isActiveView) {
            terminalLines.value.push(`[Failover] ${text}`);
            // Brief status on the in-flight assistant bubble if one exists.
            const activeMsgId = Object.keys(messageStates.value).find(
              (id) => messageStates.value[id]?.type === 'thinking' || messageStates.value[id]?.type === 'tool',
            );
            if (activeMsgId) {
              messageStates.value[activeMsgId] = {
                type: 'thinking',
                text: `Switched to ${toP}${toM} — continuing…`,
              };
            }
          }
          break;
        }
        case 'provider_recovered': {
          // Recovery banner (Option 2). Backend emits this when the default
          // provider succeeds again after an earlier failover in this
          // conversation — the green counterpart to provider_fallback.
          const backP = data?.backTo?.provider || 'default';
          const backM = data?.backTo?.model ? `/${data.backTo.model}` : '';
          const text = `Recovered: back on ${backP}${backM}`;
          if (ms) addActivityTo(ms, { type: 'success', text });
          if (isActiveView) terminalLines.value.push(`[Recovered] ${text}`);
          break;
        }
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
        case 'cache_activity':
          // A round just reported cache read/write tokens, so the prefix was
          // provably alive at that moment. Without this the freshness clock
          // only ever advanced at turn end, and a 40-minute agentic turn read
          // as "cache likely cold" the whole time it was hitting the cache.
          if (ms) ms.lastCacheActivityAt = data?.at || new Date().toISOString();
          break;
        case 'context_manifest':
          if (ms) {
            // Same conversion as context_status, from the same module — these
            // two events render side by side and must agree on units.
            const manifest = calibrateManifest(data);
            ms.lastManifest = manifest || null;
            if (manifest?.cacheTtlMs != null) ms.cacheTtlMs = manifest.cacheTtlMs;
            markPrefixBreak(ms, manifest);
          }
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
            ms.lastCostBreakdown = data.costBreakdown || null;
            if (data.model) {
              const entry = ms.modelMix[data.model] || { model: data.model, provider: data.provider, calls: 0, cost: 0 };
              entry.calls += 1;
              entry.cost += Number(data.estimatedCost) || 0;
              ms.modelMix = { ...ms.modelMix, [data.model]: entry };
            }
            if (data.subscriptionBased != null) {
              // Mixed metered + subscription turns -> null, since neither
              // "you paid" nor "notional" is true of the whole conversation.
              ms.subscriptionBased = ms.subscriptionBased == null || ms.subscriptionBased === data.subscriptionBased
                ? data.subscriptionBased
                : null;
            }
            if (data.costBreakdown && data.costBreakdown.uncached != null) {
              // Seed from the actual running total the first time we can price
              // a turn, so the baseline covers the same turns totalCost does.
              if (ms.totalUncachedCost == null) ms.totalUncachedCost = ms.totalCost - (Number(data.estimatedCost) || 0);
              ms.totalUncachedCost += Number(data.costBreakdown.uncached) || 0;
            }
            if (data.cacheMetrics) {
              if ((data.cacheMetrics.cacheReadTokens || 0) > 0
                || (data.cacheMetrics.cacheCreationTokens || 0) > 0) {
                ms.lastCacheActivityAt = new Date().toISOString();
              }
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
      const isEditable = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

      // Don't steal keys when a non-chat input is focused (e.g. a search box
      // teleported to body, or a popover field). The chat textarea inside
      // .input-container / .chat-input-container is still fair game for
      // PageUp/PageDown.
      const insideModalInput = isEditable && !active.closest?.('.input-container, .chat-input-container, .automation-interface');
      if (insideModalInput) return;

      // Home/End have native cursor-movement semantics inside any editable
      // element — never hijack them while the user is typing.
      if (isEditable && (event.key === 'Home' || event.key === 'End')) return;

      const page = Math.max(80, Math.floor(el.clientHeight * 0.85));

      if (event.key === 'PageUp') {
        event.preventDefault();
        try {
          el.scrollBy({ top: -page, behavior: 'smooth' });
        } catch (e) {
          el.scrollTop = Math.max(0, el.scrollTop - page);
        }
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        try {
          el.scrollBy({ top: page, behavior: 'smooth' });
        } catch (e) {
          el.scrollTop = el.scrollTop + page;
        }
      } else if (event.key === 'Home') {
        event.preventDefault();
        try {
          el.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
          el.scrollTop = 0;
        }
      } else if (event.key === 'End') {
        event.preventDefault();
        try {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        } catch (e) {
          el.scrollTop = el.scrollHeight;
        }
      }
    };

    // (scrollToTop removed: every caller opened a conversation, and opening a
    //  200-message conversation at message 1 was the bug. Opens now go through
    //  restoreScroll. The user-facing "scroll to top" control lives in
    //  ChatScrollControls and is unaffected.)

    const clearInput = () => baseScreenRef.value?.clearInput();
    const focusInput = () => baseScreenRef.value?.focusInput();

    // The pending-steer auto-fire used to live here, driven by two watchers on
    // the FLAT store mirror. It now lives in the store as `drainPendingSteer`,
    // dispatched from the 'done' and 'run_ended' terminators where the OWNING
    // conversation id is known.
    //
    // It had to move, not just get a guard. The flat mirror always names the
    // conversation ON SCREEN, so this screen could only ever drain the chat the
    // user was looking at — and `syncMirror` republishes a conversation's
    // parked steer into that mirror on every switch, which made
    // `watch(pendingSteer)` fire on HYDRATION. Clicking away orphaned the
    // buffer; clicking back re-sent it. One utterance, two runs.
    //
    // Reacting to a derived mirror instead of to the real event is the same
    // mistake `conversationEpoch` exists to prevent in BaseScreen.vue.

    const saveConversation = async () => {
      const token = localStorage.getItem('token');

      if (!token) {
        console.error('No authentication token found');
        return null;
      }

      try {
        // Generate a title from the first user message or use a default
        const firstUserMessage = displayMessages.value.find((msg) => msg.role === 'user');        const conversationTitle = firstUserMessage
          ? safeTruncate(firstUserMessage.content, 100, '...')
          : 'Untitled Conversation';

        // Persist {{IMAGE_REF:id}} tokens AS-IS — do NOT inline base64.
        // Images are already persisted to disk server-side at generation time
        // and MessageItem resolves refs to /api/images/:id on render. Inlining
        // made image-heavy conversation blobs ~6x larger and slowed loads.
        const conversationData = {
          conversationId: currentConversationId.value,
          title: conversationTitle,
          messages: displayMessages.value.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
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

        const saveStartedAt = Date.now();
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

        // Merge the returned row metadata — the sidebar updates without a
        // list refetch. The conversation-saved event now only drives the
        // position bump in OutputList.
        if (result.output) {
          store.dispatch('contentOutputs/applyOutputMeta', {
            output: result.output,
            snapshotStartedAt: saveStartedAt,
          });
        }
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
      // Cached switch is O(1) in the store (syncMirror just reassigns refs);
      // the only real cost is Vue re-rendering MessageItems for the new keys,
      // which Vue's diff handles inline. Skip the spinner entirely — showing
      // and hiding it around an instant swap adds latency, not clarity.
      // Opening a conversation stamps its server-side read watermark — the
      // sidebar's unread dot (and every other device's) derives from it.
      // Fire-and-forget: a failed PATCH must never block the open.
      store.dispatch('contentOutputs/markRead', contentId).catch(() => {});

      const conversations = store.state.chat.conversations;
      for (const [convId, conv] of Object.entries(conversations)) {
        if (conv.savedOutputId === contentId) {
          resetMessageWindow();
          store.commit('chat/SET_ACTIVE_CONVERSATION', convId);
          currentConversationId.value = convId;
          terminalLines.value.push(`Switched to conversation (${conv.messages.length} messages)`);
          // Scroll position is restored by the activeConversationId watcher,
          // which owns every switch. Nothing to do here.
          return;
        }
      }

      try {
        // Uncached: the HTTP fetch is the actual wait, so show the spinner
        // for the whole duration. No forced paint frames — the browser
        // will paint in the natural gap between the click and the network
        // reply, and Vue will render the messages when the commit lands.
        bulkLoading.value = true;

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

          // Create or switch to the conversation slot
          resetMessageWindow();
          store.commit('chat/ENSURE_CONVERSATION', convId);
          store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: convId, messages: conversationData.messages });
          store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: convId, id: contentId });
          store.commit('chat/SCOPED_SET_SAVED_OUTPUT_TITLE', { conversationId: convId, title: conversationData.title || null });
          store.commit('chat/SET_ACTIVE_CONVERSATION', convId);
          // Restore the conversation's persisted skill/goal bindings so the
          // chips reappear and the orchestrator system prompt picks them up.
          store.dispatch('chat/loadConversationContext', convId).catch(() => {});

          // Also update legacy flat state for components that read it directly
          currentConversationId.value = convId;

          terminalLines.value.push(
            `Loaded conversation from ${new Date(conversationData.createdAt).toLocaleDateString()} (${conversationData.messages.length} messages)`,
          );
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
      } catch (error) {
        console.error('Error loading saved output:', error);
        store.commit('chat/ADD_MESSAGE', {
          id: generateMessageId(),
          role: 'assistant',
          content: `Sorry, I couldn't load that saved output. Error: ${error.message}`,
          timestamp: Date.now(),
          metadata: ['Error'],
        });
      } finally {
        // Drop the spinner and restore the conversation's reading position
        // once the messages have rendered. `finally` guarantees the flag
        // clears even if the fetch or JSON parse threw.
        //
        // The activeConversationId watcher already fired a restore when the
        // slot was committed, but at that moment `bulkLoading` was still true
        // so the canvas held a spinner and no anchors were measurable. This
        // call supersedes it — restore() cancels any in-flight settle loop —
        // and is the one that runs against the real transcript.
        bulkLoading.value = false;
        await restoreScroll(store.state.chat.activeConversationId);
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
      // A reload or app quit gives us no unmount hook, so the last debounced
      // capture would be lost. visibilitychange fires on both, and on tab
      // switch — cheap enough to just flush every time.
      document.addEventListener('visibilitychange', flushScrollCaptureOnHide);

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
      resetMessageWindow();
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
      // No event needed for the sidebar: its highlight derives from
      // chat.savedOutputId, which SET_ACTIVE_CONVERSATION just reset.
    };

    const flushScrollCaptureOnHide = () => {
      if (document.visibilityState === 'hidden') flushScrollCapture();
    };

    // Navigating away from Chat does not unmount it — KeepAlive detaches the
    // subtree, and a detached element's scrollTop is reset to 0 by the
    // browser. So the position has to be banked on the way out and re-applied
    // on the way back in, exactly as if it were a conversation switch.
    onDeactivated(() => flushScrollCapture());
    onActivated(() => restoreScroll());

    onUnmounted(() => {
      // Bank the reading position before we lose the DOM. This is the last
      // chance: the debounced capture from the user's final scroll may still
      // be pending.
      flushScrollCapture();
      teardownScrollRestore();

      // Unregister stream event callback when component unmounts
      store.dispatch('chat/unregisterStreamEventCallback', handleStreamEvent);
      window.removeEventListener('trigger-new-chat', clearConversation);
      window.removeEventListener('keydown', handleChatKeyboardScroll);
      document.removeEventListener('visibilitychange', flushScrollCaptureOnHide);
      unsubscribeScrollSync();
    });

    // Conversation switches: bank the outgoing position, restore the incoming
    // one. This is the single owner of switch-time scroll behaviour — every
    // path that changes conversation (sidebar click, /new-chat, clear, loading
    // a saved output) commits SET_ACTIVE_CONVERSATION, so none of them has to
    // think about scrolling.
    //
    // WHY THE MUTATION AND NOT A watch ON THE ID
    // `activeConversationId` changes for two entirely different reasons: the
    // user navigating to another conversation (SET_ACTIVE_CONVERSATION), and
    // the backend assigning the real id to the conversation the user is
    // ALREADY IN, mid-first-send (MIGRATE_CONVERSATION_ID mutates the field
    // directly). A watch cannot tell them apart, so it would treat the id
    // assignment as a switch: re-file the position under the dead temp id and
    // start a settle loop that suppresses the autoscroll following the very
    // response being streamed. Same conversation, new name — nothing resets.
    // This is the same trap documented on BaseScreen's draft sync.
    //
    // The subscriber runs synchronously after the commit and before Vue
    // re-renders, so the DOM measured here is still the OUTGOING
    // conversation's — which is exactly what we need to bank.
    let scrollKeyOnScreen = store.state.chat.activeConversationId || null;
    const unsubscribeScrollSync = store.subscribe((mutation) => {
      if (mutation.type === 'chat/MIGRATE_CONVERSATION_ID') {
        // Identity assignment. The stored position is carried across by
        // MIGRATE_CONTEXT_BINDINGS; all we do is follow the new name.
        const { newId } = mutation.payload || {};
        if (newId) scrollKeyOnScreen = newId;
        return;
      }
      if (mutation.type !== 'chat/SET_ACTIVE_CONVERSATION') return;

      const newId = store.state.chat.activeConversationId;
      if (newId === scrollKeyOnScreen) return;
      if (scrollKeyOnScreen) flushScrollCapture(scrollKeyOnScreen);
      scrollKeyOnScreen = newId;
      if (newId) restoreScroll(newId);
    });

    // MathJax typesetting is handled per-message in MessageItem.vue (after streaming completes).
    // A global watcher here would fire on every stream chunk, causing flicker with morphdom.

    // Watch for route query parameter changes to load saved outputs
    watch(
      () => route.query['content-id'],
      async (newContentId, oldContentId) => {
        if (newContentId && newContentId !== oldContentId) {
          // No pre-emptive scroll: the canvas shows a spinner for the whole
          // fetch, so there is nothing to flash. loadSavedOutput restores the
          // conversation's own position once the transcript has rendered.
          terminalLines.value = ['Loading saved output...'];
          await loadSavedOutput(newContentId);
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
          ms.totalUncachedCost = cum.uncachedCost != null ? Number(cum.uncachedCost) : null;
          if (Array.isArray(cum.models)) {
            ms.modelMix = Object.fromEntries(cum.models.map((m) => [m.model, m]));
          }
          ms.subscriptionBased = cum.subscriptionBased ?? null;
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
        if (summary.lastCacheActivityAt) {
          ms.lastCacheActivityAt = summary.lastCacheActivityAt;
        }
        if (summary.cacheTtlMs != null) {
          ms.cacheTtlMs = summary.cacheTtlMs;
        }
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
      ([, model], previous) => {
        // The aiProvider store hydrates asynchronously, so the first firing is
        // usually undefined -> 'claude-opus-5'. That is the store settling, not
        // the user switching models, and treating it as a switch wiped the
        // restored request size on every single page load.
        if (!previous || previous[1] == null) return;

        const convId = store.state.chat.activeConversationId;
        if (!convId) return;
        const ms = getMonitoringState(convId);
        // Only the LIMIT is model-dependent. The last measured request size and
        // its breakdown remain the best known values, so preserve them rather
        // than blanking the panel. Mirrors updateContextWindow().
        ms.contextStatus = {
          ...ms.contextStatus,
          model: model || 'N/A',
          // Unknown model => 0 (renders as unknown). Never inherit the previous
          // model's limit — that left K3 displaying a stale 64K.
          tokenLimit: getContextWindowForModel(model) || 0,
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
        return c.isStreaming || c.isRemoteStreaming || (c.activeAsyncTools && c.activeAsyncTools.size > 0);
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
        // Stand down while a restore is settling. Early in the loop the
        // transcript is short and scrollTop is still 0, which reads as
        // "near the bottom" — acting on that would yank the user to the end
        // of a conversation they asked to reopen in the middle.
        if (isRestoringScroll.value) return;

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
      scheduleScrollCapture,
      terminalLines,
      displayMessages,
      isProcessing,
      suggestions,
      isLoadingSuggestions,
      contextStatus,
      hasMonitoringData,
      lastContextManaged,
      contextManaged,
      errorsCaught,
      toolTruncations,
      toolsLoadedCount,
      lastTokenUsage,
      lastCacheMetrics,
      lastEstimatedCost,
      lastCostBreakdown,
      totalTokenUsage,
      totalCost,
      totalUncachedCost,
      totalCacheMetrics,
      lastManifest,
      lastCacheActivityAt,
      cacheTtlMs,
      modelMix,
      subscriptionBased,
      executionsCount,
      systemActivities,
      turnRounds,
      growthPerTurn,
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
      chatParticipants,
      floorState,
      useTutorial,
      initializeScreen,
      isMobile,
      isMonitoringCollapsed,
      toggleMonitoringPanel,
      hasConnectedAIProvider,
      activeConversationIdForSelector,
      imageCache,
      dataCache,
      bulkLoading,
      expandedToolCalls,
      windowedMessages,
      hiddenMessageCount,
      showEarlierMessages,
      suppressMessageTransition,
      // Skill/goal context (per-conversation)
      activeSkill,
      activeGoal,
      currentActiveSkillId,
      currentActiveGoalId,
      handleCommandAction,
      goalEventLabel,
      goalEventIcon,
    };
  },
};
</script>

<style scoped>
.show-earlier-row {
  display: flex;
  justify-content: center;
  padding: 8px 0 16px;
}

.show-earlier-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-size: var(--font-size-xs, 11px);
  font-family: inherit;
  color: var(--color-text-muted, #8a8a9e);
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-full, 999px);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.show-earlier-btn:hover {
  color: var(--color-text, #e0e0e0);
  border-color: var(--color-text-muted, #8a8a9e);
}

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

/* Force right-alignment regardless of whether the parent is flex-column.
   .message-flow's align-self approach was unreliable, so wrap each pill
   in a row-flex container with justify-content: flex-end. */
.inline-pill-row {
  display: flex;
  justify-content: flex-end;
  width: 100%;
  margin: 8px 0;
}

/* Inline skill/goal pills inserted into the conversation when the user
   invokes /skill or /goal. Right-aligned via the row wrapper above. */
.inline-context-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 5px 5px 12px;
  border-radius: 999px;
  font-size: 0.78em;
  line-height: 1.2;
  border: 1px solid rgba(160, 120, 255, 0.4);
  background: rgba(160, 120, 255, 0.1);
  color: var(--status-purple-text);
  max-width: max-content;
}

.inline-context-pill.is-detached {
  border-color: rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-med-navy, #888);
}

.inline-context-pill > i:first-child {
  font-size: 0.85em;
  flex-shrink: 0;
}

.inline-context-pill .pill-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.inline-context-pill .pill-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  flex-shrink: 0;
}

.inline-context-pill .pill-close:hover {
  background: rgba(255, 255, 255, 0.14);
  color: var(--color-lightest);
}

.inline-context-pill .pill-close i {
  font-size: 0.7em;
}

/* Inline goal-widget container — small detach link below the widget.
   Right-aligned via the .inline-pill-row wrapper. */
.inline-goal-widget-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: 420px;
}

/* GoalProgressWidget has its own .margin: 1px 8px 8px from its scoped style;
   neutralize horizontal margins so it sits flush with the right edge. */
.inline-goal-widget-wrap :deep(.goal-progress-widget) {
  margin: 0;
}

.inline-goal-widget-wrap .inline-goal-detach {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 4px 0 0 0;
  padding: 2px 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 999px;
  background: transparent;
  color: var(--color-med-navy, #888);
  cursor: pointer;
  font-size: 0.7em;
  width: auto;
  height: auto;
}

.inline-goal-widget-wrap .inline-goal-detach:hover {
  color: var(--color-lightest);
  background: rgba(255, 255, 255, 0.06);
}

.inline-goal-widget-wrap .inline-goal-detach i {
  font-size: 0.85em;
}

/* Append-only goal trace event cards (kind=goal-event). One per task
   completion / verdict / loop end. Right-aligned via .inline-pill-row. */
.goal-event-card {
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--color-darker-1);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  color: var(--color-text-secondary, #aaa);
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.goal-event-card.goal-event-task_completed {
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.08);
}

.goal-event-card.goal-event-task_failed,
.goal-event-card.goal-event-loop_error {
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.08);
}

.goal-event-card.goal-event-verdict {
  border-color: rgba(0, 255, 136, 0.4);
  background: rgba(0, 255, 136, 0.08);
}

.goal-event-card .goal-event-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--color-text-primary, #e0e0e0);
}

.goal-event-card .goal-event-kind {
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 9px;
}

.goal-event-card .goal-event-title {
  font-weight: 400;
  color: var(--color-text-secondary, #888);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

.goal-event-card .goal-event-summary {
  color: var(--color-text-primary, #e0e0e0);
  white-space: pre-wrap;
}

.goal-event-card .goal-event-detail {
  color: var(--color-text-secondary, #888);
  white-space: pre-wrap;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
  padding-top: 4px;
  font-size: 10px;
  line-height: 1.4;
}

.monitoring-panel {
  background: var(--color-darker-0);
  border-bottom: 1px solid rgba(127, 129, 147, 0.1);
  transition: all 0.3s ease;
  border-radius: 0;
  /* The columns below respond to THIS panel's width, not the viewport's —
     the chat pane is far narrower than the window that contains it. */
  container-type: inline-size;
}

.monitoring-panel.collapsed {
  border-bottom: 1px solid rgba(127, 129, 147, 0.05);
  border-radius: 0 0 8px 8px;
}

/* The header strip, the tiles and the drawer all live in ContextTiles.vue now,
   which owns its own layout. */

/* The three-column grid was removed with the header above; ContextTiles lays
   itself out with an auto-fit tile grid and a wrapping drawer instead. */

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
  padding: 48px 16px 32px 16px;
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

/* Spinner shown while a saved conversation is loading or being switched.
   Centered in the canvas; matches the OAuthCallback spinner style so we
   stay visually consistent with the rest of the app's loading states. */
.chat-loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  width: 100%;
  padding: 48px 0;
}

.chat-loading-state .spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(var(--green-rgb, 25, 239, 131), 0.2);
  border-top-color: var(--color-green, #19ef83);
  border-radius: 50%;
  animation: chat-loading-spin 0.9s linear infinite;
}

@keyframes chat-loading-spin {
  to { transform: rotate(360deg); }
}

.message-flow {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-left: -56px;
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

@media (max-width: 1780px) {
  .message-flow {
    margin-left: 0;
  }
}

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

/* ---- Group chat: participant roster + floor queue ---- */
.chat-roster {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 0 8px;
  font-size: 11px;
}

.chat-roster-label {
  color: var(--color-text-muted);
  font-size: 11px;
}

.chat-roster-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--color-border, #2a2a44);
  border-radius: 10px;
  color: var(--color-text-secondary, #a0a0b8);
  background: transparent;
  line-height: 16px;
  white-space: nowrap;
}

.chat-roster-chip.is-annie {
  color: var(--color-accent, #e53d8f);
  border-color: color-mix(in srgb, var(--color-accent, #e53d8f) 40%, transparent);
}

.chat-roster-avatar {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  object-fit: cover;
}

.floor-queue-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin: 4px 0;
  font-size: 12px;
  color: var(--color-text-muted);
  border-left: 2px solid var(--color-accent, #e53d8f);
}

.floor-queue-budget {
  color: var(--color-text-muted);
  opacity: 0.7;
}
</style>
