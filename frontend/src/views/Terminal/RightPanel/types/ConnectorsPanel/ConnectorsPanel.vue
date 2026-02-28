<template>
  <div class="ui-panel connectors-panel">
    <!-- Default View -->
    <div v-if="!selectedPlugin">
      <h2>Connectors</h2>
      <div class="panel-section about-section">
        <div class="about-row">AGNT Terminal UI v0.3.1</div>
        <div class="about-row">Connect your favorite apps and MCPs.</div>
      </div>
    </div>

    <!-- Plugin Details View -->
    <div v-else class="plugin-details">
      <div class="details-header">
        <BaseButton variant="ghost" size="small" @click="closeDetails" class="back-btn"> <i class="fas fa-arrow-left"></i> Back </BaseButton>
        <h2>{{ selectedPlugin.displayName || selectedPlugin.name }}</h2>
      </div>

      <div class="details-content">
        <div class="detail-row">
          <span class="label">Version:</span>
          <span class="value">{{ selectedPlugin.version }}</span>
        </div>
        <div class="detail-row" v-if="selectedPlugin.author">
          <span class="label">Author:</span>
          <span class="value">{{ selectedPlugin.author }}</span>
        </div>
        <div class="detail-row description" v-if="selectedPlugin.description">
          <span class="label">Description:</span>
          <p class="value">{{ selectedPlugin.description }}</p>
        </div>

        <div class="actions-row">
          <template v-if="selectedPlugin._isInstalled">
            <BaseButton variant="secondary" @click="editPlugin"> <i class="fas fa-edit"></i> Edit </BaseButton>
            <BaseButton variant="danger" @click="uninstallPlugin" :disabled="isUninstalling">
              <i class="fas fa-trash"></i> {{ isUninstalling ? 'Removing...' : 'Uninstall' }}
            </BaseButton>
          </template>
          <template v-else>
            <BaseButton variant="primary" @click="installPlugin" :disabled="isInstalling">
              <i class="fas fa-download"></i>
              {{ isInstalling ? 'Processing...' : selectedPlugin.price > 0 ? `Purchase ($${selectedPlugin.price.toFixed(2)})` : 'Install' }}
            </BaseButton>
          </template>
        </div>

        <div v-if="selectedPlugin.tools && selectedPlugin.tools.length" class="tools-section">
          <h3>Tools ({{ selectedPlugin.tools.length }})</h3>
          <div class="tools-list">
            <div v-for="tool in selectedPlugin.tools" :key="tool.type" class="tool-item">
              <div class="tool-header">
                <strong>{{ tool.schema?.title || tool.type }}</strong>
                <span class="tool-type">{{ tool.schema?.category || 'tool' }}</span>
              </div>
              <p v-if="tool.schema?.description">{{ tool.schema.description }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <SimpleModal ref="modalRef" />
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useStore } from 'vuex';
import BaseButton from '@/views/Terminal/_components/BaseButton.vue';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { API_CONFIG } from '@/tt.config.js';

