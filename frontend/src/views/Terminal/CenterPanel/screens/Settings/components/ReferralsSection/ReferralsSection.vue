<template>
  <div class="referrals-section">
    <SimpleModal ref="simpleModal" />
    <!-- Referral Overview Card -->
    <div class="referral-card overview-card">
      <div class="card-header">
        <div class="header-left">
          <div class="icon-container">
            <i class="fas fa-users"></i>
          </div>
          <div>
            <h3 class="card-title">Referral Program</h3>
            <p class="card-subtitle">Earn 30% commission when your referrals subscribe to paid plans</p>
          </div>
        </div>
        <div class="header-right">
          <div class="balance-display">
            <span class="balance-label">Referral Score</span>
            <span class="balance-value">{{ referralBalance.toLocaleString() }}</span>
          </div>
        </div>
      </div>

      <!-- Referral Link Section -->
      <div class="referral-link-section">
        <label class="input-label">Your Referral Link</label>
        <div class="link-input-group">
          <input type="text" :value="referralLink" readonly class="referral-input" ref="linkInput" />
          <button @click="copyReferralLink" class="copy-button" :class="{ copied: linkCopied }">
            <i :class="linkCopied ? 'fas fa-check' : 'fas fa-copy'"></i>
            {{ linkCopied ? 'Copied!' : 'Copy' }}
          </button>
        </div>
        <p class="help-text">Share this link with others to grow your referral network</p>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">👥</div>
        <div class="stat-content">
          <div class="stat-label">Total Referrals</div>
          <div class="stat-value">{{ referralStats.total }}</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">✅</div>
        <div class="stat-content">
          <div class="stat-label">Active</div>
          <div class="stat-value">{{ referralStats.active }}</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">⭐</div>
        <div class="stat-content">
          <div class="stat-label">Total Referral Score</div>
          <div class="stat-value">{{ referralBalance.toLocaleString() }}</div>
          <div class="stat-subtext">Direct + Network</div>
        </div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">🎯</div>
        <div class="stat-content">
          <div class="stat-label">Network Score Boost</div>
          <div class="stat-value">+{{ networkScoreBoost }}</div>
          <div class="stat-subtext">20x multiplier</div>
        </div>
      </div>
    </div>

    <!-- Commission Earnings Card -->
    <div class="referral-card commission-card">
      <div class="card-header">
        <div class="header-left">
          <div class="icon-container commission-icon">
            <i class="fas fa-dollar-sign"></i>
          </div>
          <div>
            <h3 class="card-title">Referral Commissions</h3>
            <p class="card-subtitle">Earn 30% commission when your referrals subscribe to paid plans</p>
          </div>
        </div>
        <div class="header-right" v-if="commissionSummary">
          <div class="balance-display">
            <span class="balance-label">Total Earned</span>
            <span class="balance-value commission-value">${{ commissionSummary.totalEarned?.toFixed(2) || '0.00' }}</span>
          </div>
        </div>
      </div>

      <!-- Commission Stats -->
      <div class="commission-stats" v-if="commissionSummary">
        <div class="commission-stat">
          <div class="commission-stat-icon">⌚</div>
          <div class="commission-stat-content">
            <div class="commission-stat-label">Pending</div>
            <div class="commission-stat-value">${{ commissionSummary.pendingAmount?.toFixed(2) || '0.00' }}</div>
            <div class="commission-stat-subtext">{{ commissionSummary.pendingCount || 0 }} commission(s) pending payout</div>
          </div>
        </div>

        <!-- <div class="commission-stat">
          <div class="commission-stat-icon">✅</div>
          <div class="commission-stat-content">
            <div class="commission-stat-label">Approved</div>
            <div class="commission-stat-value">${{ commissionSummary.approvedAmount?.toFixed(2) || '0.00' }}</div>
            <div class="commission-stat-subtext">{{ commissionSummary.approvedCount || 0 }} ready for payout</div>
          </div>
        </div> -->

        <div class="commission-stat">
          <div class="commission-stat-icon">💸</div>
          <div class="commission-stat-content">
            <div class="commission-stat-label">Paid Out</div>
            <div class="commission-stat-value">${{ commissionSummary.paidAmount?.toFixed(2) || '0.00' }}</div>
            <div class="commission-stat-subtext">{{ commissionSummary.paidCount || 0 }} payment(s) paid to your Stripe account</div>
          </div>
        </div>
      </div>

      <!-- Stripe Connect Setup (if not connected) -->
      <div class="stripe-connect-prompt" v-if="commissionSummary && !commissionSummary.hasStripeConnect && commissionSummary.totalEarned > 0">
        <div class="prompt-icon">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <div class="prompt-content">
          <h4 class="prompt-title">Setup Required: Connect Your Stripe Account</h4>
          <p class="prompt-text">
            You have <strong>${{ commissionSummary.approvedAmount?.toFixed(2) || '0.00' }}</strong> ready to be paid out! Connect your Stripe account
            to receive commission payments.
          </p>
          <button class="stripe-connect-button" @click="setupStripeConnect">
            <i class="fab fa-stripe"></i>
            Connect Stripe Account
          </button>
        </div>
      </div>

      <!-- Commission History -->
      <div class="commission-history" v-if="commissionHistory && commissionHistory.length > 0">
        <div class="history-header">
          <h4 class="history-title">Commission History</h4>
          <button v-if="commissionHistory.length > 5" class="toggle-all-button" @click="showAllCommissions = !showAllCommissions">
            <i :class="showAllCommissions ? 'fas fa-chevron-up' : 'fas fa-chevron-down'"></i>
            {{ showAllCommissions ? 'Show Less' : `Show All ${commissionHistory.length}` }}
          </button>
        </div>
        <div class="history-list">
          <div
            v-for="commission in showAllCommissions ? commissionHistory : commissionHistory.slice(0, 5)"
            :key="commission.id"
            class="history-item"
            :class="`status-${commission.status}`"
          >
            <div class="history-item-left">
              <div class="history-item-icon">
                <i class="fas fa-user-check"></i>
              </div>
              <div class="history-item-info">
                <div class="history-item-title">
                  <span class="referral-name">{{ commission.referredUserPseudonym || commission.referredUserName || 'Anonymous' }}</span> subscribed
                  <span class="history-item-plan">{{ commission.planType }}</span>
                </div>
                <div class="history-item-date">{{ formatCommissionDate(commission.createdAt) }}</div>
                <div v-if="commission.status === 'pending' && commission.eligibleAt" class="history-item-eligible">
                  <i class="fas fa-clock"></i>
                  Released from Stripe {{ formatEligibleDate(commission.eligibleAt) }}
                </div>
                <div v-if="commission.status === 'paid' && commission.paidAt" class="history-item-paid">
                  <i class="fas fa-check-circle"></i>
                  Paid {{ formatCommissionDate(commission.paidAt) }}
                </div>
                <div v-if="commission.status === 'paid' && commission.stripeTransferId" class="history-item-stripe">
                  <i class="fab fa-stripe"></i>
                  Transfer ID: {{ commission.stripeTransferId }}
                </div>
              </div>
            </div>
            <div class="history-item-right">
              <div class="history-item-amount">${{ commission.commissionAmount?.toFixed(2) }}</div>
              <div class="history-item-status" :class="`status-${commission.status}`">
                {{ formatCommissionStatus(commission.status) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Fraud Protection Notice -->
      <div class="fraud-protection-notice" v-if="commissionSummary && commissionSummary.totalEarned > 0">
        <div class="notice-icon">
          <i class="fas fa-shield-alt"></i>
        </div>
        <div class="notice-content">
          <h4 class="notice-title">Fraud Protection Active</h4>
          <p class="notice-text">
            <strong>Instant Payouts with Safety:</strong> Commissions are transferred to your Stripe account immediately, but Stripe holds them for
            <strong>7 days</strong> before allowing withdrawal. If a subscription is cancelled within <strong>90 days</strong>, commission transfers
            will be reversed.
          </p>
          <div class="notice-details">
            <div class="notice-detail-item">
              <i class="fas fa-bolt"></i>
              <span><strong>Instant Transfer:</strong> Money appears in your Stripe account immediately</span>
            </div>
            <div class="notice-detail-item">
              <i class="fas fa-clock"></i>
              <span><strong>7-Day Hold:</strong> Stripe holds funds for 7 days before allowing payout</span>
            </div>
            <div class="notice-detail-item">
              <i class="fas fa-undo"></i>
              <span><strong>90-Day Reversal:</strong> Will be reversed if subscription cancelled (even after withdrawal)</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div class="commission-empty" v-else-if="commissionSummary && commissionSummary.totalEarned === 0">
        <div class="empty-icon">💰</div>
        <h4 class="empty-title">No Commissions Yet</h4>
        <p class="empty-text">
          You'll earn a <strong>30% commission</strong> when someone you refer subscribes to a paid plan. Share your referral link to start earning!
        </p>
      </div>

      <!-- Loading State -->
      <div class="commission-loading" v-else-if="!commissionSummary">
        <i class="fas fa-spinner fa-spin"></i>
        <p>Loading commission data...</p>
      </div>
    </div>

    <!-- Referral Tree -->
    <div class="referral-card tree-card" v-if="referralTree.length > 0">
      <div class="card-header">
        <h3 class="card-title">Your Referral Network</h3>
        <p class="card-subtitle">{{ referralStats.total }} total referrals across all levels</p>
      </div>

      <div class="tree-container">
        <div class="tree-level" v-for="(level, index) in groupedReferrals" :key="index">
          <div class="level-header">
            <span class="level-badge">Level {{ index + 1 }}</span>
            <span class="level-count">{{ level.length }} referral{{ level.length !== 1 ? 's' : '' }}</span>
          </div>
          <div class="referral-list">
            <div v-for="referral in level" :key="referral.email" class="referral-item" :class="{ active: referral.isActive }">
              <div class="referral-avatar">
                <i class="fas fa-user"></i>
              </div>
              <div class="referral-info">
                <div class="referral-name">
                  <span class="referral-pseudonym">{{ referral.pseudonym || 'Anonymous User' }}</span>
                </div>
                <div class="referral-meta">
                  <!-- <span class="referral-code" v-if="referral.referralCode">
                    <i class="fas fa-link"></i>
                    {{ referral.referralCode.substring(0, 8) }}...
                  </span> -->
                  <span class="referral-score" v-if="referral.score">
                    <i class="fas fa-star"></i>
                    {{ referral.score }} pts
                  </span>
                  <span class="referral-status" :class="{ active: referral.isActive }">
                    {{ referral.isActive ? 'Active' : 'Inactive' }}
                  </span>
                </div>
              </div>
              <div class="referral-rewards">
                <div class="reward-item">
                  <span class="reward-label">Their Network Score</span>
                  <span class="reward-value">{{ (referral.score * 20).toLocaleString() }}</span>
                </div>
                <div class="reward-item">
                  <span class="reward-label">You Earn</span>
                  <span class="reward-value">{{ calculateYourEarnings(referral).toLocaleString() }}</span>
                </div>
                <div class="reward-item" v-if="referral.children && referral.children.length > 0">
                  <span class="reward-label">Sub-refs</span>
                  <span class="reward-value">{{ referral.children.length }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div class="referral-card empty-state" v-else>
      <div class="empty-icon">
        <i class="fas fa-share-alt"></i>
      </div>
      <h3 class="empty-title">Start Building Your Network</h3>
      <p class="empty-text">
        Share your referral link to grow your referral network and boost your Network score. Each referral increases your Referral points, which gets
        a 20x multiplier for your Network network score!
      </p>
    </div>

    <!-- How It Works -->
    <div class="referral-card info-card">
      <h3 class="card-title">How Referrals Work</h3>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-number">1</div>
          <div class="info-content">
            <h4>Share Your Link</h4>
            <p>Copy your unique referral link and share it with friends, colleagues, or on social media</p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-number">2</div>
          <div class="info-content">
            <h4>Someone Signs Up</h4>
            <p>When someone signs up using your link, they become part of your referral network</p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-number">3</div>
          <div class="info-content">
            <h4>You Both Earn Rewards</h4>
            <p>Each referral increases your referral score, which gets a 20x multiplier for your Network score</p>
          </div>
        </div>
        <div class="info-item">
          <div class="info-number">4</div>
          <div class="info-content">
            <h4>Multi Level Network Bonuses</h4>
            <p>
              Your network grows in 3 levels: Level 1 (direct referrals) contributes 50% of their score to you, Level 2 (their referrals) contributes
              25%, and Level 3 contributes 12.5%. Your total referral score × 20 = your Network Score boost!
            </p>
          </div>
        </div>
      </div>

      <div class="scoring-explanation">
        <!-- <h4 class="explanation-title">Multi-Level Scoring Breakdown</h4> -->
        <div class="explanation-content">
          <!-- <div class="level-explanation">
            <div class="level-badge-small">Direct</div>
            <p>
              <strong>Direct Earnings:</strong> You earn <strong>+100 pts</strong> for each person who signs up with your link. You also earned
              <strong>+100 pts</strong> as your onboarding bonus when you were referred.
            </p>
          </div>
          <div class="level-explanation">
            <div class="level-badge-small">Level 1</div>
            <p>
              <strong>Direct Referrals (50%):</strong> Your Level 1 referrals' total scores contribute at <strong>50%</strong> to your network score.
              If they have 500 pts, you get 250 pts from them.
            </p>
          </div>
          <div class="level-explanation">
            <div class="level-badge-small">Level 2</div>
            <p>
              <strong>Sub-Referrals (25%):</strong> Your Level 2 referrals (your referrals' referrals) contribute at <strong>25%</strong>. If they
              have 150 pts, you get 37.5 pts from them (rounded to 38 pts).
            </p>
          </div>
          <div class="level-explanation">
            <div class="level-badge-small">Level 3</div>
            <p>
              <strong>Final Level (12.5%):</strong> Level 3 is the deepest level tracked. These referrals contribute at <strong>12.5%</strong>,
              completing your 3-level referral network.
            </p>
          </div>
          <div class="level-explanation highlight-box">
            <div class="level-badge-small">Your Score</div>
            <p>
              <strong>Total Referral Score = Direct Earnings + Network Score</strong><br />
              Your direct earnings are from your onboarding bonus + people you directly referred. Your network score is calculated from all your
              downline referrals with depreciation applied per level (50% → 25% → 12.5%).
            </p>
          </div> -->

          <!-- Dynamic Calculation Display -->
          <div class="calculation-box" v-if="referralStats.total > 0">
            <strong>📊 Your Referral Score Calculation:</strong>
            <div class="calc-breakdown">
              <div class="calc-row">
                <span class="calc-label">Direct Earnings:</span>
                <span class="calc-value">{{ personalBalanceDisplay }} pts</span>
              </div>
              <!-- Direct Earnings Breakdown -->
              <div class="calc-detail" v-if="hasReferrer">
                <span class="calc-sublabel">└ Onboarding Bonus:</span>
                <span class="calc-subvalue">+100 pts</span>
              </div>
              <div class="calc-detail" v-if="referralStats.level1 > 0">
                <span class="calc-sublabel">└ Direct Referrals:</span>
                <span class="calc-subvalue">{{ referralStats.level1 }} × 100 pts = {{ referralStats.level1 * 100 }} pts</span>
              </div>
              <div class="calc-detail" v-if="agntBonusPoints > 0">
                <span class="calc-sublabel">└ AGNT Bonus:</span>
                <span class="calc-subvalue">+{{ agntBonusPoints }} pts</span>
              </div>
              <div class="calc-row network-section">
                <span class="calc-label">Multi Level Network Bonus:</span>
                <span class="calc-value">{{ networkScoreDisplay }} pts</span>
              </div>
              <div class="calc-detail" v-for="(level, index) in levelBreakdown" :key="index">
                <span class="calc-sublabel">└ Level {{ index + 1 }} ({{ level.percentage }}%):</span>
                <span class="calc-subvalue">{{ level.totalScore }} pts × {{ level.percentage }}% = {{ level.contribution }} pts</span>
              </div>
              <!-- Detailed breakdown of each referral -->
              <div class="calc-detail-breakdown" v-for="(level, levelIndex) in detailedBreakdown" :key="'level-' + levelIndex">
                <div class="breakdown-level-header">
                  <span class="breakdown-level-label">Level {{ levelIndex + 1 }} Details:</span>
                </div>
                <div class="breakdown-referral" v-for="(referral, refIndex) in level" :key="'ref-' + refIndex">
                  <span class="breakdown-name">{{ referral.name }}</span>
                  <span class="breakdown-calc">{{ referral.score }} pts × {{ referral.percentage }}% = {{ referral.contribution }} pts</span>
                </div>
              </div>
              <div class="calc-row total-row">
                <span class="calc-label"><strong>Total Referral Score:</strong></span>
                <span class="calc-value"
                  ><strong>{{ referralBalance.toLocaleString() }} pts</strong></span
                >
              </div>
              <div class="calc-row agnt-row">
                <span class="calc-label"><strong>Network Score Boost:</strong></span>
                <span class="calc-value agnt-boost"
                  ><strong>+{{ networkScoreBoost }}</strong></span
                >
              </div>
              <div class="calc-formula">
                <em>Formula: {{ referralBalance }} pts × 20 = {{ networkScoreBoost }} Network</em>
              </div>
            </div>
          </div>

          <!-- <div class="example-box" v-else>
            <strong>Example Calculation:</strong> Direct Earnings (250 pts: 100 onboarding + 100 for 1 referral + 50 bonus) + Level 1 at 50% (250 pts)
            + Level 2 at 25% (113 pts) = <strong>613 pts total</strong>. This gives you a <strong>+12,260 Network boost</strong> (613 × 20)!
          </div> -->
        </div>
      </div>
    </div>

    <!-- Referral Code Entry Card (if not referred yet) -->
    <div v-if="!hasReferrer" class="referral-card referral-code-card">
      <div class="card-header">
        <div class="header-left">
          <div class="icon-container bonus-icon">
            <i class="fas fa-gift"></i>
          </div>
          <div>
            <h3 class="card-title">Get Your Bonus!</h3>
            <p class="card-subtitle">Enter a referral code to earn <strong>100 Referral points</strong></p>
          </div>
        </div>
      </div>

      <div class="referral-code-entry">
        <label class="input-label">Enter Referral Code</label>
        <div class="code-input-group">
          <input
            type="text"
            v-model="enteredReferralCode"
            placeholder="Paste referral code here"
            class="referral-code-input"
            :disabled="isSubmitting"
            maxlength="50"
          />
          <button @click="submitReferralCode" class="submit-button" :disabled="isSubmitting || !enteredReferralCode">
            <i :class="isSubmitting ? 'fas fa-spinner fa-spin' : 'fas fa-check'"></i>
            {{ isSubmitting ? 'Submitting...' : 'Submit' }}
          </button>
        </div>
        <p v-if="codeError" class="error-message">{{ codeError }}</p>
        <p v-if="codeSuccess" class="success-message">{{ codeSuccess }}</p>
      </div>
    </div>

    <!-- Referral Bonus Received Card (if already referred) -->
    <div v-else class="referral-card bonus-received-card">
      <div class="card-header">
        <div class="header-left">
          <div class="icon-container success-icon">
            <i class="fas fa-check-circle"></i>
          </div>
          <div>
            <h3 class="card-title">Referral Bonus Received!</h3>
            <p class="card-subtitle">You earned <strong>2,000 Referral points</strong> for joining</p>
          </div>
        </div>
      </div>

      <div class="bonus-info">
        <div class="info-row">
          <span class="info-label">Referred by:</span>
          <span class="info-value">{{ userReferralData?.referrer_pseudonym || userReferralData?.referred_by || 'Unknown' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Bonus earned:</span>
          <span class="info-value bonus-amount">+2,000</span>
        </div>
        <div class="info-row">
          <span class="info-label">Calculation:</span>
          <span class="info-value">100 referral score × 20 = 2,000</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue';
import { useStore } from 'vuex';
import { API_CONFIG } from '@/tt.config.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

export default {
  name: 'ReferralsSection',
  components: {
    SimpleModal,
  },
  setup() {
    const store = useStore();
    const simpleModal = ref(null);
    const linkInput = ref(null);
    const codeInput = ref(null);
    const linkCopied = ref(false);
    const codeCopied = ref(false);

    // Referral code entry state
    const enteredReferralCode = ref('');
    const isSubmitting = ref(false);
    const codeError = ref('');
    const codeSuccess = ref('');
    const hasReferrer = ref(false);
    const userReferralData = ref(null);

    // Pseudonym editing state
    const editablePseudonym = ref('');
    const originalPseudonym = ref('');
    const isEditingPseudonym = ref(false);
    const isSavingPseudonym = ref(false);
    const pseudonymSaved = ref(false);

    // Check if pseudonym has unsaved changes
    const hasUnsavedChanges = computed(() => {
      return editablePseudonym.value !== originalPseudonym.value;
    });

    // Get user email and referral code
    const userEmail = computed(() => store.getters['userAuth/userEmail'] || '');
    const userReferralCode = ref('Loading...');

    // Generate referral link
    const referralLink = computed(() => {
      if (!userReferralCode.value || userReferralCode.value === 'Loading...') {
        return 'https://agnt.gg?ref=...';
      }
      return `https://agnt.gg?ref=${encodeURIComponent(userReferralCode.value)}`;
    });

    // Get referral data from store
    const referralBalance = computed(() => store.state.userStats.referralBalance || 0);
    const referralBreakdown = computed(() => store.state.userStats.referralBreakdown || { personalBalance: 0, networkScore: 0, totalScore: 0 });
    const referralTree = computed(() => store.state.userStats.referralTree.tree || []);
    const referralStats = computed(
      () =>
        store.state.userStats.referralTree.stats || {
          total: 0,
          active: 0,
          inactive: 0,
          level1: 0,
          level2: 0,
          level3: 0,
        }
    );

    // Calculate credits display (10 credits per referral)
    const referralCreditsDisplay = computed(() => {
      const total = referralStats.value.total || 0;
      return (total * 10).toLocaleString();
    });

    // Calculate network score boost (20x multiplier)
    const networkScoreBoost = computed(() => {
      const balance = referralBalance.value || 0;
      if (balance === 0) return '0';
      return (balance * 20).toLocaleString();
    });

    // Flatten tree structure to get all referrals with their levels
    const flattenTree = (tree, level = 1) => {
      let result = [];
      tree.forEach((referral) => {
        result.push({
          ...referral,
          level,
        });
        if (referral.children && referral.children.length > 0) {
          result = result.concat(flattenTree(referral.children, level + 1));
        }
      });
      return result;
    };

    // Group referrals by level
    const groupedReferrals = computed(() => {
      const flatReferrals = flattenTree(referralTree.value);
      const levels = [[], [], []];

      flatReferrals.forEach((referral) => {
        const level = referral.level || 1;
        if (level >= 1 && level <= 3) {
          levels[level - 1].push(referral);
        }
      });

      return levels.filter((level) => level.length > 0);
    });

    // Pseudonym editing functions
    const onPseudonymInput = () => {
      // This function is called on input to trigger reactivity
      // The hasUnsavedChanges computed will automatically update
    };

    const startEditingPseudonym = () => {
      isEditingPseudonym.value = true;
      pseudonymSaved.value = false;
    };

    const savePseudonym = async () => {
      const trimmedValue = editablePseudonym.value.trim();

      if (!trimmedValue || trimmedValue === '') {
        await simpleModal.value.showModal({
          title: 'Error',
          message: 'Pseudonym cannot be empty',
          confirmText: 'OK',
          showCancel: false,
        });
        // Reset to original value
        editablePseudonym.value = originalPseudonym.value;
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
            newPseudonym: editablePseudonym.value.trim(),
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Failed to update pseudonym');
        }

        pseudonymSaved.value = true;
        isEditingPseudonym.value = false;

        // Update the stored user data and original pseudonym
        const trimmedPseudonym = editablePseudonym.value.trim();
        if (userReferralData.value) {
          userReferralData.value.pseudonym = trimmedPseudonym;
        }
        originalPseudonym.value = trimmedPseudonym;

        setTimeout(() => {
          pseudonymSaved.value = false;
        }, 2000);
      } catch (error) {
        console.error('Failed to update pseudonym:', error);
        await simpleModal.value.showModal({
          title: 'Error',
          message: error.message || 'Failed to update pseudonym. Please try again.',
          confirmText: 'OK',
          showCancel: false,
        });
      } finally {
        isSavingPseudonym.value = false;
      }
    };

    // Copy referral link
    const copyReferralLink = async () => {
      try {
        await navigator.clipboard.writeText(referralLink.value);
        linkCopied.value = true;
        setTimeout(() => {
          linkCopied.value = false;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy link:', error);
        if (linkInput.value) {
          linkInput.value.select();
          document.execCommand('copy');
          linkCopied.value = true;
          setTimeout(() => {
            linkCopied.value = false;
          }, 2000);
        }
      }
    };

    // Submit referral code
    const submitReferralCode = async () => {
      if (!enteredReferralCode.value) {
        codeError.value = 'Please enter a referral code';
        return;
      }

      isSubmitting.value = true;
      codeError.value = '';
      codeSuccess.value = '';

      try {
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/referrals/referral`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${store.state.userAuth.token}`,
          },
          body: JSON.stringify({
            referralCode: enteredReferralCode.value,
            newUserEmail: userEmail.value,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Failed to apply referral code');
        }

        codeSuccess.value = 'Referral code applied! You earned 100 referral score (2,000 bonus)!';
        hasReferrer.value = true;
        enteredReferralCode.value = '';

        // Refresh referral data
        await fetchUserReferralCode();
        await store.dispatch('userStats/fetchReferralBalance');
        await store.dispatch('userStats/fetchReferralTree');
      } catch (error) {
        codeError.value = error.message || 'Failed to apply referral code. Please try again.';
      } finally {
        isSubmitting.value = false;
      }
    };

    // Format date
    const formatDate = (dateString) => {
      if (!dateString) return 'Unknown';
      const date = new Date(dateString);
      const now = new Date();
      const diffTime = Math.abs(now - date);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
      return date.toLocaleDateString();
    };

    // Fetch user's referral code from the user endpoint
    const fetchUserReferralCode = async () => {
      if (!userEmail.value) return;

      try {
        console.log('🔍 Fetching user referral code for:', userEmail.value);
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/referrals/user/${encodeURIComponent(userEmail.value)}`, {
          headers: {
            Authorization: `Bearer ${store.state.userAuth.token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          console.log('🔍 User referral data:', data);

          // Store the full user data
          userReferralData.value = data;

          // Check if user has been referred
          if (data.referred_by) {
            hasReferrer.value = true;
            console.log('✅ User has been referred by:', data.referred_by);
            console.log('✅ Referrer pseudonym:', data.referrer_pseudonym);

            // If no pseudonym was returned, try to fetch it separately
            if (!data.referrer_pseudonym) {
              console.log('⚠️ No referrer_pseudonym in response, fetching separately...');
              try {
                const referrerResponse = await fetch(`${API_CONFIG.REMOTE_URL}/referrals/user/${encodeURIComponent(data.referred_by)}`, {
                  headers: {
                    Authorization: `Bearer ${store.state.userAuth.token}`,
                  },
                });

                if (referrerResponse.ok) {
                  const referrerData = await referrerResponse.json();
                  console.log('✅ Fetched referrer data:', referrerData);
                  userReferralData.value.referrer_pseudonym = referrerData.pseudonym;
                }
              } catch (err) {
                console.error('Failed to fetch referrer pseudonym:', err);
              }
            }
          }

          // The API returns referral_code field
          userReferralCode.value = data.referral_code || userEmail.value;
          console.log('✅ Set userReferralCode to:', userReferralCode.value);

          // Set the editable pseudonym and original
          const pseudonym = data.pseudonym || userEmail.value.split('@')[0];
          editablePseudonym.value = pseudonym;
          originalPseudonym.value = pseudonym;
        } else {
          console.warn('Failed to fetch user referral code, using email as fallback');
          userReferralCode.value = userEmail.value;
        }
      } catch (error) {
        console.error('Failed to fetch referral code:', error);
        userReferralCode.value = userEmail.value;
      }
    };

    // Watch for userEmail to become available
    watch(
      userEmail,
      async (newEmail) => {
        if (newEmail) {
          console.log('👀 userEmail changed to:', newEmail);
          await fetchUserReferralCode();
        }
      },
      { immediate: true }
    );

    // Dynamic calculation displays - use real data from API
    const personalBalanceDisplay = computed(() => {
      return (referralBreakdown.value.personalBalance || 0).toString();
    });

    const networkScoreDisplay = computed(() => {
      return (referralBreakdown.value.networkScore || 0).toString();
    });

    const levelBreakdown = computed(() => {
      // Use REAL data from API's networkBreakdown - the API already calculated everything correctly!
      const breakdown = referralBreakdown.value.networkBreakdown || [];

      // Group by level - ONLY sum up direct Level 1 referrals (not their children)
      const levelContributions = { 1: 0, 2: 0, 3: 0 };
      const levelScores = { 1: 0, 2: 0, 3: 0 }; // Track total scores BEFORE depreciation
      const levelCounts = { 1: 0, 2: 0, 3: 0 };

      // Process ONLY the direct Level 1 referrals from the breakdown
      breakdown.forEach((referral) => {
        const level = referral.level || 1;
        if (level === 1) {
          // For Level 1: use the contributedScore from API (already includes their network)
          levelContributions[1] += referral.contributedScore || 0;
          levelScores[1] += referral.personalBalance || 0;
          levelCounts[1]++;

          // For Level 2 and 3: process children
          if (referral.children && referral.children.length > 0) {
            referral.children.forEach((child) => {
              const childLevel = child.level || 2;
              if (childLevel === 2) {
                levelContributions[2] += child.contributedScore || 0;
                levelScores[2] += child.personalBalance || 0;
                levelCounts[2]++;

                // Level 3
                if (child.children && child.children.length > 0) {
                  child.children.forEach((grandchild) => {
                    const grandchildLevel = grandchild.level || 3;
                    if (grandchildLevel === 3) {
                      levelContributions[3] += grandchild.contributedScore || 0;
                      levelScores[3] += grandchild.personalBalance || 0;
                      levelCounts[3]++;
                    }
                  });
                }
              }
            });
          }
        }
      });

      const depreciation = [50, 25, 12.5];

      return [
        {
          percentage: depreciation[0],
          count: levelCounts[1],
          totalScore: levelScores[1], // Total score BEFORE depreciation
          contribution: Math.round(levelContributions[1]), // Use API's contributedScore
        },
        {
          percentage: depreciation[1],
          count: levelCounts[2],
          totalScore: levelScores[2],
          contribution: Math.round(levelContributions[2]),
        },
        {
          percentage: depreciation[2],
          count: levelCounts[3],
          totalScore: levelScores[3],
          contribution: Math.round(levelContributions[3]),
        },
      ].filter((level) => level.count > 0);
    });

    // Calculate AGNT Bonus (leftover points in Direct Earnings)
    const agntBonusPoints = computed(() => {
      const personal = referralBreakdown.value.personalBalance || 0;
      const onboardingBonus = hasReferrer.value ? 100 : 0;
      const directReferrals = (referralStats.value.level1 || 0) * 100;
      const accountedFor = onboardingBonus + directReferrals;
      const bonus = personal - accountedFor;
      return bonus > 0 ? bonus : 0;
    });

    // Detailed breakdown showing EVERY referral and their contribution
    const detailedBreakdown = computed(() => {
      const tree = referralTree.value;
      const depreciation = [50, 25, 12.5]; // Level 1, 2, 3 percentages
      const levels = [[], [], []];

      // Flatten tree and organize by level
      const flatReferrals = flattenTree(tree);

      flatReferrals.forEach((referral) => {
        const level = referral.level || 1;
        if (level >= 1 && level <= 3) {
          const percentage = depreciation[level - 1];
          const contribution = Math.round((referral.score || 0) * (percentage / 100));

          levels[level - 1].push({
            name: referral.pseudonym || 'Anonymous User',
            score: referral.score || 0,
            percentage,
            contribution,
          });
        }
      });

      return levels.filter((level) => level.length > 0);
    });

    // Calculate what YOU earn from each referral (with depreciation)
    const calculateYourEarnings = (referral) => {
      const level = referral.level || 1;
      const depreciation = [50, 25, 12.5]; // Level 1, 2, 3 percentages
      const percentage = depreciation[level - 1] || 0;
      const yourEarnings = Math.round((referral.score || 0) * (percentage / 100));
      return yourEarnings * 20; // Convert to Network Score (20x multiplier)
    };

    // Commission state
    const commissionSummary = ref(null);
    const commissionHistory = ref([]);
    const showAllCommissions = ref(false);

    // Fetch commission data
    const fetchCommissionData = async () => {
      if (!userEmail.value) return;

      try {
        // Fetch commission summary
        const summaryResponse = await fetch(`${API_CONFIG.REMOTE_URL}/referrals/commissions/summary`, {
          headers: {
            Authorization: `Bearer ${store.state.userAuth.token}`,
          },
        });

        if (summaryResponse.ok) {
          const summaryData = await summaryResponse.json();
          commissionSummary.value = summaryData;
        }

        // Fetch commission history
        const historyResponse = await fetch(`${API_CONFIG.REMOTE_URL}/referrals/commissions/history`, {
          headers: {
            Authorization: `Bearer ${store.state.userAuth.token}`,
          },
        });

        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          commissionHistory.value = historyData.commissions || [];
        }
      } catch (error) {
        console.error('Failed to fetch commission data:', error);
      }
    };

    // Setup Stripe Connect
    const setupStripeConnect = async () => {
      try {
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/marketplace/stripe/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${store.state.userAuth.token}`,
          },
          body: JSON.stringify({
            email: userEmail.value,
            return_url: `${window.location.origin}/settings?stripe=success`,
            refresh_url: `${window.location.origin}/settings?stripe=refresh`,
          }),
        });

        const data = await response.json();

        if (data.onboardingUrl) {
          window.location.href = data.onboardingUrl;
        }
      } catch (error) {
        console.error('Failed to setup Stripe Connect:', error);
        await simpleModal.value.showModal({
          title: 'Error',
          message: 'Failed to setup Stripe Connect. Please try again.',
          confirmText: 'OK',
          showCancel: false,
        });
      }
    };

    // Format commission date
    const formatCommissionDate = (timestamp) => {
      if (!timestamp) return 'Unknown';
      const date = new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    };

    // Format eligible date with countdown
    const formatEligibleDate = (timestamp) => {
      if (!timestamp) return '';
      const eligibleDate = new Date(timestamp);
      const now = new Date();
      const diffTime = eligibleDate - now;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) {
        return 'now';
      } else if (diffDays === 1) {
        return 'in 1 day';
      } else if (diffDays < 7) {
        return `in ${diffDays} days`;
      } else {
        return `on ${eligibleDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      }
    };

    // Format commission status
    const formatCommissionStatus = (status) => {
      const statusMap = {
        pending: 'Pending',
        approved: 'Approved',
        paid: 'Paid',
        cancelled: 'Cancelled',
      };
      return statusMap[status] || status;
    };

    // Fetch referral data on mount
    onMounted(async () => {
      if (userEmail.value) {
        await fetchUserReferralCode();
        await store.dispatch('userStats/fetchReferralBalance');
        await store.dispatch('userStats/fetchReferralTree');
        await fetchCommissionData();
      }
    });

    return {
      linkInput,
      linkCopied,
      codeCopied,
      commissionSummary,
      commissionHistory,
      setupStripeConnect,
      formatCommissionDate,
      formatEligibleDate,
      formatCommissionStatus,
      showAllCommissions,
      editablePseudonym,
      hasUnsavedChanges,
      isEditingPseudonym,
      isSavingPseudonym,
      pseudonymSaved,
      onPseudonymInput,
      enteredReferralCode,
      isSubmitting,
      codeError,
      codeSuccess,
      hasReferrer,
      userReferralData,
      userReferralCode,
      referralLink,
      referralBalance,
      referralTree,
      referralStats,
      referralCreditsDisplay,
      networkScoreBoost,
      groupedReferrals,
      personalBalanceDisplay,
      networkScoreDisplay,
      levelBreakdown,
      detailedBreakdown,
      agntBonusPoints,
      calculateYourEarnings,
      startEditingPseudonym,
      savePseudonym,
      copyReferralLink,
      submitReferralCode,
      formatDate,
    };
  },
};
</script>

<style scoped>
.referrals-section {
  display: flex;
  flex-direction: column;
  gap: 24px;
  width: 100%;
}

.referral-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 24px;
  transition: all 0.3s ease;
}

.referral-card:hover {
  border-color: var(--color-primary);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.1);
}

/* Card Header */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
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
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
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
  text-align: right;
}

.balance-display {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.balance-label {
  font-size: 0.75em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.balance-value {
  font-size: 1.5em;
  font-weight: bold;
  color: var(--color-primary);
}

/* Referral Link Section */
.referral-link-section {
  margin-bottom: 24px;
}

.input-label {
  display: block;
  font-size: 0.9em;
  color: var(--color-text);
  margin-bottom: 8px;
  font-weight: 500;
}

.link-input-group {
  display: flex;
  gap: 12px;
}

.referral-input {
  flex: 1;
  padding: 12px 16px;
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.referral-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.1);
}

.referral-input.editing {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.referral-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.copy-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.copy-button {
  padding: 12px 24px;
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
  white-space: nowrap;
}

.copy-button:hover {
  background: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3);
}

.copy-button.copied {
  background: var(--color-primary);
}

.help-text {
  margin-top: 8px;
  font-size: 0.85em;
  color: var(--color-text-muted);
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.stat-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: all 0.2s ease;
}

.stat-card:hover {
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.1);
}

.stat-icon {
  font-size: 2em;
  line-height: 1;
}

.stat-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 0.75em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.stat-value {
  font-size: 1.5em;
  font-weight: bold;
  color: var(--color-text);
}

.stat-subtext {
  font-size: 0.7em;
  color: var(--color-text-muted);
  margin-top: 2px;
}

/* Referral Tree */
.tree-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.tree-level {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.level-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--terminal-border-color);
}

.level-badge {
  padding: 4px 12px;
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary);
  border-radius: 6px;
  font-size: 0.85em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.level-count {
  font-size: 0.9em;
  color: var(--color-text-muted);
}

.referral-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.referral-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.referral-item:hover {
  background: rgba(127, 129, 147, 0.1);
  border-color: var(--color-primary);
}

.referral-item.active {
  border-color: rgba(var(--primary-rgb), 0.3);
}

.referral-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-darker-3);
  font-size: 1.2em;
}

.referral-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.referral-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.referral-pseudonym {
  font-size: 1em;
  color: var(--color-text);
  font-weight: 600;
}

.referral-email {
  font-size: 0.85em;
  color: var(--color-text-muted);
  font-weight: 400;
}

.referral-meta {
  display: flex;
  gap: 8px;
  font-size: 0.75em;
  flex-wrap: wrap;
}

.referral-code,
.referral-score {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-muted);
  padding: 2px 6px;
  background: rgba(127, 129, 147, 0.1);
  border-radius: 4px;
}

