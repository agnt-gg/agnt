<template>
  <div class="marketplace-right-panel">
    <div v-if="!selectedWorkflow && !showItemSelection" class="no-selection">
      <p>Select an asset to view details.</p>
      <BaseButton variant="primary" class="publish-new-button" @click="showItemSelection = true">
        <i class="fas fa-plus"></i>
        Publish New Item
      </BaseButton>
    </div>

    <!-- Item Selection Screen -->
    <div v-if="showItemSelection && !selectedItemType" class="item-selection">
      <div class="selection-header">
        <h2>What would you like to publish?</h2>
        <button class="close-button" @click="closeItemSelection">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="item-type-grid">
        <div class="item-type-card" data-sound="buttonClick" @click="selectItemType('agent')">
          <i class="fas fa-robot"></i>
          <h3>Agent</h3>
          <p>Publish an AI agent to the marketplace</p>
        </div>

        <div class="item-type-card" data-sound="buttonClick" @click="selectItemType('workflow')">
          <i class="fas fa-project-diagram"></i>
          <h3>Workflow</h3>
          <p>Publish a workflow to the marketplace</p>
        </div>

        <div class="item-type-card" data-sound="buttonClick" @click="selectItemType('tool')">
          <i class="fas fa-wrench"></i>
          <h3>Tool</h3>
          <p>Publish a custom tool to the marketplace</p>
        </div>

        <div class="item-type-card" data-sound="buttonClick" @click="selectItemType('plugin')">
          <i class="fas fa-puzzle-piece"></i>
          <h3>Plugin</h3>
          <p>Publish a plugin to the marketplace</p>
        </div>
      </div>
    </div>

    <!-- Item List (after type selection) -->
    <div v-else-if="showItemSelection && selectedItemType" class="item-list">
      <div class="list-header">
        <button class="back-button" @click="selectedItemType = null">
          <i class="fas fa-arrow-left"></i>
          Back
        </button>
        <h2>Select {{ selectedItemType }} to publish</h2>
        <button class="close-button" @click="closeItemSelection">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Search Bar -->
      <div class="search-bar">
        <input v-model="itemSearchQuery" type="text" class="search-input" :placeholder="`Search ${selectedItemType}s...`" />
        <i class="fas fa-search search-icon"></i>
      </div>

      <div class="items-grid">
        <div v-for="item in filteredItems" :key="item.id" class="selectable-item-card" data-sound="buttonClick" @click="selectItemToPublish(item)">
          <div class="item-header">
            <div class="item-avatar" v-if="selectedItemType === 'agent'">
              <img v-if="item.avatar" :src="item.avatar" :alt="item.name" />
              <div v-else class="avatar-placeholder">{{ (item.name || 'A').charAt(0).toUpperCase() }}</div>
            </div>
            <div class="item-icon-wrapper" v-else-if="selectedItemType === 'tool'">
              <SvgIcon v-if="item.icon" :name="item.icon" class="item-svg-icon" />
              <div v-else class="item-icon-placeholder">
                {{ (item.title || item.type || 'T').charAt(0).toUpperCase() }}
              </div>
            </div>
            <div class="item-icon-wrapper plugin" v-else-if="selectedItemType === 'plugin'">
              <SvgIcon v-if="item.icon" :name="item.icon" class="item-svg-icon" />
              <i v-else class="fas fa-puzzle-piece"></i>
            </div>
            <div class="item-icon-wrapper" v-else-if="selectedItemType === 'workflow'">
              <i class="fas fa-project-diagram"></i>
            </div>
            <span class="item-name">{{ getItemDisplayName(item) }}</span>
          </div>
          <p class="item-description">{{ item.description || 'No description' }}</p>
        </div>
        <div v-if="filteredItems.length === 0" class="no-items-found">
          <i class="fas fa-search"></i>
          <p>No {{ selectedItemType }}s found matching "{{ itemSearchQuery }}"</p>
        </div>
      </div>
    </div>

    <div v-else-if="selectedWorkflow" class="workflow-details">
      <!-- Header -->
      <div class="workflow-header">
        <h2 class="workflow-title">{{ selectedWorkflow.title }}</h2>
        <div class="header-actions">
          <Tooltip text="Close Panel" width="auto">
            <button class="close-btn" @click="closeWorkflowDetails">
              <i class="fas fa-times"></i>
            </button>
          </Tooltip>
        </div>
      </div>
      <div class="workflow-meta-section">
        <div class="workflow-meta">
          <span class="publisher">
            <i class="fas fa-user"></i>
            {{ selectedWorkflow.publisher_pseudonym || 'Anonymous Publisher' }}
          </span>
          <span v-if="selectedWorkflow.price > 0" class="price">${{ selectedWorkflow.price.toFixed(2) }}</span>
          <span v-else class="price free">FREE</span>
        </div>
      </div>

      <!-- Rating and Stats -->
      <div class="stats-bar">
        <div class="stat">
          <i class="fas fa-star"></i>
          <span class="stat-value">{{ selectedWorkflow.rating ? selectedWorkflow.rating.toFixed(1) : '0.0' }}</span>
          <span class="stat-label">({{ selectedWorkflow.rating_count || 0 }} reviews)</span>
        </div>
        <div class="stat">
          <i class="fas fa-download"></i>
          <span class="stat-value">{{ selectedWorkflow.downloads || 0 }}</span>
          <span class="stat-label">downloads</span>
        </div>
      </div>

      <!-- Description -->
      <div class="section">
        <h3 class="section-title">Description</h3>
        <p class="description">{{ selectedWorkflow.description || selectedWorkflow.tagline || 'No description available' }}</p>
      </div>

      <!-- Preview Image -->
      <div class="section" v-if="selectedWorkflow.preview_image">
        <h3 class="section-title">Preview</h3>
        <div class="preview-image-container">
          <img :src="selectedWorkflow.preview_image" :alt="selectedWorkflow.title" class="preview-image" />
        </div>
      </div>

      <!-- Category -->
      <div class="section" v-if="selectedWorkflow.category">
        <h3 class="section-title">Category</h3>
        <div class="category-badge">{{ selectedWorkflow.category }}</div>
      </div>

      <!-- Tags -->
      <div class="section" v-if="selectedWorkflow.tags && selectedWorkflow.tags.length > 0">
        <h3 class="section-title">Tags</h3>
        <div class="tags-container">
          <span v-for="tag in selectedWorkflow.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>

      <!-- Version Info -->
      <div class="section" v-if="selectedWorkflow.version">
        <h3 class="section-title">Version</h3>
        <div class="version-info">
          <span class="version">v{{ selectedWorkflow.version }}</span>
          <span v-if="selectedWorkflow.updated_at" class="updated">Updated {{ formatDate(selectedWorkflow.updated_at) }}</span>
        </div>
      </div>

      <!-- Requirements -->
      <div class="section" v-if="selectedWorkflow.requirements && selectedWorkflow.requirements.trim()">
        <h3 class="section-title">Requirements</h3>
        <p class="requirements-text">{{ selectedWorkflow.requirements }}</p>
      </div>

      <!-- Owner Actions (Edit/Unpublish) - Only show if user owns this item -->
      <div v-if="isOwnedByUser" class="owner-actions-section">
        <h3 class="section-title">Manage Listing</h3>
        <div class="owner-actions">
          <button class="owner-action-btn edit" @click="handleEditItem">
            <i class="fas fa-edit"></i>
            Edit Listing
          </button>
          <button class="owner-action-btn unpublish" @click="handleUnpublishItem">
            <i class="fas fa-eye-slash"></i>
            Unpublish Listing
          </button>
          <button class="owner-action-btn install" data-sound="chaChingMoney" @click="handleInstall">
            <i class="fas fa-download"></i>
            Install Own Item
          </button>
        </div>
      </div>

      <!-- Install Button (show if NOT owned by user) -->
      <div v-if="!isOwnedByUser" class="action-section">
        <!-- Already Installed Indicator -->
        <div v-if="hasInstalled" class="installed-indicator">
          <i class="fas fa-check-circle"></i>
          <span>Already installed</span>
        </div>

        <button class="install-button" data-sound="chaChingMoney" @click="handleInstall">
          <i class="fas fa-download"></i>
          {{ hasInstalled ? 'Reinstall' : selectedWorkflow.price > 0 ? 'Purchase & Install' : `Install ${getItemTypeLabel}` }}
        </button>
        <button v-if="selectedWorkflow.demo_url" class="demo-button" @click="openDemo">
          <i class="fas fa-play"></i>
          View Demo
        </button>
      </div>

      <!-- Reviews Section -->
      <div class="section reviews-section">
        <div class="reviews-header">
          <h3 class="section-title">Reviews ({{ reviews.length }})</h3>
          <button v-if="hasInstalled && !isOwnedByUser" class="write-review-btn" @click="showReviewModal = true">
            <i class="fas fa-edit"></i>
            {{ userReview ? 'Edit Review' : 'Write Review' }}
          </button>
        </div>

        <!-- Reviews List -->
        <div v-if="reviews.length > 0" class="reviews-list">
          <ReviewCard
            v-for="review in reviews"
            :key="review.id"
            :review="review"
            :user-vote="userVotes[review.id]"
            :can-edit="review.user_id === currentUserId"
            :can-vote="!!currentUserId && review.user_id !== currentUserId"
            @vote="handleVoteOnReview"
            @edit="handleEditReview"
            @delete="handleDeleteReview"
          />
        </div>

        <!-- No Reviews Yet -->
        <div v-else class="no-reviews">
          <i class="fas fa-star"></i>
          <p v-if="hasInstalled && !isOwnedByUser">No reviews yet. Be the first to review this item!</p>
          <p v-else-if="isOwnedByUser">No reviews yet for your item.</p>
          <p v-else>No reviews yet. Install this item to leave a review!</p>
          <button v-if="hasInstalled && !isOwnedByUser" class="write-first-review-btn" @click="showReviewModal = true">
            <i class="fas fa-edit"></i>
            Write First Review
          </button>
        </div>
      </div>
    </div>

    <!-- Publish Marketplace Item Modal -->
    <MarketplaceFormModal
      :is-open="showPublishModal"
      mode="publish"
      :item-type="selectedItemType || 'marketplace-item'"
      :item="selectedItemToPublish"
      :categories="categories"
      :stripe-connected="stripeConnected"
      :show-preview-image="true"
      @close="showPublishModal = false"
      @submit="handlePublishItem"
      @setup-stripe="handleSetupStripe"
      @open-billing="handleOpenBilling"
    />

    <!-- Edit Marketplace Item Modal -->
    <MarketplaceFormModal
      :is-open="showEditModal"
      mode="edit"
      item-type="marketplace-item"
      :item="selectedWorkflow"
      :categories="categories"
      :stripe-connected="stripeConnected"
      :show-demo-url="false"
      :show-requirements="true"
      :show-preview-image="true"
      @close="showEditModal = false"
      @submit="handleSaveEdit"
      @setup-stripe="handleSetupStripe"
      @open-billing="handleOpenBilling"
    />

    <!-- Submit Review Modal -->
    <SubmitReviewModal
      :is-open="showReviewModal"
      :item="selectedWorkflow"
      :existing-review="userReview"
      @close="showReviewModal = false"
      @submit="handleSubmitReview"
    />

    <!-- Simple Modal for confirmations -->
    <SimpleModal ref="simpleModalRef" />

    <!-- Resources Section -->
    <ResourcesSection />
  </div>
