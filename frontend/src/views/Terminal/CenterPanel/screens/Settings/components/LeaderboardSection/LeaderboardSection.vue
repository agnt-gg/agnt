<template>
  <div class="leaderboard-section">
    <!-- Leaderboard Header Card -->
    <div class="leaderboard-card header-card">
      <div class="card-header">
        <div class="header-left">
          <div class="icon-container">
            <i class="fas fa-trophy"></i>
          </div>
          <div>
            <h3 class="card-title">Leaderboards</h3>
            <p class="card-subtitle">
              {{ activeTab === 'referral' ? 'Top performers by Network Score' : 'Top performers by total AGNT XP' }}
            </p>
          </div>
        </div>
        <div class="header-right">
          <div class="info-tooltip">
            <i class="fas fa-info-circle"></i>
            <div class="tooltip-content">
              <h4>What Gets Synced?</h4>
              <p>
                <strong>Synced:</strong> Your Network Score, level, and aggregated stats (# of agents/ workflows / tools, # executions, seconds
                automated, etc.)
              </p>
              <p><strong>NOT Synced:</strong> Email, workflow code, credentials, or personal data</p>
              <p><strong>Visible:</strong> Only your pseudonym, score, and rank</p>
            </div>
          </div>
          <!-- Tab Switcher -->
          <div class="tab-switcher">
            <button @click="activeTab = 'referral'" :class="{ active: activeTab === 'referral' }" class="tab-button">
              <i class="fas fa-users"></i>
              Network Score
            </button>
            <button @click="activeTab = 'global'" :class="{ active: activeTab === 'global' }" class="tab-button">
              <i class="fas fa-globe"></i>
              Global XP
            </button>
          </div>
          <button @click="syncAndRefresh" class="sync-button" :disabled="isSyncing">
            <i :class="isSyncing ? 'fas fa-spinner fa-spin' : 'fas fa-cloud-upload-alt'"></i>
            {{ isSyncing ? 'Syncing...' : 'Sync & Refresh' }}
          </button>
        </div>
      </div>

      <!-- Your Rank Display -->
      <div v-if="currentUserRank" class="your-rank-display">
        <div class="rank-badge">
          <span class="rank-label">Your Rank</span>
          <span class="rank-value">#{{ currentUserRank.rank }}</span>
        </div>
        <div class="rank-user-info">
          <span class="rank-pseudonym">{{ displayPseudonym }}</span>
        </div>
        <div class="rank-stats">
          <div class="rank-stat" v-if="activeTab === 'referral'">
            <span class="stat-label">Referral Points</span>
            <span class="stat-value">{{ currentUserRank.referralScore.toLocaleString() }}</span>
          </div>
          <div class="rank-stat">
            <span class="stat-label">{{ activeTab === 'referral' ? 'Network Score' : 'AGNT XP ' }}</span>
            <span class="stat-value agnt-value">{{ currentUserRank.agntScore.toLocaleString() }}</span>
          </div>
          <div class="rank-stat" v-if="activeTab === 'global' && currentUserRank.level">
            <span class="stat-label">Level</span>
            <span class="stat-value">{{ currentUserRank.level }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Leaderboard Table -->
    <div class="leaderboard-card table-card">
      <div class="leaderboard-table" v-if="!isLoading && leaderboardData.length > 0">
        <!-- Table Header -->
        <div class="table-header" :class="{ 'global-layout': activeTab === 'global' }">
          <div class="header-cell rank-cell">Rank</div>
          <div class="header-cell user-cell">User</div>
          <div class="header-cell level-cell" v-if="activeTab === 'global'">Level</div>
          <div class="header-cell score-cell" v-if="activeTab === 'referral'">Referral Score</div>
          <div class="header-cell agnt-cell">{{ activeTab === 'referral' ? 'Network Score' : 'Total Score' }}</div>
        </div>

        <!-- Table Rows -->
        <div
          v-for="(entry, index) in leaderboardData"
          :key="entry.pseudonym || entry.id"
          class="table-row"
          :class="{ 'current-user': isCurrentUser(entry), 'top-three': index < 3, 'global-layout': activeTab === 'global' }"
        >
          <div class="table-cell rank-cell">
            <span class="rank-number" :class="getRankClass(index)">
              {{ getRankDisplay(index) }}
            </span>
          </div>
          <div class="table-cell user-cell">
            <div class="user-info">
              <!-- <div class="user-avatar">
                <i class="fas fa-user"></i>
              </div> -->
              <div class="user-details">
                <span class="user-name">{{ entry.pseudonym || 'Anonymous User' }}</span>
                <span v-if="isCurrentUser(entry)" class="you-badge">You</span>
              </div>
            </div>
          </div>
          <div class="table-cell level-cell" v-if="activeTab === 'global'">
            <span class="level-value">{{ entry.level || 1 }}</span>
          </div>
          <div class="table-cell score-cell" v-if="activeTab === 'referral'">
            <span class="score-value">{{ (entry.total_network_score || entry.balance || 0).toLocaleString() }}</span>
          </div>
          <div class="table-cell agnt-cell">
            <span class="agnt-value">{{ getAgntScore(entry).toLocaleString() }}</span>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div v-else-if="isLoading" class="loading-state">
        <i class="fas fa-spinner fa-spin"></i>
        <p>Loading leaderboard...</p>
      </div>

      <!-- Empty State -->
      <div v-else class="empty-state">
        <div class="empty-icon">
          <i class="fas fa-trophy"></i>
        </div>
        <h3 class="empty-title">No Rankings Yet</h3>
        <p class="empty-text">
          {{
            activeTab === 'referral'
              ? 'Be the first to climb the leaderboard by growing your referral network!'
              : 'Be the first to climb the leaderboard by earning Global points!'
          }}
        </p>
      </div>
    </div>

    <!-- Info Card -->
    <div class="leaderboard-card info-card">
      <h3 class="card-title">{{ activeTab === 'referral' ? 'How Referral Rankings Work' : 'How Global Rankings Work' }}</h3>
      <div class="info-grid" v-if="activeTab === 'referral'">
        <div class="info-item">
          <div class="info-number">1</div>
          <div class="info-content">
            <h4>Referral Score</h4>
            <p>
              Your base score comes from your referral network. Direct referrals earn you 100 points, plus network bonuses from multi-level referrals.
            </p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-number">2</div>
          <div class="info-content">
            <h4>Network Multiplier</h4>
            <p>Your Referral Score gets a 20× multiplier to calculate your Network Score, which contributes to your overall Global Score ranking.</p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-number">3</div>
          <div class="info-content">
            <h4>Multi-Level Bonuses</h4>
            <p>
              Level 1 referrals contribute 50% of their score, Level 2 contributes 25%, and Level 3 contributes 12.5% - building a powerful network
              effect.
            </p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-number">4</div>
          <div class="info-content">
            <h4>Real-Time Updates</h4>
            <p>Rankings update in real-time as users grow their networks. Keep referring to climb higher!</p>
          </div>
        </div>
      </div>
      <div class="info-grid" v-else>
        <div class="info-item">
          <div class="info-number">1</div>
          <div class="info-content">
            <h4>Global Score</h4>
            <p>Your comprehensive score based on productivity, engagement, infrastructure, efficiency, network, and scale metrics.</p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-number">2</div>
          <div class="info-content">
            <h4>Automatic Syncing</h4>
            <p>Your stats automatically sync to the global leaderboard when you use the app. Rankings update based on your latest activity.</p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-number">3</div>
          <div class="info-content">
            <h4>Privacy First</h4>
            <p>Only your pseudonym and aggregated stats are visible. Your email and detailed activity remain private.</p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-number">4</div>
          <div class="info-content">
            <h4>Compete Globally</h4>
            <p>See how you rank against all AGNT users worldwide. Climb the ranks by maximizing your productivity and engagement!</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';

export default {
  name: 'LeaderboardSection',
  setup() {
    const store = useStore();
    const leaderboardData = ref([]);
    const apiUserRank = ref(null);
    const isLoading = ref(false);
    const isSyncing = ref(false);
    const activeTab = ref('referral'); // 'referral' or 'global'

    const userEmail = computed(() => store.getters['userAuth/userEmail'] || '');
    const userId = computed(() => store.state.userAuth.user?.id || '');
    const userPseudonym = computed(() => store.state.userAuth.user?.pseudonym || '');
    const referralBalance = computed(() => store.state.userStats.referralBalance || 0);
    const agntScore = computed(() => store.state.userStats.agntScore?.total || 0);
    const userLevel = computed(() => store.state.userStats.level || 1);

    // Fetch and display user's pseudonym
    const userReferralData = ref(null);
    const displayPseudonym = computed(() => {
      return userReferralData.value?.pseudonym || userPseudonym.value || userEmail.value.split('@')[0] || 'User';
    });

    // Fetch user's referral data to get pseudonym
    const fetchUserPseudonym = async () => {
      if (!userEmail.value) return;

      try {
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/referrals/user/${encodeURIComponent(userEmail.value)}`, {
          headers: {
            Authorization: `Bearer ${store.state.userAuth.token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          userReferralData.value = data;
        }
      } catch (error) {
        console.error('Failed to fetch user pseudonym:', error);
      }
    };

    // Calculate current user's rank
    const currentUserRank = computed(() => {
      // Use API-provided rank if available
      if (apiUserRank.value) {
        if (activeTab.value === 'global') {
          return {
            rank: apiUserRank.value.rank,
            agntScore: agntScore.value, // Use local score, not API score (which might be 0 if not synced)
            level: userLevel.value,
            totalUsers: apiUserRank.value.totalUsers,
          };
        } else {
          return {
            rank: apiUserRank.value.rank,
            referralScore: apiUserRank.value.balance,
            agntScore: apiUserRank.value.balance * 20,
            totalUsers: apiUserRank.value.totalUsers,
          };
        }
      }

      if (!Array.isArray(leaderboardData.value) || leaderboardData.value.length === 0) {
        // Fallback when no leaderboard data
        if (activeTab.value === 'global') {
          return {
            rank: '?',
            agntScore: agntScore.value,
            level: userLevel.value,
          };
        } else {
          return {
            rank: '?',
            referralScore: referralBalance.value,
            agntScore: referralBalance.value * 20,
          };
        }
      }

      // Find user in leaderboard
      const userIndex = leaderboardData.value.findIndex((entry) => {
        if (activeTab.value === 'global') {
          return entry.id === userId.value;
        } else {
          return entry.pseudonym === userPseudonym.value || entry.email === userEmail.value;
        }
      });

      if (userIndex !== -1) {
        const entry = leaderboardData.value[userIndex];
        if (activeTab.value === 'global') {
          return {
            rank: userIndex + 1,
            agntScore: entry.agnt_score || 0,
            level: entry.level || 1,
          };
        } else {
          return {
            rank: userIndex + 1,
            referralScore: entry.total_network_score || entry.balance || 0,
            agntScore: (entry.total_network_score || entry.balance || 0) * 20,
          };
        }
      }

      // Fallback: use local data
      if (activeTab.value === 'global') {
        return {
          rank: '?',
          agntScore: agntScore.value,
          level: userLevel.value,
        };
      } else {
        return {
          rank: '?',
          referralScore: referralBalance.value,
          agntScore: referralBalance.value * 20,
        };
      }
    });

    const fetchReferralLeaderboard = async () => {
      isLoading.value = true;
      try {
        const email = userEmail.value;
        const url = email
          ? `${API_CONFIG.REMOTE_URL}/referrals/leaderboard?email=${encodeURIComponent(email)}&limit=10`
          : `${API_CONFIG.REMOTE_URL}/referrals/leaderboard?limit=10`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${store.state.userAuth.token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Referral Leaderboard API response:', data);

          if (data.leaderboard) {
            leaderboardData.value = data.leaderboard;
            if (data.userRank) {
              apiUserRank.value = data.userRank;
            }
          } else {
            leaderboardData.value = Array.isArray(data) ? data : [];
          }
        } else {
          console.error('Failed to fetch referral leaderboard');
          leaderboardData.value = [];
        }
      } catch (error) {
        console.error('Error fetching referral leaderboard:', error);
        leaderboardData.value = [];
      } finally {
        isLoading.value = false;
      }
    };

    const fetchGlobalLeaderboard = async () => {
      isLoading.value = true;
      try {
        const token = store.state.userAuth.token;
        const url = `${API_CONFIG.REMOTE_URL}/users/leaderboard/global?limit=10`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          console.log('🌍 Global Leaderboard API response:', data);

          if (data.success && data.leaderboard) {
            leaderboardData.value = data.leaderboard;
            if (data.userRank) {
              apiUserRank.value = data.userRank;
              console.log('👤 User rank from API:', data.userRank);
            }
          } else {
            leaderboardData.value = [];
          }
        } else {
          console.error('Failed to fetch global leaderboard');
          leaderboardData.value = [];
        }
      } catch (error) {
        console.error('Error fetching global leaderboard:', error);
        leaderboardData.value = [];
      } finally {
        isLoading.value = false;
      }
    };

    const fetchLeaderboard = async () => {
      if (activeTab.value === 'referral') {
        await fetchReferralLeaderboard();
      } else {
        await fetchGlobalLeaderboard();
      }
    };

    const syncAndRefresh = async () => {
      isSyncing.value = true;
      try {
        // Recalculate AGNT score first to ensure we have the latest local data
        console.log('🔄 Recalculating AGNT score...');
        await store.dispatch('userStats/calculateAndStoreAgntScore');

        // Then sync stats to remote
        console.log('🔄 Syncing stats to remote...');
        await store.dispatch('userStats/syncStatsToRemote');

        // Wait a moment for the database to update
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Then fetch the leaderboard
        await fetchLeaderboard();

        // Also refresh user's own data
        if (activeTab.value === 'referral') {
          await store.dispatch('userStats/fetchReferralBalance');
        }

        console.log('✅ Sync and refresh complete!');
      } catch (error) {
        console.error('❌ Error during sync and refresh:', error);
      } finally {
        isSyncing.value = false;
      }
    };

    const getAgntScore = (entry) => {
      if (activeTab.value === 'global') {
        return entry.agnt_score || 0;
      } else {
        return (entry.total_network_score || entry.balance || 0) * 20;
      }
    };

    const getRankDisplay = (index) => {
      const rank = index + 1;
      if (rank === 1) return '🥇';
      if (rank === 2) return '🥈';
      if (rank === 3) return '🥉';
      return `#${rank}`;
    };

    const getRankClass = (index) => {
      if (index === 0) return 'rank-gold';
      if (index === 1) return 'rank-silver';
      if (index === 2) return 'rank-bronze';
      return '';
    };

    const isCurrentUser = (entry) => {
      if (activeTab.value === 'global') {
        return entry.id === userId.value;
      } else {
        return entry.pseudonym === userPseudonym.value || entry.email === userEmail.value;
      }
    };

    // Watch for tab changes and fetch appropriate leaderboard
    watch(activeTab, () => {
      apiUserRank.value = null; // Reset rank when switching tabs
      fetchLeaderboard();
    });

    onMounted(async () => {
      // Ensure AGNT score is calculated before showing leaderboard
      await store.dispatch('userStats/calculateAndStoreAgntScore');
      fetchLeaderboard();
      fetchUserPseudonym();
    });

    return {
      leaderboardData,
      isLoading,
      isSyncing,
      currentUserRank,
      activeTab,
      displayPseudonym,
      syncAndRefresh,
      getRankDisplay,
      getRankClass,
      isCurrentUser,
      getAgntScore,
    };
  },
};
</script>

