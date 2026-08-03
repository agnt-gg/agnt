<template>
  <div
    class="unified-chat-container"
    :class="{ 'is-drag-over': isDragOver }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div v-if="isDragOver" class="drop-overlay">
      <i class="fas fa-cloud-upload-alt"></i>
      <span>Drop files to attach</span>
    </div>
    <div class="chat-messages-area">
      <div class="chat-messages" ref="chatMessagesRef">
        <div v-if="formattedMessages.length === 0" class="empty-state">
          <slot name="empty-state">
            <i :class="emptyIcon"></i>
            <p>{{ welcomeMessage }}</p>
          </slot>
        </div>

        <TransitionGroup name="message" tag="div" class="message-flow" v-else>
          <MessageItem
            v-for="message in formattedMessages"
            :key="message.id"
            :message="message"
            :status="getStatusFor(message)"
            :runningTools="getRunningToolsFor(message)"
            :show-avatar="showAvatar"
            :compact="messageItemMode === 'compact'"
            :image-cache="imageCache"
            :data-cache="dataCache"
            @toggle-tool="onToggleTool"
            @edit-message="onEditMessage"
          />
        </TransitionGroup>

        <ProcessingState v-if="isProcessing" text="Annie is working..." />
      </div>

      <ChatScrollControls :target-getter="getMessagesEl" />
    </div>

    <div class="quick-actions-wrapper" v-if="showSuggestions && suggestions.length > 0 && !isProcessing">
      <QuickActions
        :suggestions="suggestions"
        :is-loading="isLoadingSuggestions"
        @execute="executeSuggestion"
      />
    </div>

    <div class="chat-input-container">
      <div v-if="pendingSteer" class="steering-chip">
        <i class="fas fa-sync-alt"></i>
        <span class="steering-chip-text" v-tooltip="pendingSteer">Steer pending: "{{ pendingSteer }}"</span>
        <button type="button" class="steering-chip-cancel" @click="onCancelSteer" v-tooltip="'Cancel steer'">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <!--
        Voice status strip. Voice has no visible surface of its own, so without
        this the user cannot tell whether it is hearing them, thinking, or
        broken — and a hands-free mode you cannot read is one you cannot trust.
      -->
      <div v-if="voiceActive" class="voice-status-strip" :class="'voice-' + voiceState">
        <span class="voice-dot"></span>
        <span class="voice-status-text">
          <template v-if="voiceError">{{ voiceError }}</template>
          <template v-else-if="voiceState === 'listening'">{{ voicePartial || 'Listening…' }}</template>
          <template v-else-if="voiceState === 'reopen'">{{ voicePartial || 'Listening…' }}</template>
          <template v-else-if="voiceState === 'thinking'">Thinking…</template>
          <template v-else-if="voiceState === 'speaking'">Speaking — talk any time to interrupt</template>
          <template v-else>Voice ready</template>
        </span>
        <button class="voice-end-btn" type="button" @click="toggleVoice">End</button>
      </div>
      <ChatInputBar
        ref="inputBarRef"
        v-model="chatInput"
        :placeholder="isProcessing ? 'Steer Annie mid-turn…' : placeholder"
        :disabled="false"
        :is-streaming="isProcessing"
        :show-attachments="showAttachments"
        :show-voice="showVoiceInput"
        :voice-supported="isSupported"
        :voice-listening="isListening"
        :selected-files="selectedFiles"
        :compact="compactInput"
        @submit="onSend"
        @stop="onStop"
        @attach-files="onAttachFiles"
        @paste-files="onAttachFiles"
        @remove-file="onRemoveFile"
        @toggle-voice="toggleListening"
      >
        <!--
          Voice goes in `primary-buttons`, which ChatInputBar renders in BOTH
          layouts. It must NOT go in `extra-buttons`: that slot only exists in
          the non-compact branch, and `compactInput` defaults to true for every
          host — which is exactly how this shipped invisible.
        -->
        <template #primary-buttons>
          <Tooltip
            :text="voiceActive ? 'End voice conversation' : 'Start a voice conversation (hands-free)'"
            width="auto"
          >
            <button
              @click="toggleVoice"
              class="chat-icon-btn chat-voice-btn"
              :class="['voice-' + voiceState, { 'voice-on': voiceActive }]"
              type="button"
              :aria-pressed="voiceActive ? 'true' : 'false'"
              aria-label="Toggle hands-free voice conversation"
            >
              <i :class="voiceActive ? 'fas fa-headset' : 'far fa-comment-dots'"></i>
              <span
                v-if="voiceActive"
                class="voice-level-ring"
                :style="{ transform: 'scale(' + (1 + voiceLevel * 0.5) + ')' }"
              ></span>
            </button>
          </Tooltip>
        </template>
        <template #extra-buttons="{ isStreaming: streaming }">
          <Tooltip v-if="!compactInput && !streaming" text="AI Provider Settings" width="auto">
            <button ref="providerBtnRef" @click="toggleProviderSelector" class="chat-icon-btn chat-provider-btn" type="button">
              <i class="fas fa-robot"></i>
            </button>
          </Tooltip>
          <Tooltip v-if="!compactInput && !streaming" text="Tool Settings" width="auto">
            <button @click="toggleToolSelector" class="chat-icon-btn chat-tools-btn" type="button">
              <i class="fas fa-wrench"></i>
            </button>
          </Tooltip>
          <Tooltip v-if="!compactInput && !streaming && showClearAction" text="Clear chat" width="auto">
            <button @click="onClearChat" class="chat-icon-btn chat-clear-btn" type="button">
              <i class="fas fa-trash"></i>
            </button>
          </Tooltip>
        </template>
        <template v-if="compactInput" #overflow-items="{ close }">
          <button ref="providerBtnRef" @click="onOverflowAction(close, toggleProviderSelector)" class="chat-overflow-item" type="button">
            <i class="fas fa-robot"></i>
            <span>AI provider</span>
          </button>
          <button @click="onOverflowAction(close, toggleToolSelector)" class="chat-overflow-item" type="button">
            <i class="fas fa-wrench"></i>
            <span>Tools</span>
          </button>
          <button v-if="showClearAction" @click="onOverflowAction(close, onClearChat)" class="chat-overflow-item chat-clear-item" type="button">
            <i class="fas fa-trash"></i>
            <span>Clear chat</span>
          </button>
        </template>
      </ChatInputBar>
    </div>

    <!-- Provider + Tool selectors: same global popovers used by the orchestrator chat.
         We position both relative to the chat input bar so they sit cleanly above
         the input regardless of panel width. -->
    <Teleport to="body">
      <ChatProviderSelector
        v-if="isProviderSelectorOpen"
        :isOpen="isProviderSelectorOpen"
        :clean-position="true"
        :channel-key="channelKey"
        :style="popoverStyle"
        @close="closeProviderSelector"
      />
    </Teleport>
    <Teleport to="body">
      <ChatToolSelector
        v-if="isToolSelectorOpen"
        :isOpen="isToolSelectorOpen"
        :channel-key="channelKey"
        :style="popoverStyle"
        @close="closeToolSelector"
      />
    </Teleport>

    <!-- Confirm host for the destructive clear action. Lives here, not in the
         host panel, so every surface gets the same guard. -->
    <SimpleModal ref="confirmModalRef" />
  </div>
