<template>
  <div class="resources-section">
    <SimpleModal ref="simpleModal" />
    <h4 class="section-title">RESOURCES</h4>

    <div class="resource-links">
      <a href="https://agnt.gg/docs" target="_blank" rel="noopener noreferrer" class="resource-link">
        <i class="fas fa-book"></i>
        <span>Docs</span>
      </a>
      <a href="https://github.com/agnt-gg/agnt" target="_blank" rel="noopener noreferrer" class="resource-link">
        <i class="fab fa-github"></i>
        <span>GitHub</span>
      </a>
      <a href="https://discord.com/invite/nwXJMnHmXP" target="_blank" rel="noopener noreferrer" class="resource-link">
        <i class="fab fa-discord"></i>
        <span>Discord</span>
      </a>
      <button @click="showFeedbackModal = true" class="resource-link resource-button">
        <i class="fas fa-comment-dots"></i>
        <span>Feedback</span>
      </button>
    </div>

    <!-- Feedback Modal -->
    <div v-if="showFeedbackModal" class="modal-overlay" @click.self="showFeedbackModal = false">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Send Feedback</h3>
          <button class="close-btn" @click="showFeedbackModal = false">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <textarea
            v-model="feedbackText"
            placeholder="Share your thoughts, suggestions, or report issues..."
            rows="6"
            class="feedback-textarea"
          ></textarea>

          <div class="image-upload-section">
            <label class="upload-label">
              <i class="fas fa-image"></i>
              <span>{{ uploadedImage ? 'Change Screenshot' : 'Attach Screenshot (Optional)' }}</span>
              <input type="file" accept="image/*" @change="handleImageUpload" class="file-input" />
            </label>

            <div v-if="uploadedImage" class="image-preview">
              <img :src="imagePreview" alt="Screenshot preview" />
              <button @click="removeImage" class="remove-image-btn" type="button">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showFeedbackModal = false">Cancel</button>
          <button class="btn btn-primary" @click="submitFeedback" :disabled="!feedbackText.trim() || isSubmitting">
            {{ isSubmitting ? 'Sending...' : 'Send Feedback' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { API_CONFIG } from '@/tt.config.js';

export default {
  name: 'ResourcesSection',
  components: {
    SimpleModal,
  },
  setup() {
    const store = useStore();
    const showFeedbackModal = ref(false);
    const feedbackText = ref('');
    const isSubmitting = ref(false);
    const uploadedImage = ref(null);
    const imagePreview = ref('');

    const handleImageUpload = (event) => {
      const file = event.target.files[0];
      if (file && file.type.startsWith('image/')) {
        uploadedImage.value = file;
        const reader = new FileReader();
        reader.onload = (e) => {
          imagePreview.value = e.target.result;
        };
        reader.readAsDataURL(file);
      }
    };

    const removeImage = () => {
      uploadedImage.value = null;
      imagePreview.value = '';
    };

    const simpleModal = ref(null);

    const submitFeedback = async () => {
      if (!feedbackText.value.trim()) return;

      isSubmitting.value = true;
      try {
        const token = localStorage.getItem('token');
        const userEmail = store.getters['userAuth/userEmail'] || '';
        const userName = store.getters['userAuth/userName'] || '';

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/email/send-feedback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            feedback: feedbackText.value,
            userEmail,
            userName,
            screenshot: uploadedImage.value ? imagePreview.value : null,
          }),
        });

        const data = await response.json();

        if (data.success) {
          // Success - close modal and reset
          showFeedbackModal.value = false;
          feedbackText.value = '';
          uploadedImage.value = null;
          imagePreview.value = '';

          await simpleModal.value.showModal({
            title: 'Feedback Sent',
            message: '✅ Thank you! Your feedback has been sent successfully.',
            confirmText: 'OK',
            showCancel: false,
          });
        } else {
          throw new Error(data.error || 'Failed to send feedback');
        }
      } catch (error) {
        console.error('Error submitting feedback:', error);
        await simpleModal.value.showModal({
          title: 'Error',
          message: '❌ Error submitting feedback. Please try again.',
          confirmText: 'OK',
          showCancel: false,
        });
      } finally {
        isSubmitting.value = false;
      }
    };

    return {
      simpleModal,
      showFeedbackModal,
      feedbackText,
      isSubmitting,
      uploadedImage,
      imagePreview,
      handleImageUpload,
      removeImage,
      submitFeedback,
    };
  },
};
</script>

<style scoped>
.resources-section {
  margin-top: auto;
  padding-top: 16px;
  flex-shrink: 0;
}

.section-title {
  font-size: 0.75em;
  font-weight: 500;
  color: var(--color-duller-navy);
  letter-spacing: 0.2em;
  margin-bottom: 16px;
  font-family: var(--font-family-primary);
}

/* Resource Links */
.resource-links {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.resource-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  /* background: var(--color-dull-white); */
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: all 0.2s ease;
  font-size: 0.9em;
}

body.dark .resource-link {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

body:not(.dark):not(.rose) button.resource-link.resource-button {
  border: 1px solid var(--color-light-navy);
  color: var(--color-text-muted);
}

.resource-link i {
  color: var(--color-text);
}

.resource-link:hover,
body:not(.dark):not(.rose) button.resource-link.resource-button:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  transform: translateY(-2px);
}

.resource-link i {
  font-size: 1.1em;
}

.resource-button {
  cursor: pointer;
  font-family: inherit;
  width: 100%;
  text-align: left;
  background: transparent;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}

.modal-content {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  max-width: 500px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 20px;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.3em;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 1.5em;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-primary);
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.feedback-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  background: var(--color-dull-white);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.95em;
  resize: vertical;
  min-height: 120px;
}

body.dark .feedback-textarea {
  background: rgba(0, 0, 0, 10%);
}

.feedback-textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px solid var(--terminal-border-color);
  padding-top: 20px;
}

.btn {
  padding: 10px 20px;
  border-radius: 4px;
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  font-family: inherit;
}

.btn-primary {
  background: var(--color-primary);
  color: var(--color-dark-navy);
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.75;
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* Image Upload Styles */
.image-upload-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.upload-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--color-dull-white);
  border: 1px dashed var(--terminal-border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text);
  font-size: 0.9em;
  width: calc(100% - 24px);
}

body.dark .upload-label {
  background: rgba(0, 0, 0, 10%);
}

.upload-label:hover {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.upload-label i {
  color: var(--color-primary);
  font-size: 1.1em;
}

.file-input {
  display: none;
}

.image-preview {
  position: relative;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  overflow: hidden;
}

.image-preview img {
  width: 100%;
  height: auto;
  display: block;
}

.remove-image-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  border: none;
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.remove-image-btn:hover {
  background: rgba(255, 0, 0, 0.8);
  transform: scale(1.1);
}

.remove-image-btn i {
  font-size: 0.9em;
}
</style>