</template>

<script>
import { ref, onMounted, computed, watch, onUnmounted, inject } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import { useMarketplaceInstall } from '@/composables/useMarketplaceInstall';
import MarketplaceFormModal from '@/views/_components/common/MarketplaceFormModal.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import ReviewCard from './components/ReviewCard.vue';
import SubmitReviewModal from './components/SubmitReviewModal.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'MarketplacePanel',
  components: { MarketplaceFormModal, SimpleModal, SvgIcon, BaseButton, ReviewCard, SubmitReviewModal, ResourcesSection, Tooltip },
  props: {
    selectedWorkflow: {
      type: Object,
      default: null,
    },
    activeTab: {
      type: String,
      default: 'all',
    },
  },
  emits: ['panel-action'],
  setup(props, { emit, expose }) {
    const store = useStore();
    const showPublishModal = ref(false);
    const showEditModal = ref(false);
    const showItemSelection = ref(false);
    const selectedItemType = ref(null);
    const selectedItemToPublish = ref(null);
    const itemSearchQuery = ref('');
    const stripeConnected = ref(false);
    const localSelectedWorkflow = ref(null);
    const simpleModalRef = ref(null);
    const showReviewModal = ref(false);
    const reviews = ref([]);
    const userReview = ref(null);
    const userVotes = ref({});
    const hasInstalled = ref(false);
    const installedPluginsList = ref([]);

    // Fetch installed plugins from local backend API
    const fetchInstalledPlugins = async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/installed`);
        const data = await response.json();
        if (data.success) {
          installedPluginsList.value = data.plugins || [];
        }
      } catch (error) {
        console.error('Error fetching installed plugins:', error);
        installedPluginsList.value = [];
      }
    };

    // Watch for prop changes and update local state
    watch(
      () => props.selectedWorkflow,
      (newWorkflow) => {
        localSelectedWorkflow.value = newWorkflow;
      },
      { immediate: true }
    );

    // Method to update selected workflow from parent
    const updateSelectedWorkflow = (workflow) => {
      localSelectedWorkflow.value = workflow;
    };

    // Expose method to parent component
    const handlePanelAction = (action, payload) => {
      if (action === 'update-workflow-details') {
        updateSelectedWorkflow(payload);
      }
    };

    // Expose methods for external access
    expose({
      updateSelectedWorkflow,
      handlePanelAction,
    });
    // Get categories from workflow store
    const categories = computed(() => {
      return store.getters['workflows/workflowCategories'] || [];
    });

    // Get available items based on selected type
    const availableItems = computed(() => {
      if (!selectedItemType.value) return [];

      switch (selectedItemType.value) {
        case 'agent':
          return store.getters['agents/allAgents'] || [];
        case 'workflow':
          return store.getters['workflows/allWorkflows'] || [];
        case 'tool':
          return store.getters['tools/customTools'] || [];
        case 'plugin':
          // Use the fetched plugins list from local backend API
          return installedPluginsList.value;
        default:
          return [];
      }
    });

    // Filter items based on search query
    const filteredItems = computed(() => {
      if (!itemSearchQuery.value.trim()) {
        return availableItems.value;
      }

      const query = itemSearchQuery.value.toLowerCase().trim();
      return availableItems.value.filter((item) => {
        const name = (item.name || item.title || '').toLowerCase();
        const description = (item.description || '').toLowerCase();
        const category = (item.category || '').toLowerCase();

        return name.includes(query) || description.includes(query) || category.includes(query);
      });
    });

    const selectItemType = async (type) => {
      selectedItemType.value = type;
      itemSearchQuery.value = ''; // Reset search when changing type

      // Fetch plugins from API when plugin type is selected
      if (type === 'plugin') {
        await fetchInstalledPlugins();
      }
    };

    // Helper function to get display name for items (converts kebab-case to Title Case)
    const getItemDisplayName = (item) => {
      // If item has displayName, use it
      if (item.displayName) return item.displayName;
      // If item has title, use it
      if (item.title) return item.title;
      // If item has name, convert from kebab-case to Title Case
      if (item.name) {
        return item.name
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
      return 'Untitled';
    };

    const selectItemToPublish = (item) => {
      // Add display name to the item for the form
      const itemWithDisplayName = {
        ...item,
        // Add a title field with the display name for the form to use
        title: getItemDisplayName(item),
      };
      selectedItemToPublish.value = itemWithDisplayName;
      showPublishModal.value = true;
    };

    const closeItemSelection = () => {
      showItemSelection.value = false;
      selectedItemType.value = null;
      selectedItemToPublish.value = null;
      itemSearchQuery.value = '';
    };

    const closeWorkflowDetails = () => {
      localSelectedWorkflow.value = null;
      emit('panel-action', 'close-panel');
    };

    const getToolIcon = (tool) => {
      if (tool.icon) return `fas fa-${tool.icon}`;
      return 'fas fa-wrench';
    };
    const handleInstall = async () => {
      if (props.selectedWorkflow) {
        try {
          // Emit the install action to the parent
          emit('panel-action', 'install-workflow', props.selectedWorkflow);

          // After a short delay, refresh the installed status
          // This gives time for the install to complete
          setTimeout(async () => {
            if (localSelectedWorkflow.value?.id) {
              await checkIfInstalled(localSelectedWorkflow.value.id);
            }
          }, 1500);
        } catch (error) {
          console.error('Error during install:', error);
        }
      }
    };

    const openDemo = () => {
      if (props.selectedWorkflow?.demo_url) {
        window.open(props.selectedWorkflow.demo_url, '_blank');
      }
    };

    const formatDate = (dateString) => {
      if (!dateString) return '';
      const date = new Date(dateString);
      const now = new Date();
      const diffTime = Math.abs(now - date);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'today';
      if (diffDays === 1) return 'yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
      return `${Math.floor(diffDays / 365)} years ago`;
    };

    // Check Stripe Connect status
    const checkStripeStatus = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/stripe/connect/status`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        stripeConnected.value = data.exists && data.onboardingComplete;
      } catch (error) {
        console.error('Error checking Stripe status:', error);
      }
    };

    onMounted(() => {
      checkStripeStatus();
    });

    const handlePublishItem = async (publishData) => {
      try {
        const token = localStorage.getItem('token');

        // Handle different asset types
        if (selectedItemType.value === 'plugin' && selectedItemToPublish.value) {
          // For plugins, fetch the package data first
          const packageResponse = await fetch(`${API_CONFIG.BASE_URL}/plugins/installed/${selectedItemToPublish.value.name}/package`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const packageData = await packageResponse.json();
          if (!packageData.success) {
            throw new Error(packageData.error || 'Failed to get plugin package');
          }

          // Add plugin-specific data
          publishData.asset_data = {
            manifest: selectedItemToPublish.value,
            downloadUrl: null, // Will be set by server after storing the package
            packageData: packageData.data, // Base64 encoded .agnt file
            size: packageData.size,
          };
        } else if (selectedItemType.value === 'workflow' && selectedItemToPublish.value?.id) {
          // For workflows, fetch the full workflow data
          const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${selectedItemToPublish.value.id}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          const data = await response.json();
          publishData.workflow_data = data.workflow;
        } else if (selectedItemType.value === 'agent' && selectedItemToPublish.value) {
          // For agents, add the full agent data
          publishData.asset_data = selectedItemToPublish.value;
        } else if (selectedItemType.value === 'tool' && selectedItemToPublish.value) {
          // For tools, add the full tool data
          publishData.asset_data = selectedItemToPublish.value;
        } else if (props.selectedWorkflow?.id) {
          // Fallback for legacy workflow publishing
          const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${props.selectedWorkflow.id}`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          const data = await response.json();
          publishData.workflow_data = data.workflow;
        }

        // Publish to marketplace
        await store.dispatch('marketplace/publishWorkflow', publishData);
        showPublishModal.value = false;
        closeItemSelection();
        emit('panel-action', 'workflow-published', publishData);
      } catch (error) {
        console.error('Error publishing item:', error);
        await simpleModalRef.value?.showModal({
          title: '✗ Publish Failed',
          message: `Failed to publish item:\n\n${error.message}`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-danger',
        });
      }
    };

    const handleSetupStripe = async () => {
      try {
        const token = localStorage.getItem('token');
        const user = store.state.userAuth?.user;

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/stripe/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            email: user?.email,
            return_url: window.location.origin + '/marketplace?stripe=success',
            refresh_url: window.location.origin + '/marketplace?stripe=refresh',
          }),
        });

        const data = await response.json();

        // Validate URL before opening
        if (!data.onboardingUrl || typeof data.onboardingUrl !== 'string' || !data.onboardingUrl.startsWith('http')) {
          console.error('Invalid onboarding URL received:', data.onboardingUrl);
          await simpleModalRef.value?.showModal({
            title: 'Error',
            message: 'Invalid Stripe onboarding URL received from server',
            confirmText: 'OK',
            showCancel: false,
          });
          return;
        }

        // Open Stripe onboarding in external browser
        if (window.electron?.openExternalUrl) {
          window.electron.openExternalUrl(data.onboardingUrl);
        } else {
          window.open(data.onboardingUrl, '_blank');
        }
      } catch (error) {
        console.error('Error setting up Stripe:', error);
        await simpleModalRef.value?.showModal({
          title: 'Error',
          message: `Failed to set up Stripe Connect: ${error.message}`,
          confirmText: 'OK',
          showCancel: false,
        });
      }
    };

    const handleOpenBilling = () => {
      // Close the modal first
      showPublishModal.value = false;
      showEditModal.value = false;

      // Navigate to Settings screen
      emit('panel-action', 'navigate', 'SettingsScreen');

      // Set the billing section to be opened
      localStorage.setItem('settings-initial-section', 'billing');
    };

    // Check if current user owns this item
    const isOwnedByUser = computed(() => {
      if (!localSelectedWorkflow.value) return false;
      const currentUser = store.state.userAuth?.user;
      if (!currentUser) return false;

      return localSelectedWorkflow.value.publisher_id === currentUser.id;
    });

    // Get the item type label for display (Agent, Tool, Workflow, Plugin)
    const getItemTypeLabel = computed(() => {
      if (!localSelectedWorkflow.value) return 'Item';
      const assetType = localSelectedWorkflow.value.asset_type;
      if (assetType === 'agent') return 'Agent';
      if (assetType === 'tool') return 'Tool';
      if (assetType === 'workflow') return 'Workflow';
      if (assetType === 'plugin') return 'Plugin';
      return 'Item';
    });

    // Handler functions for owner actions
    const handleEditItem = () => {
      showEditModal.value = true;
    };

    const handleSaveEdit = async (updateData) => {
      if (!localSelectedWorkflow.value) return;

      try {
        await store.dispatch('marketplace/updateMarketplaceItem', {
          itemId: localSelectedWorkflow.value.id,
          updates: updateData,
        });

        // Update local workflow data
        Object.assign(localSelectedWorkflow.value, updateData);

        showEditModal.value = false;
        emit('panel-action', 'item-updated', localSelectedWorkflow.value);

        await simpleModalRef.value?.showModal({
          title: '✓ Updated Successfully',
          message: 'Listing updated successfully!',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Error updating listing:', error);
        await simpleModalRef.value?.showModal({
          title: '✗ Update Failed',
          message: `Failed to update listing:\n\n${error.message}`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-danger',
        });
      }
    };

    const handleUnpublishItem = async () => {
      console.log('[UNPUBLISH] Button clicked!');
      console.log('[UNPUBLISH] localSelectedWorkflow:', localSelectedWorkflow.value);
      console.log('[UNPUBLISH] simpleModalRef:', simpleModalRef.value);

      if (!localSelectedWorkflow.value) {
        console.error('[UNPUBLISH] No workflow selected!');
        return;
      }

      if (!simpleModalRef.value) {
        console.error('[UNPUBLISH] simpleModalRef is not available!');
        return;
      }

      const confirmed = await simpleModalRef.value.showModal({
        title: 'Unpublish Item?',
        message: `Unpublish "${localSelectedWorkflow.value.title}"?\n\nThis will hide it from the marketplace but users who already installed it will keep their copies.`,
        confirmText: 'Unpublish',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (confirmed) {
        try {
          await store.dispatch('marketplace/unpublishMarketplaceItem', localSelectedWorkflow.value.id);
          emit('panel-action', 'item-unpublished', localSelectedWorkflow.value);

          await simpleModalRef.value?.showModal({
            title: '✓ Unpublished',
            message: 'Item unpublished successfully!',
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-primary',
          });
        } catch (error) {
          await simpleModalRef.value?.showModal({
            title: '✗ Failed',
            message: `Failed to unpublish:\n\n${error.message}`,
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-danger',
          });
        }
      }
    };

    const handleRepublishItem = async () => {
      if (!localSelectedWorkflow.value) return;

      try {
        await store.dispatch('marketplace/republishMarketplaceItem', localSelectedWorkflow.value.id);
        emit('panel-action', 'item-republished', localSelectedWorkflow.value);

        await simpleModalRef.value?.showModal({
          title: '✓ Republished',
          message: 'Item republished successfully!',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        await simpleModalRef.value?.showModal({
          title: '✗ Failed',
          message: `Failed to republish:\n\n${error.message}`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-danger',
        });
      }
    };

    // Get current user ID
    const currentUserId = computed(() => {
      return store.state.userAuth?.user?.id || null;
    });

    // Fetch reviews when workflow changes
    watch(
      () => localSelectedWorkflow.value,
      async (newWorkflow) => {
        if (newWorkflow?.id) {
          await fetchReviews(newWorkflow.id);
          await checkIfInstalled(newWorkflow.id);
        } else {
          reviews.value = [];
          userReview.value = null;
          userVotes.value = {};
          hasInstalled.value = false;
        }
      },
      { immediate: true }
    );

    // Fetch reviews for an item
    const fetchReviews = async (itemId) => {
      try {
        const token = localStorage.getItem('token');
        // Use marketplace_item_id if available (for My Installs items), otherwise use itemId
        const marketplaceItemId = localSelectedWorkflow.value?.marketplace_item_id || itemId;
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/items/${marketplaceItemId}/reviews`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        reviews.value = data.reviews || [];

        // Find user's review if exists
        if (currentUserId.value) {
          userReview.value = reviews.value.find((r) => r.user_id === currentUserId.value) || null;
        }

        // TODO: Fetch user votes for each review
      } catch (error) {
        console.error('Error fetching reviews:', error);
        reviews.value = [];
      }
    };

    // Check if user has installed this item
    const checkIfInstalled = async (itemId) => {
      // If we're on the "My Installs" tab, automatically set hasInstalled to true
      if (props.activeTab === 'my-installs') {
        hasInstalled.value = true;
        return;
      }

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          hasInstalled.value = false;
          return;
        }

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/my-installs`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        const installs = data.installs || [];
        hasInstalled.value = installs.some((install) => install.marketplace_item_id === itemId);
      } catch (error) {
        console.error('Error checking install status:', error);
        hasInstalled.value = false;
      }
    };

    // Handle review submission
    const handleSubmitReview = async (reviewData) => {
      try {
        if (userReview.value) {
          // Update existing review
          await store.dispatch('marketplace/updateReview', {
            reviewId: userReview.value.id,
            updates: reviewData,
          });
        } else {
          // Submit new review
          await store.dispatch('marketplace/submitReview', reviewData);
        }

        showReviewModal.value = false;

        // Refresh reviews
        if (localSelectedWorkflow.value?.id) {
          await fetchReviews(localSelectedWorkflow.value.id);
        }

        await simpleModalRef.value?.showModal({
          title: '✓ Review Submitted',
          message: userReview.value ? 'Your review has been updated!' : 'Thank you for your review!',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Error submitting review:', error);
        await simpleModalRef.value?.showModal({
          title: '✗ Failed',
          message: `Failed to submit review:\n\n${error.message}`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-danger',
        });
      }
    };

    // Handle edit review
    const handleEditReview = (review) => {
      userReview.value = review;
      showReviewModal.value = true;
    };

    // Handle delete review
    const handleDeleteReview = async (review) => {
      const confirmed = await simpleModalRef.value?.showModal({
        title: 'Delete Review?',
        message: 'Are you sure you want to delete your review? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (confirmed) {
        try {
          await store.dispatch('marketplace/deleteReview', review.id);

          // Refresh reviews
          if (localSelectedWorkflow.value?.id) {
            await fetchReviews(localSelectedWorkflow.value.id);
          }

          await simpleModalRef.value?.showModal({
            title: '✓ Deleted',
            message: 'Your review has been deleted.',
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-primary',
          });
        } catch (error) {
          console.error('Error deleting review:', error);
          await simpleModalRef.value?.showModal({
            title: '✗ Failed',
            message: `Failed to delete review:\n\n${error.message}`,
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-danger',
          });
        }
      }
    };

    // Handle vote on review
    const handleVoteOnReview = async ({ reviewId, voteType }) => {
      try {
        await store.dispatch('marketplace/voteOnReview', { reviewId, voteType });

        // Refresh reviews to get updated vote counts
        if (localSelectedWorkflow.value?.id) {
          await fetchReviews(localSelectedWorkflow.value.id);
        }
      } catch (error) {
        console.error('Error voting on review:', error);
      }
    };

    const handleDeleteItem = async () => {
      if (!localSelectedWorkflow.value) return;

      const confirmed = await simpleModalRef.value?.showModal({
        title: '⚠️ DELETE Item?',
        message: `DELETE "${localSelectedWorkflow.value.title}"?\n\nThis action CANNOT be undone!\n\nClick Delete to permanently remove this item.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        showCancel: true,
        confirmClass: 'btn-danger',
      });

      if (confirmed) {
        try {
          await store.dispatch('marketplace/deleteMarketplaceItem', {
            itemId: localSelectedWorkflow.value.id,
            force: false,
          });
          emit('panel-action', 'item-deleted', localSelectedWorkflow.value);
          closeWorkflowDetails();

          await simpleModalRef.value?.showModal({
            title: '✓ Deleted',
            message: 'Item deleted successfully!',
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-primary',
          });
        } catch (error) {
          if (error.message.includes('purchases') || error.message.includes('installs')) {
            const forceDelete = await simpleModalRef.value?.showModal({
              title: '⚠️ Item Has Users',
              message: `This item has existing purchases or installs.\n\nConsider unpublishing instead.\n\nForce delete anyway?`,
              confirmText: 'Force Delete',
              cancelText: 'Cancel',
              showCancel: true,
              confirmClass: 'btn-danger',
            });

            if (forceDelete) {
              try {
                await store.dispatch('marketplace/deleteMarketplaceItem', {
                  itemId: localSelectedWorkflow.value.id,
                  force: true,
                });
                emit('panel-action', 'item-deleted', localSelectedWorkflow.value);
                closeWorkflowDetails();

                await simpleModalRef.value?.showModal({
                  title: '✓ Force Deleted',
                  message: 'Item force deleted!',
                  confirmText: 'OK',
                  showCancel: false,
                  confirmClass: 'btn-primary',
                });
              } catch (err) {
                await simpleModalRef.value?.showModal({
                  title: '✗ Failed',
                  message: `Failed to delete:\n\n${err.message}`,
                  confirmText: 'OK',
                  showCancel: false,
                  confirmClass: 'btn-danger',
                });
              }
            }
          } else {
            await simpleModalRef.value?.showModal({
              title: '✗ Failed',
              message: `Failed to delete:\n\n${error.message}`,
              confirmText: 'OK',
              showCancel: false,
              confirmClass: 'btn-danger',
            });
          }
        }
      }
    };

    return {
      handleInstall,
      openDemo,
      formatDate,
      showPublishModal,
      showEditModal,
      showItemSelection,
      selectedItemType,
      selectedItemToPublish,
      itemSearchQuery,
      availableItems,
      filteredItems,
      stripeConnected,
      categories,
      handlePublishItem,
      handleSetupStripe,
      handleOpenBilling,
      selectItemType,
      selectItemToPublish,
      closeItemSelection,
      closeWorkflowDetails,
      getToolIcon,
      selectedWorkflow: localSelectedWorkflow,
      updateSelectedWorkflow,
      handlePanelAction,
      isOwnedByUser,
      handleEditItem,
      handleSaveEdit,
      handleUnpublishItem,
      handleRepublishItem,
      handleDeleteItem,
      simpleModalRef,
      showReviewModal,
      reviews,
      userReview,
      userVotes,
      hasInstalled,
      currentUserId,
      handleSubmitReview,
      handleEditReview,
      handleDeleteReview,
      handleVoteOnReview,
      getItemTypeLabel,
      getItemDisplayName,
    };
  },
};
</script>

