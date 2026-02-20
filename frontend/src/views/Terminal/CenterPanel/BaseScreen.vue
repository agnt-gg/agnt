<template>
  <div
    class="terminal-content"
    :class="{ 'is-resizing': isResizing, 'panel-active': isMobile && isPanelOpen }"
    ref="terminalContentRef"
    tabindex="-1"
  >
    <!-- Global Banners - Rate Limit Banner first (more urgent) -->
    <RateLimitBanner />
    <!-- <PromoBanner /> -->

    <div class="three-panel-container">
      <!-- Left Panel -->
      <LeftPanel
        v-if="!hidePanels && showLeftPanel"
        class="left-panel-component"
        :class="{ collapsed: leftPanelCollapsed }"
        ref="leftPanel"
        :active-panel="computedLeftPanel"
        :active-screen="screenId"
        :panel-props="leftPanelProps"
        :style="!isMobile ? { width: leftPanelCollapsed ? '16px' : `${actualLeftPanelWidth}px` } : {}"
        @panel-action="handleLeftPanelAction"
        @click="leftPanelCollapsed && toggleLeftPanelCollapsed()"
      />

      <!-- Left Resize Handle -->
      <div
        v-if="!isMobile && !hidePanels && showLeftPanel"
        class="resize-handle left-resize-handle"
        :class="{ 'switch-mode': isLeftSwitchMode }"
        @mousedown="startLeftResize"
        @touchstart="startLeftResize"
      >
        <div class="resize-handle-indicator"></div>
      </div>

      <!-- Main content area -->
      <div
        class="main-panel"
        ref="mainPanelRef"
        :class="{ 'centered-content': hidePanels }"
        :style="!isMobile && !hidePanels ? { width: `${mainContentWidth}px` } : {}"
      >
        <div class="mobile-panel-toggle" v-if="isMobile" @click="togglePanel">
          <span class="hamburger-bar"></span>
          <span class="hamburger-bar"></span>
          <span class="hamburger-bar"></span>
        </div>
        <div class="scrollable-content">
          <slot :terminal-lines="terminalLines"></slot>
        </div>
        <!-- Input line container -->
        <div class="input-container" :class="{ 'input-disabled': isInputDisabled }" v-if="showInputLine">
          <!-- Scrollable content area for file chips -->
          <div class="input-scrollable-area">
            <!-- File preview chips -->
            <div v-if="selectedFiles.length > 0" class="file-preview-chips">
              <div v-for="(file, index) in selectedFiles" :key="index" class="file-chip">
                <span class="file-icon">📎</span>
                <span class="file-name">{{ file.name }}</span>
                <Tooltip text="Remove file" width="auto">
                <button @click="removeFile(index)" class="file-remove-btn">
                  <i class="fas fa-times"></i>
                </button>
                </Tooltip>
              </div>
            </div>
          </div>

          <!-- Input line with textarea and buttons on same row -->
          <div class="terminal-line input-line" :class="{ 'is-expanded': isTextareaExpanded }">
            <span v-if="showPrompt" class="prompt">> </span>
            <textarea
              ref="textareaRef"
              class="chat-input-textarea"
              v-model="currentUserInput"
              placeholder="Type a message or command..."
              rows="1"
              :disabled="isInputDisabled"
              @input="autoResizeTextarea"
              @keydown.enter.exact.prevent="triggerSubmit"
              @paste="handlePaste"
            ></textarea>
            <input
              ref="fileInputRef"
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.csv,.md,.json,.js,.py,.html,.css,.jpg,.jpeg,.png,.gif,.webp"
              @change="handleFileSelect"
              style="display: none"
            />
            <Tooltip text="Attach files" width="auto">
            <button v-if="!isStreaming" @click="triggerFileInput" :disabled="isInputDisabled" class="chat-attach-button">
              <i class="fas fa-paperclip"></i>
            </button>
            </Tooltip>
            <Tooltip text="AI Provider Settings" width="auto">
            <button
              v-if="!isStreaming"
              ref="providerSelectorButtonRef"
              @click="toggleProviderSelector"
              :disabled="isInputDisabled"
              class="chat-provider-button"
            >
              <i class="fas fa-robot"></i>
            </button>
            </Tooltip>
            <Tooltip :text="isListening ? 'Stop recording' : 'Start voice input'" width="auto">
            <button
              v-if="isSupported && !isStreaming"
              @click="toggleListening"
              :disabled="isInputDisabled"
              class="chat-mic-button"
              :class="{ 'is-listening': isListening }"
            >
              <i :class="isListening ? 'fas fa-stop' : 'fas fa-microphone'"></i>
            </button>
            </Tooltip>
            <template v-if="!isStreaming">
              <Tooltip text="Send message" width="auto">
                <button
                  @click="triggerSubmit"
                  :disabled="!currentUserInput.trim() || isInputDisabled"
                  class="chat-send-button"
                >
                  <i class="fas fa-paper-plane"></i>
                </button>
              </Tooltip>
            </template>
            <template v-else>
              <Tooltip text="Stop generating" width="auto">
                <button @click="stopStreaming" class="chat-stop-button">
                  <i class="fas fa-stop"></i>
                </button>
              </Tooltip>
            </template>
          </div>
        </div>
      </div>

      <!-- Right Resize Handle -->
      <div
        v-if="!isMobile && !hidePanels && showRightPanel"
        class="resize-handle right-resize-handle"
        :class="{ 'switch-mode': isRightSwitchMode }"
        @mousedown="startRightResize"
        @touchstart="startRightResize"
      >
        <div class="resize-handle-indicator"></div>
      </div>

      <!-- Right Panel -->
      <RightPanel
        v-if="!hidePanels && showRightPanel"
        class="right-panel-component"
        :class="{ collapsed: rightPanelCollapsed }"
        ref="rightPanel"
        :active-panel="computedRightPanel"
        :panel-props="panelProps"
        :style="!isMobile ? { width: rightPanelCollapsed ? '16px' : `${rightPanelWidth}px` } : {}"
        @panel-action="handlePanelAction"
        @click="rightPanelCollapsed && toggleRightPanelCollapsed()"
      />
    </div>

    <!-- Tutorial -->
    <PopupTutorial
      v-if="tutorialConfig"
      :config="tutorialConfig"
      :startTutorial="startTutorial"
      :tutorialId="screenId"
      @close="onTutorialClose"
      @navigate="handleTutorialNavigate"
    />

    <!-- Provider Selector Dropdown -->
    <Teleport to="body">
      <ChatProviderSelector
        v-if="isProviderSelectorOpen"
        :isOpen="isProviderSelectorOpen"
        :style="providerSelectorStyle"
        @close="closeProviderSelector"
      />
    </Teleport>
  </div>