.referral-code i,
.referral-score i {
  font-size: 0.9em;
}

.referral-status {
  color: var(--color-grey);
  padding: 2px 8px;
  background: rgba(127, 129, 147, 0.2);
  border-radius: 4px;
  font-weight: 600;
}

.referral-status.active {
  color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.15);
}


.referral-rewards {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}

.reward-item {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.reward-label {
  font-size: 0.7em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.reward-value {
  font-size: 0.9em;
  color: var(--color-primary);
  font-weight: 700;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 48px 24px;
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
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
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

/* Scoring Explanation */
.scoring-explanation {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--terminal-border-color);
}

.explanation-title {
  font-size: 1.1em;
  color: var(--color-text);
  margin: 0 0 16px 0;
  font-weight: 600;
}

.explanation-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.level-explanation {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: rgba(127, 129, 147, 0.05);
  border-radius: 8px;
  border: 1px solid var(--terminal-border-color);
}

.level-badge-small {
  padding: 4px 10px;
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary);
  border-radius: 6px;
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  flex-shrink: 0;
}

.level-explanation p {
  margin: 0;
  font-size: 0.9em;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.level-explanation strong {
  color: var(--color-text);
}

.highlight-box {
  background: linear-gradient(135deg, rgba(var(--yellow-rgb), 0.1) 0%, rgba(var(--yellow-rgb), 0.05) 100%);
  border: 2px solid rgba(var(--yellow-rgb), 0.3);
}

.highlight-box .level-badge-small {
  background: rgba(var(--yellow-rgb), 0.2);
  color: var(--color-yellow);
}

.example-box {
  padding: 16px;
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.08) 0%, rgba(var(--primary-rgb), 0.04) 100%);
  border: 1px solid rgba(var(--primary-rgb), 0.2);
  border-radius: 8px;
  font-size: 0.9em;
  color: var(--color-text-muted);
  line-height: 1.6;
}