</template>

<script>
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { useStore } from 'vuex';
import MessageItem from '@/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue';
import ProcessingState from '@/views/Terminal/CenterPanel/screens/Chat/components/ProcessingState.vue';
import QuickActions from '@/views/Terminal/CenterPanel/screens/Chat/components/QuickActions.vue';
import ChatInputBar from '@/views/_components/chat/ChatInputBar.vue';
import ChatScrollControls from '@/views/_components/chat/ChatScrollControls.vue';
import ChatProviderSelector from '@/views/Terminal/CenterPanel/screens/Chat/components/ChatProviderSelector.vue';
import ChatToolSelector from '@/views/Terminal/CenterPanel/screens/Chat/components/ChatToolSelector.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { useSpeechRecognition } from '@/composables/useSpeechRecognition';
import { useVoiceSession } from '@/composables/useVoiceSession';
import { getChannelConfig } from '@/services/chatChannelConfig.js';

export default {
  name: 'UnifiedChatContainer',
  components: { MessageItem, ProcessingState, QuickActions, ChatInputBar, ChatScrollControls, ChatProviderSelector, ChatToolSelector, Tooltip, SimpleModal },
  props: {
    channelKey: { type: String, required: true },
    chatType: { type: String, required: true },
    pageContext: { type: Object, default: () => ({}) },
    pageState: { type: Object, default: () => ({}) },
    welcomeMessage: { type: String, default: 'Hi! I\'m Annie. How can I help?' },
    emptyIcon: { type: String, default: 'fas fa-comments' },
    placeholder: { type: String, default: 'Ask Annie...' },
    initialSuggestions: { type: Array, default: () => [] },
    showSuggestions: { type: Boolean, default: true },
    // Assistant avatar in the message gutter. Defaults OFF because the five
    // sidebar panels are narrow and have never shown it — changing that
    // default would silently reflow every one of them. The full-width Chat
    // screen DOES show it (MessageItem's own default), so surfaces aiming for
    // Chat parity opt in explicitly.
    showAvatar: { type: Boolean, default: false },
    showVoiceInput: { type: Boolean, default: true },
    // Defaults to true — every chat now matches orchestrator capabilities
    // (file attach, provider selector, tool selector). Panels can opt out.
    showAttachments: { type: Boolean, default: true },
    compactInput: { type: Boolean, default: true }, // sidebar panels are narrow → consolidate buttons
    messageItemMode: { type: String, default: 'compact' }, // 'compact' | 'full'
    // Clear/reset this conversation. Defaults ON so any surface that embeds a
    // chat gets the action for free — the workspace chat widget shipped with no
    // clear button precisely because this lived in each host's header chrome
    // instead of here, and its host (WidgetFrame) has no chat-aware header.
    // The six panels that already render their own header button opt out, so a
    // host that forgets gets a visible duplicate rather than a silent omission.
    showClearAction: { type: Boolean, default: true },
    onFrontendEvent: { type: Function, default: null },
    autoSuggestions: { type: Boolean, default: true },
    suggestionsContextLabel: { type: String, default: '' },
  },
  emits: ['frontend-event', 'sent', 'cleared'],
  setup(props, { emit }) {
    const store = useStore();
    const chatMessagesRef = ref(null);
    const inputBarRef = ref(null);
    const confirmModalRef = ref(null);
    const providerBtnRef = ref(null);
    const chatInput = ref('');
    const selectedFiles = ref([]);
    const isDragOver = ref(false);
    let dragLeaveTimer = null;

    // Provider + tool selector popovers (mirrors BaseScreen orchestrator behavior).
    const isProviderSelectorOpen = ref(false);
    const isToolSelectorOpen = ref(false);

    // Hardcoded position for sidebar chat popovers. Matches the orchestrator
    // chat's "bottom-right anchored, expand up-and-left" behaviour: bottom
    // and left are pinned, the popup grows from that corner. Inline `auto`
    // for top defeats the popover components' own top/bottom rules so they
    // don't fight our anchor.
    const popoverStyle = {
      position: 'fixed',
      top: 'auto',
      right: '1592px',
      bottom: '148px',
      left: '96px',
      margin: 0,
    };

    const { isListening, isSupported, transcript, toggleListening } = useSpeechRecognition();
    watch(transcript, (t) => { if (t) chatInput.value = t; });

    const toggleProviderSelector = () => {
      isToolSelectorOpen.value = false;
      isProviderSelectorOpen.value = !isProviderSelectorOpen.value;
    };
    const closeProviderSelector = () => { isProviderSelectorOpen.value = false; };

    const toggleToolSelector = () => {
      isProviderSelectorOpen.value = false;
      isToolSelectorOpen.value = !isToolSelectorOpen.value;
    };
    const closeToolSelector = () => { isToolSelectorOpen.value = false; };

    // Used by the compact-mode overflow menu items: close the popover then run the action.
    const onOverflowAction = (closeOverflow, action) => {
      if (typeof closeOverflow === 'function') closeOverflow();
      nextTick(action);
    };

    const onAttachFiles = (files) => {
      if (!Array.isArray(files) || files.length === 0) return;
      selectedFiles.value = [...selectedFiles.value, ...files];
    };
    const onRemoveFile = (index) => {
      selectedFiles.value.splice(index, 1);
    };

    // Drag & drop file attach. We accept anything the file input would accept
    // (extension filtering happens later when uploading); the overlay just
    // gives the user feedback that a drop will land here.
    //
    // Every handler gates on `types.includes('Files')`. Non-file drags
    // (@mention picker, internal reorder, etc.) must pass through
    // completely — in particular, we must NOT touch dropEffect for them,
    // because overriding a child's 'move' with our 'copy' causes the
    // browser to cancel the drop when effectAllowed='move'.
    const isFileDrag = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const onDragEnter = (e) => {
      if (!isFileDrag(e)) return;
      if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null; }
      isDragOver.value = true;
    };
    const onDragOver = (e) => {
      if (!isFileDrag(e)) return;
      e.dataTransfer.dropEffect = 'copy';
      if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null; }
      isDragOver.value = true;
    };
    const onDragLeave = (e) => {
      // Browsers fire dragleave on every child. Debounce so we only clear
      // when the cursor truly leaves the container.
      if (dragLeaveTimer) clearTimeout(dragLeaveTimer);
      dragLeaveTimer = setTimeout(() => { isDragOver.value = false; dragLeaveTimer = null; }, 50);
    };
    const onDrop = (e) => {
      if (!isFileDrag(e)) return;
      if (dragLeaveTimer) { clearTimeout(dragLeaveTimer); dragLeaveTimer = null; }
      isDragOver.value = false;
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) onAttachFiles(files);
    };

    const formattedMessages = computed(() => store.getters['chatUnified/getFormattedMessages'](props.channelKey));
    const isProcessing = computed(() => store.getters['chatUnified/isStreaming'](props.channelKey));
    const isLoadingSuggestions = computed(() => store.getters['chatUnified/isLoadingSuggestions'](props.channelKey));
    const storedSuggestions = computed(() => store.getters['chatUnified/getSuggestions'](props.channelKey));
    const pendingSteer = computed(() => store.getters['chatUnified/pendingSteer'](props.channelKey));
    // Without this, MessageItem falls back to its default empty Map and every
    // {{IMAGE_REF:id}} resolves to the authenticated /api/images/:id URL, which
    // an <img> tag cannot load. The main chat passes the equivalent cache.
    const imageCache = computed(() => store.getters['chatUnified/getImageCache'](props.channelKey));
    const dataCache = computed(() => store.getters['chatUnified/getDataCache'](props.channelKey));

    const suggestions = computed(() => {
      const stored = storedSuggestions.value;
      return stored && stored.length > 0 ? stored : props.initialSuggestions;
    });

    const scrollToBottom = () => {
      nextTick(() => {
        if (chatMessagesRef.value) {
          chatMessagesRef.value.scrollTop = chatMessagesRef.value.scrollHeight;
        }
      });
    };

    // Handed to ChatScrollControls so it can attach listeners to the right
    // element without us plumbing the ref through component props.
    const getMessagesEl = () => chatMessagesRef.value;

    // Keyboard scroll for the messages pane. PageUp/PageDown route to the
    // chat (the textarea is ~150px tall so paging it is useless). Home/End
    // are left alone whenever an editable element is focused — they have
    // native cursor-movement meaning there.
    const handleKeyboardScroll = (event) => {
      const el = chatMessagesRef.value;
      if (!el) return;

      // Don't fight a focused modal/dialog.
      if (document.querySelector('.modal-overlay')) return;

      const active = document.activeElement;
      const isEditable =
        !!active &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

      // Don't steal keys when an input outside any chat surface is focused
      // (e.g. a search box teleported to body). Inputs inside our own chat
      // input-container are still fair game for PageUp/PageDown.
      const insideExternalInput =
        isEditable &&
        !active.closest?.('.input-container, .chat-input-container, .unified-chat-container, .automation-interface');
      if (insideExternalInput) return;

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

    const focusInput = () => {
      nextTick(() => inputBarRef.value?.focus());
    };

    const handleFrontendEvent = (eventType, eventData, toolCall) => {
      emit('frontend-event', { eventType, eventData, toolCall });
      if (typeof props.onFrontendEvent === 'function') {
        try { props.onFrontendEvent(eventType, eventData, toolCall); } catch (e) {
          console.error('[UnifiedChatContainer] onFrontendEvent threw:', e);
        }
      }
    };

    const onSend = async () => {
      if (!chatInput.value.trim() && selectedFiles.value.length === 0) return;

      // Mid-turn steering branch: a turn is already streaming for this
      // channel, so don't start a new POST /chat — emit a 'steer' over the
      // socket. Backend stashes it; OrchestratorService drains it between
      // tool rounds and appends it to the last tool-result message.
      if (isProcessing.value && chatInput.value.trim()) {
        const content = chatInput.value.trim();
        chatInput.value = '';
        const resp = await store.dispatch('chatUnified/steerInFlight', {
          channelKey: props.channelKey,
          content,
        });
        if (!resp?.ok) {
          console.warn('[UnifiedChatContainer] steer failed:', resp?.error);
          // Restore input so the user can retry.
          chatInput.value = content;
        }
        focusInput();
        return;
      }

      const content = chatInput.value;
      const filesToSend = selectedFiles.value.slice();
      chatInput.value = '';
      selectedFiles.value = [];

      // Notify the panel that files were attached — some panels still hook
      // this to react locally (e.g. paste image into widget editor). The
      // multipart upload itself now rides on the sendMessage dispatch below.
      if (filesToSend.length > 0) {
        emit('frontend-event', { eventType: 'submit-files', eventData: { files: filesToSend } });
      }

      await store.dispatch('chatUnified/sendMessage', {
        channelKey: props.channelKey,
        chatType: props.chatType,
        content,
        pageContext: props.pageContext || {},
        pageState: props.pageState || {},
        files: filesToSend.length > 0 ? filesToSend : undefined,
        onFrontendEvent: handleFrontendEvent,
      });

      emit('sent');
      focusInput();
      scrollToBottom();

      if (props.autoSuggestions && props.showSuggestions) {
        store.dispatch('chatUnified/fetchSuggestions', {
          channelKey: props.channelKey,
          chatType: props.chatType,
          contextLabel: props.suggestionsContextLabel || props.chatType,
        }).catch(() => { /* non-fatal */ });
      }
    };

    const onStop = () => {
      store.dispatch('chatUnified/stopStream', { channelKey: props.channelKey });
      focusInput();
    };

    // ---- hands-free voice conversation ---------------------------------
    //
    // Declared here, after formattedMessages/isProcessing/onSend, because the
    // watchers below read them immediately — wiring this block earlier is a
    // temporal-dead-zone crash at setup, not a lint nit.
    //
    // Deliberately SEPARATE from the push-to-talk mic. That button is a
    // dictation aid: it fills the textarea and the user still presses send.
    // This is a CONVERSATION — it endpoints on its own, speaks the reply, and
    // can be interrupted. Two different interactions, so two controls;
    // collapsing them would make the mic unpredictable for everyone already
    // used to it.
    const voice = useVoiceSession({
      onCommit: ({ text }) => {
        chatInput.value = text;
        onSend();
      },
      onSteer: async ({ text }) => {
        // A voice interruption is exactly the mid-run steer the text path
        // already implements — reuse it rather than racing a second POST.
        const resp = await store.dispatch('chatUnified/steerInFlight', {
          channelKey: props.channelKey,
          content: text,
        });
        if (!resp?.ok) {
          chatInput.value = text;
          onSend();
        }
      },
      getAgents: () => {
        const list = store.getters['agents/allAgents'];
        return Array.isArray(list) ? list.map((a) => ({ id: a.id, name: a.name })) : [];
      },
    });

    /**
     * Bridge the assistant stream into the voice pipeline.
     *
     * Watching the rendered message rather than tapping the SSE socket is
     * deliberate: the store already owns stream decoding for every chat
     * surface, and a second subscriber would be a second place for the wire
     * protocol to drift. The accumulated content is what the chunker wants.
     */
    watch(
      () => {
        if (!voice.isActive.value) return null;
        const list = formattedMessages.value || [];
        const last = list[list.length - 1];
        return last && last.role === 'assistant' ? last.content || '' : null;
      },
      (content) => {
        if (content === null) return;
        voice.handleStreamEvent('content_delta', { accumulated: content });
      }
    );

    watch(isProcessing, (streaming, was) => {
      if (was && !streaming && voice.isActive.value) {
        voice.handleStreamEvent('done', {});
      }
    });

    const onCancelSteer = () => {
      store.dispatch('chatUnified/cancelSteer', { channelKey: props.channelKey });
    };

    const executeSuggestion = (suggestion) => {
      chatInput.value = suggestion.text;
      onSend();
    };

    const onToggleTool = (messageId, toolCallIndex) => {
      store.dispatch('chatUnified/toggleToolCallExpansion', {
        channelKey: props.channelKey,
        messageId,
        toolCallIndex,
      });
    };

    const onEditMessage = async ({ messageId, newContent }) => {
      if (!messageId || !newContent || !newContent.trim() || isProcessing.value) return;
      await store.dispatch('chatUnified/editMessage', {
        channelKey: props.channelKey,
        chatType: props.chatType,
        messageId,
        newContent: newContent.trim(),
        pageContext: props.pageContext || {},
        pageState: props.pageState || {},
        onFrontendEvent: handleFrontendEvent,
      });
      scrollToBottom();
      focusInput();
    };

    const getStatusFor = (message) => {
      if (!message || message.role !== 'assistant') return null;
      return store.getters['chatUnified/getMessageStatus'](props.channelKey, message.id);
    };
    const getRunningToolsFor = (message) => {
      if (!message || !message.toolCalls) return [];
      return store.getters['chatUnified/getRunningToolsForMessage'](props.channelKey, message.id);
    };

    // Single source of truth for the greeting, shared by first-mount init and
    // by clear — otherwise a cleared channel drifts from a fresh one.
    const buildWelcomeMessage = () =>
      props.welcomeMessage
        ? {
            id: `${props.channelKey.replace(':', '-')}-welcome-${Date.now()}`,
            role: 'assistant',
            content: props.welcomeMessage,
            timestamp: Date.now(),
          }
        : null;

    /** Workspace history hydrate — may need retries until workspace sync lands. */
    const hydrateWorkspaceHistory = (attempt = 0) => {
      if (typeof props.channelKey !== 'string' || !props.channelKey.startsWith('workspace:')) return;
      // Promise.resolve, not a bare .then: Vuex returns UNDEFINED for an action
      // it does not have registered, and this hydrate is a best-effort extra.
      // A host that mounts a chat without the workspace sync actions must still
      // get a working chat, not a TypeError during setup().
      Promise.resolve(store.dispatch('chatUnified/hydrateWorkspaceChannel', { channelKey: props.channelKey }))
        .then((r) => {
          if (r?.ok && r.reason === 'hydrated') {
            scrollToBottom(true);
            return;
          }
          // Race: chat mounts before /api/workspaces hydrate writes channelConversations.
          // Retry a few times so the other browser can pick up the conversation id.
          if (r?.reason === 'no_conversation_id' && attempt < 5) {
            setTimeout(() => hydrateWorkspaceHistory(attempt + 1), 300 * (attempt + 1));
          }
        })
        .catch(() => { /* offline / missing log — keep local */ });
    };

    const initialize = () => {
      store.dispatch('chatUnified/initializeChannel', { channelKey: props.channelKey, welcomeMessage: buildWelcomeMessage() });
      applyChannelProviderToVuex();
      // Workspace chats: reload transcript from conversation_logs when this
      // device has no/shorter local history (cross-device sync).
      hydrateWorkspaceHistory(0);
    };

    // After workspace layout sync finishes, conversation ids are in localStorage —
    // re-run hydrate so we don't depend on the mount-time race.
    const onWorkspaceSyncReady = () => {
      if (typeof props.channelKey === 'string' && props.channelKey.startsWith('workspace:')) {
        hydrateWorkspaceHistory(0);
      }
    };

    const onClearChat = async () => {
      // No confirm host mounted => no destructive action. Never clear silently.
      const confirmed = await confirmModalRef.value?.showModal({
        title: 'Clear chat?',
        message: 'This will permanently delete the conversation history for this chat.',
        confirmText: 'Clear',
        confirmClass: 'btn-danger',
      });
      if (!confirmed) return;

      await store.dispatch('chatUnified/clearConversation', {
        channelKey: props.channelKey,
        welcomeMessage: buildWelcomeMessage(),
      });
      // Generated suggestions describe the conversation we just deleted.
      store.dispatch('chatUnified/setSuggestions', {
        channelKey: props.channelKey,
        suggestions: [...props.initialSuggestions],
      });
      emit('cleared');
      focusInput();
    };

    // Each chat surface remembers its own provider/model in chatChannelConfig.
    // Push that selection into Vuex on mount/channel-switch so the very next
    // request from this chat is sent with the right provider — without
    // waiting for the user to open the popover. Tool selection is read
    // directly from the per-channel config in the send path, so it doesn't
    // need a Vuex mirror here.
    const applyChannelProviderToVuex = () => {
      if (!props.channelKey) return;
      const cfg = getChannelConfig(props.channelKey);
      if (!cfg) return;
      if (cfg.provider && cfg.provider !== store.state.aiProvider?.selectedProvider) {
        store.dispatch('aiProvider/setProvider', cfg.provider);
      }
      if (cfg.model && cfg.model !== store.state.aiProvider?.selectedModel) {
        store.dispatch('aiProvider/setModel', cfg.model);
      }
    };

    onMounted(() => {
      initialize();
      focusInput();
      scrollToBottom();
      window.addEventListener('keydown', handleKeyboardScroll);
      window.addEventListener('agnt:workspace-sync-ready', onWorkspaceSyncReady);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleKeyboardScroll);
      window.removeEventListener('agnt:workspace-sync-ready', onWorkspaceSyncReady);
    });

    watch(() => props.channelKey, () => {
      initialize();
      setTimeout(scrollToBottom, 100);
    });

    // Sticky-bottom only when the user is already near the bottom — same
    // pattern as the main chat (Chat.vue). Without this, every streaming
    // token AND every tool-call expand/collapse click yanks the user back
    // to the bottom, even if they scrolled up to read history.
    watch(
      formattedMessages,
      () => {
        const el = chatMessagesRef.value;
        if (!el) return;
        const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
        if (isNearBottom) scrollToBottom();
      },
      { flush: 'post', deep: true },
    );

    return {
      chatMessagesRef,
      inputBarRef,
      confirmModalRef,
      providerBtnRef,
      onClearChat,
      chatInput,
      selectedFiles,
      formattedMessages,
      imageCache,
      dataCache,
      isProcessing,
      isLoadingSuggestions,
      suggestions,
      pendingSteer,
      onCancelSteer,
      onSend,
      onStop,
      onAttachFiles,
      onRemoveFile,
      getMessagesEl,
      isDragOver,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      onToggleTool,
      onEditMessage,
      executeSuggestion,
      getStatusFor,
      getRunningToolsFor,
      isListening,
      isSupported,
      toggleListening,
      voiceActive: voice.isActive,
      voiceState: voice.state,
      voiceLevel: voice.level,
      voiceError: voice.error,
      voicePartial: voice.partialTranscript,
      toggleVoice: voice.toggle,
      // Provider/Tool selectors
      isProviderSelectorOpen,
      isToolSelectorOpen,
      popoverStyle,
      toggleProviderSelector,
      closeProviderSelector,
      toggleToolSelector,
      closeToolSelector,
      onOverflowAction,
    };
  },
};
</script>

