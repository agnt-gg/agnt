/**
 * Shared composable for marketplace installation functionality
 * Provides consistent install behavior with confetti and modal feedback
 * across all screens (Marketplace, Workflows, Agents, Tools)
 */

import { ref, onMounted } from 'vue';
import { useStore } from 'vuex';

export function useMarketplaceInstall(simpleModalRef, addTerminalLine = null) {
  const store = useStore();
  const isInstalling = ref(false);

  // Load confetti library on mount
  onMounted(() => {
    if (typeof window !== 'undefined' && !window.confetti) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
      document.head.appendChild(script);
    }
  });

  // Helper to add terminal line if callback provided
  const log = (message, type = 'info') => {
    if (addTerminalLine) {
      if (typeof addTerminalLine === 'function') {
        addTerminalLine(message, type);
      }
    }
    console.log(`[MarketplaceInstall] ${message}`);
  };

  // Trigger confetti animation
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

  // Main install function
  const handleInstall = async (item, assetTypeOverride = null) => {
    if (!item) {
      console.error('[MarketplaceInstall] No item provided');
      return { success: false, error: 'No item provided' };
    }

    const assetType = assetTypeOverride || item.asset_type || 'workflow';
    const assetTypeLabel = assetType.charAt(0).toUpperCase() + assetType.slice(1);
    const itemTitle = item.title || item.name || 'Unknown Item';

    isInstalling.value = true;

    try {
      // Check if this is a paid item
      if (item.price && item.price > 0) {
        // Check if user has already purchased
        const hasPurchased = await store.dispatch('marketplace/checkPurchaseStatus', item.id);

        if (!hasPurchased) {
          // Show purchase confirmation modal
          const confirmed = await simpleModalRef.value?.showModal({
            title: 'Purchase Required',
            message: `"${itemTitle}" costs $${item.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
            confirmText: 'Purchase Now',
            cancelText: 'Cancel',
            showCancel: true,
            confirmClass: 'btn-primary',
          });

          if (confirmed) {
            log(`Redirecting to checkout for "${itemTitle}"...`, 'info');
            // Redirect to Stripe checkout
            await store.dispatch('marketplace/purchaseItem', {
              itemId: item.id,
            });
            // Note: User will be redirected to Stripe, so code after this won't execute
          }
          isInstalling.value = false;
          return { success: false, cancelled: true };
        }
      }

      // If free or already purchased, proceed with installation
      log(`Installing "${itemTitle}"...`, 'info');

      const result = await store.dispatch('marketplace/installWorkflow', {
        workflowId: item.id,
        auto_update: false,
      });

      log(`✓ ${assetTypeLabel} installed successfully!`, 'success');
      log(`  New ${assetType} ID: ${result.assetId}`, 'info');
      log(`  You can now find it in your ${assetType}s list`, 'info');

      // Refresh myInstalls and myPurchases to update UI immediately
      await Promise.all([store.dispatch('marketplace/fetchMyInstalls'), store.dispatch('marketplace/fetchMyPurchases')]);

      // Trigger confetti animation
      triggerConfetti();

      // Show success modal
      await simpleModalRef.value?.showModal({
        title: '✓ Installed Successfully',
        message: `"${itemTitle}" has been installed!\n\nNew ${assetType} ID: ${result.assetId}\n\nYou can now find it in your ${assetType}s list.`,
        confirmText: 'OK',
        showCancel: false,
        confirmClass: 'btn-primary',
      });

      isInstalling.value = false;
      return { success: true, result };
    } catch (error) {
      console.error('Install error:', error);
      isInstalling.value = false;

      if (error.code === 'PAYMENT_REQUIRED') {
        log(`✗ This ${assetType} costs $${item.price}. Payment required.`, 'error');
        const confirmed = await simpleModalRef.value?.showModal({
          title: 'Payment Required',
          message: `This ${assetType} costs $${item.price.toFixed(2)}.\n\nYou'll be redirected to Stripe to complete your purchase.`,
          confirmText: 'Purchase Now',
          cancelText: 'Cancel',
          showCancel: true,
          confirmClass: 'btn-primary',
        });

        if (confirmed) {
          await store.dispatch('marketplace/purchaseItem', {
            itemId: item.id,
          });
        }
      } else if (error.message.includes('already installed')) {
        log(`✗ You have already installed this ${assetType}.`, 'error');
        await simpleModalRef.value?.showModal({
          title: '✗ Already Installed',
          message: `You have already installed this ${assetType}.`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-secondary',
        });
      } else if (error.message.includes('invalid payment setup')) {
        log(`✗ This item has invalid payment configuration.`, 'error');
        await simpleModalRef.value?.showModal({
          title: '✗ Payment Setup Error',
          message: `This item cannot be purchased due to invalid payment configuration.\n\nThe publisher needs to fix their Stripe Connect setup.\n\nError: ${error.message}`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-danger',
        });
      } else {
        log(`✗ Error installing ${assetType}: ${error.message}`, 'error');
        await simpleModalRef.value?.showModal({
          title: '✗ Installation Error',
          message: `Failed to install ${assetType}:\n\n${error.message}`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-danger',
        });
      }

      return { success: false, error: error.message };
    }
  };

  return {
    isInstalling,
    handleInstall,
    installMarketplaceItem: handleInstall, // Alias for backward compatibility
    triggerConfetti,
  };
}