<style scoped>
.marketplace-right-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  padding: 0;
}

.no-selection {
  text-align: center;
  color: var(--color-text);
  padding: 30px 15px;
  border: 1px dashed var(--terminal-border-color-light);
  background: var(--color-darker-0);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  height: fit-content;
}

.no-selection p {
  font-style: italic;
  margin: 0 0 16px 0;
}

.publish-new-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.workflow-details {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.workflow-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  padding-bottom: 8px;
}

.workflow-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-green);
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.close-btn {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--color-red);
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9em;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
}

/* .workflow-meta-section {
  margin-bottom: 16px;
} */

.workflow-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}

.publisher {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
}

.publisher i {
  font-size: 11px;
}

.price {
  padding: 4px 10px 2px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(245, 158, 11, 0.2);
  color: var(--color-yellow);
}

.price.free {
  background: rgba(34, 197, 94, 0.2);
  color: var(--color-green);
}

.stats-bar {
  display: flex;
  gap: 24px;
  padding: 12px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
}

.stat {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
}

.stat i {
  color: var(--color-green);
  font-size: 14px;
}

.stat i.fa-star {
  color: var(--color-yellow);
}

.stat-value {
  font-weight: 700;
  color: var(--color-text);
  font-size: 14px;
}

.stat-label {
  color: var(--color-text-muted);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}