<style scoped>
/* ---- hands-free voice ------------------------------------------------ */

/*
 * The button is a STATE indicator, not just a control. Voice has no other
 * visible surface, so if the button looks the same whether or not the mic is
 * open, the only way to find out is to talk to a machine that may not be
 * listening. Colour follows the conversation state.
 *
 * These use the --status-*-text tokens rather than the raw --color-green/blue
 * hues: the raw hues are tuned for a dark canvas and drop to ~1.9:1 on the
 * light theme, while the status tokens are re-darkened per theme to clear AA.
 * No fallback values — a stale literal silently ships the wrong brand colour
 * if a token is ever renamed, which is worse than failing loudly.
 */
.chat-voice-btn {
  position: relative;
}

.chat-voice-btn.voice-on {
  color: var(--status-blue-text);
}

.chat-voice-btn.voice-listening {
  color: var(--status-green-text);
}

.chat-voice-btn.voice-thinking {
  color: var(--status-amber-text);
}

.chat-voice-btn.voice-speaking {
  color: var(--status-blue-text);
}

/* Mic level, so "is it hearing me?" is answerable at a glance. */
.voice-level-ring {
  position: absolute;
  inset: -2px;
  border-radius: 50%;
  border: 1px solid currentColor;
  opacity: 0.35;
  pointer-events: none;
  transition: transform 80ms linear;
}

