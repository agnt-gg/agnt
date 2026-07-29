<template>
  <!-- Teleported to <body>: rendered in place it lives inside .controls-panel
       (position: relative; z-index: 3), which caps this overlay's z-index of
       1000 at 3 and lets center-column content paint over it. -->
  <Teleport to="body">
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

        <!-- Images (Optional) -->
        <div class="form-group">
          <label class="form-label">Images (Optional)</label>

          <div v-if="images.length" class="image-thumbs">
            <div v-for="(image, index) in images" :key="index" class="image-thumb">
              <img :src="image" :alt="`Review image ${index + 1}`" />
              <button type="button" class="thumb-remove" v-tooltip="'Remove image'" @click="removeImage(index)">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>

          <div
            v-if="images.length < 5"
            class="image-dropzone"
            :class="{ 'is-dragging': isDragging, 'is-busy': isProcessingImages }"
            role="button"
            tabindex="0"
            @click="openFilePicker"
            @keydown.enter.prevent="openFilePicker"
            @keydown.space.prevent="openFilePicker"
            @dragenter.prevent="isDragging = true"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="onDragLeave"
            @drop.prevent="handleDrop"
          >
            <template v-if="isProcessingImages">
              <i class="fas fa-spinner fa-spin"></i>
              <span class="dz-title">Processing…</span>
            </template>
            <template v-else>
              <i class="fas fa-image"></i>
              <span class="dz-title">{{ isDragging ? 'Drop to attach' : 'Drag images here' }}</span>
              <span class="dz-sub">or <u>browse</u> · paste with {{ pasteHint }}</span>
            </template>
          </div>

          <!-- kept out of the tab order: the dropzone above is the labelled control -->
          <input
            ref="imageInput"
            type="file"
            accept="image/*"
            multiple
            tabindex="-1"
            class="file-input"
            @change="handleFileSelect"
          />

          <div class="help-text">{{ images.length }}/5 attached · PNG, JPG or GIF, up to 10MB each</div>
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
  </Teleport>
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
      isDragging: false,
      isProcessingImages: false,
    };
  },
  computed: {
    isEditing() {
      return !!this.existingReview;
    },
    isValid() {
      return this.rating > 0 && this.reviewText.trim().length > 0;
    },
    pasteHint() {
      return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V';
    },
  },
  mounted() {
    // Screenshots are the common case for a review image, and a screenshot is
    // usually already on the clipboard — so paste is a first-class path here.
    window.addEventListener('paste', this.handlePaste);
  },
  beforeUnmount() {
    window.removeEventListener('paste', this.handlePaste);
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
    openFilePicker() {
      if (this.isProcessingImages) return;
      this.$refs.imageInput.click();
    },
    onDragLeave(event) {
      // dragleave also fires when crossing onto a child element, so only clear the
      // state when the pointer has actually left the dropzone itself
      if (!event.currentTarget.contains(event.relatedTarget)) this.isDragging = false;
    },
    handleDrop(event) {
      this.isDragging = false;
      this.addFiles(event.dataTransfer && event.dataTransfer.files);
    },
    handleFileSelect(event) {
      this.addFiles(event.target.files);
      event.target.value = ''; // so re-picking the same file still fires @change
    },
    handlePaste(event) {
      if (!this.isOpen || this.images.length >= 5) return;
      const items = (event.clipboardData && event.clipboardData.items) || [];
      const files = [...items].filter((i) => i.kind === 'file' && i.type.match(/image.*/)).map((i) => i.getAsFile());
      if (files.length) {
        event.preventDefault();
        this.addFiles(files);
      }
    },
    dataUrlKB(dataUrl) {
      return ((dataUrl.length - (dataUrl.indexOf(',') + 1)) * 3) / 4 / 1024;
    },
    // Same shape as the avatar uploader in AgentForge: read -> draw to canvas at a
    // bounded size -> data URI. Reviews are posted as data URIs because that is
    // already how the marketplace stores images (preview_image is an inline
    // 'data:image/jpeg;base64,...' string), so this needs no new upload endpoint.
    compressImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
        reader.onload = (e) => {
          const img = new window.Image();
          img.onerror = () => reject(new Error(`"${file.name}" is not a readable image.`));
          img.onload = () => {
            // Far larger than an avatar — these are usually screenshots and detail
            // matters — but still bounded so five of them stay a sane payload.
            const MAX_SIZE = 1400;
            let { width, height } = img;
            if (width > height) {
              if (width > MAX_SIZE) {
                height = Math.round((height * MAX_SIZE) / width);
                width = MAX_SIZE;
              }
            } else if (height > MAX_SIZE) {
              width = Math.round((width * MAX_SIZE) / height);
              height = MAX_SIZE;
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // PNG when it is small enough (screenshots of UI stay crisp), JPEG
            // otherwise — stepping quality down rather than sending a huge payload.
            let dataUrl = canvas.toDataURL('image/png');
            if (this.dataUrlKB(dataUrl) > 200) dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            if (this.dataUrlKB(dataUrl) > 400) dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            resolve(dataUrl);
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      });
    },
    async addFiles(fileList) {
      const dropped = Array.from(fileList || []);
      if (!dropped.length) return;

      this.error = null;
      const images = dropped.filter((f) => f && f.type && f.type.match(/image.*/));
      if (!images.length) {
        this.error = 'Only image files can be attached.';
        return;
      }

      const room = 5 - this.images.length;
      if (room <= 0) {
        this.error = 'You can attach up to 5 images.';
        return;
      }
      const accepted = images.slice(0, room);

      this.isProcessingImages = true;
      const skipped = [];
      try {
        for (const file of accepted) {
          if (file.size > 10 * 1024 * 1024) {
            skipped.push(`"${file.name}" is larger than 10MB`);
            continue;
          }
          // sequential on purpose: decoding several large images at once spikes memory
          // eslint-disable-next-line no-await-in-loop
          const dataUrl = await this.compressImage(file);
          this.images.push(dataUrl);
        }
      } catch (err) {
        skipped.push(err.message || 'one image could not be processed');
      } finally {
        this.isProcessingImages = false;
      }

      if (images.length > room) skipped.push(`only ${room} more image${room === 1 ? '' : 's'} would fit (5 maximum)`);
      if (dropped.length > images.length) skipped.push('non-image files were ignored');
      if (skipped.length) this.error = `Skipped: ${skipped.join('; ')}.`;
    },
    removeImage(index) {
      this.images.splice(index, 1);
      this.error = null;
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
  background: rgba(var(--green-rgb), 0.05);
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
  background: rgba(var(--green-rgb), 0.1);
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
  border-color: rgba(var(--green-rgb), 0.5);
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

/* hidden native input — the dropzone is the visible, labelled control */
.file-input {
  display: none;
}

.image-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 18px 16px;
  border: 1px dashed var(--terminal-border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  text-align: center;
  transition: all 0.2s ease;
}

.image-dropzone:hover,
.image-dropzone:focus-visible {
  background: rgba(var(--green-rgb), 0.05);
  border-color: rgba(var(--green-rgb), 0.3);
  color: var(--color-text);
}

.image-dropzone.is-dragging {
  background: rgba(var(--green-rgb), 0.1);
  border-color: var(--color-green);
  border-style: solid;
  color: var(--color-text);
}

.image-dropzone.is-busy {
  cursor: progress;
}

.image-dropzone i {
  font-size: 18px;
  margin-bottom: 2px;
}

.dz-title {
  font-size: 13px;
  font-weight: 600;
}

.dz-sub {
  font-size: 11px;
  opacity: 0.75;
}

.image-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.image-thumb {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
}

.image-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-remove {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  /* fixed dark chip: it sits on the user's image, not on a theme surface */
  background: rgba(7, 7, 16, 0.72);
  color: #fff;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s ease;
}

.thumb-remove:hover {
  background: rgba(239, 68, 68, 0.95);
}

.help-text {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 6px;
}

.error-message {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--color-red);
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
  background: rgba(var(--green-rgb), 0.05);
  border-color: rgba(var(--green-rgb), 0.3);
}

.btn-primary {
  background: var(--color-green);
  color: var(--color-navy);
}

.btn-primary:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
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