<style scoped>
.leaderboard-section {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
}

.leaderboard-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 24px;
  transition: all 0.3s ease;
}

.leaderboard-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.1);
}

/* Header Card */
.header-card {
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.05) 0%, rgba(var(--primary-rgb), 0.02) 100%);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.icon-container {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--color-secondary) 0%, var(--color-primary) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5em;
  color: white;
}

.card-title {
  font-size: 1.3em;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 4px 0;
}

.card-subtitle {
  font-size: 0.9em;
  color: var(--color-text-muted);
  margin: 0;
}

.header-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

/* Tab Switcher */
.tab-switcher {
  display: flex;
  gap: 4px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 4px;
}

.tab-button {
  padding: 8px 16px;
  background: transparent;
  color: var(--color-text-muted);
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9em;
}

.tab-button:hover {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--color-text);
}

.tab-button.active {
  background: var(--color-primary);
  color: white;
  box-shadow: 0 2px 8px rgba(var(--primary-rgb), 0.3);
}

.sync-button {
  padding: 10px 20px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sync-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3);
}

.sync-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Info Tooltip */
.info-tooltip {
  position: relative;
  display: flex;
  align-items: center;
  cursor: help;
}

.info-tooltip > i {
  font-size: 1.2em;
  color: var(--color-text-muted);
  transition: color 0.2s ease;
}