/*
 * A recessed band above the composer. `--surface-sunken` is the app's token for
 * exactly this (wells, tracks, code) and flips per theme; the inline
 * rgba(0,0,0,0.35) it replaced is the DARK theme's own value, which rendered a
 * black bar with dark text on the light theme.
 */
.voice-status-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin: 0 8px 6px;
  border-radius: 6px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  min-height: 28px;
}

.voice-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-quaternary);
  flex: 0 0 auto;
}

.voice-status-strip.voice-listening .voice-dot {
  background: var(--status-green-text);
  animation: voice-pulse 1.4s ease-in-out infinite;
}

.voice-status-strip.voice-reopen .voice-dot {
  background: var(--status-green-text);
}

.voice-status-strip.voice-thinking .voice-dot {
  background: var(--status-amber-text);
  animation: voice-pulse 0.9s ease-in-out infinite;
}

.voice-status-strip.voice-speaking .voice-dot {
  background: var(--status-blue-text);
  animation: voice-pulse 0.7s ease-in-out infinite;
}

@keyframes voice-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

/* The partial transcript can be long; it must never push the composer around. */
.voice-status-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-end-btn {
  flex: 0 0 auto;
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.voice-end-btn:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
}

@media (prefers-reduced-motion: reduce) {
  .voice-status-strip .voice-dot { animation: none; }
  .voice-level-ring { transition: none; }
}