.description {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-muted);
  margin: 0;
}

.category-badge {
  display: inline-block;
  padding: 6px 12px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-green);
  width: fit-content;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  padding: 4px 10px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.version-info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.version {
  padding: 4px 10px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  font-weight: 600;
  color: var(--color-green);
}

.updated {
  color: var(--color-text-muted);
}

.requirements-list {
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.8;
}

.requirements-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-muted);
  margin: 0;
  white-space: pre-wrap;
}

.action-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 0;
  border-top: 1px solid var(--terminal-border-color);
  border-bottom: 1px solid var(--terminal-border-color);
}

.install-button {
  width: 100%;
  padding: 12px 16px;
  background: var(--color-green);
  color: var(--color-navy);
  font-weight: 700;
  font-size: 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
}

.install-button:hover {
  background: rgba(var(--green-rgb), 0.9);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.3);
}

.install-button i {
  font-size: 13px;
}

.demo-button {
  width: 100%;
  padding: 10px 16px;
  background: transparent;
  color: var(--color-text);
  font-weight: 600;
  font-size: 13px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.demo-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.3);
}

.demo-button i {
  font-size: 12px;
}

.installed-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 6px;
  color: var(--color-green);
  font-size: 12px;
  font-weight: 600;
}

.installed-indicator i {
  font-size: 14px;
}