.info-tooltip:hover > i {
  color: var(--color-primary);
}

.tooltip-content {
  position: absolute;
  top: calc(100% + 12px);
  right: 0;
  width: 320px;
  background: var(--color-popup);
  border: 2px solid var(--color-primary);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-10px);
  transition: all 0.3s ease;
  z-index: 1000;
}

.info-tooltip:hover .tooltip-content {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.tooltip-content h4 {
  font-size: 1em;
  font-weight: 600;
  color: var(--color-primary);
  margin: 0 0 12px 0;
}

.tooltip-content p {
  font-size: 0.85em;
  color: var(--color-text);
  line-height: 1.5;
  margin: 0 0 8px 0;
}

.tooltip-content p:last-child {
  margin-bottom: 0;
}

.tooltip-content strong {
  color: var(--color-primary);
  font-weight: 600;
}

/* Your Rank Display */
.your-rank-display {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px;
  background: rgba(var(--primary-rgb), 0.1);
  border: 2px solid var(--color-primary);
  border-radius: 8px;
}

.rank-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px 24px;
  background: var(--color-darker-0);
  border-radius: 8px;
}

.rank-label {
  font-size: 0.75em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.rank-value {
  font-size: 1.8em;
  font-weight: bold;
  color: var(--color-primary);
}

.rank-user-info {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  background: var(--color-darker-0);
  border-radius: 8px;
}

.rank-pseudonym {
  font-size: 1.1em;
  font-weight: 600;
  color: var(--color-text);
}

.rank-stats {
  display: flex;
  gap: 32px;
  flex: 1;
}

.rank-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 0.85em;
  color: var(--color-text-muted);
  font-weight: 500;
}

