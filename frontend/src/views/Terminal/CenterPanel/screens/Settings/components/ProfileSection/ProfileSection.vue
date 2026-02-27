<template>
  <div class="profile-section">
    <SimpleModal ref="modal" />
    <!-- User Info Card -->
    <div class="profile-card">
      <div class="profile-header">
        <div class="profile-left">
          <div v-if="userAvatar" class="avatar-container">
            <div class="avatar has-image">
              <img :src="userAvatar" alt="User Avatar" class="avatar-image" />
            </div>
            <div class="status-indicator" :class="{ active: isActive }"></div>
          </div>
          <div class="user-info">
            <div class="user-name-container">
              <h2 v-if="!isEditingPseudonym" class="user-name">{{ displayPseudonym }}</h2>
              <input
                v-else
                type="text"
                v-model="editablePseudonym"
                class="user-name-input"
                maxlength="32"
                @keyup.enter="savePseudonym"
                ref="pseudonymInput"
              />
              <Tooltip v-if="!isEditingPseudonym" text="Edit display name" width="auto">
                <button @click="startEditingPseudonym" class="edit-icon-button">
                  <i class="fas fa-edit"></i>
                </button>
              </Tooltip>
              <button
                v-else
                @click="savePseudonym"
                class="save-button"
                :disabled="isSavingPseudonym || !hasUnsavedChanges"
                :class="{ saved: pseudonymSaved }"
              >
                <i :class="isSavingPseudonym ? 'fas fa-spinner fa-spin' : pseudonymSaved ? 'fas fa-check' : 'fas fa-save'"></i>
              </button>
              <button v-if="isEditingPseudonym" @click="cancelEditingPseudonym" class="cancel-button" :disabled="isSavingPseudonym">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <p class="user-email">{{ userEmail || 'No email set' }}</p>
            <div class="user-badges">
              <span class="badge plan-badge" :class="{ 'pro-plan': isPro }">{{ displayPlanName }}</span>
              <span class="badge tier-badge" :class="{ 'pro-tier': isPro }">{{ displayTierName }}</span>
            </div>
          </div>
        </div>
        <div class="score-header">
          <div class="score-main">
            <span class="score-label"><span style="color: var(--color-green)">AGNT</span> XP</span>
            <span class="score-value">{{ formattedScore }}</span>
            <span class="score-tier">{{ scoreTier }}</span>
          </div>
        </div>
      </div>

      <!-- Level & XP - Full Width -->
      <div class="stat-card level-card-large">
        <div class="level-header">
          <div class="level-info">
            <div class="stat-icon">🎯</div>
            <div>
              <div class="stat-label">Level</div>
              <div class="stat-value">{{ level }} <span class="max-level">/ 100</span></div>
            </div>
          </div>
          <div class="xp-info">
            <span class="xp-needed-label">{{ xpNeededForNext.toLocaleString() }} AGNT XP to Level {{ level + 1 }}</span>
          </div>
        </div>
        <div class="xp-progress-bar-large">
          <div class="xp-progress-fill-large" :style="{ width: xpProgress + '%' }">
            <span class="progress-text">{{ Math.round(xpProgress) }}%</span>
          </div>
        </div>
      </div>

      <!-- Stats Row -->
      <div class="stats-row">
        <!-- Login Streak -->
        <div class="stat-card">
          <div class="stat-icon">🔥</div>
          <div class="stat-content">
            <div class="stat-label">Streak</div>
            <div class="stat-value">{{ loginStreak }}</div>
            <div class="stat-subtext">Days</div>
          </div>
        </div>

        <!-- ROI -->
        <!-- <div class="stat-card">
          <div class="stat-icon">📈</div>
          <div class="stat-content">
            <div class="stat-label">ROI</div>
            <div class="stat-value" :class="roiClass">{{ roiPercentage > 0 ? '+' : '' }}{{ roiPercentage }}%</div>
            <div class="stat-subtext">Return</div>
          </div>
        </div> -->

        <!-- Total Workflows -->
        <div class="stat-card">
          <div class="stat-icon">⚙️</div>
          <div class="stat-content">
            <div class="stat-label">Workflows</div>
            <div class="stat-value">{{ totalWorkflows }}</div>
            <div class="stat-subtext">Created</div>
          </div>
        </div>

        <!-- Total Tools -->
        <div class="stat-card">
          <div class="stat-icon">🔧</div>
          <div class="stat-content">
            <div class="stat-label">Tools</div>
            <div class="stat-value">{{ totalCustomTools }}</div>
            <div class="stat-subtext">Custom</div>
          </div>
        </div>

        <!-- Seconds Automated -->
        <div class="stat-card">
          <div class="stat-icon">⏱️</div>
          <div class="stat-content">
            <div class="stat-label">Automated</div>
            <div class="stat-value">{{ formattedSeconds }}</div>
            <div class="stat-subtext">Seconds</div>
          </div>
        </div>

        <!-- Referrals -->
        <div class="stat-card">
          <div class="stat-icon">👥</div>
          <div class="stat-content">
            <div class="stat-label">Referrals</div>
            <div class="stat-value">{{ totalReferrals }}</div>
            <div class="stat-subtext">+{{ referralCreditsDisplay }} Ref Score</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ProfileSection',
  components: {
    SimpleModal,
    Tooltip,
  },
  setup() {
    const store = useStore();
    const pseudonymInput = ref(null);
    const modal = ref(null);

    // User Auth Data
    const userEmail = computed(() => store.getters['userAuth/userEmail'] || '');
    const planType = computed(() => store.getters['userAuth/planType'] || 'free');
    const userAvatar = computed(() => store.state.userAuth.user?.picture || null);

    // User Stats Data
    const level = computed(() => store.state.userStats.level || 1);
    const totalXP = computed(() => store.state.userStats.xp || 0);

    // Calculate XP progress and needed XP using the same formula as the store
    const xpData = computed(() => {
      const score = totalXP.value;
      const MAX_LEVEL = 100;
      const baseXP = 1000;
      const growthRate = 1.05;

      let currentLevel = 1;
      let xpAccumulated = 0;

      for (let i = 1; i < MAX_LEVEL; i++) {
        const xpForThisLevel = Math.floor(baseXP * Math.pow(growthRate, i - 1));
        if (score >= xpAccumulated + xpForThisLevel) {
          currentLevel = i + 1;
          xpAccumulated += xpForThisLevel;
        } else {
          break;
        }
      }

      // If at max level, return 100%
      if (currentLevel >= MAX_LEVEL) {
        return {
          progressPercent: 100,
          xpNeeded: 0,
        };
      }

      const xpForNextLevel = Math.floor(baseXP * Math.pow(growthRate, currentLevel - 1));
      const currentXP = score - xpAccumulated;
      const progressPercent = Math.min(100, Math.max(0, (currentXP / xpForNextLevel) * 100));
      const xpNeeded = xpForNextLevel - currentXP;

      return {
        progressPercent,
        xpNeeded,
      };
    });

    const xpProgress = computed(() => xpData.value.progressPercent);
    const xpNeededForNext = computed(() => xpData.value.xpNeeded);
    const tokens = computed(() => store.state.userStats.tokens || 0);
    const loginStreak = computed(() => store.state.userStats.loginStreak || 0);
    const tickRateTier = computed(() => store.state.userStats.tickRateTier || 'Basic');
    const roiPercentage = computed(() => store.state.userStats.roiPercentage || 0);
    const totalWorkflows = computed(() => store.state.userStats.totalWorkflows || 0);
    const totalCustomTools = computed(() => store.state.userStats.totalCustomTools || 0);
    const totalSecondsAutomated = computed(() => store.state.userStats.totalSecondsAutomated || 0);
    const referralBalance = computed(() => store.state.userStats.referralBalance || 0);
    const totalReferrals = computed(() => store.state.userStats.referralTree.stats.total || 0);

    // AGNT Score Data
    const scoreData = computed(() => store.state.userStats.agntScore);
    const formattedScore = computed(() => scoreData.value?.formatted || '0');
    const scoreTier = computed(() => {
      const score = scoreData.value?.total || 0;
      if (score >= 1000000) return '🐐 GOAT';
      if (score >= 500000) return '👑 Legend';
      if (score >= 100000) return '💎 Diamond';
      if (score >= 50000) return '🥇 Gold';
      if (score >= 25000) return '🥈 Silver';
      if (score >= 10000) return '🥉 Bronze';
      return '🌱 Starter';
    });

    // Computed Properties
    const formattedTokens = computed(() => {
      return Math.floor(tokens.value).toLocaleString();
    });

    const formattedSeconds = computed(() => {
      return totalSecondsAutomated.value.toLocaleString();
    });

    const roiClass = computed(() => {
      if (roiPercentage.value > 0) return 'positive';
      if (roiPercentage.value < 0) return 'negative';
      return 'neutral';
    });

    const isActive = computed(() => {
      // User is active if they have a login streak
      return loginStreak.value > 0;
    });

    const displayPlanName = computed(() => {
      const planMap = {
        free: 'COMMUNITY CORE',
        personal: 'PERSONAL PRO',
        business: 'BUSINESS PRO',
        enterprise: 'ENTERPRISE',
      };
      return planMap[planType.value] || 'COMMUNITY CORE';
    });

    const isPro = computed(() => {
      return planType.value !== 'free';
    });

    const displayTierName = computed(() => {
      return isPro.value ? 'PRO' : 'BASIC';
    });

    // Only show referral credits if there are actual referrals
    const referralCreditsDisplay = computed(() => {
      if (totalReferrals.value === 0) return '0';
      return referralBalance.value.toLocaleString();
    });

    // Pseudonym editing state - use store value
    const editablePseudonym = ref('');
    const isEditingPseudonym = ref(false);
    const isSavingPseudonym = ref(false);
    const pseudonymSaved = ref(false);

    // Get pseudonym from store
    const displayPseudonym = computed(() => store.getters['userAuth/userPseudonym']);

    // Check if pseudonym has unsaved changes
    const hasUnsavedChanges = computed(() => {
      return editablePseudonym.value !== store.state.userAuth.userPseudonym;
    });

    // Start editing pseudonym
    const startEditingPseudonym = async () => {
      editablePseudonym.value = store.state.userAuth.userPseudonym || '';
      isEditingPseudonym.value = true;
      pseudonymSaved.value = false;
      await nextTick();
      if (pseudonymInput.value) {
        pseudonymInput.value.focus();
      }
    };

    // Cancel editing pseudonym
    const cancelEditingPseudonym = () => {
      editablePseudonym.value = store.state.userAuth.userPseudonym || '';
      isEditingPseudonym.value = false;
      pseudonymSaved.value = false;
    };

    // Save pseudonym
    const savePseudonym = async () => {
      const trimmedValue = editablePseudonym.value.trim();

      if (!trimmedValue || trimmedValue === '') {
        await modal.value.showModal({
          title: 'Invalid Display Name',
          message: 'Display name cannot be empty.',
          confirmText: 'OK',
          showCancel: false,
        });
        editablePseudonym.value = store.state.userAuth.userPseudonym || '';
        return;
      }

      isSavingPseudonym.value = true;
      pseudonymSaved.value = false;

      try {
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/referrals/update-pseudonym`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${store.state.userAuth.token}`,
          },
          body: JSON.stringify({
            newPseudonym: trimmedValue,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Failed to update display name');
        }

        // Update store with new pseudonym
        store.commit('userAuth/SET_PSEUDONYM', trimmedValue);

        pseudonymSaved.value = true;
        isEditingPseudonym.value = false;

        setTimeout(() => {
          pseudonymSaved.value = false;
        }, 2000);
      } catch (error) {
        console.error('Failed to update display name:', error);
        await modal.value.showModal({
          title: 'Update Failed',
          message: error.message || 'Failed to update display name. Please try again.',
          confirmText: 'OK',
          showCancel: false,
        });
        editablePseudonym.value = store.state.userAuth.userPseudonym || '';
      } finally {
        isSavingPseudonym.value = false;
      }
    };

    // Confetti animation for level up
    const triggerConfetti = () => {
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 10000 };

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

    // Watch for level changes to trigger confetti
    const previousLevel = ref(level.value);
    watch(level, async (newLevel, oldLevel) => {
      // Only trigger if level actually increased and it's not the initial load
      if (newLevel > oldLevel && oldLevel > 0) {
        // Trigger confetti animation
        triggerConfetti();

        // Show congratulations modal
        await modal.value.showModal({
          title: '🎉 Level Up!',
          message: `Congratulations! You've reached Level ${newLevel}!\n\nKeep earning AGNT XP to unlock more rewards and climb the leaderboard.`,
          confirmText: 'Awesome!',
          showCancel: false,
        });
      }
      previousLevel.value = newLevel;
    });

    // Load confetti library on mount
    onMounted(() => {
      if (!window.confetti) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
        document.head.appendChild(script);
      }
    });

    return {
      userEmail,
      planType,
      userAvatar,
      level,
      totalXP,
      loginStreak,
      tickRateTier,
      roiPercentage,
      totalWorkflows,
      totalCustomTools,
      referralBalance,
      totalReferrals,
      formattedTokens,
      formattedSeconds,
      roiClass,
      isActive,
      formattedScore,
      scoreTier,
      xpProgress,
      xpNeededForNext,
      displayPlanName,
      displayTierName,
      isPro,
      referralCreditsDisplay,
      pseudonymInput,
      editablePseudonym,
      isEditingPseudonym,
      isSavingPseudonym,
      pseudonymSaved,
      hasUnsavedChanges,
      displayPseudonym,
      startEditingPseudonym,
      cancelEditingPseudonym,
      savePseudonym,
      modal,
    };
  },
};
</script>