.installed-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3);
  border-radius: 8px;
  color: var(--color-green);
  font-size: 14px;
  font-weight: 600;
}

.installed-message i {
  font-size: 16px;
}

.publisher-section {
  padding: 16px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
}

.publisher-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.publisher-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.publisher-contact {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.publisher-contact i {
  font-size: 11px;
}

.reviews-section {
  padding: 16px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
}

.reviews-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.write-review-btn,
.write-first-review-btn {
  background: var(--color-green);
  color: var(--color-navy);
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
}

.write-review-btn:hover,
.write-first-review-btn:hover {
  background: rgba(var(--green-rgb), 0.9);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.3);
}

.write-review-btn i,
.write-first-review-btn i {
  font-size: 11px;
}

.reviews-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.no-reviews {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--color-text-muted);
  gap: 12px;
  text-align: center;
}

.no-reviews i {
  font-size: 32px;
  opacity: 0.3;
  /* color: var(--color-yellow); */
}

.no-reviews p {
  font-size: 13px;
  opacity: 0.7;
  margin: 0;
}

/* Item Selection Styles */
.item-selection,
.item-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
}

.selection-header,
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.selection-header h2,
.list-header h2 {
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

.back-button {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text);
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.back-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.3);
}

/* Search Bar */
.search-bar {
  position: relative;
  width: 100%;
}

