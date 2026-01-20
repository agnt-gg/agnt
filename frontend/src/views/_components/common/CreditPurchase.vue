<template>
  <div class="credit-purchase">
    <div class="card-row">
      <div class="card">
        <h3>Current Token Credits</h3>
        <p class="credits-text"><span style="opacity: 0.5; margin-right: 2px"></span>{{ formattedCredits }}</p>
      </div>
    </div>
    <div class="card-row">
      <div class="card">
        <h3 style="margin-bottom: 12px">
          Purchase Tokens <span style="font-size: 14px; font-weight: 400; opacity: 0.5; margin-left: 4px">1,000 tokens = $10</span>
        </h3>
        <div class="input-wrapper">
          <input
            class="credit-amount"
            type="number"
            v-model.number="amount"
            placeholder="Enter amount"
            min="0"
            step="1"
            @focus="selectInputContent"
          />
        </div>
        <div class="stripe-element-container">
          <div id="card-element"></div>
        </div>
        <div id="card-errors" role="alert"></div>
        <button
          @click="handlePurchase"
          :disabled="!amount || amount <= 0 || (!isCardComplete && !stripeBlocked) || isProcessing"
          :class="{ 'button-ready': (isCardComplete || stripeBlocked) && amount > 0 && !isProcessing, 'button-processing': isProcessing }"
        >
          {{ isProcessing ? 'Processing...' : stripeBlocked ? 'Payment Unavailable' : 'Purchase Credits' }}
        </button>
      </div>
    </div>
    <SimpleModal ref="modal" />
  </div>
</template>

<script>
import { loadStripe } from '@stripe/stripe-js';
import { API_CONFIG } from '@/tt.config.js';
import SimpleModal from '@/views/_components/common/SimpleModal.vue';

// Lazy load Stripe with error handling for blocked requests
let stripePromise = null;
let stripeLoadAttempted = false;
let stripeBlocked = false;

const initializeStripe = async () => {
  if (stripeLoadAttempted) {
    return stripeBlocked ? null : stripePromise;
  }

  stripeLoadAttempted = true;

  try {
    // Add timeout to detect if Stripe is blocked
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Stripe load timeout')), 5000);
    });

    stripePromise = Promise.race([loadStripe('pk_live_4T6XuZUzk69JcGRGaGIgDwkf'), timeoutPromise]);

    const stripe = await stripePromise;
    if (!stripe) {
      throw new Error('Stripe failed to initialize');
    }

    return stripe;
  } catch (error) {
    console.warn('Stripe blocked or failed to load:', error.message);
    stripeBlocked = true;
    stripePromise = null;
    return null;
  }
};

