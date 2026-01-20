<!-- THIS HAS TO BE IN A SCRIPT WITH A SETUP ATTRIBUTE -->
<script setup>
import { useRoute } from 'vue-router';
import { useStore } from 'vuex';
import { computed, ref, onMounted, watch, onBeforeUnmount } from 'vue';
import { useCleanup } from '@/composables/useCleanup';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

const route = useRoute();
const store = useStore();
const cleanup = useCleanup();
const isTyping = ref(true);
const typedText = ref('');
const typingInterval = ref(null); // To track and clear the interval
const animationInProgress = ref(false); // Flag to prevent multiple animations

const systemMessage = computed(() => {
  const messages = store.state.chat.messages;
  return messages.find((msg) => msg.role === 'assistant')?.content || '';
});

const chatMessages = computed(() => store.state.chat.messages);

const modal = ref(null);

// Function to animate typing of system message
const typeSystemMessage = () => {
  if (!systemMessage.value || animationInProgress.value) return;

  // Clear any existing interval
  if (typingInterval.value) {
    clearInterval(typingInterval.value);
  }

  animationInProgress.value = true;
  isTyping.value = true;
  const message = systemMessage.value;
  let index = 0;
  typedText.value = '';

  typingInterval.value = setInterval(() => {
    if (index < message.length) {
      typedText.value += message[index];
      index++;
    } else {
      clearInterval(typingInterval.value);
      typingInterval.value = null;
      isTyping.value = false;
      animationInProgress.value = false;
    }
  }, 10);
};

// Only use the watch to trigger animation, not both watch and onMounted
watch(
  () => systemMessage.value,
  (newValue) => {
    if (newValue && !animationInProgress.value) {
      typeSystemMessage();
    }
  },
  { immediate: true }
);

// Clean up on unmount
onBeforeUnmount(() => {
  if (typingInterval.value) {
    clearInterval(typingInterval.value);
    typingInterval.value = null;
  }
});

onMounted(() => {
  const responseArea = document.getElementById('response-area');
  const linkModalHandler = async (event) => {
    const result = await modal.value.showModal({
      title: 'Open External Link',
      message: `Are you sure you want to open this link?\n${event.detail.href}`,
      confirmText: 'Open',
      cancelText: 'Cancel',
      confirmClass: 'btn-primary',
      cancelClass: 'btn-secondary',
    });

    if (result) {
      window.open(event.detail.href, '_blank', 'noopener,noreferrer');
    }
  };

  cleanup.addEventListener(responseArea, 'open-link-modal', linkModalHandler);
});
</script>

<template>
  <inner-editor-area id="response-area">
    <!-- Content for /chat route -->
    <div v-if="route.path === '/chat'">
      <!-- System message with typing effect -->
      <div
        v-for="(message, index) in chatMessages"
        :key="index"
        :class="[
          message.role === 'assistant' ? 'system-message' : message.role === 'user' ? 'user-message-sent' : 'assistant-message-receive',
          message.role === 'assistant' && !isTyping ? 'typing-done' : '',
        ]"
      >
        <!-- Add avatar for all messages as needed -->
        <template v-if="message.role === 'assistant' && isTyping"> {{ typedText }}<span class="cursor-blink">|</span> </template>
        <template v-else>
          {{ message.content }}
        </template>
      </div>

      <!-- Show placeholder only when no messages -->
      <div v-if="chatMessages.length === 0" id="placeholder-text" class="placeholder-text" spellcheck="false" style="user-select: none">
        <h4 class="placeholder">Send a message from the chat input below.</h4>
      </div>
    </div>

    <!-- Content for /tool-forge route -->
    <div v-else-if="route.path === '/tool-forge'" id="placeholder-text" class="placeholder-text" spellcheck="false" style="user-select: none">
      <h3 class="placeholder">Fill out your template fields and click generate...</h3>
      <hr />
      <h4 class="placeholder">Then your AI generated content will show up here.</h4>
    </div>
  </inner-editor-area>
  <SimpleModal ref="modal" />
</template>

<script>
import { ref } from 'vue';
import { getContentFromQueryParam, addPlaceholderEventListeners } from '../base/response';

