<template>
  <div class="workflow-panel">
    <div v-if="selectedWorkflow" class="workflow-details">
      <div class="workflow-header">
        <h2 class="workflow-title">{{ selectedWorkflow.name || selectedWorkflow.title }}</h2>
        <div class="workflow-status" :class="selectedWorkflow.status.toLowerCase()">[{{ selectedWorkflow.status }}]</div>
      </div>

      <div class="workflow-description">
        {{ selectedWorkflow.description || 'No description available' }}
      </div>

      <div class="workflow-info">
        <div class="info-item">
          <span class="info-label">Category:</span>
          <CustomCategoryDropdown v-model="selectedCategory" :categories="workflowCategories" @update:modelValue="updateCategory" />
        </div>
        <div class="info-item">
          <span class="info-label">Created:</span>
          <span class="info-value">{{ formatDate(selectedWorkflow.createdAt || selectedWorkflow.created_at) }}</span>
        </div>
        <!-- <div class="info-item">
          <span class="info-label">Last Run:</span>
          <span class="info-value">{{ selectedWorkflow.lastRun ? formatDate(selectedWorkflow.lastRun) : 'Never' }}</span>
        </div> -->
        <div class="info-item" v-if="selectedWorkflow.assignedTo">
          <span class="info-label">Assigned To:</span>
          <span class="info-value">{{ selectedWorkflow.assignedTo }}</span>
        </div>
      </div>

      <div class="workflow-tools" v-if="hasWorkflowTools">
        <h3>Tools</h3>
        <div class="tools-list">
          <Tooltip
            v-for="(tool, index) in workflowToolsWithIcons"
            :key="`tool-icon-${index}`"
            :text="tool.name"
            width="auto"
          >
            <SvgIcon
              :name="tool.icon"
              class="tool-icon"
            />
          </Tooltip>
        </div>
      </div>

      <div class="workflow-progress" v-if="isWorkflowActive">
        <h3>Progress</h3>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${selectedWorkflow.progress || 0}%` }"></div>
          <span class="progress-text">{{ selectedWorkflow.progress || 0 }}%</span>
        </div>
      </div>

      <div class="workflow-actions">
        <BaseButton class="action-button edit" @click="handleEditWorkflow"> <i class="fas fa-edit"></i> Edit Workflow </BaseButton>
        <BaseButton v-if="canStart" class="action-button start" @click="handleStartWorkflow"> Start Workflow </BaseButton>
        <BaseButton v-if="canStop" class="action-button stop" @click="handleStopWorkflow"> Stop Workflow </BaseButton>
        <BaseButton v-if="!isMarketplaceWorkflow" class="action-button publish" @click="showPublishModal = true">
          <i class="fas fa-store"></i> Publish to Marketplace
        </BaseButton>
        <BaseButton class="action-button delete" @click="handleDeleteWorkflow"> <i class="fas fa-trash"></i> Delete Workflow </BaseButton>
      </div>

      <!-- Reviews Section (for marketplace workflows) -->
      <div v-if="isMarketplaceWorkflow" class="reviews-container">
        <ReviewSection
          :workflow-id="selectedWorkflow.id"
          :reviews="workflowReviews"
          :can-review="canReviewWorkflow"
          :current-user-id="currentUserId"
          @submit-review="handleSubmitReview"
          @delete-review="handleDeleteReview"
          @vote-review="handleVoteReview"
        />
      </div>
    </div>
    <div v-else class="no-workflow-selected">
      <p>Select a workflow to view details.</p>
      <BaseButton variant="primary" class="create-workflow-button" @click="$emit('panel-action', 'navigate', 'WorkflowForgeScreen')">
        <i class="fas fa-plus"></i>
        Create New Workflow
      </BaseButton>
    </div>

    <!-- Resources Section -->
    <ResourcesSection />

    <!-- Publish Workflow Modal -->
    <MarketplaceFormModal
      :is-open="showPublishModal"
      mode="publish"
      item-type="workflow"
      :item="selectedWorkflow"
      :categories="workflowCategories"
      :stripe-connected="stripeConnected"
      @close="showPublishModal = false"
      @submit="handlePublishWorkflow"
      @setup-stripe="handleSetupStripe"
      @open-billing="handleOpenBilling"
    />

    <SimpleModal ref="simpleModal" />
  </div>
</template>

<script>
import { computed, ref, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import CustomCategoryDropdown from './CustomCategoryDropdown.vue';
import ResourcesSection from '@/views/_components/common/ResourcesSection.vue';
import ReviewSection from './components/ReviewSection.vue';
import MarketplaceFormModal from '@/views/_components/common/MarketplaceFormModal.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'WorkflowsPanel',
  components: { BaseButton, SvgIcon, CustomCategoryDropdown, ResourcesSection, ReviewSection, MarketplaceFormModal, SimpleModal, Tooltip },
  props: {
    selectedWorkflowId: {
      type: String,
      default: null,
    },
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();
    const selectedCategory = ref('');

    const selectedWorkflow = computed(() => {
      console.log('[DEBUG] Selected workflow ID:', props.selectedWorkflowId);
      const workflow = props.selectedWorkflowId ? store.getters['workflows/getWorkflowById'](props.selectedWorkflowId) : null;
      console.log('[DEBUG] Found workflow in store:', workflow);
      return workflow;
    });

    const workflowCategories = computed(() => store.getters['workflows/workflowCategories']);

    watch(
      selectedWorkflow,
      (newWorkflow) => {
        if (newWorkflow) {
          // Convert empty string to "Uncategorized" for display in dropdown
          selectedCategory.value = newWorkflow.category || 'Uncategorized';
        }
      },
      { immediate: true }
    );

    const hasWorkflowTools = computed(() => {
      if (!selectedWorkflow.value) return false;
      return selectedWorkflow.value.nodes?.length > 0 || selectedWorkflow.value.steps?.length > 0;
    });

    const workflowToolsList = computed(() => {
      if (!selectedWorkflow.value) return [];

      if (selectedWorkflow.value.nodes?.length) {
        return selectedWorkflow.value.nodes.map((node) => node.data?.label || node.type || 'Unknown Tool');
      } else if (selectedWorkflow.value.steps?.length) {
        return selectedWorkflow.value.steps.map((step) => {
          return step.toolId || `Tool ${step.order}`;
        });
      }

      return [];
    });

    const workflowToolsWithIcons = computed(() => {
      if (!selectedWorkflow.value) return [];

      const tools = [];
      const seenTools = new Set();

      if (selectedWorkflow.value.nodes?.length) {
        selectedWorkflow.value.nodes.forEach((node) => {
          const icon = node.data?.icon || node.icon || 'custom';
          const name = node.data?.label || node.type || 'Unknown Tool';
          const key = `${icon}-${name}`;

          if (!seenTools.has(key)) {
            seenTools.add(key);
            tools.push({ icon, name });
          }
        });
      } else if (selectedWorkflow.value.steps?.length) {
        selectedWorkflow.value.steps.forEach((step) => {
          const icon = step.icon || 'custom';
          const name = step.toolId || `Tool ${step.order}`;
          const key = `${icon}-${name}`;

          if (!seenTools.has(key)) {
            seenTools.add(key);
            tools.push({ icon, name });
          }
        });
      }

      return tools;
    });

    const isWorkflowActive = computed(() => {
      if (!selectedWorkflow.value) return false;
      return ['running', 'listening'].includes(selectedWorkflow.value.status);
    });

    const canStart = computed(() => {
      if (!selectedWorkflow.value) return false;
      return ['stopped', 'completed', 'error', 'insufficient-credits'].includes(selectedWorkflow.value.status);
    });

    const canStop = computed(() => {
      if (!selectedWorkflow.value) return false;
      return ['running', 'listening'].includes(selectedWorkflow.value.status);
    });

    const formatDate = (dateString) => {
      if (!dateString) return 'N/A';
      return new Date(dateString).toLocaleString();
    };

    const updateCategory = () => {
      if (selectedWorkflow.value) {
        // Convert "Uncategorized" to empty string to match how uncategorized workflows are stored
        const newCategory = selectedCategory.value === 'Uncategorized' ? '' : selectedCategory.value;
        const currentCategory = selectedWorkflow.value.category || '';

        if (currentCategory !== newCategory) {
          // Create a deep copy to avoid direct mutation issues
          const updatedWorkflow = JSON.parse(JSON.stringify(selectedWorkflow.value));
          updatedWorkflow.category = newCategory;
          emit('panel-action', 'update-workflow', updatedWorkflow);
        }
      }
    };

    const handleEditWorkflow = () => {
      if (selectedWorkflow.value) {
        emit('panel-action', 'edit-workflow', selectedWorkflow.value.id);
      }
    };

    const handleStartWorkflow = () => {
      if (selectedWorkflow.value) {
        emit('panel-action', 'start-workflow', selectedWorkflow.value.id);
      }
    };

    const handleStopWorkflow = () => {
      if (selectedWorkflow.value) {
        emit('panel-action', 'stop-workflow', selectedWorkflow.value.id);
      }
    };

    const handleDeleteWorkflow = async () => {
      if (selectedWorkflow.value) {
        const confirmed = await simpleModal.value?.showModal({
          title: 'Delete Workflow?',
          message: `Are you sure you want to delete workflow "${
            selectedWorkflow.value.name || selectedWorkflow.value.id
          }"? This action cannot be undone.`,
          confirmText: 'Delete',
          cancelText: 'Cancel',
          showCancel: true,
          confirmClass: 'btn-danger',
        });

        if (confirmed) {
          emit('panel-action', 'delete-workflow', selectedWorkflow.value.id);
        }
      }
    };

    // Marketplace & Reviews
    const workflowReviews = ref([]);
    const showPublishModal = ref(false);
    const stripeConnected = ref(false);
    const simpleModal = ref(null);

    const isMarketplaceWorkflow = computed(() => {
      // Check if this is a marketplace workflow by looking for marketplace-specific fields
      return selectedWorkflow.value?.publisher_name !== undefined || selectedWorkflow.value?.rating !== undefined;
    });

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

    // Confetti animation
    const triggerConfetti = () => {
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 2000 };

      function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
      }

      const interval = setInterval(function () {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);

        // Create confetti from two origins
        if (window.confetti) {
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          });
          window.confetti({
            ...defaults,
            particleCount,
            origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          });
        }
      }, 250);
    };

    onMounted(() => {
      checkStripeStatus();

      // Load confetti library if not already loaded
      if (!window.confetti) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
        document.head.appendChild(script);
      }
    });

    const currentUserId = computed(() => store.state.userAuth?.user?.id || null);

    const canReviewWorkflow = computed(() => {
      // User can review if they have installed or purchased the workflow
      return isMarketplaceWorkflow.value && currentUserId.value;
    });

    const fetchReviews = async () => {
      if (!isMarketplaceWorkflow.value || !selectedWorkflow.value) return;

      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/workflows/${selectedWorkflow.value.id}/reviews`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        workflowReviews.value = data.reviews || [];
      } catch (error) {
        console.error('Error fetching reviews:', error);
      }
    };

    const handleSubmitReview = async (reviewData) => {
      try {
        await store.dispatch('marketplace/submitReview', reviewData);
        // Refresh reviews
        await fetchReviews();
        emit('panel-action', 'review-submitted', reviewData);
      } catch (error) {
        console.error('Error submitting review:', error);
      }
    };

    const handleDeleteReview = async (reviewId) => {
      try {
        const token = localStorage.getItem('token');
        await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/reviews/${reviewId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        // Refresh reviews
        await fetchReviews();
        emit('panel-action', 'review-deleted', reviewId);
      } catch (error) {
        console.error('Error deleting review:', error);
      }
    };

    const handleVoteReview = async ({ reviewId, voteType }) => {
      try {
        const token = localStorage.getItem('token');
        await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/reviews/${reviewId}/vote`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ vote_type: voteType }),
        });

        // Refresh reviews
        await fetchReviews();
      } catch (error) {
        console.error('Error voting on review:', error);
      }
    };

    // Watch for workflow changes to fetch reviews
    watch(
      selectedWorkflow,
      (newWorkflow) => {
        if (newWorkflow && isMarketplaceWorkflow.value) {
          fetchReviews();
        } else {
          workflowReviews.value = [];
        }
      },
      { immediate: true }
    );

    const handlePublishWorkflow = async (publishData) => {
      try {
        // Fetch full workflow data from local backend first
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.BASE_URL}/workflows/${selectedWorkflow.value.id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();

        // Add the full workflow data and asset_type to publishData
        publishData.workflow_data = data.workflow;
        publishData.asset_type = 'workflow'; // IMPORTANT: Specify this is a workflow

        console.log('[DEBUG] Publishing workflow with data:', publishData);

        // Now publish to marketplace with full workflow data
        await store.dispatch('marketplace/publishWorkflow', publishData);
        showPublishModal.value = false;
        emit('panel-action', 'workflow-published', publishData);

        // Trigger confetti
        triggerConfetti();

        // Show success message
        await simpleModal.value?.showModal({
          title: '🎉 Success! 🎉',
          message: 'Workflow published successfully to marketplace!',
          confirmText: 'Awesome!',
          showCancel: false,
        });
      } catch (error) {
        console.error('Error publishing workflow:', error);
        await simpleModal.value?.showModal({
          title: 'Error',
          message: `Failed to publish workflow: ${error.message}`,
          confirmText: 'OK',
          showCancel: false,
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
            return_url: window.location.origin + '/workflows?stripe=success',
            refresh_url: window.location.origin + '/workflows?stripe=refresh',
          }),
        });

        const data = await response.json();

        // Validate URL before opening
        if (!data.onboardingUrl || typeof data.onboardingUrl !== 'string' || !data.onboardingUrl.startsWith('http')) {
          console.error('Invalid onboarding URL received:', data.onboardingUrl);
          throw new Error('Invalid Stripe onboarding URL received from server');
        }

        // Open Stripe onboarding in external browser
        if (window.electron?.openExternalUrl) {
          window.electron.openExternalUrl(data.onboardingUrl);
        } else {
          window.open(data.onboardingUrl, '_blank');
        }
      } catch (error) {
        console.error('Error setting up Stripe:', error);
        await simpleModal.value?.showModal({
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

      // Navigate to Settings screen
      emit('panel-action', 'navigate', 'SettingsScreen');

      // Set the billing section to be opened
      localStorage.setItem('settings-initial-section', 'billing');
    };

    return {
      selectedWorkflow,
      isWorkflowActive,
      canStart,
      canStop,
      formatDate,
      handleEditWorkflow,
      handleStartWorkflow,
      handleStopWorkflow,
      handleDeleteWorkflow,
      hasWorkflowTools,
      workflowToolsList,
      workflowToolsWithIcons,
      workflowCategories,
      selectedCategory,
      updateCategory,
      // Marketplace & Reviews
      isMarketplaceWorkflow,
      workflowReviews,
      canReviewWorkflow,
      currentUserId,
      handleSubmitReview,
      handleDeleteReview,
      handleVoteReview,
      // Publishing
      showPublishModal,
      stripeConnected,
      handlePublishWorkflow,
      handleSetupStripe,
      handleOpenBilling,
      simpleModal,
    };
  },
};
</script>

