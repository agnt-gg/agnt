<template>
  <div ref="widgetRef" class="agent-chat-widget" :class="{ open: isOpen }" :style="widgetStyle">
    <div class="chat-header" @mousedown="startDrag">
      <div class="header-content">
        <img src="/src/assets/images/annie-avatar.png" alt="Agent Avatar" class="agent-avatar" />
        <span>Annie Chat</span>
      </div>
      <span class="toggle-icon" @click.stop="toggleChat">{{ isOpen ? "▼" : "▲" }}</span>
    </div>
    <div v-if="isOpen" class="chat-body">
      <div class="messages">
        <!-- Messages will go here -->
        <p class="agent-message">Hi I'm Annie, your AI assistant. How can I help you today?</p>
      </div>
      <div class="chat-input">
        <input type="text" v-model="message" placeholder="Type your message..." />
        <button @click="sendMessage">Send</button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from "vue";

export default {
  name: "AgentChat",
  setup() {
    const isOpen = ref(false);
    const position = ref({ x: 0, y: 0 });
    const dragging = ref(false);
    const startPos = ref({ x: 0, y: 0 });
    const offset = ref({ x: 0, y: 0 });
    const widgetRef = ref(null);
    const padding = 32;
    const message = ref('');

    const sendMessage = () => {
      console.log(message.value);
      message.value = '';
    };

    const toggleChat = async () => {
      const wasOpen = isOpen.value;
      let currentBottom = 0;

      // If it was open and is about to close, record its bottom edge position
      if (wasOpen && widgetRef.value) {
        currentBottom = position.value.y + widgetRef.value.offsetHeight;
      }

      isOpen.value = !isOpen.value;

      // Wait for DOM update regardless of opening or closing
      await nextTick();

      if (widgetRef.value) {
        const widgetHeight = widgetRef.value.offsetHeight; // Current height (could be open or closed)
        const windowHeight = window.innerHeight;

        // Case 1: Just Opened - Adjust if bottom goes off-screen
        if (!wasOpen) { // isOpen is now true
          const currentY = position.value.y;
          const bottomEdge = currentY + widgetHeight; // Bottom edge with the *newly opened* height
          const maxAllowedBottom = windowHeight - padding;

          if (bottomEdge > maxAllowedBottom) {
            const newY = maxAllowedBottom - widgetHeight;
            position.value.y = Math.max(padding, newY); // Clamp respecting top padding
          }
        }
        // Case 2: Just Closed - Adjust top to keep bottom edge stable
        else { // isOpen is now false
          const newY = currentBottom - widgetHeight; // Calculate new top based on old bottom and *new closed* height
          position.value.y = Math.max(padding, newY); // Clamp respecting top padding
        }
      }
    };

    const startDrag = (event) => {
      // Prevent dragging when clicking the toggle icon itself
      if (event.target.classList.contains('toggle-icon')) {
        return;
      }
      dragging.value = true;
      startPos.value = { x: event.clientX, y: event.clientY };
      offset.value = { x: position.value.x, y: position.value.y }; // Store current position as offset
      window.addEventListener('mousemove', handleDrag);
      window.addEventListener('mouseup', stopDrag);
    };

    const handleDrag = (event) => {
      if (!dragging.value || !widgetRef.value) return;

      const widgetWidth = widgetRef.value.offsetWidth;
      const widgetHeight = widgetRef.value.offsetHeight;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      const dx = event.clientX - startPos.value.x;
      const dy = event.clientY - startPos.value.y;

      let newX = offset.value.x + dx;
      let newY = offset.value.y + dy;

      // Clamp position within viewport boundaries with padding
      newX = Math.max(padding, Math.min(newX, windowWidth - widgetWidth - padding));
      newY = Math.max(padding, Math.min(newY, windowHeight - widgetHeight - padding));

      position.value = {
        x: newX,
        y: newY,
      };
    };

    const stopDrag = () => {
      if (dragging.value) {
        dragging.value = false;
        window.removeEventListener('mousemove', handleDrag);
        window.removeEventListener('mouseup', stopDrag);
      }
    };

    // Set initial position once the component is mounted
    onMounted(() => {
      if (widgetRef.value) {
        const widgetWidth = widgetRef.value.offsetWidth;
        const widgetHeight = widgetRef.value.offsetHeight; // Height when closed
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        position.value = {
          x: windowWidth - widgetWidth - padding,
          y: windowHeight - widgetHeight - padding,
        };
      }
    });

    // Ensure listeners are removed if component is unmounted while dragging
    onBeforeUnmount(() => {
        window.removeEventListener('mousemove', handleDrag);
        window.removeEventListener('mouseup', stopDrag);
    });

    // Calculate the style based on the position state
    const widgetStyle = computed(() => ({
      top: `${position.value.y}px`,
      left: `${position.value.x}px`,
      cursor: dragging.value ? 'grabbing' : 'default', // Change cursor while dragging
    }));

    return {
      isOpen,
      toggleChat,
      widgetStyle,
      startDrag,
      widgetRef,
      message,
      sendMessage,
    };
  },
};
</script>