</template>

<script>
import { ref, onMounted, nextTick, computed, watch, toRefs, defineExpose, onUnmounted, inject } from 'vue';
import { useStore } from 'vuex';
import LeftPanel from '../LeftPanel/LeftPanel.vue';
import RightPanel from '../RightPanel/RightPanel.vue';
import PopupTutorial from '@/views/_components/utility/PopupTutorial.vue';
import ChatProviderSelector from './screens/Chat/components/ChatProviderSelector.vue';
// import PromoBanner from '@/views/_components/common/PromoBanner.vue';
import RateLimitBanner from '@/views/_components/common/RateLimitBanner.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useSpeechRecognition } from '@/composables/useSpeechRecognition';

export default {
  name: 'BaseScreen',
  components: { LeftPanel, RightPanel, PopupTutorial, ChatProviderSelector, RateLimitBanner, Tooltip },
  props: {
    activeRightPanel: {
      type: [String, null],
      required: false,
      default: null,
    },
    activeLeftPanel: {
      type: [String, null],
      required: false,
      default: null,
    },
    panelProps: {
      type: Object,
      default: () => ({}),
    },
    leftPanelProps: {
      type: Object,
      default: () => ({}),
    },
    screenId: {
      type: String,
      required: true,
    },
    // Optional prop to control if the input line should be shown at all
    showInput: {
      type: Boolean,
      default: true,
    },
    // Optional prop to disable input initially (e.g., during streaming)
    disableInputInitially: {
      type: Boolean,
      default: false,
    },
    // Optional prop for tutorial configuration hook
    useTutorialHook: {
      type: Function,
      default: null,
    },
    // Allow passing terminal lines from parent if managed there
    terminalLines: {
      type: Array,
      default: () => [],
    },
    // Optional prop to hide panels (left navigation and right panel)
    hidePanels: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['screen-change', 'panel-action', 'submit-input', 'base-mounted'],
  setup(props, { emit, expose }) {
    const store = useStore(); // Keep store access if needed for base actions
    const { screenId, showInput, disableInputInitially, useTutorialHook, terminalLines } = toRefs(props);

    // --- Refs ---
    const terminalContentRef = ref(null);
    const mainPanelRef = ref(null);
    const textareaRef = ref(null);
    const rightPanel = ref(null);
    const leftPanel = ref(null);
    const fileInputRef = ref(null);

    // --- Mobile & Panel State ---
    const isMobile = inject('isMobile');
    const isPanelOpen = ref(false);

    // --- Speech Recognition ---
    const { isListening, isSupported, transcript, error: speechError, toggleListening } = useSpeechRecognition();

    // --- Input State ---
    const currentUserInput = ref('');
    const isInputDisabled = ref(disableInputInitially.value);
    const showPrompt = ref(!disableInputInitially.value);
    const selectedFiles = ref([]);
    const isTextareaExpanded = ref(false);

    // --- Provider Selector State ---
    const isProviderSelectorOpen = ref(false);
    const providerSelectorButtonRef = ref(null);
    const providerSelectorStyle = ref({});

    // --- Streaming State ---
    const isStreaming = computed(() => store.state.chat.isStreaming);

    // --- 3-Panel System State ---
    const actualLeftPanelWidth = ref(store.getters['theme/actualLeftPanelWidth'] || 384);
    const mainContentWidth = ref(store.getters['theme/mainContentWidth'] || 0);
    const rightPanelWidth = ref(store.getters['theme/rightPanelWidth'] || 384);
    const showLeftPanel = ref(store.getters['theme/showLeftPanel']);
    const showRightPanel = ref(store.getters['theme/showRightPanel']);
    const leftPanelCollapsed = ref(store.getters['theme/leftPanelCollapsed']);
    const rightPanelCollapsed = ref(store.getters['theme/rightPanelCollapsed']);

    // Track if user manually set panel widths (vs auto-adjusted)
    // If the stored width matches a "minimum" value (200, 280), it was likely auto-shrunk
    const isLeftPanelUserSized = ref(
      localStorage.getItem('leftPanelUserSized') === 'true' || (actualLeftPanelWidth.value !== 200 && actualLeftPanelWidth.value !== 280)
    );
    const isRightPanelUserSized = ref(
      localStorage.getItem('rightPanelUserSized') === 'true' || (rightPanelWidth.value !== 200 && rightPanelWidth.value !== 280)
    );

    // --- Dual Resize System State ---
    const isResizing = ref(false);
    const currentResizeHandle = ref(null); // 'left' or 'right'
    const isLeftSwitchMode = ref(false);
    const isRightSwitchMode = ref(false);
    const switchThreshold = 80;

    // Responsive minimum widths - smaller for screens like MacBook Air (1200px)
    const minLeftPanelWidth = 280;
    const minRightPanelWidth = 280;
    const minMainWidth = 480;

    // --- Computed ---
    // Controls visibility based on prop AND disabled state
    const showInputLine = computed(() => showInput.value && !isInputDisabled.value);

    // --- Methods ---
    const scrollToBottom = async () => {
      await nextTick();
      if (mainPanelRef.value) {
        mainPanelRef.value.scrollTop = mainPanelRef.value.scrollHeight;
      }
    };

    const focusInput = async () => {
      // Only handle input focus if showInput is true
      if (!props.showInput || isInputDisabled.value) return;

      await nextTick();
      textareaRef.value?.focus();
    };

    const handleContainerClick = (event) => {
      // Don't steal focus if the user is selecting text.
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        return;
      }

      const isFormElement = event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'SELECT';
      if (!isFormElement) {
        focusInput();
      }
    };

    const triggerSubmit = () => {
      if (isInputDisabled.value || !showInput.value) return;
      const input = currentUserInput.value.trim();
      // Don't clear or emit if input is empty and no files
      if (!input && selectedFiles.value.length === 0) return;

      emit('submit-input', input, selectedFiles.value);
      // Let the parent component clear the input if submission is successful
      // currentUserInput.value = ""; // Consider moving clear to parent handler
      scrollToBottom(); // Scroll after potential line add from parent
      focusInput(); // Refocus after submit
    };

    const handlePanelAction = async (action, payload) => {
      if (action === 'close-panel') {
        isPanelOpen.value = false;
        return;
      }
      emit('panel-action', action, payload);
    };

    const handleNavigation = (targetScreenId) => {
      emit('screen-change', targetScreenId);
    };

    // Allow parent to control input state
    const setInputDisabled = (disabled) => {
      isInputDisabled.value = disabled;
      showPrompt.value = !disabled;
      if (!disabled) {
        nextTick(focusInput);
      }
    };

    const clearInput = () => {
      currentUserInput.value = '';
      selectedFiles.value = [];
      nextTick(autoResizeTextarea);
    };

    const triggerFileInput = () => {
      if (fileInputRef.value) {
        fileInputRef.value.click();
      }
    };

    const handleFileSelect = (event) => {
      const files = Array.from(event.target.files || []);
      selectedFiles.value = [...selectedFiles.value, ...files];
      // Reset input so same file can be selected again
      if (fileInputRef.value) {
        fileInputRef.value.value = '';
      }
    };

    const removeFile = (index) => {
      selectedFiles.value.splice(index, 1);
    };

    const toggleProviderSelector = () => {
      isProviderSelectorOpen.value = !isProviderSelectorOpen.value;

      if (isProviderSelectorOpen.value && providerSelectorButtonRef.value) {
        // Calculate position for the dropdown
        nextTick(() => {
          const buttonRect = providerSelectorButtonRef.value.getBoundingClientRect();
          providerSelectorStyle.value = {
            top: `${buttonRect.top - 420}px`, // Position above the button
            left: `${buttonRect.left}px`,
          };
        });
      }
    };

    const closeProviderSelector = () => {
      isProviderSelectorOpen.value = false;
    };

    const handlePaste = async (event) => {
      // Check if clipboard contains files
      const items = event.clipboardData?.items;
      if (!items) return;

      const imageFiles = [];

      // Iterate through clipboard items
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Check if item is an image
        if (item.type.startsWith('image/')) {
          // Prevent default paste behavior for images
          event.preventDefault();

          // Get the file from the clipboard item
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }

      // Add pasted images to selectedFiles
      if (imageFiles.length > 0) {
        selectedFiles.value = [...selectedFiles.value, ...imageFiles];
        console.log(`Pasted ${imageFiles.length} image(s)`);
      }
    };

    const autoResizeTextarea = () => {
      const el = textareaRef.value;
      if (el) {
        el.style.height = 'auto';
        const newHeight = Math.min(el.scrollHeight, 150);
        el.style.height = `${newHeight}px`;

        // Track if textarea is expanded (more than single line ~24px)
        isTextareaExpanded.value = newHeight > 30;
      }
    };

    const togglePanel = () => {
      isPanelOpen.value = !isPanelOpen.value;
    };

    const stopStreaming = () => {
      store.dispatch('chat/stopStreamingConversation');
      // Re-enable input after stopping
      setInputDisabled(false);
      focusInput();
    };

    const toggleLeftPanelCollapsed = () => {
      const newCollapsed = !leftPanelCollapsed.value;

      // When expanding, set width to responsive default
      if (!newCollapsed) {
        const responsiveDefault = getResponsiveDefaultPanelWidth();
        actualLeftPanelWidth.value = responsiveDefault;
        store.dispatch('theme/setActualLeftPanelWidth', responsiveDefault);
        calculateMainContentWidth();
      }

      store.dispatch('theme/setLeftPanelCollapsed', newCollapsed);
      leftPanelCollapsed.value = newCollapsed;
    };

    const toggleRightPanelCollapsed = () => {
      const newCollapsed = !rightPanelCollapsed.value;

      // When expanding, set width to responsive default
      if (!newCollapsed) {
        const responsiveDefault = getResponsiveDefaultPanelWidth();
        rightPanelWidth.value = responsiveDefault;
        store.dispatch('theme/setThreePanelWidths', {
          actualLeftWidth: actualLeftPanelWidth.value,
          mainWidth: mainContentWidth.value,
          rightWidth: responsiveDefault,
        });
        calculateMainContentWidth();
      }

      store.dispatch('theme/setRightPanelCollapsed', newCollapsed);
      rightPanelCollapsed.value = newCollapsed;
    };

    // Update the triggerPanelMethod to call the method directly on the right panel
    const triggerPanelMethod = (methodName, ...args) => {
      // Call the method directly on the right panel component if it exists
      if (rightPanel.value && rightPanel.value.activePanelComponentRef && rightPanel.value.activePanelComponentRef[methodName]) {
        rightPanel.value.activePanelComponentRef[methodName](...args);
      }
    };

    // --- Tutorial ---
    const tutorial = useTutorialHook?.value
      ? useTutorialHook.value()
      : {
          tutorialConfig: ref(null),
          startTutorial: ref(false),
          onTutorialClose: () => {},
        };

    // --- Left Panel Action Handler ---
    const handleLeftPanelAction = (action, payload) => {
      if (action === 'close-left-panel') {
        store.dispatch('theme/setShowLeftPanel', false);
        return;
      }
      if (action === 'navigate') {
        handleNavigation(payload);
        return;
      }
      emit('panel-action', action, payload);
    };

    // --- 3-Panel Resize Methods ---
    const startLeftResize = (event) => {
      isResizing.value = true;
      currentResizeHandle.value = 'left';
      document.addEventListener('mousemove', handleLeftResize);
      document.addEventListener('mouseup', stopLeftResize);
      document.addEventListener('touchmove', handleLeftResize);
      document.addEventListener('touchend', stopLeftResize);

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      event.preventDefault();
    };

    const handleLeftResize = (event) => {
      if (!isResizing.value || currentResizeHandle.value !== 'left' || !terminalContentRef.value) return;

      const containerRect = terminalContentRef.value.getBoundingClientRect();
      const clientX = event.clientX || (event.touches && event.touches[0]?.clientX);
      if (!clientX) return;

      const mouseX = clientX - containerRect.left;

      // Check for hide/show threshold based on current collapsed state
      if (leftPanelCollapsed.value) {
        // When collapsed, drag RIGHT (inward) to expand
        isLeftSwitchMode.value = mouseX > switchThreshold;
      } else {
        // When expanded, drag LEFT (outward) to collapse
        isLeftSwitchMode.value = mouseX < switchThreshold;
      }

      if (!isLeftSwitchMode.value) {
        // Normal resize - adjust left panel width
        const newLeftWidth = Math.max(
          minLeftPanelWidth,
          Math.min(mouseX, containerRect.width - minMainWidth - (showRightPanel.value ? rightPanelWidth.value + 8 : 0) - 8)
        );
        actualLeftPanelWidth.value = newLeftWidth;

        // Recalculate main content width
        calculateMainContentWidth();

        // Save to store
        store.dispatch('theme/setActualLeftPanelWidth', newLeftWidth);
      }
    };

    const stopLeftResize = () => {
      if (isLeftSwitchMode.value) {
        // Toggle left panel collapsed state instead of hiding
        const newCollapsed = !leftPanelCollapsed.value;

        // When expanding via drag, set width to responsive default
        if (!newCollapsed) {
          const responsiveDefault = getResponsiveDefaultPanelWidth();
          actualLeftPanelWidth.value = responsiveDefault;
          store.dispatch('theme/setActualLeftPanelWidth', responsiveDefault);
          calculateMainContentWidth();
        }

        store.dispatch('theme/setLeftPanelCollapsed', newCollapsed);
        leftPanelCollapsed.value = newCollapsed;
      } else {
        // User manually resized the panel - mark it as user-sized
        isLeftPanelUserSized.value = true;
        localStorage.setItem('leftPanelUserSized', 'true');
      }

      isResizing.value = false;
      currentResizeHandle.value = null;
      isLeftSwitchMode.value = false;
      document.removeEventListener('mousemove', handleLeftResize);
      document.removeEventListener('mouseup', stopLeftResize);
      document.removeEventListener('touchmove', handleLeftResize);
      document.removeEventListener('touchend', stopLeftResize);

      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    const startRightResize = (event) => {
      isResizing.value = true;
      currentResizeHandle.value = 'right';
      document.addEventListener('mousemove', handleRightResize);
      document.addEventListener('mouseup', stopRightResize);
      document.addEventListener('touchmove', handleRightResize);
      document.addEventListener('touchend', stopRightResize);

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      event.preventDefault();
    };

    const handleRightResize = (event) => {
      if (!isResizing.value || currentResizeHandle.value !== 'right' || !terminalContentRef.value) return;

      const containerRect = terminalContentRef.value.getBoundingClientRect();
      const clientX = event.clientX || (event.touches && event.touches[0]?.clientX);
      if (!clientX) return;

      const mouseX = clientX - containerRect.left;
      const containerWidth = containerRect.width;

      // Check for hide/show threshold based on current collapsed state
      if (rightPanelCollapsed.value) {
        // When collapsed, drag LEFT (inward) to expand
        isRightSwitchMode.value = mouseX < containerWidth - switchThreshold;
      } else {
        // When expanded, drag RIGHT (outward) to collapse
        isRightSwitchMode.value = mouseX > containerWidth - switchThreshold;
      }

      if (!isRightSwitchMode.value) {
        // Normal resize - adjust right panel width
        const newRightWidth = Math.max(
          minRightPanelWidth,
          Math.min(containerWidth - mouseX, containerWidth - minMainWidth - (showLeftPanel.value ? actualLeftPanelWidth.value + 8 : 0) - 8)
        );
        rightPanelWidth.value = newRightWidth;

        // Recalculate main content width
        calculateMainContentWidth();

        // Save to store
        store.dispatch('theme/setThreePanelWidths', {
          actualLeftWidth: actualLeftPanelWidth.value,
          mainWidth: mainContentWidth.value,
          rightWidth: rightPanelWidth.value,
        });
      }
    };

    const stopRightResize = () => {
      if (isRightSwitchMode.value) {
        // Toggle right panel collapsed state instead of hiding
        const newCollapsed = !rightPanelCollapsed.value;

        // When expanding via drag, set width to responsive default
        if (!newCollapsed) {
          const responsiveDefault = getResponsiveDefaultPanelWidth();
          rightPanelWidth.value = responsiveDefault;
          store.dispatch('theme/setThreePanelWidths', {
            actualLeftWidth: actualLeftPanelWidth.value,
            mainWidth: mainContentWidth.value,
            rightWidth: responsiveDefault,
          });
          calculateMainContentWidth();
        }

        store.dispatch('theme/setRightPanelCollapsed', newCollapsed);
        rightPanelCollapsed.value = newCollapsed;
      } else {
        // User manually resized the panel - mark it as user-sized
        isRightPanelUserSized.value = true;
        localStorage.setItem('rightPanelUserSized', 'true');
      }

      isResizing.value = false;
      currentResizeHandle.value = null;
      isRightSwitchMode.value = false;
      document.removeEventListener('mousemove', handleRightResize);
      document.removeEventListener('mouseup', stopRightResize);
      document.removeEventListener('touchmove', handleRightResize);
      document.removeEventListener('touchend', stopRightResize);

      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    const calculateMainContentWidth = () => {
      if (!terminalContentRef.value) return;

      const containerWidth = terminalContentRef.value.clientWidth;
      let usedWidth = 0;

      if (showLeftPanel.value) {
        usedWidth += actualLeftPanelWidth.value + 8; // 8px for handle
      }
      if (showRightPanel.value) {
        usedWidth += rightPanelWidth.value + 8; // 8px for handle
      }

      mainContentWidth.value = Math.max(minMainWidth, containerWidth - usedWidth);
      store.dispatch('theme/setMainContentWidth', mainContentWidth.value);
    };

    // Get responsive default panel width based on screen size
    const getResponsiveDefaultPanelWidth = () => {
      const screenWidth = window.innerWidth;

      // Scale down only when necessary, keep 384px as the target for larger screens
      if (screenWidth >= 1920) {
        return 384; // Full size for large screens (1920px+)
      } else if (screenWidth >= 1600) {
        return 384; // Still full size for medium-large screens
      } else if (screenWidth >= 1280) {
        // Scale proportionally: ~22% of screen width, minimum 280px
        return Math.max(280, Math.floor(screenWidth * 0.22));
      } else if (screenWidth >= 1024) {
        // Scale proportionally: ~20% of screen width, minimum 200px
        return Math.max(200, Math.floor(screenWidth * 0.2));
      } else {
        // Very small screens: use minimum before collapse
        return 200;
      }
    };

    const initializePanelWidths = () => {
      if (terminalContentRef.value) {
        const screenWidth = window.innerWidth;

        // Calculate maximum safe panel width (leaving room for main content)
        const maxPanelWidth = Math.floor((screenWidth - minMainWidth - 16) / 2);

        // Get the responsive default for this screen size
        const responsiveDefault = getResponsiveDefaultPanelWidth();

        // Left Panel
        if (actualLeftPanelWidth.value > maxPanelWidth) {
          // Panel is too large for current screen - shrink it (auto-adjustment)
          actualLeftPanelWidth.value = Math.max(minLeftPanelWidth, maxPanelWidth);
          isLeftPanelUserSized.value = false;
          localStorage.setItem('leftPanelUserSized', 'false');
          store.dispatch('theme/setActualLeftPanelWidth', actualLeftPanelWidth.value);
        } else if (!isLeftPanelUserSized.value && actualLeftPanelWidth.value < responsiveDefault && responsiveDefault <= maxPanelWidth) {
          // Panel was auto-shrunk before, screen is now larger - expand to responsive default
          actualLeftPanelWidth.value = responsiveDefault;
          store.dispatch('theme/setActualLeftPanelWidth', actualLeftPanelWidth.value);
        }
        // If user manually sized the panel, preserve their preference

        // Right Panel
        if (rightPanelWidth.value > maxPanelWidth) {
          // Panel is too large for current screen - shrink it (auto-adjustment)
          rightPanelWidth.value = Math.max(minRightPanelWidth, maxPanelWidth);
          isRightPanelUserSized.value = false;
          localStorage.setItem('rightPanelUserSized', 'false');
          store.dispatch('theme/setThreePanelWidths', {
            actualLeftWidth: actualLeftPanelWidth.value,
            mainWidth: mainContentWidth.value,
            rightWidth: rightPanelWidth.value,
          });
        } else if (!isRightPanelUserSized.value && rightPanelWidth.value < responsiveDefault && responsiveDefault <= maxPanelWidth) {
          // Panel was auto-shrunk before, screen is now larger - expand to responsive default
          rightPanelWidth.value = responsiveDefault;
          store.dispatch('theme/setThreePanelWidths', {
            actualLeftWidth: actualLeftPanelWidth.value,
            mainWidth: mainContentWidth.value,
            rightWidth: rightPanelWidth.value,
          });
        }
        // If user manually sized the panel, preserve their preference

        calculateMainContentWidth();
      }
    };

    // --- Window Resize Handler ---
    const handleWindowResize = () => {
      initializePanelWidths();
    };

    // --- Lifecycle ---
    onMounted(async () => {
      await nextTick();
      initializePanelWidths();
      window.addEventListener('resize', handleWindowResize);
      terminalContentRef.value?.addEventListener('click', handleContainerClick);
      // Only focus input if showInput is true
      if (props.showInput) {
        focusInput();
      }
      // scrollToBottom(); // Call scrollToBottom after terminalLines might have rendered
      emit('base-mounted');

      if (tutorial.tutorialConfig.value) {
        setTimeout(() => {
          tutorial.startTutorial.value = true;
        }, 1500);
      }
      // Ensure scroll to bottom after initial lines and slot content are mounted
      await nextTick();
      scrollToBottom();
    });

    onUnmounted(() => {
      // Clean up any ongoing resize
      if (isResizing.value) {
        if (currentResizeHandle.value === 'left') {
          stopLeftResize();
        } else if (currentResizeHandle.value === 'right') {
          stopRightResize();
        }
      }
      window.removeEventListener('resize', handleWindowResize);
      if (terminalContentRef.value) {
        terminalContentRef.value.removeEventListener('click', handleContainerClick);
      }
    });

    // Watch terminal lines prop if parent manages it
    watch(
      terminalLines,
      async () => {
        await nextTick();
        scrollToBottom();
      },
      { deep: true }
    );

    watch(currentUserInput, autoResizeTextarea);

    // Watch for speech recognition transcript changes
    watch(transcript, (newTranscript) => {
      if (newTranscript) {
        currentUserInput.value = newTranscript;
        autoResizeTextarea();
      }
    });

    // Watch for speech recognition errors
    watch(speechError, (newError) => {
      if (newError) {
        // Only log actual errors (network errors are handled silently in the composable)
        console.warn('Speech recognition:', newError);
        // You could show a toast notification here if you have a notification system
      }
    });

    // Watch store state changes to make them reactive immediately
    watch(
      () => store.getters['theme/leftPanelCollapsed'],
      (newValue) => {
        leftPanelCollapsed.value = newValue;
        calculateMainContentWidth();
      }
    );

    watch(
      () => store.getters['theme/rightPanelCollapsed'],
      (newValue) => {
        rightPanelCollapsed.value = newValue;
        calculateMainContentWidth();
      }
    );

    watch(
      () => store.getters['theme/showLeftPanel'],
      (newValue) => {
        showLeftPanel.value = newValue;
        calculateMainContentWidth();
      }
    );

    watch(
      () => store.getters['theme/showRightPanel'],
      (newValue) => {
        showRightPanel.value = newValue;
        calculateMainContentWidth();
      }
    );

    // Handle tutorial navigation
    const handleTutorialNavigate = (screenName) => {
      emit('screen-change', screenName);
    };

    // Add computed properties for automatic panel names
    const computedRightPanel = computed(() => {
      // If explicit prop is provided, use it
      if (props.activeRightPanel !== null && props.activeRightPanel !== undefined) {
        return props.activeRightPanel;
      }
      // Otherwise, derive from screenId
      if (props.screenId) {
        return `${props.screenId}Panel`;
      }
      return null;
    });

    const computedLeftPanel = computed(() => {
      // If explicit prop is provided, use it
      if (props.activeLeftPanel !== null && props.activeLeftPanel !== undefined) {
        return props.activeLeftPanel;
      }
      // Otherwise, derive from screenId
      if (props.screenId) {
        // Remove "Screen" suffix if present, then add "Panel"
        const baseName = props.screenId.replace(/Screen$/, '');
        return `${baseName}Panel`;
      }
      return 'ChatPanel'; // Consistent fallback
    });

    // Expose methods for parent component control
    expose({
      setInputDisabled,
      clearInput,
      focusInput,
      scrollToBottom,
      triggerPanelMethod,
    });

    return {
      // Refs
      terminalContentRef,
      mainPanelRef,
      textareaRef,
      rightPanel,
      leftPanel,
      fileInputRef,
      // 3-Panel System State
      actualLeftPanelWidth,
      mainContentWidth,
      rightPanelWidth,
      showLeftPanel,
      showRightPanel,
      // Dual Resize System State
      isResizing,
      currentResizeHandle,
      isLeftSwitchMode,
      isRightSwitchMode,
      // Input State
      currentUserInput,
      isInputDisabled,
      showPrompt,
      isTextareaExpanded,
      // Computed
      showInputLine,
      computedLeftPanel,
      computedRightPanel,
      // Methods
      focusInput,
      triggerSubmit,
      handlePanelAction,
      handleLeftPanelAction,
      handleNavigation,
      handleTutorialNavigate,
      scrollToBottom,
      autoResizeTextarea,
      // 3-Panel Resize Methods
      startLeftResize,
      startRightResize,
      // Tutorial
      ...tutorial,
      // Mobile
      isMobile,
      isPanelOpen,
      togglePanel,
      // Panel collapse methods
      toggleLeftPanelCollapsed,
      toggleRightPanelCollapsed,
      leftPanelCollapsed,
      rightPanelCollapsed,
      // Speech Recognition
      isListening,
      isSupported,
      toggleListening,
      // Streaming
      isStreaming,
      stopStreaming,
      // File handling
      selectedFiles,
      triggerFileInput,
      handleFileSelect,
      removeFile,
      handlePaste,
      // Provider selector
      isProviderSelectorOpen,
      providerSelectorButtonRef,
      providerSelectorStyle,
      toggleProviderSelector,
      closeProviderSelector,
    };
  },
};
</script>

<style scoped>
.terminal-header {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: space-between;
  align-items: center;
}

.mobile-panel-toggle {
  display: none;
}

.terminal-line.text-bright-green.font-bold.text-xl {
  margin-top: -10px;
}

.terminal-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  position: relative;
  z-index: 10;
  outline: none !important;
  border: none !important;
}

.three-panel-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  position: relative;
  width: 100%;
  height: 100%;
  border-bottom-right-radius: var(--terminal-screen-border-radius, 0);
}