<style scoped>
.profile-section {
  width: 100%;
}

.profile-card {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Profile Header */
.profile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.profile-left {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
}

.avatar-container {
  position: relative;
}

.avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-cyan) 0%, var(--color-green) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3px solid var(--color-darker-0);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3);
  overflow: hidden;
}

.avatar.has-image {
  background: var(--color-darker-0);
  padding: 0;
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}

.avatar-text {
  font-size: 2em;
  font-weight: bold;
  color: var(--color-darker-3);
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.status-indicator {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-grey);
  border: 3px solid var(--color-darker-0);
}

.status-indicator.active {
  background: var(--color-green);
  box-shadow: 0 0 8px rgba(var(--green-rgb), 0.6);
}

.user-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-name-container {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-name {
  font-size: 1.8em;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.user-name-input {
  font-size: 1.8em;
  font-weight: 600;
}

.edit-icon-button {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-size: 0.9em;
}

.edit-icon-button:hover {
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.1);
}

.save-button,
.cancel-button {
  background: var(--color-green);
  border: none;
  color: var(--color-darker-3);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 4px;
  transition: all 0.2s ease;
  font-size: 0.9em;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
}

.save-button:hover:not(:disabled),
.cancel-button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(var(--green-rgb), 0.3);
}

.save-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-button.saved {
  background: var(--color-green);
}