.stat-value {
  font-size: 1.2em;
  font-weight: bold;
  color: var(--color-text);
}

.stat-value.agnt-value {
  color: var(--color-primary);
}

/* Leaderboard Table */
.table-card {
  padding: 0;
  overflow: hidden;
}

.leaderboard-table {
  display: flex;
  flex-direction: column;
}

.table-header {
  display: grid;
  grid-template-columns: 100px 1fr 180px 200px;
  gap: 16px;
  padding: 16px 24px;
  background: var(--color-darker-0);
  border-bottom: 1px solid var(--terminal-border-color);
}

.table-header.global-layout {
  grid-template-columns: 100px 1fr 200px 100px;
}

.header-cell {
  font-size: 0.85em;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.table-row {
  display: grid;
  grid-template-columns: 100px 1fr 180px 200px;
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--terminal-border-color);
  transition: all 0.2s ease;
}

.table-row.global-layout {
  grid-template-columns: 100px 1fr 200px 100px;
}

.table-row:hover {
  background: rgba(127, 129, 147, 0.05);
}

.table-row.current-user {
  background: rgba(var(--primary-rgb), 0.08);
  border-left: 4px solid var(--color-primary);
  padding-left: 20px;
}

.table-row.top-three {
  background: rgba(var(--primary-rgb), 0.05);
}