.main-panel {
  position: relative;
  top: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  min-width: 320px;
  padding: 16px;
  background: var(--color-darker-0);
  justify-content: flex-start;
  flex-wrap: nowrap;
  align-content: flex-start;
  align-items: center;
}

body:not(.dark) .main-panel {
  background: var(--color-darker-0);
}

body[data-page='terminal-workflow-designer'] .main-panel {
  padding: 0;
}

body[data-page='terminal-tool-forge'] .main-panel {
  padding: 16px 0;
}

body[data-page='terminal-agent-forge'] .main-panel {
  padding: 16px 0;
}

body[data-page='terminal-workflows'] .main-panel {
  padding: 16px 0;
}

body[data-page='terminal-marketplace'] .main-panel {
  padding: 16px 0;
}

body[data-page='terminal-chat'] .main-panel {
  padding: 8px 0 16px;
}

body[data-page='terminal-runs'] .main-panel {
  padding: 16px 0;
}

body[data-page='terminal-tools'] .main-panel {
  padding: 16px 0;
}

body[data-page='terminal-agents'] .main-panel {
  padding: 16px 0;
}

.main-panel.centered-content .scrollable-content {
  align-content: center;
  justify-content: center;
  align-items: center;
}

.scrollable-content {
  position: relative;
  top: 0;
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.input-container {
  position: sticky;
  bottom: 0;
  background: transparent;
  padding: 16px 16px 0 16px;
  border-radius: 0 0 0 16px;
  border-top: 1px solid var(--terminal-border-color);
  margin-top: auto;
  width: calc(100% - 32px);
  display: flex;
  flex-direction: column;
}

.input-scrollable-area {
  max-height: 150px;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--color-duller-navy) transparent;
  display: flex;
  flex-direction: column;
}