.cancel-button {
  background: rgba(127, 129, 147, 0.3);
  color: var(--color-text);
}

.cancel-button:hover:not(:disabled) {
  background: rgba(127, 129, 147, 0.5);
  box-shadow: 0 2px 8px rgba(127, 129, 147, 0.3);
}

.user-email {
  font-size: 1em;
  color: var(--color-text-muted);
  margin: 0;
}

.user-badges {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.badge {
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.plan-badge {
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
}

.plan-badge.pro-plan {
  background: rgba(var(--yellow-rgb), 0.15);
  color: var(--color-yellow);
  border: 1px solid rgba(var(--yellow-rgb), 0.4);
  box-shadow: 0 0 8px rgba(var(--yellow-rgb), 0.3);
}

.tier-badge {
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary);
  border: 1px solid rgba(var(--primary-rgb), 0.3);
}

.tier-badge.pro-tier {
  background: rgba(var(--yellow-rgb), 0.15);
  color: var(--color-yellow);
  border: 1px solid rgba(var(--yellow-rgb), 0.4);
  box-shadow: 0 0 8px rgba(var(--yellow-rgb), 0.3);
}

/* Score Header */
.score-header {
  display: flex;
  align-items: center;
}

.score-main {
  display: flex;
  align-items: center;
  gap: 12px;
}

.score-label {
  font-size: 0.75em;
  color: var(--color-text-muted);
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.score-value {
  font-size: 1.5em;
  font-weight: bold;
  color: var(--color-primary);
}

.score-tier {
  font-size: 0.9em;
  color: var(--color-primary);
  padding: 2px 8px;
  background: rgba(var(--primary-rgb), 0.1);
  border-radius: 4px;
}

/* Stats Row */
.stats-row {
  display: flex;
  gap: 16px;
  width: 100%;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: space-between;
  align-items: center;
}

.stat-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: all 0.2s ease;
  width: 100%;
}

.stat-card:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.1);
}

