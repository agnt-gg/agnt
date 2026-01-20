/**
 * WidgetBase.js
 *
 * Base mixin for all preview widgets (MediaPreview, HtmlPreview, etc.)
 * Provides common functionality for drag & drop, file processing, and memory management
 */

export default {
  props: {
    nodeId: {
      type: String,
      required: true,
    },
    isTinyMode: {
      type: Boolean,
      default: false,
    },
    allowDragDrop: {
      type: Boolean,
      default: true,
    },
    output: {
      type: Object,
      default: null,
    },
  },
  data() {
    return {
      isDragHover: false,
      isProcessingFile: false,
      dragCounter: 0,
      localObjectUrl: null,
      cleanupTimer: null,
    };
  },
  methods: {
    // ==================== Drag & Drop Handlers ====================

    handleDragEnter(e) {
      if (!this.allowDragDrop) return;

      e.preventDefault();
      e.stopPropagation();
      this.dragCounter++;

      if (this.dragCounter === 1) {
        this.isDragHover = true;
      }
    },

    handleDragOver(e) {
      if (!this.allowDragDrop) return;

      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    },

    handleDragLeave(e) {
      if (!this.allowDragDrop) return;

      e.preventDefault();
      e.stopPropagation();
      this.dragCounter--;

      if (this.dragCounter === 0) {
        this.isDragHover = false;
      }
    },

    async handleDrop(e) {
      if (!this.allowDragDrop) return;

      e.preventDefault();
      e.stopPropagation();

      // Reset drag state
      this.isDragHover = false;
      this.dragCounter = 0;

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const file = files[0];

      // Validate file (child component should implement validateFile)
      if (!this.validateFile(file)) {
        this.showError(`Invalid file type: ${file.type || 'unknown'}`);
        return;
      }

      // Validate file size
      if (!this.validateFileSize(file)) {
        return;
      }

      try {
        this.isProcessingFile = true;
        await this.processFile(file);
      } catch (error) {
        console.error('❌ Error processing dropped file:', error);
        this.showError('Failed to process file. Please try again.');
      } finally {
        this.isProcessingFile = false;
      }
    },

    // ==================== File Validation ====================

    validateFileSize(file, maxSize = 10 * 1024 * 1024) {
      if (file.size > maxSize) {
        this.showError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum size is ${(maxSize / 1024 / 1024).toFixed(0)}MB.`);
        return false;
      }
      return true;
    },

    // Child components should override these methods
    validateFile(file) {
      console.warn('validateFile not implemented in child component');
      return true;
    },

    async processFile(file) {
      console.warn('processFile not implemented in child component');
    },

    // ==================== Memory Management ====================

    scheduleCleanup() {
      // Clear existing cleanup timer
      if (this.cleanupTimer) {
        clearTimeout(this.cleanupTimer);
      }

      // Schedule cleanup for 5 minutes from now
      this.cleanupTimer = setTimeout(() => {
        this.performCleanup();
      }, 5 * 60 * 1000); // 5 minutes
    },

    performCleanup() {
      if (this.localObjectUrl) {
        URL.revokeObjectURL(this.localObjectUrl);
        this.localObjectUrl = null;
      }

      // Clean up unused IndexedDB entries
      this.cleanupIndexedDB();
    },

    async cleanupIndexedDB() {
      try {
        const db = await this.openMediaDB();
        const transaction = db.transaction(['media'], 'readonly');
        const store = transaction.objectStore('media');

        const allKeys = await new Promise((resolve, reject) => {
          const request = store.getAllKeys();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

        // Clean up entries older than 1 hour that aren't referenced
        const cutoffTime = Date.now() - 60 * 60 * 1000; // 1 hour ago
        let cleanedCount = 0;

        for (const key of allKeys) {
          const item = await new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });

          if (item && item.timestamp < cutoffTime) {
            // Delete old entry
            const deleteTransaction = db.transaction(['media'], 'readwrite');
            const deleteStore = deleteTransaction.objectStore('media');
            await new Promise((resolve, reject) => {
              const request = deleteStore.delete(key);
              request.onerror = () => reject(request.error);
              request.onsuccess = () => resolve();
            });
            cleanedCount++;
          }
        }

        db.close();
      } catch (error) {
        console.warn('Error cleaning up IndexedDB:', error);
      }
    },

    async cleanupOldContentForNode() {
      try {
        const db = await this.openMediaDB();
        const transaction = db.transaction(['media'], 'readwrite');
        const store = transaction.objectStore('media');

        // Get all keys to find entries for this node
        const allKeys = await new Promise((resolve, reject) => {
          const request = store.getAllKeys();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

        // Find and delete entries that belong to this node
        const nodePrefix = `media_node_${this.nodeId}_param_`;
        const keysToDelete = allKeys.filter((key) => key.startsWith(nodePrefix));

        // Delete each old entry
        for (const key of keysToDelete) {
          await new Promise((resolve, reject) => {
            const deleteRequest = store.delete(key);
            deleteRequest.onerror = () => reject(deleteRequest.error);
            deleteRequest.onsuccess = () => resolve();
          });
        }

        db.close();
      } catch (error) {
        console.error(`❌ Error cleaning up old content for node ${this.nodeId}:`, error);
      }
    },

    // ==================== IndexedDB Helpers ====================

    async openMediaDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('WorkflowMediaDB', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('media')) {
            db.createObjectStore('media', { keyPath: 'id' });
          }
        };
      });
    },

    async getMediaFromIndexedDB(mediaId) {
      try {
        const db = await this.openMediaDB();
        const transaction = db.transaction(['media'], 'readonly');
        const store = transaction.objectStore('media');

        const result = await new Promise((resolve, reject) => {
          const request = store.get(mediaId);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });

        db.close();

        if (result && result.blob) {
          return URL.createObjectURL(result.blob);
        }
        return null;
      } catch (error) {
        console.error('Error retrieving media from IndexedDB:', error);
        return null;
      }
    },

    async loadContentFromIndexedDB(idbReference) {
      const mediaId = idbReference.replace('idb://', '');

      const blobUrl = await this.getMediaFromIndexedDB(mediaId);
      if (blobUrl) {
        this.localObjectUrl = blobUrl;
        this.scheduleCleanup();
        this.$forceUpdate();
      }
    },

    // ==================== File Conversion Helpers ====================

    fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = (error) => reject(error);
      });
    },

    fileToText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsText(file);
        reader.onload = () => {
          resolve(reader.result);
        };
        reader.onerror = (error) => reject(error);
      });
    },

    // ==================== Notification Helpers ====================

    showError(message) {
      console.warn('Widget error:', message);
      this.$emit('show-notification', {
        type: 'error',
        message: message,
      });
    },

    showSuccess(message) {
      this.$emit('show-notification', {
        type: 'success',
        message: message,
      });
    },

    showInfo(message) {
      this.$emit('show-notification', {
        type: 'info',
        message: message,
      });
    },

    // ==================== Content Update Helpers ====================

    updateContent(updates) {
      this.$emit('update:content', {
        nodeId: this.nodeId,
        parameters: updates,
      });
    },
  },
  emits: ['show-notification', 'update:content', 'content-loaded', 'content-error'],
  beforeUnmount() {
    // Clean up timers and blob URLs when component is destroyed
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.localObjectUrl) {
      URL.revokeObjectURL(this.localObjectUrl);
      this.localObjectUrl = null;
    }
  },
};