export default {
  components: {
    SimpleModal,
  },
  data() {
    return {
      credits: 0,
      amount: 0,
      card: null,
      stripeElements: null,
      stripeLoaded: false,
      stripeBlocked: false,
      isCardComplete: false,
      isProcessing: false,
      setupAttempted: false,
    };
  },
  mounted() {
    document.body.setAttribute('data-page', 'agents');
    this.fetchCredits();
    // Delay Stripe setup to avoid blocking page load
    this.$nextTick(() => {
      setTimeout(() => {
        this.setupStripe();
      }, 1000);
    });
  },
  computed: {
    formattedCredits() {
      return Math.floor(this.credits).toLocaleString();
    },
  },
  methods: {
    selectInputContent(event) {
      event.target.select();
    },
    async setupStripe() {
      if (this.setupAttempted) return;
      this.setupAttempted = true;

      try {
        const stripe = await initializeStripe();
        if (!stripe) {
          console.warn('Stripe is blocked or unavailable');
          this.stripeBlocked = true;
          this.showStripeBlockedMessage();
          return;
        }

        this.stripeElements = stripe.elements();

        const style = {
          base: {
            fontFamily: '"League Spartan", sans-serif',
            fontSize: '16px',
            color: 'var(--color-navy)',
            '::placeholder': {
              color: 'var(--color-med-navy)',
            },
          },
          invalid: {
            color: 'var(--color-pink)',
            ':focus': {
              color: 'var(--color-pink)',
            },
          },
        };

        this.card = this.stripeElements.create('card', { style: style });

        // Add error handling for mount operation
        try {
          await this.card.mount('#card-element');
        } catch (mountError) {
          console.warn('Failed to mount Stripe card element:', mountError);
          this.stripeBlocked = true;
          this.showStripeBlockedMessage();
          return;
        }

        this.card.on('change', (event) => {
          const displayError = document.getElementById('card-errors');
          if (event.error) {
            displayError.textContent = event.error.message;
          } else {
            displayError.textContent = '';
          }
          this.isCardComplete = event.complete;
        });

        this.stripeLoaded = true;
      } catch (error) {
        console.warn('Error setting up Stripe:', error);
        this.stripeBlocked = true;
        this.showStripeBlockedMessage();
      }
    },

    showStripeBlockedMessage() {
      const cardElement = document.getElementById('card-element');
      if (cardElement) {
        cardElement.innerHTML = `
          <div style="padding: 12px; text-align: center; color: var(--color-med-navy); font-size: 14px;">
            <p style="margin: 0 0 8px 0;">⚠️ Payment processing is currently unavailable</p>
            <p style="margin: 0; font-size: 12px; opacity: 0.7;">
              This may be due to an ad blocker or privacy extension.<br>
              Please disable ad blockers for this site or try a different browser.
            </p>
          </div>
        `;
      }
    },

    async fetchCredits() {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/users/credits`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        this.credits = data.credits;
      } catch (error) {
        console.error('Error fetching credits:', error);
      }
    },
    async handlePurchase() {
      if (this.isProcessing) return;

      // Check if Stripe is blocked
      if (this.stripeBlocked) {
        await this.$refs.modal.showModal({
          title: 'Payment Unavailable',
          message:
            'Payment processing is currently blocked by your browser or an extension. Please disable ad blockers for this site and refresh the page to enable payments.',
          confirmText: 'OK',
          showCancel: false,
        });
        return;
      }

      this.isProcessing = true;

      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No token available');
        await this.$refs.modal.showModal({
          title: 'Authentication Error',
          message: 'Please try logging out and back in.',
          confirmText: 'OK',
          showCancel: false,
        });
        this.isProcessing = false;
        return;
      }

      try {
        const stripe = await initializeStripe();
        if (!stripe) {
          throw new Error('Stripe is not available');
        }

        // Create payment intent
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/users/purchase-credits`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ amount: this.amount }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const { clientSecret, paymentIntentId } = await response.json();

        // Collect card details
        const { error: stripeError, paymentMethod } = await stripe.createPaymentMethod({
          type: 'card',
          card: this.card,
        });

        if (stripeError) {
          console.error('Error creating payment method:', stripeError);
          throw new Error('Failed to process payment method');
        }

        // Confirm the payment
        const result = await stripe.confirmCardPayment(clientSecret, {
          payment_method: paymentMethod.id,
        });

        if (result.error) {
          console.error(result.error);
          throw new Error('Payment confirmation failed');
        } else {
          // Payment succeeded
          await fetch(`${API_CONFIG.REMOTE_URL}/users/confirm-purchase`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              paymentIntentId: paymentIntentId,
              credits: this.amount,
            }),
          });

          // Refresh credits
          await this.fetchCredits();

          // Reset amount
          this.amount = 0;

          await this.$refs.modal.showModal({
            title: 'Success',
            message: 'Credits purchased successfully!',
            confirmText: 'OK',
            showCancel: false,
          });
        }
      } catch (error) {
        console.error('Error purchasing credits:', error);

        let errorMessage = 'Error purchasing credits. Please try again.';
        if (error.message.includes('Stripe') || error.message.includes('blocked')) {
          errorMessage =
            'Payment processing is currently unavailable. This may be due to an ad blocker or privacy extension. Please disable ad blockers for this site and try again.';
        }

        await this.$refs.modal.showModal({
          title: 'Error',
          message: errorMessage,
          confirmText: 'OK',
          showCancel: false,
        });
      } finally {
        this.isProcessing = false;
      }
    },
  },
};
</script>

<style scoped>
.credit-purchase {
  position: relative;
  width: 100%;
  display: flex;
}

.card-row {
  width: 100%;
  display: flex;
  justify-content: space-between;
  margin-bottom: 0;
}

.card {
  width: 100%;
}

.full {
  width: 100%;
}

.half {
  width: 48%;
}

.input-wrapper {
  position: relative;
}

.input-wrapper::before {
  content: '$';
  position: absolute;
  left: 10px;
  top: 45%;
  transform: translateY(-50%);
  color: var(--color-med-navy);
  font-size: 16px;
}

input[type='number'] {
  width: calc(100% - 2rem);
  padding: 0.5rem 0.5rem 0.5rem 1.5rem;
  margin-bottom: 0.5rem;
  font-size: 16px;
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  background-color: var(--color-ultra-light-navy);
  color: var(--color-navy);
}

input[type='number']:focus {
  outline: none;
  border-color: var(--color-pink);
  box-shadow: 0 0 0 2px var(--color-pink);
}

/* Hide spinner for webkit browsers */
input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Hide spinner for Firefox */
input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}

button {
  width: 100%;
  padding: 0.5rem;
  background-color: var(--color-med-navy);
  color: white;
  border: none;
  border-radius: 16px;
  cursor: pointer;
  margin-bottom: 0;
  transition: background-color 0.3s ease;
}

button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}

button.button-ready {
  background-color: var(--color-pink);
}

.stripe-element-container {
  background-color: var(--color-ultra-light-navy);
  border: 1px solid var(--color-light-navy);
  border-radius: 8px;
  padding: 6px 0 2px 4px;
  transition: all 0.3s ease;
}

.stripe-element-container:focus-within {
  border-color: var(--color-pink);
  box-shadow: 0 0 0 2px var(--color-pink);
}

#card-errors {
  color: var(--color-pink);
  font-size: 14px;
  margin-top: 8px;
}

/* Override Stripe's default styles */
::v-deep .StripeElement {
  background-color: transparent !important;
  padding: 0 !important;
}

::v-deep .StripeElement--focus {
  box-shadow: none !important;
}

::v-deep .StripeElement--invalid {
  border-color: var(--color-pink) !important;
}

.credits-text {
  font-family: monospace;
  font-size: 24px;
  font-weight: bold;
  color: var(--color-pink);
}

body.dark .credits-text {
  color: var(--color-green);
}

.credit-amount:focus {
  outline: none !important;
  box-shadow: none !important;
}

button.button-processing {
  background-color: var(--color-med-navy);
  cursor: not-allowed;
}
</style>