.table-cell {
  display: flex;
  align-items: center;
}

.rank-cell {
  justify-content: center;
}

.rank-number {
  font-size: 1.2em;
  font-weight: bold;
  color: var(--color-text);
}

.rank-number.rank-gold {
  font-size: 1.8em;
  filter: drop-shadow(0 0 8px rgba(var(--yellow-rgb), 0.6));
}

.rank-number.rank-silver {
  font-size: 1.6em;
  filter: drop-shadow(0 0 6px rgba(192, 192, 192, 0.6));
}

.rank-number.rank-bronze {
  font-size: 1.4em;
  filter: drop-shadow(0 0 4px rgba(var(--yellow-rgb), 0.6));
}

.user-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-secondary) 0%, var(--color-primary) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-darker-3);
  font-size: 1.1em;
}

.user-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-name {
  font-size: 1em;
  font-weight: 600;
  color: var(--color-text);
}

.you-badge {
  font-size: 0.7em;
  color: var(--color-green);
  background: rgba(var(--green-rgb), 0.2);
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  width: fit-content;
}

.score-value {
  font-size: 1.1em;
  font-weight: 600;
  color: var(--color-text);
}

.agnt-value {
  font-size: 1.1em;
  font-weight: bold;
  color: var(--color-primary);
}

.level-value {
  font-size: 1.1em;
  font-weight: 600;
  color: var(--color-text);
}