.stat-card.highlight {
  background: rgba(var(--green-rgb), 0.05);
  border-color: rgba(var(--green-rgb), 0.3);
}

.stat-card.highlight:hover {
  border-color: var(--color-green);
  box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
}

.stat-icon {
  font-size: 2em;
  line-height: 1;
}

.stat-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-content: center;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: nowrap;
}

.stat-label {
  font-size: 0.75em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.stat-value {
  font-size: 1.25em;
  font-weight: bold;
  color: var(--color-text);
  line-height: 1;
}

.stat-value.positive {
  color: var(--color-green);
}

.stat-value.negative {
  color: var(--color-red);
}

.stat-value.neutral {
  color: var(--color-text-muted);
}

.stat-subtext {
  font-size: 0.7em;
  color: var(--color-text-muted);
}

/* Level Card - Large Full Width */
.level-card-large {
  width: calc(100% - 32px);
  flex-direction: column;
  padding: 16px;
}

.level-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.level-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.max-level {
  font-size: 0.6em;
  color: var(--color-text-muted);
  font-weight: normal;
}

.xp-info {
  text-align: right;
  margin-left: 16px;
}

.xp-needed-label {
  font-size: 0.85em;
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.1);
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid rgba(var(--primary-rgb), 0.3);
  font-weight: 600;
  white-space: nowrap;
}