<style scoped>
.agent-chat-widget {
  position: fixed;
  /* Remove bottom and right positioning */
  /* bottom: 20px; */
  /* right: 20px; */
  width: 400px;
  border: 1px solid var(--color-light-med-navy);
  border-radius: 32px;
  background-color: #fff;
  color: var(--color-duller-navy);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  overflow: hidden;
  user-select: none; /* Prevent text selection during drag */
}

.chat-header {
  padding: 10px 15px;
  background-color: #f1f1f1;
  cursor: grab; /* Indicate draggable header */
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chat-header:active {
    cursor: grabbing; /* Change cursor while dragging */
}

.header-content {
  display: flex;
  align-items: center;
  gap: 16px; /* Spacing between avatar and text */
}

.agent-avatar {
  width: 24px; /* Adjust size as needed */
  height: 24px;
  border-radius: 50%;
  border: 2px solid var(--color-primary); /* Match existing avatar style */
  object-fit: cover;
}

.chat-header span {
  font-weight: bold;
}

.toggle-icon {
  font-size: 1em;
  opacity: 0.5;
  cursor: pointer; /* Make toggle icon separately clickable */
  padding: 5px; /* Add some padding for easier clicking */
}

.toggle-icon:hover {
    opacity: 1;
}

.chat-body {
  display: flex;
  flex-direction: column;
  height: 400px; /* Adjust height as needed */
}

.messages {
  flex-grow: 1;
  padding: 16px;
  overflow-y: auto;
  background-color: #f9f9f9;
  border-top: 1px solid var(--color-light-med-navy);
  display: flex;
  flex-direction: column;
}

.message {
  margin-bottom: 10px;
  padding: 8px 12px;
  border-radius: 16px;
  max-width: 75%;
  word-wrap: break-word;
}

.message p {
  margin: 0;
  line-height: 1.4;
}

.user-message {
  border-radius: 16px 16px 0px 16px;
  padding: 12px;
  background-color: var(--color-blue);
  color: white;
  align-self: flex-end;
}

.agent-message {
  border-radius: 16px 16px 16px 0px;
  padding: 12px;
  background-color: #e5e5ea;
  color: black;
  align-self: flex-start;
  border-bottom-left-radius: 4px;
}

.chat-input {
  display: flex;
  padding: 10px;
  border-top: 1px solid #ccc;
}

.chat-input input {
  flex-grow: 1;
  padding: 8px;
  padding-left: 16px;
  border: 1px solid #ccc;
  border-radius: 32px;
  margin-right: 5px;
}

.chat-input button {
  padding: 8px 15px;
  background-color: var(--color-green);
  color: white;
  border: none;
  border-radius: 32px;
  cursor: pointer;
  transition: opacity 0.3s ease;
}

.chat-input button:hover {
  opacity: 0.5;
}

/* Basic dark mode styles */
body.dark .agent-chat-widget {
  background-color: var(--color-dark-navy);
  border-color: var(--color-dull-navy);
  color: var(--color-white);
}
body.dark .chat-header {
  background-color: var(--color-dark-navy);
  border-bottom-color: var(--color-dull-navy);
}
body.dark .agent-avatar {
  border-color: var(--color-green); /* Optional: Adjust border for dark mode */
}
body.dark .messages {
  background-color: var(--color-bg-dark-navy);
  border-color: var(--color-dull-navy);
}
body.dark .user-message {
  background-color: var(--color-green);
  color: var(--color-white);
}
body.dark .agent-message {
  background-color: var(--color-dull-navy);
  color: var(--color-white);
}
body.dark .chat-input {
  border-top-color: var(--color-dull-navy);
}
body.dark .chat-input input {
  background-color: var(--color-bg-dark-navy);
  border-color: var(--color-dull-navy);
  color: var(--color-white);
}
body.dark .chat-input button {
  background-color: var(--color-green);
}
body.dark .chat-input button:hover {
  opacity: 0.5;
}
</style>