/* Loading State */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  gap: 16px;
}

.loading-state i {
  font-size: 3em;
  color: var(--color-green);
}

.loading-state p {
  font-size: 1em;
  color: var(--color-text-muted);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 60px 24px;
}

.empty-icon {
  font-size: 4em;
  color: var(--color-text-muted);
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-title {
  font-size: 1.3em;
  color: var(--color-text);
  margin: 0 0 12px 0;
}

.empty-text {
  font-size: 0.95em;
  color: var(--color-text-muted);
  line-height: 1.6;
  max-width: 600px;
  margin: 0 auto;
}

/* Info Card */
.info-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 20px;
}

.info-item {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.info-number {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-secondary) 0%, var(--color-primary) 100%);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.1em;
  flex-shrink: 0;
}

.info-content h4 {
  font-size: 1em;
  color: var(--color-text);
  margin: 0 0 6px 0;
  font-weight: 600;
}

.info-content p {
  font-size: 0.9em;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin: 0;
}

/* Responsive Design */
@media (max-width: 1200px) {
  .table-header,
  .table-row {
    grid-template-columns: 80px 1fr 150px 180px;
  }

  .table-header.global-layout,
  .table-row.global-layout {
    grid-template-columns: 80px 1fr 180px 80px;
  }

  .rank-stats {
    flex-direction: column;
    gap: 12px;
  }
}

@media (max-width: 900px) {
  .header-right {
    flex-direction: column;
    align-items: stretch;
  }

  .tab-switcher {
    width: 100%;
  }

  .table-header,
  .table-row {
    grid-template-columns: 60px 1fr 120px 150px;
    gap: 12px;
    padding: 12px 16px;
  }

  .table-header.global-layout,
  .table-row.global-layout {
    grid-template-columns: 60px 1fr 150px 80px;
  }

  .your-rank-display {
    flex-direction: column;
    align-items: stretch;
  }

  .rank-badge {
    flex-direction: row;
    justify-content: space-between;
  }
}

@media (max-width: 600px) {
  .table-header {
    display: none;
  }

  .table-row {
    grid-template-columns: 1fr;
    gap: 12px;
    padding: 16px;
  }

  .table-cell {
    justify-content: space-between;
  }

  .table-cell::before {
    content: attr(data-label);
    font-size: 0.85em;
    color: var(--color-text-muted);
    font-weight: 600;
  }

  .rank-cell::before {
    content: 'Rank: ';
  }

  .user-cell::before {
    content: 'User: ';
  }

  .score-cell::before {
    content: 'Referral Score: ';
  }

  .agnt-cell::before {
    content: 'Global Score: ';
  }

  .level-cell::before {
    content: 'Level: ';
  }
}
</style>
