<template>
  <div v-if="showBanner" class="promo-banner" @click="handleBannerClick">
    <Tooltip text="Close" width="auto">
    <button class="close-banner-btn" @click.stop="closeBanner">×</button>
    </Tooltip>
    <div class="promo-banner-content">
      <span class="promo-icon">🎄</span>
      <div class="promo-text-container">
        <span class="promo-text">{{ PROMO_MESSAGE }}</span>
        <span class="promo-countdown">{{ countdownText }}</span>
      </div>
      <span class="promo-icon">🎁</span>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

// ============================================
// PROMO CONFIGURATION
// ============================================
const PROMO_ENABLED = true; // Set to true to enable promo banner
const PROMO_END_DATE = '2025-12-25T23:59:59'; // Christmas Day
const PROMO_MESSAGE = '🎅 12 Days of Christmas: Lifetime Pro Access for $333! ';

export default {
  name: 'PromoBanner',
  components: { Tooltip },
  setup() {
    const store = useStore();
    const router = useRouter();
    const countdown = ref(null);
    const countdownInterval = ref(null);

    const planType = computed(() => store.state.userAuth?.planType || 'free');
    const isPromoBannerClosed = computed(() => store.state.theme.isPromoBannerClosed);

    const showBanner = computed(() => {
      if (!PROMO_ENABLED) return false;
      if (isPromoBannerClosed.value) return false;

      // Only show to free users
      if (planType.value !== 'free') return false;

      const endDate = new Date(PROMO_END_DATE);
      const now = new Date();
      return now < endDate;
    });

    const closeBanner = () => {
      store.dispatch('theme/setPromoBannerClosed', true);
    };

    const updateCountdown = () => {
      const endDate = new Date(PROMO_END_DATE);
      const now = new Date();
      const diff = endDate - now;

      if (diff <= 0) {
        countdown.value = null;
        if (countdownInterval.value) {
          clearInterval(countdownInterval.value);
          countdownInterval.value = null;
        }
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      countdown.value = { days, hours, minutes, seconds };
    };

    const countdownText = computed(() => {
      if (!countdown.value) return 'Offer Ended';

      const { days, hours, minutes, seconds } = countdown.value;

      if (days > 0) {
        return `Ends in ${days}d ${hours}h ${minutes}m ${seconds}s`;
      } else if (hours > 0) {
        return `Ends in ${hours}h ${minutes}m ${seconds}s`;
      } else if (minutes > 0) {
        return `Ends in ${minutes}m ${seconds}s`;
      } else {
        return `Ends in ${seconds}s`;
      }
    });

    const handleBannerClick = () => {
      // Set the initial section to billing so Settings page opens to Billing tab
      localStorage.setItem('settings-initial-section', 'billing');
      // Navigate to settings/billing page
      router.push('/settings');
    };

    onMounted(() => {
      if (showBanner.value) {
        updateCountdown();
        countdownInterval.value = setInterval(updateCountdown, 1000);
      }
    });

    onBeforeUnmount(() => {
      if (countdownInterval.value) {
        clearInterval(countdownInterval.value);
        countdownInterval.value = null;
      }
    });

    return {
      showBanner,
      countdownText,
      handleBannerClick,
      closeBanner,
      PROMO_MESSAGE,
    };
  },
};
</script>

<style scoped>
.promo-banner {
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1000;
  background: linear-gradient(135deg, var(--color-blue) 0%, var(--color-green) 50%, var(--color-blue) 100%);
  border-bottom: 2px solid var(--color-primary);
  padding: 8px 40px 8px 16px;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
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

.promo-banner:hover {
  background: linear-gradient(135deg, var(--color-green) 0%, var(--color-green) 50%, var(--color-green) 100%);
}

.promo-banner-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  max-width: 1200px;
  margin: 0 auto;
}

.promo-icon {
  margin-bottom: -4px;
  font-size: 1.2em;
  animation: bounce 2s ease-in-out infinite;
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(4px);
  }
  50% {
    transform: translateY(-4px);
  }
}

.promo-text-container {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

.promo-text {
  color: var(--color-dull-navy);
  font-size: 0.9em;
  font-weight: 700;
  text-align: center;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  letter-spacing: 0.3px;
  padding: 4px 0 2px;
}

.promo-countdown {
  color: var(--color-white);
  font-size: 0.85em;
  font-weight: 700;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  background: rgba(0, 0, 0, 0.2);
  padding: 2px 8px 0;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

/* Responsive design */
@media (max-width: 768px) {
  .promo-banner {
    padding: 6px 12px;
  }

  .promo-banner-content {
    gap: 8px;
  }

  .promo-icon {
    font-size: 1em;
  }

  .promo-text {
    font-size: 0.8em;
  }

  .promo-countdown {
    font-size: 0.75em;
  }
}

@media (max-width: 480px) {
  .promo-banner {
    padding: 6px 8px;
  }

  .promo-text-container {
    flex-direction: column;
    gap: 4px;
  }

  .promo-text {
    font-size: 0.75em;
  }

  .promo-countdown {
    font-size: 0.7em;
  }
}
</style>