.input-scrollable-area::-webkit-scrollbar {
  width: 6px;
}

.input-scrollable-area::-webkit-scrollbar-track {
  background: transparent;
}

.input-scrollable-area::-webkit-scrollbar-thumb {
  background-color: var(--color-duller-navy);
  border-radius: 3px;
}

.input-scrollable-area::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-med-navy);
}

.input-buttons {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 4px 8px 0 8px;
  flex-shrink: 0;
}

.terminal-line {
  margin: 2px 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.input-line {
  display: flex;
  align-items: flex-end;
  width: 100%;
  padding: 0 8px;
}

.prompt {
  color: var(--color-primary);
  margin-right: 0.5rem;
  line-height: 1.5;
  flex-shrink: 0;
  align-self: center;
}

.chat-input-textarea {
  flex: 1;
  background: transparent !important;
  border: none !important;
  border-color: transparent !important;
  outline: none;
  resize: none;
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--font-size-md);
  line-height: 1.5;
  padding: 0;
  max-height: 150px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--color-duller-navy) transparent;
  align-self: center;
}

.chat-input-textarea::-webkit-scrollbar {
  width: 6px;
}

.chat-input-textarea::-webkit-scrollbar-track {
  background: transparent;
}

.chat-input-textarea::-webkit-scrollbar-thumb {
  background-color: var(--color-duller-navy);
  border-radius: 3px;
}

