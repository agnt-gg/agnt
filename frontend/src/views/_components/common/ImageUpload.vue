<template>
  <div class="image-upload">
    <label v-if="label" class="upload-label">{{ label }}</label>

    <div
      class="upload-area"
      :class="{
        'drag-over': isDragging,
        'has-images': hasImages,
        multiple: multiple,
      }"
      @dragover.prevent="handleDragOver"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
      @click="triggerFileInput"
    >
      <!-- Upload Prompt -->
      <div v-if="!hasImages" class="upload-prompt">
        <i class="fas fa-cloud-upload-alt"></i>
        <p class="prompt-text">{{ multiple ? 'Click or drag images here' : 'Click or drag image here' }}</p>
        <p class="prompt-hint">{{ acceptHint }}</p>
      </div>

      <!-- Image Previews -->
      <div v-else class="image-previews" :class="previewSize">
        <div v-for="(image, index) in imageArray" :key="index" class="image-preview-item" @click.stop>
          <img :src="image" :alt="`Preview ${index + 1}`" class="preview-image" />
          <Tooltip text="Remove image" width="auto">
          <button type="button" class="remove-image-btn" @click.stop="removeImage(index)">
            <i class="fas fa-times"></i>
          </button>
          </Tooltip>
        </div>

        <!-- Add More Button (for multiple mode) -->
        <button v-if="multiple && canAddMore" type="button" class="add-more-btn" @click.stop="triggerFileInput">
          <i class="fas fa-plus"></i>
          <span>Add More</span>
        </button>
      </div>
    </div>

    <!-- Hidden File Input -->
    <input ref="fileInput" type="file" :accept="accept" :multiple="multiple" @change="handleFileSelect" class="file-input" />

    <!-- Error Message -->
    <p v-if="errorMessage" class="error-message">
      <i class="fas fa-exclamation-circle"></i>
      {{ errorMessage }}
    </p>

    <!-- Info Message -->
    <p v-if="infoMessage" class="info-message">
      {{ infoMessage }}
    </p>
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ImageUpload',
  components: { Tooltip },
  props: {
    modelValue: {
      type: [String, Array],
      default: null,
    },
    multiple: {
      type: Boolean,
      default: false,
    },
    maxSize: {
      type: Number,
      default: 200, // KB
    },
    maxImages: {
      type: Number,
      default: 5,
    },
    accept: {
      type: String,
      default: 'image/*',
    },
    label: {
      type: String,
      default: '',
    },
    previewSize: {
      type: String,
      default: 'medium',
      validator: (value) => ['small', 'medium', 'large'].includes(value),
    },
    maxDimensions: {
      type: Number,
      default: 512, // Max width/height in pixels
    },
    quality: {
      type: Number,
      default: 0.9, // JPEG quality (0-1)
    },
  },
  emits: ['update:modelValue', 'error'],
  setup(props, { emit }) {
    const fileInput = ref(null);
    const isDragging = ref(false);
    const errorMessage = ref('');
    const infoMessage = ref('');

    const imageArray = computed(() => {
      if (!props.modelValue) return [];
      return Array.isArray(props.modelValue) ? props.modelValue : [props.modelValue];
    });

    const hasImages = computed(() => imageArray.value.length > 0);

    const canAddMore = computed(() => {
      return !props.multiple || imageArray.value.length < props.maxImages;
    });

    const acceptHint = computed(() => {
      const sizeText = `Max ${props.maxSize}KB`;
      const countText = props.multiple ? ` (up to ${props.maxImages} images)` : '';
      return `${sizeText}${countText}`;
    });

    // Clear error after 5 seconds
    watch(errorMessage, (newVal) => {
      if (newVal) {
        setTimeout(() => {
          errorMessage.value = '';
        }, 5000);
      }
    });

    const triggerFileInput = () => {
      fileInput.value?.click();
    };

    const handleDragOver = (e) => {
      isDragging.value = true;
    };

    const handleDragLeave = (e) => {
      isDragging.value = false;
    };

    const handleDrop = (e) => {
      isDragging.value = false;
      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    };

    const handleFileSelect = (e) => {
      const files = Array.from(e.target.files);
      processFiles(files);
      // Reset input so same file can be selected again
      e.target.value = '';
    };

    const processFiles = async (files) => {
      errorMessage.value = '';
      infoMessage.value = '';

      // Filter image files
      const imageFiles = files.filter((file) => file.type.startsWith('image/'));

      if (imageFiles.length === 0) {
        errorMessage.value = 'Please select valid image files';
        emit('error', 'Please select valid image files');
        return;
      }

      // Check if we can add more images
      const currentCount = imageArray.value.length;
      const availableSlots = props.multiple ? props.maxImages - currentCount : 1;

      if (availableSlots <= 0) {
        errorMessage.value = `Maximum ${props.maxImages} images allowed`;
        emit('error', `Maximum ${props.maxImages} images allowed`);
        return;
      }

      const filesToProcess = imageFiles.slice(0, availableSlots);

      if (imageFiles.length > filesToProcess.length) {
        infoMessage.value = `Only processing ${filesToProcess.length} of ${imageFiles.length} images (limit: ${props.maxImages})`;
      }

      // Process each file
      const processedImages = [];
      for (const file of filesToProcess) {
        try {
          const base64 = await processImage(file);
          if (base64) {
            processedImages.push(base64);
          }
        } catch (error) {
          console.error('Error processing image:', error);
          errorMessage.value = error.message;
          emit('error', error.message);
        }
      }

      // Update model value
      if (processedImages.length > 0) {
        if (props.multiple) {
          const newImages = [...imageArray.value, ...processedImages];
          emit('update:modelValue', newImages);
        } else {
          emit('update:modelValue', processedImages[0]);
        }
      }
    };

    const processImage = (file) => {
      return new Promise((resolve, reject) => {
        // Check file size before processing
        if (file.size > props.maxSize * 1024 * 10) {
          // 10x the limit for initial check
          reject(new Error(`Image "${file.name}" is too large. Please use a smaller image.`));
          return;
        }

        const reader = new FileReader();

        reader.onload = (e) => {
          const img = new Image();

          img.onload = () => {
            try {
              // Calculate dimensions maintaining aspect ratio
              let width = img.width;
              let height = img.height;

              if (width > height) {
                if (width > props.maxDimensions) {
                  height = Math.round((height * props.maxDimensions) / width);
                  width = props.maxDimensions;
                }
              } else {
                if (height > props.maxDimensions) {
                  width = Math.round((width * props.maxDimensions) / height);
                  height = props.maxDimensions;
                }
              }

              // Create canvas and draw image
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d', { alpha: true });

              // Enable high-quality image smoothing
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';

              // Draw image
              ctx.drawImage(img, 0, 0, width, height);

              // Try PNG first for transparency support
              let dataUrl = canvas.toDataURL('image/png');
              let base64Length = dataUrl.length - 'data:image/png;base64,'.length;
              let sizeInKB = (base64Length * 3) / 4 / 1024;

              // If PNG is too large, try JPEG
              if (sizeInKB > props.maxSize) {
                dataUrl = canvas.toDataURL('image/jpeg', props.quality);
                base64Length = dataUrl.length - 'data:image/jpeg;base64,'.length;
                sizeInKB = (base64Length * 3) / 4 / 1024;

                // If still too large, reduce quality
                if (sizeInKB > props.maxSize) {
                  let quality = props.quality;
                  while (sizeInKB > props.maxSize && quality > 0.3) {
                    quality -= 0.1;
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                    base64Length = dataUrl.length - 'data:image/jpeg;base64,'.length;
                    sizeInKB = (base64Length * 3) / 4 / 1024;
                  }

                  if (sizeInKB > props.maxSize) {
                    reject(new Error(`Unable to compress "${file.name}" below ${props.maxSize}KB. Please use a smaller image.`));
                    return;
                  }
                }
              }

              resolve(dataUrl);
            } catch (error) {
              reject(new Error(`Error processing "${file.name}": ${error.message}`));
            }
          };

          img.onerror = () => {
            reject(new Error(`Failed to load image "${file.name}"`));
          };

          img.src = e.target.result;
        };

        reader.onerror = () => {
          reject(new Error(`Failed to read file "${file.name}"`));
        };

        reader.readAsDataURL(file);
      });
    };

    const removeImage = (index) => {
      if (props.multiple) {
        const newImages = [...imageArray.value];
        newImages.splice(index, 1);
        emit('update:modelValue', newImages.length > 0 ? newImages : []);
      } else {
        emit('update:modelValue', null);
      }
      errorMessage.value = '';
      infoMessage.value = '';
    };

    return {
      fileInput,
      isDragging,
      errorMessage,
      infoMessage,
      imageArray,
      hasImages,
      canAddMore,
      acceptHint,
      triggerFileInput,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      handleFileSelect,
      removeImage,
    };
  },
};
</script>

