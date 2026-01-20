<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h2>{{ isEditing ? 'Edit Review' : 'Write a Review' }}</h2>
        <button class="close-btn" @click="$emit('close')">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="modal-body">
        <!-- Item Info -->
        <div class="item-info">
          <div class="item-name">{{ item?.title || 'Unknown Item' }}</div>
          <div class="item-meta">
            <span class="verified-badge">
              <i class="fas fa-check-circle"></i>
              Verified Install
            </span>
          </div>
        </div>

        <!-- Star Rating -->
        <div class="form-group">
          <label class="form-label">Rating *</label>
          <div class="star-selector">
            <button
              v-for="star in 5"
              :key="star"
              type="button"
              class="star-btn"
              :class="{ active: star <= rating, hover: star <= hoverRating }"
              @click="rating = star"
              @mouseenter="hoverRating = star"
              @mouseleave="hoverRating = 0"
            >
              <i :class="star <= (hoverRating || rating) ? 'fas fa-star' : 'far fa-star'"></i>
            </button>
            <span class="rating-text">{{ getRatingText(rating) }}</span>
          </div>
        </div>

        <!-- Review Title -->
        <div class="form-group">
          <label class="form-label" for="review-title">Title</label>
          <input id="review-title" v-model="title" type="text" class="form-input" placeholder="Summarize your experience" maxlength="100" />
          <div class="char-count">{{ title.length }}/100</div>
        </div>

        <!-- Review Text -->
        <div class="form-group">
          <label class="form-label" for="review-text">Review *</label>
          <textarea
            id="review-text"
            v-model="reviewText"
            class="form-textarea"
            placeholder="Share your thoughts about this item..."
            rows="6"
            maxlength="2000"
          ></textarea>
          <div class="char-count">{{ reviewText.length }}/2000</div>
        </div>

        <!-- Image URLs (Optional) -->
        <div class="form-group">
          <label class="form-label">Images (Optional)</label>
          <div class="image-inputs">
            <div v-for="(image, index) in images" :key="index" class="image-input-row">
              <input v-model="images[index]" type="url" class="form-input" placeholder="https://example.com/image.jpg" />
              <button type="button" class="remove-btn" @click="removeImage(index)">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <button v-if="images.length < 5" type="button" class="add-image-btn" @click="addImage">
              <i class="fas fa-plus"></i>
              Add Image URL
            </button>
          </div>
          <div class="help-text">Add up to 5 image URLs to showcase your experience</div>
        </div>

        <!-- Error Message -->
        <div v-if="error" class="error-message">
          <i class="fas fa-exclamation-circle"></i>
          {{ error }}
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" @click="$emit('close')" :disabled="isSubmitting">Cancel</button>
        <button class="btn btn-primary" @click="handleSubmit" :disabled="!isValid || isSubmitting">
          <i v-if="isSubmitting" class="fas fa-spinner fa-spin"></i>
          <span>{{ isSubmitting ? 'Submitting...' : isEditing ? 'Update Review' : 'Submit Review' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SubmitReviewModal',
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    item: {
      type: Object,
      default: null,
    },
    existingReview: {
      type: Object,
      default: null,
    },
  },
  emits: ['close', 'submit'],
  data() {
    return {
      rating: 0,
      hoverRating: 0,
      title: '',
      reviewText: '',
      images: [],
      error: null,
      isSubmitting: false,
    };
  },
  computed: {
    isEditing() {
      return !!this.existingReview;
    },
    isValid() {
      return this.rating > 0 && this.reviewText.trim().length > 0;
    },
  },
  watch: {
    isOpen(newVal) {
      if (newVal) {
        this.loadExistingReview();
      } else {
        this.resetForm();
      }
    },
    existingReview() {
      if (this.isOpen) {
        this.loadExistingReview();
      }
    },
  },
  methods: {
    loadExistingReview() {
      if (this.existingReview) {
        this.rating = this.existingReview.rating || 0;
        this.title = this.existingReview.title || '';
        this.reviewText = this.existingReview.review_text || '';
        this.images = this.existingReview.images ? [...this.existingReview.images] : [];
      } else {
        this.resetForm();
      }
    },
    resetForm() {
      this.rating = 0;
      this.hoverRating = 0;
      this.title = '';
      this.reviewText = '';
      this.images = [];
      this.error = null;
      this.isSubmitting = false;
    },
    getRatingText(rating) {
      const texts = {
        1: 'Poor',
        2: 'Fair',
        3: 'Good',
        4: 'Very Good',
        5: 'Excellent',
      };
      return texts[rating] || 'Select a rating';
    },
    addImage() {
      if (this.images.length < 5) {
        this.images.push('');
      }
    },
    removeImage(index) {
      this.images.splice(index, 1);
    },
    async handleSubmit() {
      if (!this.isValid) return;

      this.error = null;
      this.isSubmitting = true;

      try {
        // Filter out empty image URLs
        const validImages = this.images.filter((img) => img.trim().length > 0);

        const reviewData = {
          marketplace_item_id: this.item.marketplace_item_id || this.item.id,
          rating: this.rating,
          title: this.title.trim(),
          review_text: this.reviewText.trim(),
          images: validImages.length > 0 ? validImages : undefined,
        };

        this.$emit('submit', reviewData);
      } catch (error) {
        this.error = error.message || 'Failed to submit review';
        this.isSubmitting = false;
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
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  background: var(--color-navy);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.modal-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.close-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  transition: color 0.2s ease;
}

.close-btn:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.item-info {
  background: rgba(25, 239, 131, 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 20px;
}

.item-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 6px;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.verified-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-green);
  background: rgba(25, 239, 131, 0.1);
  padding: 2px 8px;
  border-radius: 12px;
}

.verified-badge i {
  font-size: 10px;
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 8px;
}

.star-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.star-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-size: 28px;
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 4px;
}

.star-btn:hover,
.star-btn.hover {
  transform: scale(1.1);
}

.star-btn i {
  color: var(--color-text-muted);
}

.star-btn.active i,
.star-btn.hover i {
  color: var(--color-yellow);
}

.rating-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin-left: 8px;
}

.form-input,
.form-textarea {
  width: 100%;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  padding: 10px 12px;
  color: var(--color-text);
  font-size: 13px;
  font-family: inherit;
  transition: border-color 0.2s ease;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: rgba(25, 239, 131, 0.5);
}

.form-textarea {
  resize: vertical;
  min-height: 120px;
}

.char-count {
  text-align: right;
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 4px;
}

.image-inputs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.image-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.image-input-row .form-input {
  flex: 1;
}

.remove-btn {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.remove-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

.add-image-btn {
  background: transparent;
  border: 1px dashed var(--terminal-border-color);
  color: var(--color-text-muted);
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
}

.add-image-btn:hover {
  background: rgba(25, 239, 131, 0.05);
  border-color: rgba(25, 239, 131, 0.3);
  color: var(--color-text);
}

.help-text {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 6px;
}

.error-message {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #ef4444;
  padding: 12px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px;
  border-top: 1px solid var(--terminal-border-color);
}

.btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(25, 239, 131, 0.05);
  border-color: rgba(25, 239, 131, 0.3);
}

.btn-primary {
  background: var(--color-green);
  color: var(--color-navy);
}

.btn-primary:hover:not(:disabled) {
  background: rgba(25, 239, 131, 0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(25, 239, 131, 0.3);
}

.fa-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