.chat-input-textarea::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-med-navy);
}

.chat-input-textarea::placeholder {
  color: var(--color-med-navy);
}

/* When textarea is expanded, remove center alignment */
.input-line.is-expanded .prompt,
.input-line.is-expanded .chat-input-textarea {
  align-self: flex-end;
}

.chat-mic-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-darker-2);
  color: var(--color-dull-white);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  margin-left: 8px;
  flex-shrink: 0;
}

.chat-mic-button:hover:not(:disabled) {
  background: var(--color-darker-0);
  color: var(--color-primary);
}

.chat-mic-button.is-listening {
  background: var(--color-red);
  color: var(--color-dull-white);
  animation: pulse 1.5s ease-in-out infinite;
}

.chat-mic-button:disabled {
  background: var(--color-darker-1);
  cursor: not-allowed;
  transform: none;
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--red-rgb), 0.7);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(var(--red-rgb), 0);
  }
}

.chat-send-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-green);
  color: var(--color-dark-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  margin-left: 8px;
  flex-shrink: 0;
}

.chat-send-button:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.8);
  transform: scale(1.05);
}

.chat-send-button:disabled {
  background: rgba(var(--green-rgb), 0.3);
  cursor: not-allowed;
  transform: none;
}

.chat-stop-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-red);
  color: var(--color-dull-white);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  margin-left: 8px;
  flex-shrink: 0;
  animation: pulse-stop 2s ease-in-out infinite;
}