<style scoped>
.workflow-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  overflow-y: auto;
  min-height: 0;
}

/* .workflow-details {
  border-radius: 8px;
  padding: 15px;
  box-shadow: 0 0 8px rgba(var(--green-rgb), 0.3);
} */

.workflow-header {
  margin-bottom: 15px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  padding-bottom: 8px;
}

.workflow-title {
  color: var(--color-text);
  font-size: 1.1em;
  margin: 0 0 5px 0;
}

.workflow-status {
  font-size: 0.9em;
  color: var(--color-text-muted);
}

.workflow-status.running {
  color: var(--color-green);
}

.workflow-status.error {
  color: var(--color-red);
}

.workflow-status.listening {
  color: var(--color-blue);
}

.workflow-status.queued {
  color: var(--color-yellow);
}

.workflow-description {
  margin-bottom: 18px;
  line-height: 1.4;
  color: var(--color-white);
}

.workflow-tools {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

h3 {
  color: var(--color-grey);
  font-size: 0.9em;
  margin-bottom: 10px;
}

.tools-list {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px;
  background: rgba(var(--green-rgb), 0.05);
  border-radius: 4px;
}

.tool-icon {
  width: 28px;
  height: 28px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.tool-icon:hover {
  transform: scale(1.1);
}

.workflow-progress {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

.progress-bar {
  height: 20px;
  background: rgba(var(--green-rgb), 0.1);
  border-radius: 10px;
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: var(--color-green);
  transition: width 0.3s ease;
}

.progress-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--color-white);
  font-size: 0.8em;
}

.workflow-info {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.info-label {
  color: var(--color-grey);
}

.info-value {
  color: var(--color-light-green);
}

.info-value-select {
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.2);
  color: var(--color-light-green);
  border-radius: 4px;
  padding: 4px 8px;
  width: 65%;
  font-family: inherit;
  font-size: 0.95em;
}

.info-value-select:focus {
  outline: none;
  border-color: var(--color-green);
}

.info-value-select option {
  background-color: var(--color-popup);
  color: var(--color-text);
}

.workflow-actions {
  margin-top: 15px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.action-button {
  background: transparent;
  border: 1px solid rgba(var(--green-rgb), 0.3);
  color: var(--color-light-green);
  padding: 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.action-button:hover {
  background: rgba(var(--green-rgb), 0.1);
  border-color: var(--color-green);
}

.action-button.edit {
  border-color: rgba(var(--green-rgb), 0.5);
  color: var(--color-green);
}

.action-button.edit:hover {
  background: rgba(var(--green-rgb), 0.15);
  border-color: var(--color-green);
}

.action-button.stop {
  border-color: rgba(255, 99, 71, 0.3);
  color: tomato;
}

.action-button.stop:hover {
  background: rgba(255, 99, 71, 0.1);
  border-color: tomato;
}

.action-button.delete {
  border-color: rgba(255, 99, 71, 0.3);
  color: tomato;
}

.action-button.delete:hover {
  background: rgba(255, 99, 71, 0.1);
  border-color: tomato;
}

.no-workflow-selected {
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

.no-workflow-selected p {
  font-style: italic;
  margin: 0;
  padding: 0;
  margin-bottom: 16px;
}

.create-workflow-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
</style>