.example-box strong {
  color: var(--color-primary);
}

/* Dynamic Calculation Box */
.calculation-box {
  /* padding: 20px; */
  /* background: linear-gradient(135deg, rgba(var(--green-rgb), 0.12) 0%, rgba(18, 224, 255, 0.12) 100%); */
  /* border: 2px solid var(--terminal-border-color); */
  border-radius: 12px;
  margin-top: 8px;
  /* box-shadow: 0 4px 16px rgba(var(--green-rgb), 0.15); */
}

.calculation-box strong {
  color: var(--color-primary);
  font-size: 1.05em;
  display: block;
  /* margin-bottom: 16px; */
}

.calc-breakdown {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: var(--font-family-mono);
  margin-top: 8px;
}

.calc-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(127, 129, 147, 0.08);
  border-radius: 6px;
  border: 1px solid var(--terminal-border-color);
}

.calc-row.network-section {
  background: rgba(var(--primary-rgb), 0.08);
  border-color: rgba(var(--primary-rgb), 0.3);
}

.calc-row.total-row {
  background: rgba(var(--yellow-rgb), 0.1);
  border: 2px solid rgba(var(--yellow-rgb), 0.4);
  margin-top: 8px;
}

.calc-row.agnt-row {
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.15) 0%, rgba(var(--primary-rgb), 0.08) 100%);
  border: 2px solid var(--color-primary);
}