.chat-stop-button:hover {
  background: var(--color-red);
  opacity: 0.8;
  transform: scale(1.05);
}

@keyframes pulse-stop {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--red-rgb), 0.7);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(var(--red-rgb), 0);
  }
}

.user-input-area {
  display: none; /* No longer used */
}

.hidden-input {
  display: none; /* No longer used */
}

/* Custom Scrollbar Styles */
.scrollable-content::-webkit-scrollbar {
  width: 8px;
}

.scrollable-content::-webkit-scrollbar-track {
  background: var(--color-dark-navy);
}

.scrollable-content::-webkit-scrollbar-thumb {
  background-color: var(--color-duller-navy);
  border-radius: 4px;
  border: 2px solid var(--color-dark-navy);
}

.scrollable-content {
  display: flex;
  flex: 1;
  overflow-y: auto;
  padding: 0;
  /* padding-right: 8px; */
  gap: 16px;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  scrollbar-width: thin !important;
  /* scrollbar-color: var(--color-green) var(--color-dark-navy); */
  scrollbar-color: var(--color-duller-navy) transparent;
}

.main-panel.centered-content .scrollable-content {
  align-content: center;
  justify-content: center;
  align-items: center;
}

/* *::-webkit-scrollbar {
  width: 0;
  height: 0;
}

*::-webkit-scrollbar-track {
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.3) !important;
}

*::-webkit-scrollbar-thumb {
  background-color: rgb(255, 255, 255, 0.1) !important;
  outline: 1px solid rgb(255, 255, 255, 0.25) !important;
} */

