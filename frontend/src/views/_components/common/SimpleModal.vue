<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-overlay">
      <div class="modal-content">
        <h3>{{ title }}</h3>
        <p v-if="message" v-html="formattedMessage" class="modal-message"></p>
        <template v-if="isPrompt">
          <textarea v-if="isTextArea" ref="promptInput" v-model="inputValue" :placeholder="placeholder" @keyup.enter="confirm"></textarea>
          <input v-else :type="inputType" ref="promptInput" v-model="inputValue" :placeholder="placeholder" @keyup.enter="confirm" />
        </template>
        <div class="modal-actions">
          <button type="button" :class="confirmClass" @click="confirm">
            {{ confirmText }}
          </button>
          <!-- Cancel button is always shown by default -->
          <button type="button" v-if="isPrompt || showCancel" :class="cancelClass" @click="cancel">
            {{ cancelText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { resizeTextarea } from '@/views/_components/base/fields.js';

export default {
  name: 'SimpleModal',
  data() {
    return {
      isOpen: false,
      title: '',
      message: '',
      isPrompt: false,
      placeholder: '',
      confirmText: 'OK',
      cancelText: 'Cancel',
      inputValue: '',
      resolvePromise: null,
      // Default to true so modals can always be closed
      showCancel: true,
      // Default classes (empty means no extra styling)
      confirmClass: '',
      cancelClass: '',
      isTextArea: false, // Added: option to use textarea instead of input
      inputType: 'text', // Added: option to set input type (text, password, etc.)
    };
  },
  computed: {
    formattedMessage() {
      if (!this.message) return '';

      // Convert URLs to clickable links that open in new tab
      // Stop URL matching at whitespace or HTML tag delimiters.
      const urlRegex = /(https?:\/\/[^\s<]+)/g;
      return this.message.replace(urlRegex, (match) => {
        // Trim trailing punctuation that commonly sticks to URLs in text.
        const cleanUrl = match.replace(/[)\],.;:!?]+$/g, '');
        const trailing = match.slice(cleanUrl.length);
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${trailing}`;
      });
    },
  },
  methods: {
    confirm() {
      this.isOpen = false;
      if (this.resolvePromise) {
        this.resolvePromise(this.isPrompt ? this.inputValue : true);
      }
    },
    cancel() {
      this.isOpen = false;
      if (this.resolvePromise) {
        this.resolvePromise(null);
      }
    },
    showModal(options = {}) {
      this.title = options.title || '';
      this.message = options.message || '';
      this.isPrompt = options.isPrompt || false;
      this.placeholder = options.placeholder || '';
      this.confirmText = options.confirmText || 'OK';
      this.cancelText = options.cancelText || 'Cancel';
      // Default showCancel is true so modals can always be closed
      this.showCancel = options.showCancel !== undefined ? options.showCancel : true;
      // Allow custom classes for buttons
      this.confirmClass = options.confirmClass || '';
      this.cancelClass = options.cancelClass || '';
      // Prepopulate the input value when provided
      this.inputValue = options.defaultValue || '';
      // Set isTextArea flag if provided
      this.isTextArea = options.isTextArea !== undefined ? options.isTextArea : false;
      // Set input type (text, password, etc.)
      this.inputType = options.inputType || 'text';
      this.isOpen = true;
      return new Promise((resolve) => {
        this.resolvePromise = resolve;
      });
    },
  },
  watch: {
    isOpen(newVal) {
      if (newVal && this.isPrompt) {
        this.$nextTick(() => {
          // Add a delay to prevent Enter key from button triggering input's enter handler
          setTimeout(() => {
            if (this.$refs.promptInput) {
              if (this.isTextArea) {
                resizeTextarea(this.$refs.promptInput);
              }
              this.$refs.promptInput.focus();
            }
          }, 150);
        });
      }
    },
  },
};
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 99999;
}

.modal-content {
  display: flex;
  background-color: white;
  padding: 20px;
  border-radius: 16px;
  max-width: 400px;
  width: 100%;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-start;
  align-items: center;
  text-align: center;
  gap: 16px;
}

.modal-message :deep(a) {
  color: var(--color-blue);
  text-decoration: underline;
  cursor: pointer;
}

.modal-message :deep(a:hover) {
  color: var(--color-green);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
}

button {
  margin-left: 10px;
  border: none;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  border-radius: 8px;
  border: 1px solid var(--color-dull-navy);
  background: transparent;
  color: var(--color-med-navy);
}

input:focus {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

textarea {
  max-height: 240px;
}

.btn-danger {
  /* background-color: var(--color-red); */
  color: var(--color-red) !important;
}

.btn-secondary {
  /* background-color: var(--color-dull-navy); */
  color: var(--color-dull-navy);
}

body.dark .btn-secondary {
  color: var(--color-dull-white);
}

.btn-primary {
  /* background-color: var(--color-green); */
  color: var(--color-green) !important;
}
</style>
