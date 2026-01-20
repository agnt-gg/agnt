<template>
  <div v-if="showBanner" class="rate-limit-banner" @click="handleBannerClick">
    <Tooltip text="Close" width="auto">
    <button class="close-banner-btn" @click.stop="closeBanner">×</button>
    </Tooltip>
    <div class="rate-limit-banner-content">
      <span class="rate-limit-icon">⚠️</span>
      <div class="rate-limit-text-container">
        <span class="rate-limit-text">{{ bannerMessage }}</span>
        <span v-if="resetTimeText" class="rate-limit-reset">{{ resetTimeText }}</span>
      </div>
      <span class="rate-limit-icon">🚫</span>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'RateLimitBanner',
  components: { Tooltip },
  setup() {
    const store = useStore();
    const router = useRouter();
    const resetInterval = ref(null);

    const planType = computed(() => store.state.userAuth?.planType || 'free');
    const isRateLimited = computed(() => store.state.theme.isRateLimited);
    const isRateLimitBannerClosed = computed(() => store.state.theme.isRateLimitBannerClosed);
    const rateLimitInfo = computed(() => store.state.theme.rateLimitInfo);
    const rateLimitHitCount = computed(() => store.state.theme.rateLimitHitCount);

    const showBanner = computed(() => {
      // Only show if rate limited
      if (!isRateLimited.value) return false;

      // Only show if user hasn't closed it
      if (isRateLimitBannerClosed.value) return false;

      // Show banner for any rate limited user
      // Don't check planType since subscription/status endpoint might also be rate limited
      // causing a catch-22 where we can't determine the plan type
      return true;
    });

    const bannerMessage = computed(() => {
      const hitCount = rateLimitHitCount.value;
      const info = rateLimitInfo.value;

      if (hitCount > 1) {
        return `Rate Limit Reached ${hitCount} times! Upgrade to Pro for unlimited API access`;
      }

      if (info && info.window) {
        return `${info.window === 'hour' ? 'Hourly' : 'Daily'} Rate Limit Reached! Upgrade to Pro for unlimited access`;
      }

      return 'Rate Limit Reached! Upgrade to Pro for unlimited API access';
    });

    const resetTimeText = computed(() => {
      if (!rateLimitInfo.value || !rateLimitInfo.value.resetAt) return null;

      const resetAt = rateLimitInfo.value.resetAt;
      const now = Date.now();
      const diff = resetAt - now;

      if (diff <= 0) {
        // Rate limit has expired, clear it
        store.dispatch('theme/clearRateLimit');
        return null;
      }

      const minutes = Math.floor(diff / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (minutes > 60) {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `Resets in ${hours}h ${remainingMinutes}m`;
      } else if (minutes > 0) {
        return `Resets in ${minutes}m ${seconds}s`;
      } else {
        return `Resets in ${seconds}s`;
      }
    });

    const closeBanner = () => {
      store.dispatch('theme/setRateLimitBannerClosed', true);
    };

    const handleBannerClick = () => {
      // Set the initial section to billing so Settings page opens to Billing tab
      localStorage.setItem('settings-initial-section', 'billing');
      // Navigate to settings/billing page
      router.push('/settings');
    };

    const updateResetTime = () => {
      // Force reactivity update by checking if rate limit expired
      if (rateLimitInfo.value && rateLimitInfo.value.resetAt) {
        const now = Date.now();
        if (now >= rateLimitInfo.value.resetAt) {
          store.dispatch('theme/clearRateLimit');
        }
      }
    };

    onMounted(() => {
      if (showBanner.value) {
        // Update reset time every second
        resetInterval.value = setInterval(updateResetTime, 1000);
      }
    });

    onBeforeUnmount(() => {
      if (resetInterval.value) {
        clearInterval(resetInterval.value);
        resetInterval.value = null;
      }
    });

    return {
      showBanner,
      bannerMessage,
      resetTimeText,
      handleBannerClick,
      closeBanner,
    };
  },
};
</script>

<style scoped>
.rate-limit-banner {
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1001;
  background: linear-gradient(135deg, #ff6b35 0%, #ff8c42 50%, #ff6b35 100%);
  border-bottom: 2px solid #ff4444;
  padding: 8px 40px 8px 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  animation: pulse-warning 2s ease-in-out infinite;
}

@keyframes pulse-warning {
  0%,
  100% {
    box-shadow: 0 2px 8px rgba(255, 68, 68, 0.3);
  }
  50% {
    box-shadow: 0 2px 16px rgba(255, 68, 68, 0.6);
  }
}

.close-banner-btn {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.3);
  border: none;
  color: white;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 1.2em;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  z-index: 10;
}

.close-banner-btn:hover {
  background: rgba(0, 0, 0, 0.6);
  transform: translateY(-50%) scale(1.1);
}

.rate-limit-banner:hover {
  background: linear-gradient(135deg, #ff4444 0%, #ff6b35 50%, #ff4444 100%);
}

.rate-limit-banner-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  max-width: 1200px;
  margin: 0 auto;
}

.rate-limit-icon {
  margin-bottom: -4px;
  font-size: 1.2em;
  animation: shake 0.5s ease-in-out infinite;
}

@keyframes shake {
  0%,
  100% {
    transform: translateX(0) rotate(0deg);
  }
  25% {
    transform: translateX(-2px) rotate(-5deg);
  }
  75% {
    transform: translateX(2px) rotate(5deg);
  }
}

.rate-limit-text-container {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.rate-limit-text {
  color: var(--color-white);
  font-size: 0.9em;
  font-weight: 700;
  text-align: center;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  letter-spacing: 0.3px;
  padding: 4px 0 2px;
}

.rate-limit-reset {
  color: var(--color-white);
  font-size: 0.85em;
  font-weight: 700;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  background: rgba(0, 0, 0, 0.3);
  padding: 2px 8px 0;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

/* Responsive design */
@media (max-width: 768px) {
  .rate-limit-banner {
    padding: 6px 12px;
  }

  .rate-limit-banner-content {
    gap: 8px;
  }

  .rate-limit-icon {
    font-size: 1em;
  }

  .rate-limit-text {
    font-size: 0.8em;
  }

  .rate-limit-reset {
    font-size: 0.75em;
  }
}

@media (max-width: 480px) {
  .rate-limit-banner {
    padding: 6px 8px;
  }

  .rate-limit-text-container {
    flex-direction: column;
    gap: 4px;
  }

  .rate-limit-text {
    font-size: 0.75em;
  }

  .rate-limit-reset {
    font-size: 0.7em;
  }
}
</style>