.resize-handle {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  z-index: 2;
  transition: background-color 0.2s ease;
}

.resize-handle:hover {
  background: rgba(var(--primary-rgb), 0.1);
}

.resize-handle-indicator {
  width: 2px;
  height: 30px;
  background: var(--color-duller-navy);
  border-radius: 1px;
  transition: all 0.2s ease;
}

.resize-handle:hover .resize-handle-indicator {
  background: var(--color-med-navy);
  box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.4);
  height: 50px;
}

.resize-handle:active .resize-handle-indicator {
  background: var(--color-primary);
  box-shadow: 0 0 12px rgba(var(--primary-rgb), 0.6);
}

/* Switch mode styles */
.resize-handle.switch-mode {
  background: rgba(var(--yellow-rgb), 0.2);
  cursor: ew-resize;
}

.resize-handle.switch-mode .resize-handle-indicator {
  background: rgba(var(--yellow-rgb), 0.8);
  box-shadow: 0 0 10px rgba(var(--yellow-rgb), 0.6);
  height: 60px;
  width: 4px;
}

.resize-handle.switch-mode .resize-handle-indicator::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 0;
  height: 0;
  border-left: 6px solid rgba(var(--yellow-rgb), 0.9);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
}

.resize-handle.switch-mode .resize-handle-indicator::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(180deg);
  width: 0;
  height: 0;
  border-left: 6px solid rgba(var(--yellow-rgb), 0.9);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  margin-left: -12px;
}

.terminal-content.is-resizing {
  user-select: none;
  cursor: col-resize;
}

.terminal-content.is-resizing.switch-mode {
  cursor: ew-resize;
}

.terminal-content.is-resizing * {
  pointer-events: none;
}

.terminal-content.is-resizing .resize-handle {
  pointer-events: auto;
}

/* Panel positioning styles */
.panel-positioned-left {
  border-left: none !important;
  border-right: 1px solid var(--terminal-border-color) !important;
}

/* Collapsed panel styles */
.left-panel-component.collapsed,
.right-panel-component.collapsed {
  overflow: hidden;
  transition: width 0.3s ease;
}