.calc-label {
  font-size: 0.9em;
  color: var(--color-text-muted);
  font-weight: 500;
}

.calc-value {
  font-size: 0.95em;
  color: var(--color-text);
  font-weight: 600;
}

.calc-value.agnt-boost {
  color: var(--color-primary);
  font-size: 1.1em;
}

.calc-detail {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 14px 8px 28px;
  background: rgba(127, 129, 147, 0.05);
  border-radius: 6px;
  border-left: 3px solid rgba(var(--primary-rgb), 0.3);
  font-size: 0.85em;
}

.calc-sublabel {
  color: var(--color-text-muted);
  font-weight: 500;
}

.calc-subvalue {
  color: var(--color-text);
  font-weight: 600;
}

.calc-formula {
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(127, 129, 147, 0.05);
  border-radius: 6px;
  text-align: center;
  font-size: 0.85em;
  color: var(--color-text-muted);
  font-style: italic;
}

/* Detailed Breakdown Styles */
.calc-detail-breakdown {
  margin-top: 8px;
  padding: 12px;
  background: rgba(127, 129, 147, 0.03);
  border-radius: 6px;
  border: 1px dashed var(--terminal-border-color);
}

.breakdown-level-header {
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.breakdown-level-label {
  font-size: 0.8em;
  color: var(--color-primary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.breakdown-referral {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  margin: 4px 0;
  background: rgba(127, 129, 147, 0.05);
  border-radius: 4px;
  font-size: 0.8em;
  transition: all 0.2s ease;
}

.breakdown-referral:hover {
  background: rgba(var(--primary-rgb), 0.08);
  transform: translateX(4px);
}

.breakdown-name {
  color: var(--color-text);
  font-weight: 500;
  flex: 1;
}

.breakdown-calc {
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: 0.9em;
  white-space: nowrap;
  margin-left: 12px;
}

/* Referral Code Entry Card */
.referral-code-card {
  border: 2px solid var(--color-primary);
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.05) 0%, rgba(var(--primary-rgb), 0.02) 100%);
}

.referral-code-card:hover {
  box-shadow: 0 8px 24px rgba(var(--primary-rgb), 0.2);
}

.bonus-icon {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

.referral-code-entry {
  margin-bottom: 0;
}

.code-input-group {
  display: flex;
  gap: 12px;
}

.referral-code-input {
  flex: 1;
  padding: 12px 16px;
  background: rgba(127, 129, 147, 0.1);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.referral-code-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb), 0.1);
}