.search-icon {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-muted);
  font-size: 14px;
  pointer-events: none;
}

.no-items-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--color-text-muted);
  gap: 12px;
  text-align: center;
}

.no-items-found i {
  font-size: 32px;
  opacity: 0.3;
}

.no-items-found p {
  font-size: 13px;
  opacity: 0.7;
  margin: 0;
}

.item-type-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

.item-type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
  gap: 12px;
}

.item-type-card:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.3);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.item-type-card i {
  font-size: 36px;
  color: var(--color-green);
}

.item-type-card h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.item-type-card p {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0;
}

.items-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.selectable-item-card {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  gap: 8px;
}

.selectable-item-card:hover {
  background: rgba(var(--green-rgb), 0.08);
  border-color: rgba(var(--green-rgb), 0.3);
  /* transform: translateY(-1px); */
}

.item-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.item-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  border: 1px solid var(--terminal-border-color);
}

.item-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-green), rgba(var(--green-rgb), 0.7));
  color: var(--color-darker-0);
  font-weight: 700;
  font-size: 14px;
}

.item-icon-wrapper {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--terminal-border-color);
  flex-shrink: 0;
  overflow: hidden;
}

.item-svg-icon {
  width: 18px;
  height: 18px;
  color: var(--color-green);
}

.item-icon-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-green), rgba(var(--green-rgb), 0.7));
  color: var(--color-darker-0);
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
}

