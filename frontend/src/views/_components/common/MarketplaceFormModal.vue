<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <div class="modal-header">
        <h2>{{ modalTitle }}</h2>
        <button class="close-button" @click="close">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="modal-body">
        <form @submit.prevent="handleSubmit">
          <!-- Title -->
          <div class="form-group">
            <label>Title <span class="required">*</span></label>
            <input v-model="formData.title" type="text" :placeholder="titlePlaceholder" required :maxlength="mode === 'edit' ? 100 : undefined" />
          </div>

          <!-- Description -->
          <div class="form-group">
            <label>Description <span class="required">*</span></label>
            <textarea
              v-model="formData.description"
              :placeholder="descriptionPlaceholder"
              rows="3"
              required
              :maxlength="mode === 'edit' ? 500 : undefined"
            ></textarea>
          </div>

          <!-- Long Description -->
          <!-- <div class="form-group">
            <label>Detailed Description</label>
            <textarea
              v-model="formData.long_description"
              placeholder="Provide detailed information (Markdown supported)"
              rows="6"
              :maxlength="mode === 'edit' ? 2000 : undefined"
            ></textarea>
          </div> -->

          <!-- Category -->
          <div class="form-group">
            <label>Category <span class="required">*</span></label>
            <select v-model="formData.category" required>
              <option value="">Select a category</option>
              <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
            </select>
          </div>

          <!-- Tags -->
          <div class="form-group">
            <label>Tags</label>
            <input v-model="tagsInput" type="text" placeholder="automation, data-processing, etc. (comma-separated)" @blur="parseTags" />
            <div v-if="formData.tags.length > 0" class="tags-display">
              <span v-for="(tag, index) in formData.tags" :key="index" class="tag">
                {{ tag }}
                <i class="fas fa-times" @click="removeTag(index)"></i>
              </span>
            </div>
          </div>

          <!-- Price -->
          <div class="form-group">
            <label>Price (USD)</label>
            <div class="price-input-group" :class="{ disabled: !isProUser }">
              <span class="currency-symbol" :class="{ disabled: !isProUser }">$</span>
              <input
                v-model.number="formData.price"
                type="number"
                min="0"
                max="99999"
                step="0.01"
                placeholder="0.00"
                :disabled="!isProUser"
                @input="enforceMaxPrice"
              />
              <span class="price-hint">Leave as 0 for free</span>
            </div>

            <!-- Pro User Upgrade Prompt -->
            <div v-if="!isProUser" class="pro-upgrade-prompt">
              <i class="fas fa-lock"></i>
              <span>Only Pro users can sell paid assets.</span>
              <button type="button" class="upgrade-link" @click="openBilling">Upgrade to Pro</button>
            </div>

            <div v-if="formData.price > 0" class="revenue-info">
              <div class="revenue-main">
                <i class="fas fa-info-circle"></i>
                <span>{{ getRevenueMainText() }}</span>
              </div>
              <div class="revenue-comparison">{{ getRevenueComparisonText() }}</div>
            </div>
          </div>

          <!-- Stripe Connect Warning -->
          <div v-if="formData.price > 0 && !stripeConnected" class="stripe-warning">
            <i class="fas fa-exclamation-triangle"></i>
            <p>You need to set up Stripe Connect to sell paid {{ itemTypeLabel }}s.</p>
            <button type="button" class="setup-stripe-btn" @click="setupStripe">
              <i class="fas fa-credit-card"></i>
              Set Up Payments
            </button>
          </div>

          <!-- Preview Image -->
          <div v-if="showPreviewImage" class="form-group">
            <ImageUpload v-model="formData.preview_image" label="Preview Image" :multiple="false" :max-size="200" preview-size="large" />
          </div>

          <!-- Demo URL -->
          <!-- <div v-if="showDemoUrl" class="form-group">
            <label>Demo URL</label>
            <input v-model="formData.demo_url" type="url" placeholder="https://example.com/demo" />
          </div> -->

          <!-- Requirements -->
          <div v-if="showRequirements" class="form-group">
            <label>Requirements</label>
            <textarea v-model="formData.requirements" placeholder="e.g., Requires API key, Python 3.8+, etc." rows="2"></textarea>
            <p class="field-hint">List any requirements or dependencies</p>
          </div>

          <!-- Changelog -->
          <!-- <div class="form-group">
            <label>Changelog</label>
            <textarea
              v-model="formData.changelog"
              :placeholder="mode === 'edit' ? 'What\'s new in this version?' : 'Initial release'"
              rows="2"
              :maxlength="mode === 'edit' ? 500 : undefined"
            ></textarea>
          </div> -->

          <!-- Submit -->
          <div class="form-actions">
            <button type="button" class="cancel-btn" @click="close">Cancel</button>
            <button type="submit" class="publish-btn" :disabled="!canSubmit" data-sound="chaChingMoney">
              <i :class="submitIconClass"></i>
              {{ submitButtonText }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <SimpleModal ref="simpleModal" />
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import ImageUpload from '@/views/_components/common/ImageUpload.vue';

export default {
  name: 'MarketplaceFormModal',
  components: {
    SimpleModal,
    ImageUpload,
  },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    mode: {
      type: String,
      required: true,
      validator: (value) => ['publish', 'edit'].includes(value),
    },
    itemType: {
      type: String,
      required: true,
      validator: (value) => ['workflow', 'agent', 'tool', 'plugin', 'marketplace-item'].includes(value),
    },
    item: {
      type: Object,
      default: null,
    },
    categories: {
      type: Array,
      default: () => [],
    },
    stripeConnected: {
      type: Boolean,
      default: false,
    },
    showDemoUrl: {
      type: Boolean,
      default: true,
    },
    showRequirements: {
      type: Boolean,
      default: true,
    },
    showPreviewImage: {
      type: Boolean,
      default: true,
    },
    showScreenshots: {
      type: Boolean,
      default: true,
    },
  },
  emits: ['close', 'submit', 'setup-stripe', 'open-billing'],
  setup(props, { emit }) {
    const store = useStore();
    const formData = ref({
      title: '',
      description: '',
      long_description: '',
      category: '',
      tags: [],
      price: 0,
      preview_image: '',
      changelog: props.mode === 'edit' ? '' : 'Initial release',
      requirements: '',
    });

    const tagsInput = ref('');
    const hasInitialized = ref(false);
    const simpleModal = ref(null);

    const isProUser = computed(() => {
      const planType = store.getters['userAuth/planType'];
      return planType && planType !== 'free';
    });

    const openBilling = () => {
      // Close the modal first
      close();
      // Emit to parent to handle navigation
      emit('open-billing');
    };

    // Computed properties for dynamic text
    const itemTypeLabel = computed(() => {
      if (props.itemType === 'marketplace-item') return 'item';
      return props.itemType;
    });

    const modalTitle = computed(() => {
      if (props.mode === 'edit') {
        return 'Edit Marketplace Listing';
      }
      const label = itemTypeLabel.value.charAt(0).toUpperCase() + itemTypeLabel.value.slice(1);
      return `Publish ${label} to Marketplace`;
    });

    const titlePlaceholder = computed(() => {
      if (props.mode === 'edit') return 'Enter title';
      return `Enter ${itemTypeLabel.value} title`;
    });

    const descriptionPlaceholder = computed(() => {
      if (props.mode === 'edit') return 'Brief description';
      return `Describe what your ${itemTypeLabel.value} does`;
    });

    const submitButtonText = computed(() => {
      return props.mode === 'edit' ? 'Save Changes' : 'Publish to Marketplace';
    });

    const submitIconClass = computed(() => {
      return props.mode === 'edit' ? 'fas fa-save' : 'fas fa-upload';
    });

    const canSubmit = computed(() => {
      const hasRequiredFields = formData.value.title && formData.value.description && formData.value.category;
      const hasValidPayment = formData.value.price === 0 || props.stripeConnected;
      return hasRequiredFields && hasValidPayment;
    });

    // Helper function to get display name for items (converts kebab-case to Title Case)
    const getDisplayName = (item) => {
      // If item has displayName, use it
      if (item.displayName) return item.displayName;
      // If item has title, use it (title is already formatted)
      if (item.title) return item.title;
      // If item has name, convert from kebab-case to Title Case
      if (item.name) {
        return item.name
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
      return '';
    };

    // Pre-fill form when modal opens or item changes
    watch(
      [() => props.isOpen, () => props.item],
      ([isOpen, item]) => {
        if (isOpen && item) {
          // For edit mode, always update. For publish mode, only on first open
          if (props.mode === 'edit' || !hasInitialized.value) {
            // Use display name for title (converts kebab-case to Title Case)
            formData.value.title = getDisplayName(item);
            formData.value.description = item.description || '';
            formData.value.long_description = item.long_description || '';
            formData.value.category = item.category || '';
            formData.value.tags = Array.isArray(item.tags) ? [...item.tags] : [];
            formData.value.price = item.price || 0;

            // For agents, use avatar as default preview image if no preview_image exists
            if (props.itemType === 'agent' && item.avatar && !item.preview_image) {
              formData.value.preview_image = item.avatar;
            } else {
              formData.value.preview_image = item.preview_image || '';
            }

            formData.value.changelog = item.changelog || (props.mode === 'edit' ? '' : 'Initial release');
            // Requirements as simple string
            formData.value.requirements = item.requirements || '';

            // Update tags input
            tagsInput.value = formData.value.tags.join(', ');

            hasInitialized.value = true;
          }
        } else if (!isOpen) {
          hasInitialized.value = false;
        }
      },
      { immediate: true }
    );

    const parseTags = () => {
      if (tagsInput.value.trim()) {
        formData.value.tags = tagsInput.value
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
      }
    };

    const removeTag = (index) => {
      formData.value.tags.splice(index, 1);
      tagsInput.value = formData.value.tags.join(', ');
    };

    const handleSubmit = async () => {
      if (!canSubmit.value) return;

      // Build payload based on mode and item type
      const payload = {
        ...formData.value,
      };

      // Add ID field based on context
      if (props.mode === 'publish') {
        if (props.itemType === 'workflow') {
          payload.workflow_id = props.item?.id;
        } else if (props.itemType === 'agent' || props.itemType === 'tool') {
          payload.asset_id = props.item?.id;
          payload.asset_type = props.itemType;
        } else if (props.itemType === 'plugin') {
          // Plugins use name as the asset ID
          payload.asset_id = props.item?.name || props.item?.id;
          payload.asset_type = 'plugin';
        }
      }

      emit('submit', payload);
    };

    const close = () => {
      emit('close');
    };

    const setupStripe = () => {
      emit('setup-stripe');
    };

    const getRevenueMainText = () => {
      if (formData.value.price <= 0) return '';

      const price = formData.value.price;
      const planType = store.getters['userAuth/planType'] || 'free';

      // Calculate earnings for each buyer tier
      const tiers = {
        enterprise: { fee: 0, earnings: price * 1.0, label: 'Enterprise (0% fee)' },
        business: { fee: 5, earnings: price * 0.95, label: 'Business (5% fee)' },
        personal: { fee: 10, earnings: price * 0.9, label: 'Personal (10% fee)' },
        free: { fee: 20, earnings: price * 0.8, label: 'Free (20% fee)' },
      };

      const userTier = tiers[planType];
      const userEarnings = userTier.earnings.toFixed(2);

      return `As a ${userTier.label} seller, you'll earn $${userEarnings} per sale.`;
    };

    const getRevenueComparisonText = () => {
      if (formData.value.price <= 0) return '';

      const price = formData.value.price;

      // Calculate earnings for each buyer tier
      const tiers = {
        enterprise: { fee: 0, earnings: price * 1.0, label: 'Enterprise (0% fee)' },
        business: { fee: 5, earnings: price * 0.95, label: 'Business (5% fee)' },
        personal: { fee: 10, earnings: price * 0.9, label: 'Personal (10% fee)' },
        free: { fee: 20, earnings: price * 0.8, label: 'Free (20% fee)' },
      };

      // Build comparison text
      const allTiers = Object.entries(tiers)
        .map(([key, tier]) => `${tier.label}: $${tier.earnings.toFixed(2)}`)
        .join(' • ');

      return `All tiers: ${allTiers}`;
    };

    const enforceMaxPrice = (event) => {
      const value = parseFloat(event.target.value);
      if (value > 99999) {
        formData.value.price = 99999;
        // Force update the input value
        event.target.value = 99999;
      }
    };

    return {
      formData,
      tagsInput,
      itemTypeLabel,
      modalTitle,
      titlePlaceholder,
      descriptionPlaceholder,
      submitButtonText,
      submitIconClass,
      canSubmit,
      parseTags,
      removeTag,
      handleSubmit,
      close,
      setupStripe,
      simpleModal,
      isProUser,
      openBilling,
      getRevenueMainText,
      getRevenueComparisonText,
      enforceMaxPrice,
    };
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
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
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

.close-button {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  transition: color 0.2s ease;
}

.close-button:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.form-group {
  width: 100%;
  /* margin-bottom: 20px; */
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin-bottom: 8px;
}

.required {
  color: var(--color-red);
}

.field-hint {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-top: 4px;
  opacity: 0.7;
}

.price-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.price-input-group.disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.currency-symbol {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-green);
}

.currency-symbol.disabled {
  color: var(--color-text-muted);
}

.price-input-group input {
  flex: 1;
}

.price-hint {
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.revenue-info {
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.revenue-main {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-green);
}

.revenue-main i {
  font-size: 14px;
  flex-shrink: 0;
}

.revenue-comparison {
  font-size: 10px;
  color: var(--color-green);
  opacity: 0.7;
  line-height: 1.4;
  padding-left: 22px;
}

.pro-upgrade-prompt {
  margin-top: 8px;
  padding: 10px 12px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text);
}

.pro-upgrade-prompt i {
  color: var(--color-yellow);
}

.upgrade-link {
  background: transparent;
  border: none;
  color: var(--color-yellow);
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  margin-left: auto;
  font-size: 12px;
}

.upgrade-link:hover {
  color: #fff;
}

.stripe-warning {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stripe-warning i {
  font-size: 20px;
  color: var(--color-yellow);
}

.stripe-warning .setup-stripe-btn i {
  color: var(--color-darker-3);
}

.stripe-warning p {
  font-size: 13px;
  color: var(--color-text);
  margin: 0;
}

.setup-stripe-btn {
  padding: 10px 16px;
  background: var(--color-yellow);
  border: 1px solid var(--color-yellow);
  color: var(--color-darker-3);
  font-weight: 600;
  font-size: 13px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.setup-stripe-btn:hover {
  background: rgba(245, 158, 11, 0.9);
  transform: translateY(-1px);
}

.tags-display {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(var(--green-rgb), 0.15);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 12px;
  font-size: 11px;
  color: var(--color-green);
}

.tag i {
  cursor: pointer;
  font-size: 9px;
  opacity: 0.7;
  transition: opacity 0.2s ease;
}

.tag i:hover {
  opacity: 1;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--terminal-border-color);
}

.cancel-btn,
.publish-btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cancel-btn {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}

.cancel-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--color-text);
  color: var(--color-text);
}

.publish-btn {
  background: var(--color-green);
  border: none;
  color: var(--color-navy);
}

.publish-btn:hover:not(:disabled) {
  background: rgba(var(--green-rgb), 0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
}

.publish-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
