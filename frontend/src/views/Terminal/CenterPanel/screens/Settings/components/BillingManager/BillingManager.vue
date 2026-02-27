<template>
  <div class="billing-manager">
    <!-- Discount Ribbon -->
    <div v-if="showDiscountRibbon" class="discount-ribbon">
      <div class="ribbon-content">
        <span class="ribbon-icon">🎉</span>
        <div class="ribbon-text-container">
          <span class="ribbon-text">{{ DISCOUNT_MESSAGE }}</span>
          <span class="ribbon-countdown">{{ countdownText }}</span>
        </div>
        <span class="ribbon-icon">🎉</span>
      </div>
    </div>

    <!-- Header Section -->
    <div class="billing-header">
      <div class="header-content">
        <h2>Billing & Plans</h2>
        <p class="header-subtitle">Manage your subscription and billing preferences</p>
      </div>
      <div class="current-plan-badge" :class="{ 'pro-badge': planType !== 'free' }">
        <span class="badge-label">Current Plan</span>
        <span class="badge-plan">{{ currentPlan }}</span>
        <span v-if="subscriptionStatus !== 'Active' && planType !== 'free'" class="badge-status">{{ subscriptionStatus }}</span>
      </div>
    </div>

    <!-- Scheduled Plan Change Notice -->
    <div v-if="scheduledPlanChange" class="billing-section scheduled-change-notice" :class="{ 'upgrade-notice': isScheduledUpgrade }">
      <div class="notice-icon">{{ isScheduledUpgrade ? '🎉' : '⚠️' }}</div>
      <div class="notice-content">
        <h3>Scheduled Plan Change</h3>
        <p>
          You will be {{ isScheduledUpgrade ? 'upgraded' : 'downgraded' }} from <strong>{{ scheduledPlanChange.currentPlanName }}</strong> to
          <strong>{{ scheduledPlanChange.newPlanName }}</strong> on <strong>{{ formatDate(scheduledPlanChange.effectiveDate) }}</strong
          >.
        </p>
        <p class="notice-subtext">Your current {{ scheduledPlanChange.currentPlanName }} features remain active until then.</p>
        <button @click="isScheduledUpgrade ? handleCancelUpgrade : handleCancelDowngrade" class="cancel-change-button" :disabled="loading">
          {{ loading ? 'Processing...' : isScheduledUpgrade ? 'Cancel Upgrade' : 'Cancel Downgrade' }}
        </button>
      </div>
    </div>

    <!-- Plans Comparison Section -->
    <div class="billing-section">
      <div class="section-header">
        <h3>Compare Plans</h3>
        <p>Select the perfect plan for your needs. All plans include unlimited workflows and integrations.</p>

        <!-- Billing Interval Toggle -->
        <div class="billing-toggle">
          <button class="toggle-option" :class="{ active: selectedInterval === 'monthly' }" @click="selectedInterval = 'monthly'">Monthly</button>
          <button class="toggle-option" :class="{ active: selectedInterval === 'yearly' }" @click="selectedInterval = 'yearly'">
            Yearly
            <span class="save-badge">Save 33%</span>
          </button>
        </div>
      </div>

      <div class="comparison-table-wrapper">
        <table class="comparison-table">
          <thead>
            <tr>
              <th class="feature-column">Features</th>
              <th v-for="plan in plans" :key="plan.id" :class="{ 'current-plan-column': plan.name === currentPlan, 'popular-column': plan.popular }">
                <div class="plan-header-cell">
                  <div v-if="plan.popular" class="popular-badge">POPULAR</div>
                  <div class="plan-icon">{{ plan.icon }}</div>
                  <div class="plan-name">{{ plan.name }}</div>
                  <div class="plan-price">
                    <span v-if="plan.originalPrice" class="original-price">{{ plan.originalPrice }}</span>
                    <span class="current-price">{{ plan.price }}</span>
                  </div>
                  <div class="plan-tagline">{{ plan.tagline }}</div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(featureName, index) in allFeatures" :key="index" class="feature-row">
              <td class="feature-name">{{ featureName }}</td>
              <td
                v-for="plan in plans"
                :key="plan.id"
                :class="{ 'current-plan-column': plan.name === currentPlan, 'popular-column': plan.popular }"
                class="feature-cell"
              >
                <span class="feature-check" :class="{ included: getFeatureValue(plan, featureName) }">
                  {{ getFeatureValue(plan, featureName) ? '✓' : '—' }}
                  <span v-if="getFeatureDetail(plan, featureName)" class="feature-detail">
                    {{ getFeatureDetail(plan, featureName) }}
                  </span>
                </span>
              </td>
            </tr>
            <tr class="action-row">
              <td class="feature-name"></td>
              <td v-for="plan in plans" :key="plan.id" :class="{ 'current-plan-column': plan.name === currentPlan, 'popular-column': plan.popular }">
                <button
                  class="plan-button"
                  :class="[plan.name.toLowerCase().replace(' ', '-'), { 'current-plan-button': plan.name === currentPlan }]"
                  :disabled="plan.name === currentPlan || loading"
                  @click="handlePlanAction(plan)"
                >
                  {{ getPlanButtonText(plan) }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Subscription Management Section (for paid plans) -->
    <div v-if="planType !== 'free'" class="billing-section subscription-management">
      <div class="section-header">
        <h3>Subscription Details</h3>
      </div>

      <div class="subscription-row">
        <div class="subscription-info">
          <div class="info-item">
            <span class="info-label">Status:</span>
            <span class="info-value" :class="subscriptionStatus.toLowerCase().replace(' ', '-')">{{ subscriptionStatus }}</span>
          </div>
          <div v-if="renewalDate" class="info-item">
            <span class="info-label">{{ subscriptionDetails.cancelAtPeriodEnd ? 'Access Until:' : 'Renews On:' }}</span>
            <span class="info-value">{{ renewalDate }}</span>
          </div>
        </div>

        <div class="subscription-actions">
          <button v-if="canReactivate" @click="handleReactivate" class="action-button reactivate-button" :disabled="loading">
            {{ loading ? 'Processing...' : 'Reactivate Subscription' }}
          </button>
          <button v-if="canCancel" @click="handleCancel" class="action-button cancel-button" :disabled="loading">
            {{ loading ? 'Processing...' : 'Cancel Subscription' }}
          </button>
        </div>
      </div>

      <p v-if="subscriptionDetails.cancelAtPeriodEnd" class="cancellation-notice">
        Your subscription is set to cancel on {{ renewalDate }}. You'll retain access until then.
      </p>
    </div>

    <SimpleModal ref="modal" />

    <!-- Contact Sales Modal -->
    <div v-if="showContactSalesModal" class="modal-overlay" @click.self="showContactSalesModal = false">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Contact Sales - Enterprise Plan</h3>
          <button class="close-btn" @click="showContactSalesModal = false">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <p class="modal-description">Tell us about your enterprise needs and our team will get back to you within 24 hours.</p>

          <div class="form-field">
            <label for="contact-name">Name *</label>
            <input id="contact-name" v-model="contactForm.name" type="text" placeholder="Your full name" class="form-input" />
          </div>

          <div class="form-field">
            <label for="contact-company">Company *</label>
            <input id="contact-company" v-model="contactForm.company" type="text" placeholder="Your company name" class="form-input" />
          </div>

          <div class="form-field">
            <label for="contact-employees">Number of Employees *</label>
            <input id="contact-employees" v-model="contactForm.employees" type="number" placeholder="e.g., 50" class="form-input" min="1" />
          </div>

          <div class="form-field">
            <label for="contact-message">Message *</label>
            <textarea
              id="contact-message"
              v-model="contactForm.message"
              placeholder="Describe your requirements and any specific features you need..."
              rows="6"
              class="contact-textarea"
            ></textarea>
          </div>

          <div class="image-upload-section">
            <label class="upload-label">
              <i class="fas fa-image"></i>
              <span>{{ uploadedImage ? 'Change Screenshot' : 'Attach Screenshot (Optional)' }}</span>
              <input type="file" accept="image/*" @change="handleImageUpload" class="file-input" />
            </label>

            <div v-if="uploadedImage" class="image-preview">
              <img :src="imagePreview" alt="Screenshot preview" />
              <button @click="removeImage" class="remove-image-btn" type="button">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showContactSalesModal = false">Cancel</button>
          <button class="btn btn-primary" @click="submitContactSales" :disabled="!isFormValid || isSubmitting">
            {{ isSubmitting ? 'Sending...' : 'Send Inquiry' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { mapState, mapGetters, mapActions } from 'vuex';
import { useStore } from 'vuex';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';
import { API_CONFIG } from '@/tt.config.js';
import { onMounted, onBeforeUnmount } from 'vue';

// ============================================
// DISCOUNT CONFIGURATION
// ============================================
const DISCOUNT_ENABLED = false; // Set to true to enable discount pricing
const DISCOUNT_END_DATE = '2025-12-25T23:59:59'; // Christmas Day - When the discount expires
const DISCOUNT_MESSAGE = '🎅 12 Days of Christmas: 33% OFF all plans! '; // Message to display in ribbon

export default {
  name: 'BillingManager',
  components: {
    SimpleModal,
  },
  computed: {
    ...mapState('userAuth', ['subscription', 'planType']),
    ...mapGetters('userAuth', ['hasFeature']),

    currentPlan() {
      // Map planType to display name
      const planMap = {
        free: 'Community Core',
        personal: 'Personal Pro',
        business: 'Business Pro',
        enterprise: 'Enterprise',
      };
      return planMap[this.planType] || 'Community Core';
    },

    subscriptionDetails() {
      return this.subscription || {};
    },

    scheduledPlanChange() {
      return this.subscription?.scheduledPlanChange || null;
    },

    canCancel() {
      return this.planType !== 'free' && !this.subscriptionDetails.cancelAtPeriodEnd;
    },

    canReactivate() {
      return this.subscriptionDetails.cancelAtPeriodEnd === true;
    },

    renewalDate() {
      if (this.subscriptionDetails.currentPeriodEnd) {
        return new Date(this.subscriptionDetails.currentPeriodEnd * 1000).toLocaleDateString();
      }
      return null;
    },

    subscriptionStatus() {
      if (this.planType === 'free') return 'Free Plan';
      if (this.subscriptionDetails.cancelAtPeriodEnd) return 'Canceling';
      if (this.subscriptionDetails.planStatus === 'past_due') return 'Past Due';
      return 'Active';
    },

    allFeatures() {
      const featuresSet = new Set();
      this.plans.forEach((plan) => {
        plan.features.forEach((feature) => {
          featuresSet.add(feature.text);
        });
      });
      return Array.from(featuresSet);
    },

    isFormValid() {
      return (
        this.contactForm.name.trim() !== '' &&
        this.contactForm.company.trim() !== '' &&
        this.contactForm.employees !== '' &&
        this.contactForm.message.trim() !== ''
      );
    },

    showDiscountRibbon() {
      if (!DISCOUNT_ENABLED) return false;
      const endDate = new Date(DISCOUNT_END_DATE);
      const now = new Date();
      return now < endDate;
    },

    discountEndDateFormatted() {
      const endDate = new Date(DISCOUNT_END_DATE);
      return endDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    },

    countdownText() {
      if (!this.countdown) return `Ends ${this.discountEndDateFormatted}`;

      const { days, hours, minutes, seconds } = this.countdown;

      if (days > 0) {
        return `Ends in ${days}d ${hours}h ${minutes}m ${seconds}s`;
      } else if (hours > 0) {
        return `Ends in ${hours}h ${minutes}m ${seconds}s`;
      } else if (minutes > 0) {
        return `Ends in ${minutes}m ${seconds}s`;
      } else {
        return `Ends in ${seconds}s`;
      }
    },

    activePricingTier() {
      // Use discount pricing if DISCOUNT_ENABLED flag is true
      return DISCOUNT_ENABLED ? 'discount' : 'base';
    },

    isScheduledUpgrade() {
      if (!this.scheduledPlanChange) return false;
      const planHierarchy = ['Community Core', 'Personal Pro', 'Business Pro', 'Enterprise'];
      const currentIndex = planHierarchy.indexOf(this.scheduledPlanChange.currentPlanName);
      const newIndex = planHierarchy.indexOf(this.scheduledPlanChange.newPlanName);
      return newIndex > currentIndex;
    },

    plans() {
      // Get the active pricing based on selected interval
      const interval = this.selectedInterval;
      const prices = this.activePrices;

      return [
        {
          id: 2,
          name: 'Personal Pro',
          icon: '⭐',
          price: prices.personal[interval].price,
          originalPrice: prices.personal[interval].originalPrice,
          tagline: 'Best for individuals',
          features: [
            { text: 'Full Core Features', included: true },
            { text: 'Unlimited workflows', included: true },
            { text: 'All integrations', included: true },
            { text: 'Paid Marketplace Listings', included: true },
            { text: 'Support', included: true, detail: 'Community Pro (< 48h)' },
            { text: 'Cloud Sync', included: true, detail: 'Sync Every 15m' },
            { text: 'API Access', included: true, detail: 'Personal' },
            { text: 'Webhooks', included: true, detail: 'Trigger Every 15m' },
            { text: 'Email Server', included: true, detail: 'Batches Every 15m' },
            { text: 'Multi-Seat', included: false },
            { text: 'White-Label', included: false },
            { text: 'White Glove Concierge + SLA', included: false },
          ],
        },
        {
          id: 3,
          name: 'Business Pro',
          icon: '🚀',
          price: prices.business[interval].price,
          originalPrice: prices.business[interval].originalPrice,
          tagline: 'For teams up to 10',
          popular: true,
          features: [
            { text: 'Full Core Features', included: true },
            { text: 'Unlimited workflows', included: true },
            { text: 'All integrations', included: true },
            { text: 'Paid Marketplace Listings', included: true },
            { text: 'Support', included: true, detail: 'Business Pro (< 24h)' },
            { text: 'Cloud Sync', included: true, detail: 'Realtime Sync' },
            { text: 'API Access', included: true, detail: 'Business' },
            { text: 'Webhooks', included: true, detail: 'Realtime Trigger' },
            { text: 'Email Server', included: true, detail: 'Realtime Email' },
            { text: 'Multi-Seat', included: true, detail: '(up to 10)' },
            { text: 'White-Label', included: false },
            { text: 'White Glove Concierge + SLA', included: false },
          ],
        },
        {
          id: 4,
          name: 'Enterprise',
          icon: '👑',
          price: '$33k+/year',
          tagline: 'Custom solutions',
          features: [
            { text: 'Full Core Features', included: true },
            { text: 'Unlimited workflows', included: true },
            { text: 'All integrations', included: true },
            { text: 'Paid Marketplace Listings', included: true },
            { text: 'Support', included: true, detail: 'Business Pro (< 12h)' },
            { text: 'Cloud Sync', included: true, detail: 'Realtime Sync' },
            { text: 'API Access', included: true, detail: 'Unlimited' },
            { text: 'Webhooks', included: true, detail: 'Realtime Trigger' },
            { text: 'Email Server', included: true, detail: 'Realtime Email' },
            { text: 'Multi-Seat', included: true, detail: '(Unlimited)' },
            { text: 'White-Label', included: true, detail: 'Full' },
            { text: 'White Glove Concierge + SLA', included: true, detail: 'Custom' },
          ],
        },
      ];
    },
  },
  methods: {
    ...mapActions('userAuth', ['fetchSubscription', 'createSubscription', 'cancelSubscription', 'reactivateSubscription']),

    updateCountdown() {
      const endDate = new Date(DISCOUNT_END_DATE);
      const now = new Date();
      const diff = endDate - now;

      if (diff <= 0) {
        this.countdown = null;
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      this.countdown = { days, hours, minutes, seconds };
    },

    getFeatureValue(plan, featureName) {
      const feature = plan.features.find((f) => f.text === featureName);
      return feature ? feature.included : false;
    },
    getFeatureDetail(plan, featureName) {
      const feature = plan.features.find((f) => f.text === featureName);
      return feature && feature.detail ? feature.detail : '';
    },

    getPlanButtonText(plan) {
      if (plan.name === this.currentPlan) {
        return 'Current Plan';
      }

      if (plan.name === 'Enterprise') {
        return 'Contact Sales';
      }

      const planHierarchy = ['Community Core', 'Personal Pro', 'Business Pro', 'Enterprise'];
      const currentIndex = planHierarchy.indexOf(this.currentPlan);
      const targetIndex = planHierarchy.indexOf(plan.name);

      if (targetIndex < currentIndex) {
        return 'Downgrade';
      }

      return 'Upgrade to Pro';
    },

    async handlePlanAction(plan) {
      if (plan.name === this.currentPlan) {
        return; // Already on this plan
      }

      if (plan.name === 'Enterprise') {
        this.handleContactSales();
        return;
      }

      if (plan.name === 'Community Core') {
        // Downgrade to free - would need to cancel subscription
        const confirmed = await this.$refs.modal.showModal({
          title: 'Downgrade to Free Plan?',
          message: "Your subscription will be cancelled at the end of the billing period. You'll keep access until then.",
          confirmText: 'Downgrade',
          cancelText: 'Keep Subscription',
          confirmClass: 'btn-danger',
        });
        if (confirmed) {
          await this.handleCancel();
        }
        return;
      }

      // Determine if this is a downgrade or upgrade
      const planHierarchy = ['Community Core', 'Personal Pro', 'Business Pro', 'Enterprise'];
      const currentIndex = planHierarchy.indexOf(this.currentPlan);
      const targetIndex = planHierarchy.indexOf(plan.name);
      const isDowngrade = targetIndex < currentIndex;

      if (isDowngrade) {
        await this.handleDowngrade(plan.name);
      } else {
        await this.handleUpgrade(plan.name);
      }
    },

    async handleDowngrade(planName) {
      const confirmed = await this.$refs.modal.showModal({
        title: `Downgrade to ${planName}?`,
        message: `You'll keep your current plan features until ${this.renewalDate}, then switch to ${planName}. No refunds will be issued.`,
        confirmText: 'Schedule Downgrade',
        cancelText: 'Keep Current Plan',
        confirmClass: 'btn-danger',
      });

      if (!confirmed) {
        return;
      }

      this.loading = true;
      try {
        const planTypeMap = {
          'Personal Pro': 'personal',
          'Business Pro': 'business',
        };

        const token = this.$store.state.userAuth.token;
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/users/subscription/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          body: JSON.stringify({
            newPlanType: planTypeMap[planName],
            interval: 'yearly',
            pricingTier: this.activePricingTier,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to schedule downgrade');
        }

        await this.fetchSubscription();

        const effectiveDate = new Date(data.effectiveDate * 1000).toLocaleDateString();

        await this.$refs.modal.showModal({
          title: 'Downgrade Scheduled',
          message: `Your plan will change to ${planName} on ${effectiveDate}. You'll keep your current features until then.`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Downgrade error:', error);
        await this.$refs.modal.showModal({
          title: 'Downgrade Failed',
          message: error.message || 'Failed to schedule downgrade. Please try again.',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } finally {
        this.loading = false;
      }
    },

    async handleUpgrade(planName) {
      // If user is on free plan, they need to create a new subscription
      if (this.planType === 'free') {
        this.loading = true;
        try {
          const planTypeMap = {
            'Personal Pro': 'personal',
            'Business Pro': 'business',
          };

          await this.createSubscription({
            planType: planTypeMap[planName],
            interval: this.selectedInterval,
            pricingTier: this.activePricingTier,
            successUrl: `${window.location.origin}/settings?subscription=success`,
            cancelUrl: `${window.location.origin}/settings?subscription=cancelled`,
          });
          // User will be redirected to Stripe checkout
        } catch (error) {
          console.error('Upgrade error:', error);
          await this.$refs.modal.showModal({
            title: 'Upgrade Failed',
            message: 'Failed to start upgrade process. Please try again.',
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-primary',
          });
        } finally {
          this.loading = false;
        }
        return;
      }

      // User already has a subscription, upgrade it immediately
      const confirmed = await this.$refs.modal.showModal({
        title: `Upgrade to ${planName}?`,
        message: `You'll be charged the prorated difference and immediately get access to ${planName} features.`,
        confirmText: 'Upgrade Now',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
      });

      if (!confirmed) {
        return;
      }

      this.loading = true;
      try {
        const planTypeMap = {
          'Personal Pro': 'personal',
          'Business Pro': 'business',
        };

        const token = this.$store.state.userAuth.token;
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/users/subscription/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          body: JSON.stringify({
            newPlanType: planTypeMap[planName],
            interval: 'yearly',
            pricingTier: this.activePricingTier,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to upgrade');
        }

        await this.fetchSubscription();

        // Trigger confetti animation
        this.triggerConfetti();

        await this.$refs.modal.showModal({
          title: 'Upgrade Successful!',
          message: `Welcome to ${planName}! Your new features are now active.`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Upgrade error:', error);
        await this.$refs.modal.showModal({
          title: 'Upgrade Failed',
          message: error.message || 'Failed to upgrade. Please try again.',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } finally {
        this.loading = false;
      }
    },

    async handleCancel() {
      const confirmed = await this.$refs.modal.showModal({
        title: 'Cancel Subscription?',
        message: "You'll keep access until the end of your billing period.",
        confirmText: 'Cancel Subscription',
        cancelText: 'Keep Subscription',
        confirmClass: 'btn-danger',
      });

      if (!confirmed) {
        return;
      }

      this.loading = true;
      try {
        await this.cancelSubscription();
        await this.fetchSubscription();
        await this.$refs.modal.showModal({
          title: 'Subscription Cancelled',
          message: 'You will retain access until the end of your billing period.',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Cancel error:', error);
        await this.$refs.modal.showModal({
          title: 'Cancellation Failed',
          message: 'Failed to cancel subscription. Please try again.',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } finally {
        this.loading = false;
      }
    },

    async handleReactivate() {
      this.loading = true;
      try {
        await this.reactivateSubscription();
        await this.fetchSubscription();
        await this.$refs.modal.showModal({
          title: 'Subscription Reactivated',
          message: 'Your subscription has been reactivated successfully!',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Reactivate error:', error);
        await this.$refs.modal.showModal({
          title: 'Reactivation Failed',
          message: 'Failed to reactivate subscription. Please try again.',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } finally {
        this.loading = false;
      }
    },

    async handleCancelDowngrade() {
      const confirmed = await this.$refs.modal.showModal({
        title: 'Cancel Scheduled Downgrade?',
        message: `You'll keep your current ${this.currentPlan} plan and continue to be billed at the current rate.`,
        confirmText: 'Keep Current Plan',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary',
      });

      if (!confirmed) {
        return;
      }

      this.loading = true;
      try {
        const token = this.$store.state.userAuth.token;
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/users/subscription/cancel-downgrade`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to cancel downgrade');
        }

        await this.fetchSubscription();

        await this.$refs.modal.showModal({
          title: 'Downgrade Cancelled',
          message: `You'll continue on your ${this.currentPlan} plan. The scheduled downgrade has been removed.`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Cancel downgrade error:', error);
        await this.$refs.modal.showModal({
          title: 'Cancellation Failed',
          message: error.message || 'Failed to cancel downgrade. Please try again.',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } finally {
        this.loading = false;
      }
    },

    async handleCancelUpgrade() {
      const confirmed = await this.$refs.modal.showModal({
        title: 'Cancel Scheduled Upgrade?',
        message: `You'll stay on your current ${this.currentPlan} plan. The scheduled upgrade has been removed.`,
        confirmText: 'Cancel Upgrade',
        cancelText: 'Keep Upgrade',
        confirmClass: 'btn-danger',
      });

      if (!confirmed) {
        return;
      }

      this.loading = true;
      try {
        const token = this.$store.state.userAuth.token;
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/users/subscription/cancel-downgrade`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to cancel upgrade');
        }

        await this.fetchSubscription();

        await this.$refs.modal.showModal({
          title: 'Upgrade Cancelled',
          message: `You'll continue on your ${this.currentPlan} plan. The scheduled upgrade has been removed.`,
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } catch (error) {
        console.error('Cancel upgrade error:', error);
        await this.$refs.modal.showModal({
          title: 'Cancellation Failed',
          message: error.message || 'Failed to cancel upgrade. Please try again.',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } finally {
        this.loading = false;
      }
    },

    handleContactSales() {
      this.showContactSalesModal = true;
    },

    handleImageUpload(event) {
      const file = event.target.files[0];
      if (file && file.type.startsWith('image/')) {
        this.uploadedImage = file;
        const reader = new FileReader();
        reader.onload = (e) => {
          this.imagePreview = e.target.result;
        };
        reader.readAsDataURL(file);
      }
    },

    removeImage() {
      this.uploadedImage = null;
      this.imagePreview = '';
    },

    formatDate(timestamp) {
      if (!timestamp) return '';
      return new Date(timestamp * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    },

    async submitContactSales() {
      if (!this.isFormValid) return;

      this.isSubmitting = true;
      try {
        const token = localStorage.getItem('token');
        const userEmail = this.$store.getters['userAuth/userEmail'] || '';
        const userName = this.$store.getters['userAuth/userName'] || '';

        const message = `
Enterprise Contact Form Submission:
Company: ${this.contactForm.company}
Number of Employees: ${this.contactForm.employees}
Contact Name: ${this.contactForm.name}

Message:
${this.contactForm.message}
        `.trim();

        const response = await fetch(`${API_CONFIG.REMOTE_URL}/email/send-enterprise-inquiry`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            inquiry: message,
            userEmail: userEmail || this.contactForm.name,
            userName: userName || this.contactForm.name,
            screenshot: this.uploadedImage ? this.imagePreview : null,
          }),
        });

        const data = await response.json();

        if (data.success) {
          // Success - close modal and reset
          this.showContactSalesModal = false;
          this.contactForm = {
            name: '',
            company: '',
            employees: '',
            message: '',
          };
          this.uploadedImage = null;
          this.imagePreview = '';

          // Show success modal
          await this.$refs.modal.showModal({
            title: 'Inquiry Sent!',
            message: 'Thank you for your interest in our Enterprise plan. Our sales team will contact you within 24 hours.',
            confirmText: 'OK',
            showCancel: false,
            confirmClass: 'btn-primary',
          });
        } else {
          throw new Error(data.error || 'Failed to send inquiry');
        }
      } catch (error) {
        console.error('Error submitting contact sales inquiry:', error);
        await this.$refs.modal.showModal({
          title: 'Submission Failed',
          message: 'Failed to send inquiry. Please try again or email us directly at sales@agnt.gg',
          confirmText: 'OK',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } finally {
        this.isSubmitting = false;
      }
    },

    // Confetti animation
    triggerConfetti() {
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
    },
  },
  async mounted() {
    // Load confetti library if not already loaded
    if (!window.confetti) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
      document.head.appendChild(script);
    }

    // Initialize countdown timer for discount ribbon
    if (this.showDiscountRibbon) {
      this.updateCountdown();
      this.countdownInterval = setInterval(this.updateCountdown, 1000);
    }

    this.loading = true;
    try {
      // Check if returning from Stripe checkout
      const urlParams = new URLSearchParams(window.location.search);
      const subscriptionStatus = urlParams.get('subscription');

      if (subscriptionStatus === 'success') {
        // Wait longer for webhooks to process and database to update
        console.log('Waiting for subscription to process...');
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Force multiple refresh attempts to ensure we get the updated data
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
          await this.fetchSubscription();

          // Check if subscription was updated
          if (this.planType !== 'free') {
            console.log('Subscription found!', this.planType);
            break;
          }

          // Wait before next attempt
          if (attempts < maxAttempts - 1) {
            console.log(`Attempt ${attempts + 1}/${maxAttempts} - subscription not yet updated, retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          attempts++;
        }

        // Clear the URL parameter
        window.history.replaceState({}, document.title, window.location.pathname);

        // Trigger confetti animation
        this.triggerConfetti();

        // Show success modal
        await this.$refs.modal.showModal({
          title: 'Subscription Activated!',
          message: `Welcome to ${this.currentPlan}! Your subscription is now active.`,
          confirmText: 'Get Started',
          showCancel: false,
          confirmClass: 'btn-primary',
        });
      } else if (subscriptionStatus === 'cancelled') {
        // User cancelled checkout - clear URL and fetch subscription
        // We still need to fetch to ensure we have the latest data
        console.log('User cancelled Stripe checkout - fetching current subscription status');
        window.history.replaceState({}, document.title, window.location.pathname);
        await this.fetchSubscription();
      } else {
        // Normal page load - fetch subscription data
        await this.fetchSubscription();
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      this.loading = false;
    }
  },
  beforeUnmount() {
    // Clean up countdown interval
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  },
  data() {
    // Define base and discount prices for both monthly and yearly
    const basePrices = {
      personal: {
        monthly: { price: '$33/mo', originalPrice: null },
        yearly: { price: '$333/year', originalPrice: null },
      },
      business: {
        monthly: { price: '$333/mo', originalPrice: null },
        yearly: { price: '$3,333/year', originalPrice: null },
      },
    };

    const discountPrices = {
      personal: {
        monthly: { price: '$22/mo', originalPrice: '$33/mo' },
        yearly: { price: '$222/year', originalPrice: '$333/year' },
      },
      business: {
        monthly: { price: '$222/mo', originalPrice: '$333/mo' },
        yearly: { price: '$2,222/year', originalPrice: '$3,333/year' },
      },
    };

    // Select prices based on DISCOUNT_ENABLED flag
    const activePrices = DISCOUNT_ENABLED ? discountPrices : basePrices;

    return {
      DISCOUNT_MESSAGE, // Make the constant available in template
      loading: false,
      showContactSalesModal: false,
      countdown: null,
      countdownInterval: null,
      selectedInterval: 'yearly', // Default to yearly
      contactForm: {
        name: '',
        company: '',
        employees: '',
        message: '',
      },
      isSubmitting: false,
      uploadedImage: null,
      imagePreview: '',
      basePrices,
      discountPrices,
      activePrices,
    };
  },
};
</script>

<style scoped>
.billing-manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
}

/* Professional Header */
.billing-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  background: rgba(var(--primary-rgb), 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  gap: 20px;
}

body.dark .billing-header {
  background: rgba(var(--primary-rgb), 0.05);
}

.header-content h2 {
  color: var(--color-primary);
  font-size: 1.4em;
  font-weight: 700;
  margin: 0 0 4px 0;
  letter-spacing: -0.5px;
}

.header-subtitle {
  color: var(--color-light-med-navy);
  font-size: 0.85em;
  margin: 0;
  opacity: 0.8;
}

.current-plan-badge {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding: 10px 16px;
  background: rgba(var(--primary-rgb), 0.1);
  border: 2px solid var(--color-primary);
  border-radius: 8px;
  min-width: 140px;
}

.current-plan-badge.pro-badge {
  background: rgba(var(--yellow-rgb), 0.15);
  border: 2px solid rgba(var(--yellow-rgb), 0.4);
  /* box-shadow: 0 0 12px rgba(var(--yellow-rgb), 0.3); */
}

.badge-label {
  color: var(--color-light-med-navy);
  font-size: 0.65em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  opacity: 0.7;
}

.badge-plan {
  color: var(--color-primary);
  font-size: 0.95em;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.current-plan-badge.pro-badge .badge-plan {
  color: var(--color-yellow);
}

.badge-status {
  color: var(--color-primary);
  font-size: 0.7em;
  font-weight: 600;
  margin-top: 2px;
}

.billing-section {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  padding: 20px;
  transition: all 0.3s ease;
}

body.dark .billing-section {
  background: rgba(0, 0, 0, 10%);
  border: 1px solid var(--terminal-border-color);
}

.section-header {
  margin-bottom: 20px;
  text-align: center;
}

.section-header h3 {
  color: var(--color-primary);
  font-size: 1.3em;
  font-weight: 700;
  margin: 0 0 6px 0;
  letter-spacing: -0.3px;
}

.section-header p {
  color: var(--color-light-med-navy);
  font-size: 0.85em;
  margin: 0;
  opacity: 0.8;
  max-width: 600px;
  margin: 0 auto;
  line-height: 1.4;
}

/* Billing Toggle */
.billing-toggle {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-top: 16px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  width: fit-content;
  margin-left: auto;
  margin-right: auto;
}

body.dark .billing-toggle {
  background: rgba(255, 255, 255, 0.05);
}

.toggle-option {
  padding: 8px 20px;
  border: none;
  background: transparent;
  color: var(--color-light-med-navy);
  font-size: 0.85em;
  font-weight: 600;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.3s ease;
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
}

.toggle-option:hover {
  color: var(--color-primary);
}

.toggle-option.active {
  background: var(--color-primary);
  color: var(--color-dark-navy);
  box-shadow: 0 2px 8px rgba(var(--primary-rgb), 0.3);
}

.save-badge {
  background: rgba(var(--yellow-rgb), 0.9);
  color: var(--color-dark-navy);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.75em;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.toggle-option.active .save-badge {
  background: var(--color-yellow);
}

/* Subscription Management */
.subscription-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 32px;
}

.subscription-info {
  display: flex;
  gap: 32px;
  justify-content: flex-start;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-label {
  color: var(--color-light-med-navy);
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  opacity: 0.7;
}

.info-value {
  color: var(--color-primary);
  font-size: 1em;
  font-weight: 700;
}

.info-value.past-due {
  color: var(--color-primary);
}

.info-value.canceling {
  color: var(--color-orange);
}

.subscription-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.action-button {
  padding: 10px 20px;
  border: 2px solid;
  border-radius: 8px;
  font-size: 0.85em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.cancel-button {
  background: transparent;
  color: var(--color-red);
  border: none;
}

.cancel-button:hover:not(:disabled) {
  background: var(--color-red);
  color: white;
}

.reactivate-button {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
  margin-top: 24px;
}

.reactivate-button:hover:not(:disabled) {
  background: var(--color-light-green);
  border-color: var(--color-light-green);
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cancellation-notice {
  margin-top: 16px;
  padding: 12px;
  background: rgba(var(--pink-rgb), 0.1);
  border: 1px solid var(--color-primary);
  border-radius: 6px;
  color: var(--color-primary);
  font-size: 0.85em;
  text-align: center;
}

/* Cancel Section at Bottom */
.cancel-section {
  background: rgba(var(--red-rgb), 0.05);
  border: 1px solid var(--color-red);
}

.cancel-section .section-header h3 {
  color: var(--color-red);
}

.cancel-actions {
  display: flex;
  justify-content: center;
}

.cancel-button-bottom {
  background: var(--color-red);
  color: white;
  border-color: var(--color-red);
  padding: 12px 32px;
  font-size: 0.9em;
}

.cancel-button-bottom:hover:not(:disabled) {
  background: var(--color-primary);
  border-color: var(--color-primary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--red-rgb), 0.4);
}

/* Comparison Table */
.comparison-table-wrapper {
  overflow-x: auto;
  scrollbar-width: thin !important;
  border-radius: 12px;
  border: 1px solid var(--terminal-border-color);
}

.comparison-table {
  width: 100%;
  border-collapse: collapse;
  background: transparent;
}

.comparison-table thead tr {
  background: linear-gradient(135deg, rgba(var(--primary-rgb), 0.05), rgba(var(--primary-rgb), 0.02));
}

.comparison-table th {
  padding: 16px 12px;
  text-align: center;
  vertical-align: middle;
  border-right: 1px solid var(--terminal-border-color);
  border-bottom: 2px solid var(--terminal-border-color);
  position: relative;
}

.comparison-table th:last-child {
  border-right: none;
}

.comparison-table th.feature-column {
  text-align: left;
  color: var(--color-primary);
  font-weight: 700;
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  width: 180px;
  min-width: 180px;
}

.plan-header-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  position: relative;
  min-height: 120px;
}

.popular-badge {
  position: absolute;
  top: -10px;
  background: var(--color-primary);
  color: white;
  padding: 2px 8px 0;
  border-radius: 8px;
  font-size: 0.6em;
  font-weight: 700;
  letter-spacing: 0.3px;
  z-index: -1;
}

.plan-icon {
  font-size: 1.6em;
}

.plan-name {
  color: var(--color-primary);
  font-size: 0.85em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin: 0;
}

.plan-price {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}

.original-price {
  color: var(--color-med-navy);
  font-size: 0.7em;
  text-decoration: line-through;
  opacity: 0.6;
  font-family: var(--font-family-mono);
}

.current-price {
  color: var(--color-light-med-navy);
  font-size: 0.95em;
  font-weight: 600;
  font-family: var(--font-family-mono);
}

.plan-tagline {
  color: var(--color-light-med-navy);
  font-size: 0.7em;
  opacity: 0.7;
}

.feature-row {
  border-bottom: 1px solid var(--terminal-border-color);
  transition: background-color 0.2s ease;
}

.feature-row:hover {
  background: rgba(var(--primary-rgb), 0.03);
}

.feature-name {
  padding: 10px 12px;
  color: var(--color-light-med-navy);
  font-weight: 500;
  font-size: 0.8em;
  text-align: left;
  vertical-align: middle;
  border-right: 1px solid var(--terminal-border-color);
}

.feature-cell {
  padding: 8px 12px;
  text-align: center;
  vertical-align: middle;
  border-right: 1px solid var(--terminal-border-color);
}

.feature-cell:last-child {
  border-right: none;
}

.feature-check {
  font-size: 1.1em;
  font-weight: 700;
  color: var(--color-med-navy);
  opacity: 0.3;
}

.feature-check.included {
  color: var(--color-primary);
  opacity: 1;
}

.feature-detail {
  display: inline-block;
  margin-left: 4px;
  font-size: 0.7em;
  font-weight: 500;
  color: var(--color-light-med-navy);
  opacity: 0.8;
  white-space: nowrap;
}

.action-row {
  border-top: 2px solid var(--terminal-border-color);
}

.action-row td {
  padding: 14px 12px;
  border-right: 1px solid var(--terminal-border-color);
}

.action-row td:first-child {
  padding: 0;
}

.action-row td:last-child {
  border-right: none;
}

.plan-button {
  margin: 0;
  padding: 12px 16px;
  border: 2px solid transparent;
  border-radius: 8px;
  font-size: 0.8em;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.25s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.plan-button.community-core,
.plan-button.personal-pro,
.plan-button.business-pro,
.plan-button.enterprise {
  background: rgba(var(--primary-rgb), 0.05);
  color: var(--color-text);
  border-color: var(--color-primary);
}

.plan-button.community-core:hover:not(:disabled),
.plan-button.personal-pro:hover:not(:disabled),
.plan-button.business-pro:hover:not(:disabled),
.plan-button.enterprise:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(var(--primary-rgb), 0.4);
  filter: brightness(1.1);
}

.plan-button.current-plan-button {
  background: var(--color-lighter-0);
  color: var(--color-text);
  border: none;
  border-color: var(--color-primary);
  cursor: not-allowed;
  opacity: 0.8;
  font-weight: 700;
}

.plan-button.current-plan-button:hover {
  transform: none;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.plan-button:disabled {
  cursor: not-allowed;
  opacity: 0.8;
}

/* Responsive Design */
@media (max-width: 768px) {
  .billing-manager {
    gap: 20px;
  }

  .billing-header {
    flex-direction: column;
    align-items: flex-start;
    padding: 24px;
  }

  .current-plan-badge {
    width: 100%;
    align-items: flex-start;
  }

  .billing-section {
    padding: 24px;
    border-radius: 12px;
  }

  .section-header {
    margin-bottom: 24px;
  }

  .section-header h3 {
    font-size: 1.5em;
  }

  .section-header p {
    font-size: 0.95em;
  }

  .header-content h2 {
    font-size: 1.6em;
  }

  .subscription-info {
    flex-direction: column;
    gap: 16px;
  }

  .subscription-actions {
    flex-direction: column;
  }
}

@media (max-width: 480px) {
  .billing-header {
    padding: 20px;
  }

  .header-content h2 {
    font-size: 1.4em;
  }

  .header-subtitle {
    font-size: 0.9em;
  }

  .billing-section {
    padding: 20px;
  }

  .section-header h3 {
    font-size: 1.3em;
  }
}

/* Contact Sales Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}

.modal-content {
  background: var(--color-popup);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  max-width: 500px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  border-bottom: 1px solid var(--terminal-border-color);
  padding-bottom: 20px;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.3em;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 1.5em;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-primary);
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-description {
  color: var(--color-light-med-navy);
  font-size: 0.9em;
  margin: 0;
  line-height: 1.5;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px solid var(--terminal-border-color);
  padding-top: 20px;
}

.btn {
  padding: 10px 20px;
  border-radius: 4px;
  font-size: 0.9em;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  font-family: inherit;
}

.btn-primary {
  background: var(--color-primary);
  color: var(--color-dark-navy);
  font-weight: 600;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.75;
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: transparent;
  color: var(--color-text);
  border: 1px solid var(--terminal-border-color);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.05);
}

/* Image Upload Styles */
.image-upload-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.upload-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--color-dull-white);
  border: 1px dashed var(--terminal-border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--color-text);
  font-size: 0.9em;
  width: calc(100% - 24px);
}

body.dark .upload-label {
  background: rgba(0, 0, 0, 10%);
}

.upload-label:hover {
  border-color: var(--color-primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.upload-label i {
  color: var(--color-primary);
  font-size: 1.1em;
}

.file-input {
  display: none;
}

.image-preview {
  position: relative;
  border: 1px solid var(--terminal-border-color);
  border-radius: 4px;
  overflow: hidden;
}

.image-preview img {
  width: 100%;
  height: auto;
  display: block;
}

.remove-image-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  border: none;
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.remove-image-btn:hover {
  background: rgba(255, 0, 0, 0.8);
  transform: scale(1.1);
}

.remove-image-btn i {
  font-size: 0.9em;
}

/* Scheduled Plan Change Notice */
.scheduled-change-notice {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  background: rgba(var(--yellow-rgb), 0.1);
  border: 2px solid rgba(var(--yellow-rgb), 0.5);
  padding: 20px 24px;
}

body.dark .scheduled-change-notice {
  background: rgba(var(--yellow-rgb), 0.08);
}

/* Upgrade Notice Styling */
.scheduled-change-notice.upgrade-notice {
  background: rgba(var(--primary-rgb), 0.1);
  border: 2px solid rgba(var(--primary-rgb), 0.5);
}

body.dark .scheduled-change-notice.upgrade-notice {
  background: rgba(var(--primary-rgb), 0.08);
}

.scheduled-change-notice.upgrade-notice .notice-content h3 {
  color: var(--color-primary);
}

.notice-icon {
  font-size: 2em;
  line-height: 1;
  flex-shrink: 0;
}

.notice-content {
  flex: 1;
}

.notice-content h3 {
  color: rgba(255, 193, 7, 1);
  font-size: 1.1em;
  font-weight: 700;
  margin: 0 0 8px 0;
  letter-spacing: -0.3px;
}

.notice-content p {
  color: var(--color-text);
  font-size: 0.9em;
  margin: 0 0 8px 0;
  line-height: 1.5;
}

.notice-content p:last-child {
  margin-bottom: 0;
}

.notice-subtext {
  font-size: 0.85em !important;
  opacity: 0.8;
}

.notice-content strong {
  font-weight: 700;
  color: var(--color-primary);
}

.cancel-change-button {
  margin-top: 12px;
  padding: 10px 20px;
  background: var(--color-primary);
  color: white;
  border: 2px solid var(--color-primary);
  border-radius: 8px;
  font-size: 0.85em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.cancel-change-button:hover:not(:disabled) {
  background: var(--color-secondary);
  border-color: var(--color-secondary);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb), 0.4);
}

.cancel-change-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Discount Ribbon */
.discount-ribbon {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-pink) 50%, var(--color-secondary) 100%);
  border: 2px solid var(--color-primary);
  border-radius: 12px;
  padding: 8px 24px;
  box-shadow: 0 4px 20px rgba(var(--primary-rgb), 0.4);
  animation: pulse-glow 2s ease-in-out infinite;
  position: relative;
  overflow: hidden;
}

.discount-ribbon::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: linear-gradient(45deg, transparent 30%, rgba(255, 255, 255, 0.1) 50%, transparent 70%);
  animation: shine 3s infinite;
}

@keyframes pulse-glow {
  0%,
  100% {
    box-shadow: 0 4px 20px rgba(var(--primary-rgb), 0.4);
  }
  50% {
    box-shadow: 0 4px 30px rgba(var(--primary-rgb), 0.6);
  }
}

@keyframes shine {
  0% {
    transform: translateX(-100%) translateY(-100%) rotate(45deg);
  }
  100% {
    transform: translateX(100%) translateY(100%) rotate(45deg);
  }
}

.ribbon-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  position: relative;
  z-index: 1;
}

.ribbon-icon {
  font-size: 1.5em;
  animation: bounce 1s ease-in-out infinite;
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5px);
  }
}

.ribbon-text {
  color: white;
  font-size: 1em;
  font-weight: 600;
  text-align: center;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  letter-spacing: 0.3px;
}

.ribbon-text strong {
  font-weight: 800;
  font-size: 1.1em;
  letter-spacing: 0.5px;
}

@media (max-width: 768px) {
  .discount-ribbon {
    padding: 14px 20px;
  }

  .ribbon-content {
    gap: 8px;
  }

  .ribbon-icon {
    font-size: 1.2em;
  }

  .ribbon-text {
    font-size: 0.9em;
  }

  .ribbon-text strong {
    font-size: 1em;
  }
}

@media (max-width: 480px) {
  .discount-ribbon {
    padding: 12px 16px;
  }

  .ribbon-text {
    font-size: 0.8em;
  }

  .ribbon-icon {
    font-size: 1em;
  }
}
</style>