.item-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  flex: 1;
}

.item-description {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0;
  line-height: 1.4;
}

/* Owner Actions Section */
.owner-actions-section {
  display: flex;
  padding: 16px;
  background: rgba(var(--green-rgb), 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 8px;
}

.owner-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.owner-action-btn {
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid;
}

.owner-action-btn i {
  font-size: 11px;
}

.owner-action-btn.edit {
  background: rgba(59, 130, 246, 0.1);
  border-color: rgba(59, 130, 246, 0.3);
  color: var(--color-blue);
}

.owner-action-btn.edit:hover {
  background: rgba(59, 130, 246, 0.2);
  border-color: rgba(59, 130, 246, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
}

.owner-action-btn.unpublish {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.3);
  color: var(--color-yellow);
}

.owner-action-btn.unpublish:hover {
  background: rgba(245, 158, 11, 0.2);
  border-color: rgba(245, 158, 11, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
}

.owner-action-btn.install {
  background: rgba(var(--green-rgb), 0.1);
  border-color: rgba(var(--green-rgb), 0.3);
  color: var(--color-green);
  grid-column: 1 / -1;
}

.owner-action-btn.install:hover {
  background: rgba(var(--green-rgb), 0.2);
  border-color: rgba(var(--green-rgb), 0.5);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.3);
}

.owner-action-btn.republish {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
  color: var(--color-green);
}

.owner-action-btn.republish:hover {
  background: rgba(34, 197, 94, 0.2);
  border-color: rgba(34, 197, 94, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3);
}

.owner-action-btn.delete {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: var(--color-red);
  grid-column: 1 / -1;
}

.owner-action-btn.delete:hover {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
}

/* Preview Image Styles */
.preview-image-container {
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--terminal-border-color);
  background: rgba(0, 0, 0, 0.2);
}

.preview-image {
  width: 100%;
  height: auto;
  display: block;
  object-fit: contain;
  max-height: 400px;
}
</style>