.unified-chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
  flex: 1;
}

.chat-messages-area {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 0 0 16px;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
}

.chat-messages::-webkit-scrollbar { display: none; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--color-grey);
  gap: 12px;
  text-align: center;
}

.empty-state i {
  font-size: 2.5em;
  opacity: 0.5;
  color: var(--color-green);
}

.empty-state p {
  color: var(--color-light-green);
  max-width: 300px;
  line-height: 1.5;
}

/* Horizontal padding on all three surfaces below was previously 0, so message
   bubbles, suggestion chips and the composer all sat flush against the
   container's edge — fine on the full-width Chat screen (which supplies its
   own 16px via .conversation-canvas) but visibly broken in every narrow host:
   the five sidebar panels and the workspace chat rail.
   The Workspace solo view zeroes this out again, because it reproduces the
   Chat screen exactly and would otherwise double up. */
.message-flow {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1 1 auto;
  padding: 8px;
}

.message-enter-active { transition: opacity 0.3s ease-out, transform 0.3s ease-out; }
.message-leave-active { transition: opacity 0.3s ease-in, transform 0.3s ease-in; }
.message-enter-from { opacity: 0; transform: translateY(15px); }
.message-leave-to { opacity: 0; transform: translateY(15px); }

.quick-actions-wrapper {
  padding: 12px 8px 0;
  border-top: 1px solid var(--terminal-border-color);
}