.referral-code-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.submit-button {
  padding: 12px 24px;
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
  white-space: nowrap;
}

.submit-button:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.3);
}

.submit-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-message {
  color: var(--color-red);
  font-size: 0.85em;
  margin-top: 8px;
}

.success-message {
  color: var(--color-primary);
  font-size: 0.85em;
  margin-top: 8px;
  font-weight: 600;
}

/* Bonus Received Card */
.bonus-received-card {
  border: 2px solid var(--color-primary);
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.08) 0%, rgba(var(--primary-rgb), 0.04) 100%);
}

.bonus-received-card:hover {
  box-shadow: 0 8px 24px rgba(var(--primary-rgb), 0.25);
}

.success-icon {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
}

.bonus-info {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: rgba(127, 129, 147, 0.08);
  border-radius: 8px;
  border: 1px solid var(--terminal-border-color);
}

.info-label {
  font-size: 0.9em;
  color: var(--color-text-muted);
  font-weight: 500;
}

.info-value {
  font-size: 1em;
  color: var(--color-text);
  font-family: var(--font-family-mono);
  font-size: 0.9em;
}

.bonus-amount {
  color: var(--color-primary);
  font-size: 1.2em;
}

/* Commission Card Styles */
.commission-icon {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
}

.commission-value {
  color: var(--color-primary);
}