export default {
  name: 'SharedResponseArea',
  emits: ['content-loaded'],
  setup(props, { emit }) {
    const isContentLoaded = ref(false);

    return {
      isContentLoaded,
      emit,
    };
  },
  methods: {
    initResponseArea() {
      // CLEAR SELECTION FROM EDITOR AREA IF CLICK AWAY
      const editorArea = document.querySelector('editor-area');
      const mousedownHandler = function (event) {
        const innerEditorArea = editorArea.querySelector('inner-editor-area');
        if (innerEditorArea && !innerEditorArea.contains(event.target)) {
          if (window.getSelection) {
            window.getSelection().removeAllRanges();
          } else if (document.selection) {
            document.selection.empty();
          }
        }
      };

      // Store handler for cleanup
      this._mousedownHandler = mousedownHandler;
      this._editorArea = editorArea;
      editorArea.addEventListener('mousedown', mousedownHandler);
    },
    async loadContent() {
      try {
        await getContentFromQueryParam();
        addPlaceholderEventListeners();
        this.isContentLoaded = true;
        this.$emit('content-loaded');
      } catch (error) {
        console.error('Error loading content:', error);
        // Optionally, you can still emit the event or handle the error differently
        this.$emit('content-loaded');
      }
    },
  },
  mounted() {
    this.initResponseArea();
    this.loadContent();
  },
  beforeUnmount() {
    // Clean up the mousedown listener
    if (this._editorArea && this._mousedownHandler) {
      this._editorArea.removeEventListener('mousedown', this._mousedownHandler);
    }
  },
};
</script>

<style>
/* FIXES THE WEIRD SPACE AT THE START OF THE GENERATED CODE BLOCKS BY SHOWDOWN */
pre code {
  margin-top: 0;
}

body.dark #response-area hr {
  border: none;
  border-bottom: 1px solid var(--color-dull-navy);
}

/* --- Add these styles for clickable links --- */
#response-area .assistant-message-receive a,
#response-area .user-message-sent a,
#response-area .system-message a {
  color: var(--color-pink); /* Use a distinct link color */
  font-weight: 500;
  text-decoration: underline; /* Make it clear it's a link */
  cursor: pointer; /* Show the pointer cursor on hover */
}

#response-area .assistant-message-receive a:hover,
#response-area .user-message-sent a:hover,
#response-area .system-message a:hover {
  opacity: 0.8; /* Optional: visual feedback */
  text-decoration: none; /* Optional: remove underline on hover */
}
/* --- End of added styles --- */

.message-receive {
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
}

.assistant-message-receive {
  position: relative;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 24px;
  width: 100%;
}

.assistant-message-receive:focus {
  outline: none;
  border: none;
}

body[data-page='chat'] .assistant-message-receive {
  width: 100%;
  border-radius: 0 16px 16px 16px;
  gap: 16px;
  align-self: flex-start;
  /* margin-bottom: 32px; */
}

body[data-page='chat'] .assistant-message-receive:last-child {
  margin-bottom: 0px;
}

body[data-page='chat'] .user-message-sent {
  width: fit-content;
  max-width: calc(100% - 48px);
  margin-left: 24px;
  margin-bottom: 64px;
  padding: 16px 24px;
  /* background: var(--color-white); */
  border: 1px solid var(--color-light-navy);
  border-radius: 32px 32px 0 32px;
  gap: 16px;
  align-self: flex-end;
}

body[data-page='chat'] .user-message-sent {
  margin-top: 48px;
}

/* Add system message styling */
body[data-page='chat'] .system-message {
  position: relative;
  width: calc(100% - 64px);
  padding: 12px 16px 12px 64px !important;
  top: 1px;
  /* margin-bottom: 40px; */
  /* background-color: rgba(0, 0, 0, 0.05); */
  /* border-left: 3px solid var(--color-blue-accent, #3366ff); */
  /* border-radius: 4px; */
  /* font-style: italic; */
  /* color: var(--color-text-muted, #666); */
}

body[data-page='chat'].dark .system-message {
  font-weight: 300;
}

body[data-page='chat'] .system-message::before {
  content: '';
  position: absolute;
  left: 0;
  top: 1px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: transparent;
  background-image: url('/src/assets/images/annie-avatar.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border: 2px solid var(--color-pink);
}

/* Add avatar styling */
body[data-page='chat'] .assistant-message-receive {
  position: relative;
  /* padding-left: 64px !important; */
  padding-bottom: 10px;
}

body[data-page='chat'] .assistant-message-receive::before {
  content: '';
  position: absolute;
  left: 0;
  top: -60px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background-color: transparent;
  background-image: url('/src/assets/images/annie-avatar.png'); /* Update this path to your PNG location */
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border: 2px solid var(--color-pink);
}

.assistant-avatar {
  position: absolute;
  left: 0;
  top: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  background-color: var(--color-light-navy, #e0e5ee);
}

.assistant-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.assistant-avatar .avatar-icon {
  width: 100%;
  height: 100%;
  color: var(--color-pink);
}

/* Replace the existing cursor animation styles with this */
.cursor-blink {
  display: inline-block;
  animation: blink 0.7s infinite;
}

@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

/* Remove the previous system-message:after styles */
.system-message:after {
  content: none; /* Override the previous style */
}
</style>