.left-panel-component.collapsed {
  min-width: 0px !important;
  max-width: 0px !important;
  padding: 0 !important;
}

.right-panel-component.collapsed {
  min-width: 0px !important;
  max-width: 0px !important;
  padding: 0 !important;
}

/* Hide content when collapsed, but keep some visual indicators */
.left-panel-component.collapsed > *:not(.panel-collapse-indicator),
.right-panel-component.collapsed > *:not(.panel-collapse-indicator) {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

/* Add a visual indicator for collapsed panels */
.left-panel-component.collapsed::before,
.right-panel-component.collapsed::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 2px;
  height: 60px;
  background: var(--color-duller-navy);
  border-radius: 1px;
  z-index: 10;
}

/* Hover effect for collapsed panels */
.left-panel-component.collapsed:hover::before,
.right-panel-component.collapsed:hover::before {
  background: var(--color-med-navy);
  box-shadow: 0 0 8px rgba(var(--primary-rgb), 0.4);
  height: 80px;
  cursor: pointer;
}

/* Compact mode for smaller screens like MacBook Air (1200px-1400px) */
@media (max-width: 1400px) and (min-width: 801px) {
  .main-panel {
    min-width: 280px;
    padding: 12px;
  }

  .scrollable-content {
    padding: 12px;
    gap: 12px;
  }

  .input-container {
    padding: 12px 12px 0 12px;
    width: calc(100% - 24px);
  }

  .left-panel-component,
  .right-panel-component {
    /* Allow panels to shrink more on smaller screens */
    min-width: 240px;
  }
}

/* Extra compact for screens around 1200px (MacBook Air 13") */
@media (max-width: 1280px) and (min-width: 801px) {
  .main-panel {
    min-width: 240px;
    padding: 8px;
  }

  .scrollable-content {
    padding: 8px;
    gap: 10px;
  }

  .input-container {
    padding: 8px 8px 0 8px;
    width: calc(100% - 16px);
  }

  .left-panel-component,
  .right-panel-component {
    min-width: 200px;
  }

  /* Reduce button sizes slightly */
  .chat-mic-button,
  .chat-send-button,
  .chat-stop-button,
  .chat-attach-button,
  .chat-provider-button {
    width: 32px;
    height: 32px;
    margin-left: 6px;
  }
}

@media (max-width: 800px) {
  .main-panel {
    width: 100% !important;
    height: 100%;
    transition: filter 0.3s ease;
  }

  .panel-active .main-panel {
    filter: blur(10px) brightness(0.7);
    pointer-events: none;
  }

  .right-panel-component {
    position: absolute;
    top: 0;
    right: 0;
    width: 100%;
    max-width: 400px;
    height: 100%;
    z-index: 100;
    transform: translateX(100%);
    transition: transform 0.3s ease-in-out;
    border-left: none;
    /* background: var(--color-ultra-dark-navy, #0b0b17); */
    box-shadow: -5px 0 15px rgba(0, 0, 0, 0.3);
  }

  .panel-active .right-panel-component {
    transform: translateX(0);
  }

  .mobile-panel-toggle {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 28px;
    height: 22px;
    position: absolute;
    top: 20px;
    right: 16px;
    z-index: 50;
    cursor: pointer;
  }

  .hamburger-bar {
    width: 100%;
    height: 3px;
    background-color: var(--color-primary);
    border-radius: 2px;
  }
}

/* The custom cursor is no longer needed. */
.cursor {
  display: none;
}

/* All other cursor-related styles can be removed as the textarea handles its own cursor */
@keyframes blink {
  0%,
  50% {
    opacity: 1;
  }
  51%,
  100% {
    opacity: 0;
  }
}

/* Show cursor when terminal content is focused or when hidden input is focused */
.terminal-content:focus-within .cursor {
  opacity: 1;
}

/* Ensure cursor is visible when input is not disabled */
.input-container:not(.input-disabled) .cursor {
  opacity: 1;
}

/* Hide cursor when input is disabled */
.input-container.input-disabled .cursor {
  opacity: 0;
}

.base-screen-lines-output {
  margin-bottom: 16px; /* Add some space between lines and slot content */
  font-family: var(--font-family-mono); /* Typical terminal font */
  color: var(--color-light-med-navy); /* Example color */
}

.base-screen-line {
  white-space: pre-wrap;
  word-break: break-word;
  margin-bottom: 4px; /* Space between lines */
  font-size: 0.85em;
}

/* File Upload Styles */
.file-preview-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 8px 0 8px;
  margin-bottom: 8px;
}

.file-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--color-darker-1);
  border: 1px solid var(--color-dull-navy);
  border-radius: 16px;
  font-size: 0.85em;
  color: var(--color-light-med-navy);
  transition: all 0.2s ease;
}

.file-chip:hover {
  background: var(--color-darker-2);
  border-color: var(--color-duller-navy);
}

.file-icon {
  font-size: 1.1em;
}

.file-name {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-remove-btn {
  background: none;
  border: none;
  color: var(--color-med-navy);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s ease;
}

.file-remove-btn:hover {
  color: var(--color-red);
}

.chat-attach-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-darker-2);
  color: var(--color-light-med-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  margin-left: 8px;
  flex-shrink: 0;
}

.chat-attach-button:hover:not(:disabled) {
  background: var(--color-darker-0);
  color: var(--color-green);
  transform: scale(1.05);
}

.chat-attach-button:disabled {
  background: rgba(127, 129, 147, 0.3);
  cursor: not-allowed;
  transform: none;
}

.chat-provider-button {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--color-darker-2);
  color: var(--color-light-med-navy);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  margin-left: 8px;
  flex-shrink: 0;
}

.chat-provider-button:hover:not(:disabled) {
  background: var(--color-darker-0);
  color: var(--color-blue);
  transform: scale(1.05);
}

.chat-provider-button:disabled {
  background: rgba(127, 129, 147, 0.3);
  cursor: not-allowed;
  transform: none;
}

body[data-page='goals-page'] .scrollable-content {
  overflow-y: hidden !important;
  padding: 0;
}

</style>