.commission-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.commission-stat {
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.commission-stat-icon {
  font-size: 1.8em;
}

.commission-stat-content {
  flex: 1;
}

.commission-stat-label {
  font-size: 0.75em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.commission-stat-value {
  font-size: 1.3em;
  font-weight: bold;
  color: var(--color-text);
}

.commission-stat-subtext {
  font-size: 0.7em;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.stripe-connect-prompt {
  display: flex;
  gap: 16px;
  padding: 20px;
  background: linear-gradient(135deg, rgba(var(--yellow-rgb), 0.1) 0%, rgba(var(--yellow-rgb), 0.05) 100%);
  border: 2px solid rgba(var(--yellow-rgb), 0.3);
  border-radius: 8px;
  margin-bottom: 24px;
}

.prompt-icon {
  font-size: 2em;
  color: var(--color-yellow);
}

.prompt-content {
  flex: 1;
}

.prompt-title {
  font-size: 1.1em;
  color: var(--color-text);
  margin: 0 0 8px 0;
}

.prompt-text {
  font-size: 0.9em;
  color: var(--color-text-muted);
  margin: 0 0 16px 0;
  line-height: 1.5;
}

.stripe-connect-button {
  padding: 10px 20px;
  background: var(--color-violet);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.stripe-connect-button:hover {
  background: var(--color-indigo);
  transform: translateY(-1px);
}

.commission-history {
  margin-top: 24px;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.history-title {
  font-size: 1.1em;
  color: var(--color-text);
  margin: 0;
}

.toggle-all-button {
  padding: 6px 12px;
  background: transparent;
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  font-size: 0.85em;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s ease;
}

.toggle-all-button:hover {
  background: var(--color-primary);
  color: white;
  transform: translateY(-1px);
}

.toggle-all-button i {
  font-size: 0.9em;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.history-item:hover {
  background: rgba(127, 129, 147, 0.1);
}

.history-item-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.history-item-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(var(--primary-rgb), 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-primary);
}

.history-item-info {
  flex: 1;
}

.history-item-title {
  font-size: 0.9em;
  color: var(--color-text);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-item-plan {
  padding: 2px 8px;
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary);
  border-radius: 4px;
  font-size: 0.85em;
  font-weight: 600;
}

.history-item-date {
  font-size: 0.75em;
  color: var(--color-text-muted);
  margin-top: 2px;
}

.history-item-eligible {
  font-size: 0.75em;
  color: var(--color-yellow);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.history-item-eligible i {
  font-size: 0.9em;
}

.history-item-paid {
  font-size: 0.75em;
  color: var(--color-primary);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
}

.history-item-paid i {
  font-size: 0.9em;
}

.history-item-stripe {
  font-size: 0.7em;
  color: var(--color-text-muted);
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-family-mono);
}

.history-item-stripe i {
  font-size: 0.9em;
  color: var(--color-violet);
}

.referral-name {
  color: var(--color-primary);
  font-weight: 700;
}

.history-item-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.history-item-amount {
  font-size: 1em;
  font-weight: bold;
  color: var(--color-text);
}

.history-item-status {
  font-size: 0.75em;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
}

.history-item-status.status-pending {
  background: rgba(var(--yellow-rgb), 0.2);
  color: var(--color-yellow);
}

.history-item-status.status-approved {
  background: rgba(var(--green-rgb), 0.2);
  color: var(--color-green);
}

.history-item-status.status-paid {
  background: rgba(var(--green-rgb), 0.2);
  color: var(--color-green);
}


.history-item-status.status-cancelled {
  background: rgba(var(--red-rgb), 0.2);
  color: var(--color-red);
}

.view-all-button {
  margin-top: 12px;
  padding: 8px 16px;
  background: transparent;
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100%;
}

.view-all-button:hover {
  background: var(--color-primary);
  color: white;
}

.commission-empty {
  text-align: center;
  padding: 40px 20px;
}

.commission-empty .empty-icon {
  font-size: 3em;
  margin-bottom: 12px;
}

.commission-empty .empty-title {
  font-size: 1.1em;
  color: var(--color-text);
  margin: 0 0 8px 0;
}

.commission-empty .empty-text {
  font-size: 0.9em;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.commission-loading {
  text-align: center;
  padding: 40px 20px;
  color: var(--color-text-muted);
}

.commission-loading i {
  font-size: 2em;
  margin-bottom: 12px;
}

/* Fraud Protection Notice */
.fraud-protection-notice {
  display: flex;
  gap: 16px;
  padding: 20px;
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.08) 0%, rgba(var(--primary-rgb), 0.04) 100%);
  border: 2px solid rgba(var(--primary-rgb), 0.3);
  border-radius: 8px;
  margin-top: 24px;
}

.notice-icon {
  font-size: 2em;
  color: var(--color-primary);
  flex-shrink: 0;
}

.notice-content {
  flex: 1;
}

.notice-title {
  font-size: 1.1em;
  color: var(--color-text);
  margin: 0 0 12px 0;
  font-weight: 600;
}

.notice-text {
  font-size: 0.9em;
  color: var(--color-text-muted);
  margin: 0 0 16px 0;
  line-height: 1.6;
}

.notice-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notice-detail-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 0.85em;
  color: var(--color-text);
  padding: 8px 12px;
  background: rgba(127, 129, 147, 0.05);
  border-radius: 6px;
  border-left: 3px solid var(--color-primary);
}

.notice-detail-item i {
  color: var(--color-primary);
  font-size: 1.1em;
  margin-top: 2px;
  flex-shrink: 0;
}

.notice-detail-item strong {
  color: var(--color-text);
}

/* Responsive Design */
@media (max-width: 768px) {
  .card-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }

  .header-right {
    width: 100%;
    text-align: left;
  }

  .link-input-group,
  .code-input-group {
    flex-direction: column;
  }

  .copy-button,
  .submit-button {
    width: 100%;
    justify-content: center;
  }

  .stats-grid,
  .commission-stats {
    grid-template-columns: 1fr;
  }

  .stripe-connect-prompt {
    flex-direction: column;
  }

  .history-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .history-item-right {
    width: 100%;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