.quick-actions-wrapper :deep(.suggestions-bar) {
  padding: 0;
  border-top: none;
}

.chat-input-container {
  padding: 8px;
  border-top: 1px solid var(--terminal-border-color);
}

.steering-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px 2px;
  padding: 4px 4px 4px 10px;
  background: rgba(var(--green-rgb, 18, 224, 255), 0.08);
  border: 1px solid rgba(var(--green-rgb, 18, 224, 255), 0.25);
  border-radius: 999px;
  color: var(--color-green);
  font-size: 0.78em;
  line-height: 1.2;
  max-width: 100%;
}

.steering-chip > i:first-child {
  font-size: 0.85em;
  animation: steering-spin 1.6s linear infinite;
  flex-shrink: 0;
}

.steering-chip-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 360px;
}

.steering-chip-cancel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-green);
  cursor: pointer;
  flex-shrink: 0;
}

.steering-chip-cancel:hover {
  background: rgba(var(--green-rgb, 18, 224, 255), 0.18);
  color: var(--color-lightest);
}

.steering-chip-cancel i {
  font-size: 0.7em;
}

@keyframes steering-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Destructive actions read red everywhere else in the app; match that.
   The overflow rule carries an extra class so it outranks ChatInputBar's own
   :slotted(.chat-overflow-item) colour regardless of stylesheet order. */
.chat-clear-btn:hover { color: var(--color-red, #ff6b6b); }

.chat-overflow-menu .chat-overflow-item.chat-clear-item,
.chat-overflow-menu .chat-overflow-item.chat-clear-item:hover {
  color: var(--color-red, #ff6b6b);
}

.unified-chat-container :deep(.message-wrapper) { max-width: 100%; }

.unified-chat-container.is-drag-over { outline: 2px dashed var(--color-green); outline-offset: -8px; border-radius: 8px; }

.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(var(--green-rgb, 18, 224, 255), 0.08);
  color: var(--color-green);
  font-size: 0.95em;
  pointer-events: none;
}
.drop-overlay i { font-size: 2.2em; opacity: 0.85; }
</style>