.xp-progress-bar-large {
  width: 100%;
  height: 24px;
  background: rgba(127, 129, 147, 0.2);
  border-radius: 12px;
  overflow: hidden;
  position: relative;
}

.xp-progress-fill-large {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  border-radius: 12px;
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
  min-width: 2%;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 12px;
}

.xp-progress-fill-large::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
  animation: shimmer 2s infinite;
  z-index: 0;
}

@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.progress-text {
  position: relative;
  z-index: 1;
  font-size: 0.75em;
  font-weight: 700;
  color: #ffffff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  min-width: 40px;
  text-align: right;
}

/* Responsive Design */
@media (max-width: 1200px) {
  .stats-row {
    flex-wrap: wrap;
  }

  .stat-card {
    flex: 1 1 calc(33.333% - 11px);
    min-width: 150px;
  }
}

@media (max-width: 900px) {
  .stat-card {
    flex: 1 1 calc(50% - 8px);
  }
}

@media (max-width: 900px) {
  .profile-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .score-header {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 600px) {
  .profile-left {
    flex-direction: column;
    text-align: center;
    width: 100%;
  }

  .stats-row {
    flex-direction: column;
  }

  .stat-card {
    flex: 1 1 100%;
  }

  .avatar {
    width: 100px;
    height: 100px;
  }

  .avatar-text {
    font-size: 2.5em;
  }
}
</style>