export default {
  name: 'ConnectorsPanel',
  components: { BaseButton, SimpleModal },
  setup() {
    const store = useStore();
    const isUninstalling = ref(false);
    const isInstalling = ref(false);
    const modalRef = ref(null);
    const panelRef = ref(null);

    const selectedPlugin = computed(() => store.getters['connectors/selectedPlugin']);

    // Handle clicks outside the panel to close it
    function handleClickOutside(event) {
      // Only handle if a plugin is selected
      if (!selectedPlugin.value) return;

      // Check if click is inside the secrets panel (right panel)
      const rightPanel = event.target.closest('.connectors-panel');
      const pluginCard = event.target.closest('.plugin-card');
      const modal = event.target.closest('.simple-modal-overlay');

      // If click is not on the panel, not on a plugin card, and not on a modal, close the panel
      if (!rightPanel && !pluginCard && !modal) {
        store.dispatch('connectors/selectPlugin', null);
      }
    }

    onMounted(() => {
      // Add click listener to document
      document.addEventListener('click', handleClickOutside);
    });

    onUnmounted(() => {
      // Clean up listener
      document.removeEventListener('click', handleClickOutside);
    });

    function closeDetails() {
      store.dispatch('connectors/selectPlugin', null);
    }

    async function editPlugin() {
      if (!selectedPlugin.value) return;
      // Switch tab to builder and load plugin
      await store.dispatch('connectors/setActiveTab', 'builder');
      await store.dispatch('pluginBuilder/loadPluginForEditing', selectedPlugin.value.name);
    }

    async function installPlugin() {
      if (!selectedPlugin.value) return;
      isInstalling.value = true;
      try {
        const plugin = selectedPlugin.value;
        const marketplaceItemId = plugin.marketplace_item_id || plugin.id;

        // Check if this is a paid plugin from the marketplace
        if (plugin.price && plugin.price > 0) {
          // Verify we have a valid marketplace item ID for purchase
          if (!marketplaceItemId) {
            await modalRef.value?.showModal({
              title: 'Purchase Error',
              message: `This plugin is marked as paid ($${plugin.price.toFixed(
                2
              )}) but is not available for purchase through the marketplace.\n\nPlease contact the plugin author or try again later.`,
              showCancel: false,
            });
            isInstalling.value = false;
            return;
          }

          // Check if user has already purchased
          const hasPurchased = await store.dispatch('marketplace/checkPurchaseStatus', marketplaceItemId);

          if (!hasPurchased) {
            // Show purchase confirmation modal
            const confirmed = await modalRef.value?.showModal({
              title: 'Purchase Required',
              message: `"${plugin.displayName || plugin.name}" costs $${plugin.price.toFixed(
                2
              )}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
              confirmText: 'Purchase Now',
              cancelText: 'Cancel',
              showCancel: true,
              confirmClass: 'btn-primary',
            });

            if (confirmed) {
              // Redirect to Stripe checkout
              await store.dispatch('marketplace/purchaseItem', {
                itemId: marketplaceItemId,
              });
              // Note: User will be redirected to Stripe, so code after this won't execute
            }
            isInstalling.value = false;
            return;
          }
        }

        // If free or already purchased, proceed with installation
        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: plugin.name, version: plugin.version || 'latest' }),
        });
        const data = await response.json();
        if (data.success) {
          store.dispatch('connectors/triggerRefresh');
          store.dispatch('tools/fetchTools', { force: true });
          store.dispatch('connectors/selectPlugin', { ...plugin, _isInstalled: true });

          await modalRef.value?.showModal({
            title: 'Success',
            message: `Plugin "${plugin.name}" installed successfully!`,
            showCancel: false,
          });
        } else {
          throw new Error(data.error || 'Installation failed');
        }
      } catch (error) {
        console.error('Install error:', error);

        // Handle specific payment-related errors
        if (error.code === 'PAYMENT_REQUIRED') {
          const plugin = selectedPlugin.value;
          const marketplaceItemId = plugin.marketplace_item_id || plugin.id;

          if (!marketplaceItemId) {
            await modalRef.value?.showModal({
              title: 'Purchase Error',
              message: `This plugin requires payment but is not properly configured for purchase.\n\nPlease contact the plugin author.`,
              showCancel: false,
            });
            return;
          }

          const confirmed = await modalRef.value?.showModal({
            title: 'Payment Required',
            message: `This plugin costs $${plugin.price?.toFixed(2) || '?.??'}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
            confirmText: 'Purchase Now',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-primary',
          });

          if (confirmed) {
            await store.dispatch('marketplace/purchaseItem', {
              itemId: marketplaceItemId,
            });
          }
        } else if (error.message.includes('invalid payment') || error.message.includes('Stripe')) {
          await modalRef.value?.showModal({
            title: 'Payment Setup Error',
            message: `This plugin cannot be purchased due to a payment configuration issue.\n\nThe publisher needs to complete their Stripe Connect setup.\n\nError: ${error.message}`,
            showCancel: false,
          });
        } else {
          await modalRef.value?.showModal({
            title: 'Error',
            message: 'Install error: ' + error.message,
            showCancel: false,
          });
        }
      } finally {
        isInstalling.value = false;
      }
    }

    async function uninstallPlugin() {
      if (!selectedPlugin.value) return;

      const confirmed = await modalRef.value?.showModal({
        title: 'Confirm Uninstall',
        message: `Are you sure you want to uninstall "${selectedPlugin.value.name}"?`,
        confirmText: 'Uninstall',
        confirmClass: 'btn-danger',
        showCancel: true,
      });

      if (!confirmed) return;

      isUninstalling.value = true;
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/plugins/${selectedPlugin.value.name}`, {
          method: 'DELETE',
        });
        const data = await response.json();

        if (data.success) {
          // Refresh list and tools
          store.dispatch('connectors/triggerRefresh');
          store.dispatch('tools/fetchTools', { force: true });
          closeDetails();

          await modalRef.value?.showModal({
            title: 'Success',
            message: `Plugin "${selectedPlugin.value.name}" uninstalled successfully!`,
            showCancel: false,
          });
        } else {
          await modalRef.value?.showModal({
            title: 'Error',
            message: 'Failed to uninstall: ' + data.error,
            showCancel: false,
          });
        }
      } catch (error) {
        console.error('Uninstall error:', error);
        await modalRef.value?.showModal({
          title: 'Error',
          message: 'Uninstall error: ' + error.message,
          showCancel: false,
        });
      } finally {
        isUninstalling.value = false;
      }
    }

    return {
      selectedPlugin,
      closeDetails,
      editPlugin,
      installPlugin,
      uninstallPlugin,
      isUninstalling,
      isInstalling,
      modalRef,
    };
  },
};
</script>

<style scoped>
.ui-panel.connectors-panel {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
  height: 100%;
  overflow-y: auto;
}

.panel-section {
  margin-bottom: 18px;
}
.about-section {
  color: var(--color-grey);
}
.about-row {
  margin-bottom: 6px;
}

/* Details View Styles */
.details-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 24px;
}

.back-btn {
  align-self: flex-start;
  padding-left: 0;
}

.details-header h2 {
  margin: 0;
  word-break: break-word;
}

.details-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  border-bottom: 1px dashed rgba(var(--green-rgb), 0.1);
  padding-bottom: 8px;
}

.detail-row.description {
  flex-direction: column;
  gap: 4px;
}

.detail-row .label {
  font-weight: 600;
  color: var(--color-text-muted);
}

.detail-row .value {
  text-align: right;
  margin: 0;
}

.detail-row.description .value {
  text-align: left;
  line-height: 1.4;
}

.actions-row {
  display: flex;
  gap: 12px;
  margin: 16px 0;
}

.tools-section h3 {
  margin: 0 0 12px 0;
  font-size: 1.1em;
  color: var(--color-text-muted);
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tool-item {
  background: rgba(var(--green-rgb), 0.05);
  padding: 12px;
  border-radius: 8px;
  border-left: 2px solid var(--color-green);
}

.tool-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.tool-type {
  font-size: 0.8em;
  background: rgba(127, 129, 147, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
}

.tool-item p {
  margin: 0;
  font-size: 0.9em;
  color: var(--color-text-muted);
}
</style>