<style scoped>
.image-upload {
  width: 100%;
}

.upload-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 8px;
}

.upload-area {
  border: 2px dashed var(--terminal-border-color);
  border-radius: 8px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--color-darker-0);
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-area:hover {
  border-color: rgba(25, 239, 131, 0.5);
  background: rgba(25, 239, 131, 0.05);
}

.upload-area.drag-over {
  border-color: var(--color-green);
  background: rgba(25, 239, 131, 0.1);
  transform: scale(1.02);
}

.upload-area.has-images {
  padding: 12px;
  min-height: auto;
}

.upload-prompt {
  text-align: center;
  color: var(--color-text-muted);
}

.upload-prompt i {
  font-size: 2.5em;
  color: var(--color-green);
  margin-bottom: 12px;
  opacity: 0.7;
}

.prompt-text {
  font-size: 14px;
  font-weight: 500;
  margin: 0 0 4px 0;
  color: var(--color-text);
}

.prompt-hint {
  font-size: 12px;
  margin: 0;
  opacity: 0.7;
}

.image-previews {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  width: 100%;
}

.image-preview-item {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--terminal-border-color);
  background: var(--color-dark-0);
  transition: all 0.2s ease;
}

.image-preview-item:hover {
  border-color: rgba(25, 239, 131, 0.5);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.preview-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Preview sizes */
.image-previews.small .image-preview-item {
  width: 60px;
  height: 60px;
}

.image-previews.medium .image-preview-item {
  width: 100px;
  height: 100px;
}

.image-previews.large .image-preview-item {
  width: 150px;
  height: 150px;
}

.remove-image-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.9);
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s ease;
  font-size: 12px;
}

.image-preview-item:hover .remove-image-btn {
  opacity: 1;
}

.remove-image-btn:hover {
  background: rgba(239, 68, 68, 1);
  transform: scale(1.1);
}

.add-more-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 2px dashed var(--terminal-border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--color-green);
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 12px;
  font-weight: 600;
}

.image-previews.small .add-more-btn {
  width: 60px;
  height: 60px;
}

.image-previews.medium .add-more-btn {
  width: 100px;
  height: 100px;
}

.image-previews.large .add-more-btn {
  width: 150px;
  height: 150px;
}

.add-more-btn:hover {
  border-color: var(--color-green);
  background: rgba(25, 239, 131, 0.1);
}

.add-more-btn i {
  font-size: 1.5em;
}

.file-input {
  display: none;
}

.error-message {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-red);
}

.error-message i {
  font-size: 14px;
}

.info-message {
  margin-top: 8px;
  font-size: 12px;
  color: var(--color-text-muted);
  font-style: italic;
}
</style>
