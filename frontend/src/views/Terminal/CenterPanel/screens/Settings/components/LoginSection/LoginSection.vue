<template>
  <inner-setting-panel class="auth-section" :class="{ 'with-grid': !isAuthenticated }">
    <img src="/images/agnt-logo.png" alt="AGNT Logo" class="logo" :class="{ 'logged-in': isAuthenticated }" />

    <div v-if="!isAuthenticated" class="auth-content">
      <!-- Email Login Form -->
      <div v-if="!showCodeModal">
        <header class="auth-header">
          <h2>Sign in to AGNT</h2>
          <p class="auth-subtitle">Secure, passwordless access to your workspace.</p>
        </header>

        <div class="login-options">
          <div class="email-magic-login">
            <!-- <label for="magic-email" class="field-label">Email Address</label> -->
            <input type="email" v-model="email" id="magic-email" placeholder="name@company.com" :disabled="isLoading" />
            <button class="magic-link" @click="sendMagicLink" :disabled="isLoading || !email">
              {{ isLoading ? 'Sending code…' : 'Continue with email' }}
            </button>
            <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
            <p v-if="successMessage" class="success-message">{{ successMessage }}</p>
          </div>

          <div class="divider">
            <span>or</span>
          </div>

          <div class="social-login">
            <button @click="connectGoogle" class="google-auth">
              <SvgIcon name="google" />
              <span>Continue with Google</span>
            </button>
          </div>

          <p class="helper-text">
            By continuing, you agree to the AGNT
            <a href="#" @click.prevent="openTermsModal('terms')">Terms</a>
            and
            <a href="#" @click.prevent="openTermsModal('privacy')">Privacy Policy</a>.
          </p>
        </div>
      </div>

      <!-- Code Verification Section -->
      <div v-else class="verification-section">
        <header class="auth-header">
          <h2>Check your email</h2>
          <p class="auth-subtitle">
            We sent a 6‑digit code to
            <span class="email-pill">{{ email }}</span>
          </p>
        </header>

        <div class="verification-form">
          <label for="code-input" class="field-label">Verification code</label>
          <input
            id="code-input"
            type="text"
            v-model="verificationCode"
            placeholder="000000"
            maxlength="6"
            class="code-input"
            @input="formatCodeInput"
            @keyup.enter="verifyCode"
            :disabled="isVerifying"
          />
          <p v-if="verifyError" class="error-message">{{ verifyError }}</p>

          <div class="verification-actions">
            <button @click="verifyCode" :disabled="isVerifying || verificationCode.length !== 6" class="verify-btn">
              {{ isVerifying ? 'Verifying…' : 'Verify and continue' }}
            </button>
            <button @click="closeModal" :disabled="isVerifying" class="cancel-btn">Cancel</button>
          </div>

          <p class="resend-text">
            Didn't receive the code?
            <button @click="resendCode" :disabled="isLoading" class="resend-btn">Resend</button>
          </p>
        </div>
      </div>
    </div>

    <div v-else class="user-info">
      <h2>Welcome back, {{ displayPseudonym }}.</h2>
      <p class="user-subtitle">You're securely signed in to your AGNT workspace.</p>
      <button class="logout" @click="logout">Sign out</button>
    </div>

    <!-- Terms/Privacy Modal -->
    <TermsPrivacyModal :show="showTermsModal" :defaultTab="termsModalTab" @close="closeTermsModal" />
  </inner-setting-panel>
</template>

<script>
import { computed, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import axios from 'axios';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import TermsPrivacyModal from '@/components/TermsPrivacyModal.vue';
import { API_CONFIG } from '@/tt.config.js';

export default {
  name: 'AuthSection',
  components: { SvgIcon, TermsPrivacyModal },
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();

    const isAuthenticated = computed(() => store.getters['userAuth/isAuthenticated']);
    const user = computed(() => store.state.userAuth.user);
    const displayPseudonym = computed(() => store.getters['userAuth/userPseudonym']);

    // Email magic link state
    const email = ref('');
    const isLoading = ref(false);
    const errorMessage = ref('');
    const successMessage = ref('');

    // Code verification modal state
    const showCodeModal = ref(false);
    const verificationCode = ref('');
    const isVerifying = ref(false);
    const verifyError = ref('');

    // Terms/Privacy modal state
    const showTermsModal = ref(false);
    const termsModalTab = ref('terms');

    const connectGoogle = () => {
      const redirectUrl = `${window.location.origin}/settings`;
      const width = 600;
      const height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        `${API_CONFIG.REMOTE_URL}/users/auth/google?redirectUrl=${encodeURIComponent(redirectUrl)}`,
        'google-login-popup',
        `width=${width},height=${height},top=${top},left=${left}`
      );

      const handleMessage = async (event) => {
        if (event.data?.type === 'google-auth-success') {
          const { token } = event.data;

          window.removeEventListener('message', handleMessage);

          if (token) {
            store.commit('userAuth/SET_TOKEN', token);
            await store.dispatch('userAuth/fetchUserData');
            await syncTokenWithBackend();

            // CRITICAL: Fetch subscription immediately after Google login
            console.log('🔄 Fetching subscription after Google login...');
            await store.dispatch('userAuth/fetchSubscription').catch((error) => {
              console.error('Failed to fetch subscription after Google login:', error);
            });
            console.log('✅ Subscription fetched after Google login. PlanType:', store.state.userAuth.planType);

            // CRITICAL: Validate license after Google login
            console.log('🔐 Validating license after Google login...');
            await store.dispatch('userAuth/validateLicense').catch((error) => {
              console.error('Failed to validate license after Google login:', error);
            });
            console.log('✅ License validated after Google login.');

            router.push('/settings');
          }
        } else if (event.data?.type === 'google-auth-error') {
          window.removeEventListener('message', handleMessage);
          errorMessage.value = event.data.error || 'Login failed';
        }
      };

      window.addEventListener('message', handleMessage);
    };

    const sendMagicLink = async () => {
      if (!email.value || !email.value.includes('@')) {
        errorMessage.value = 'Please enter a valid email address.';
        return;
      }

      isLoading.value = true;
      errorMessage.value = '';
      successMessage.value = '';

      try {
        const result = await store.dispatch('userAuth/requestMagicLink', email.value);

        if (result.success) {
          successMessage.value = 'Code sent. Check your inbox.';
          showCodeModal.value = true;
        } else {
          errorMessage.value = result.error;
        }
      } catch (error) {
        errorMessage.value = 'Failed to send code. Please try again.';
      } finally {
        isLoading.value = false;
      }
    };

    const formatCodeInput = (event) => {
      // Only allow numbers
      verificationCode.value = event.target.value.replace(/\D/g, '');
    };

    const verifyCode = async () => {
      if (verificationCode.value.length !== 6) {
        verifyError.value = 'Please enter a 6‑digit code.';
        return;
      }

      isVerifying.value = true;
      verifyError.value = '';

      try {
        const result = await store.dispatch('userAuth/verifyMagicLink', {
          email: email.value,
          code: verificationCode.value,
        });

        if (result.success) {
          // Sync token with local backend
          await syncTokenWithBackend();

          // Fetch pseudonym for the user
          await store.dispatch('userAuth/fetchPseudonym').catch((error) => {
            console.error('Failed to fetch pseudonym after login:', error);
          });

          // CRITICAL: Fetch subscription immediately after login
          console.log('🔄 Fetching subscription after login...');
          await store.dispatch('userAuth/fetchSubscription').catch((error) => {
            console.error('Failed to fetch subscription after login:', error);
          });
          console.log('✅ Subscription fetched after login. PlanType:', store.state.userAuth.planType);

          // Close modal
          showCodeModal.value = false;

          // Navigate to home for new users to trigger onboarding
          if (result.isNewUser) {
            console.log('🎉 New user detected, navigating to home to show onboarding...');
            router.push('/');
          }
        } else {
          verifyError.value = result.error;
        }
      } catch (error) {
        verifyError.value = 'Verification failed. Please try again.';
      } finally {
        isVerifying.value = false;
      }
    };

    const closeModal = () => {
      showCodeModal.value = false;
      verificationCode.value = '';
      verifyError.value = '';
    };

    const resendCode = async () => {
      verificationCode.value = '';
      verifyError.value = '';
      await sendMagicLink();
    };

    const logout = () => {
      store.dispatch('userAuth/logout');
      router.push('/');
    };

    const openTermsModal = (tab = 'terms') => {
      termsModalTab.value = tab;
      showTermsModal.value = true;
    };

    const closeTermsModal = () => {
      showTermsModal.value = false;
    };

    onMounted(async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const newToken = urlParams.get('token');

      if (newToken) {
        // Google login returned with token
        store.commit('userAuth/SET_TOKEN', newToken);
        await store.dispatch('userAuth/fetchUserData');
        await syncTokenWithBackend();

        // CRITICAL: Fetch subscription immediately after Google login
        console.log('🔄 Fetching subscription after Google login (URL token)...');
        await store.dispatch('userAuth/fetchSubscription').catch((error) => {
          console.error('Failed to fetch subscription after Google login:', error);
        });
        console.log('✅ Subscription fetched after Google login. PlanType:', store.state.userAuth.planType);

        // CRITICAL: Validate license after Google login
        console.log('🔐 Validating license after Google login (URL token)...');
        await store.dispatch('userAuth/validateLicense').catch((error) => {
          console.error('Failed to validate license after Google login:', error);
        });
        console.log('✅ License validated after Google login.');

        const newURL = window.location.pathname;
        window.history.replaceState({}, document.title, newURL);
        router.push('/settings');
      } else {
        await store.dispatch('userAuth/fetchUserData');

        if (isAuthenticated.value) {
          await syncTokenWithBackend();
        }
      }
    });

    const syncTokenWithBackend = async () => {
      try {
        const response = await axios.post(
          `${API_CONFIG.BASE_URL}/users/sync-token`,
          {},
          {
            headers: {
              Authorization: `Bearer ${store.state.userAuth.token}`,
            },
            withCredentials: true,
          }
        );

        if (response.data.success) {
          console.log('Token synchronized with backend successfully');
        }
      } catch (error) {
        console.error('Error syncing token with backend:', error);
      }
    };

    return {
      isAuthenticated,
      user,
      displayPseudonym,
      email,
      isLoading,
      errorMessage,
      successMessage,
      showCodeModal,
      verificationCode,
      isVerifying,
      verifyError,
      connectGoogle,
      sendMagicLink,
      formatCodeInput,
      verifyCode,
      closeModal,
      resendCode,
      logout,
      showTermsModal,
      termsModalTab,
      openTermsModal,
      closeTermsModal,
    };
  },
};
</script>

<style scoped>
.auth-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 28px;
  background: radial-gradient(circle at top, rgba(var(--green-rgb), 0.06), transparent 55%),
    linear-gradient(135deg, var(--color-darker-1) 0%, var(--color-darker-0) 100%);
  border-radius: 16px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.4);
  height: fit-content;
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px);
  position: relative;
  overflow: visible;
  max-width: 440px;
}

.auth-section::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.02);
}

/* Grid background - only when not logged in */
.auth-section.with-grid::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background-image: linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 40px 40px;
  z-index: 0;
}

.auth-section.with-grid > * {
  position: relative;
  z-index: 1;
}

body.dark .auth-section {
  background: linear-gradient(135deg, var(--color-darker-1) 0%, var(--color-darker-0) 100%);
  border: 1px solid var(--terminal-border-color);
}

.logo {
  width: 140px;
  height: 140px;
  margin-bottom: 16px;
  transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1);
  filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.45));
}

.logo.logged-in {
  width: 80px;
  height: 80px;
  margin-bottom: 8px;
}

.auth-content {
  width: 100%;
}

.auth-header {
  text-align: center;
  margin-bottom: 20px;
}

.auth-header h2 {
  margin-bottom: 6px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.02em;
  background: linear-gradient(135deg, var(--color-text) 0%, var(--color-text-muted) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.auth-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  opacity: 0.85;
}

.login-options {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  gap: 18px;
}

.email-magic-login {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  gap: 8px;
}

.field-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  opacity: 0.9;
}

input[type='email'] {
  width: 100%;
  font-family: var(--font-family-primary);
  font-size: 15px;
  padding: 8px 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: var(--color-darker-2);
  color: var(--color-text);
  text-align: center;
  transition: all 0.2s ease;
}

input[type='email']::placeholder {
  color: var(--color-text-muted);
  opacity: 0.6;
}

input[type='email']:hover {
  border-color: var(--terminal-border-color);
}

input[type='email']:focus {
  border-color: var(--color-green);
  outline: none;
  box-shadow: 0 0 0 1px rgba(var(--green-rgb), 0.38);
}

body.dark input[type='email'] {
  background: var(--color-darker-2);
  border-color: var(--terminal-border-color);
}

body.dark input[type='email']:hover {
  border-color: var(--terminal-border-color);
}

body.dark input[type='email']:focus {
  border-color: var(--color-green);
}

button.magic-link {
  background: linear-gradient(135deg, var(--color-green) 0%, var(--color-green) 100%);
  color: var(--color-ultra-dark-navy);
  border: none;
  padding: 10px 18px;
  border-radius: 999px;
  font-family: var(--font-family-primary);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  margin-top: 4px;
  transition: all 0.18s ease;
  position: relative;
}

button.magic-link::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  opacity: 0;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.05);
  transition: opacity 0.18s ease;
}

button.magic-link:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
}

button.magic-link:hover:not(:disabled)::before {
  opacity: 1;
}

button.magic-link:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}

button.magic-link:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.social-login {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.social-login button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 9px 14px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 999px;
  transition: all 0.18s ease;
  position: relative;
  gap: 8px;
}

.social-login .svg-icon {
  width: 18px;
  height: 18px;
}

.google-auth {
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--terminal-border-color);
  color: #111827;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.24);
}

.google-auth:hover {
  background: #ffffff;
  border-color: var(--terminal-border-color);
  /* transform: translateY(-1px); */
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.3);
}

body.dark .google-auth {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-dull-white);
}

body.dark .google-auth:hover {
  background: var(--color-darker-1);
}

.settings-section.full-width.top-section inner-setting-panel.auth-section {
  max-width: 100%;
  width: calc(100% - 58px);
}

.success-message {
  color: var(--color-green);
  margin-top: 4px;
  font-size: 13px;
  font-weight: 500;
  animation: slideIn 0.2s ease-out;
}

.error-message {
  color: var(--color-red);
  margin-top: 4px;
  font-size: 13px;
  font-weight: 500;
  animation: slideIn 0.2s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.divider {
  display: flex;
  align-items: center;
  width: 100%;
  color: var(--color-text-muted);
  margin: 4px 0 2px;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--color-text-muted) 50%, transparent);
  opacity: 0.35;
}

.divider span {
  padding: 0 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  opacity: 0.7;
}

.helper-text {
  width: 100%;
  font-size: 11px;
  color: var(--color-text-muted);
  text-align: left;
  margin-top: 4px;
}

.helper-text a {
  color: var(--color-green);
  text-decoration: none;
}

.helper-text a:hover {
  text-decoration: underline;
}

.user-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.user-info h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  background: linear-gradient(135deg, var(--color-text) 0%, var(--color-text-muted) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.user-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
}

.logout {
  background: transparent;
  padding: 8px 18px;
  color: var(--color-red);
  border: 1px solid rgba(255, 0, 0, 0.32);
  border-radius: 999px;
  font-weight: 600;
  font-size: 13px;
  transition: all 0.18s ease;
}

.logout:hover {
  background: rgba(255, 0, 0, 0.08);
  border-color: var(--color-red);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(255, 0, 0, 0.18);
}

/* Verification Section Styles */
.verification-section {
  width: 100%;
}

.verification-form {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  gap: 8px;
}

.email-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(var(--green-rgb), 0.16);
  font-size: 12px;
  font-weight: 500;
}

.code-input {
  width: 100%;
  font-family: var(--font-family-primary);
  font-size: 26px;
  font-weight: 600;
  padding: 12px 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 12px;
  background: var(--color-darker-2);
  color: var(--color-text);
  text-align: center;
  letter-spacing: 10px;
  margin-top: 4px;
  transition: all 0.2s ease;
}

.code-input:hover {
  border-color: var(--color-duller-navy);
}

.code-input:focus {
  outline: none;
  border-color: var(--color-green);
  box-shadow: 0 0 0 1px rgba(var(--green-rgb), 0.38);
}

body.dark .code-input {
  background: var(--color-darker-2);
  border-color: var(--terminal-border-color);
}

body.dark .code-input:hover {
  border-color: var(--color-duller-navy);
}

body.dark .code-input:focus {
  border-color: var(--color-green);
}

.verification-actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

.verify-btn,
.cancel-btn {
  flex: 1;
  padding: 10px 16px;
  border-radius: 999px;
  font-family: var(--font-family-primary);
  font-weight: 600;
  cursor: pointer;
  border: none;
  font-size: 14px;
  transition: all 0.18s ease;
}

.verify-btn {
  background: linear-gradient(135deg, var(--color-green) 0%, var(--color-green) 100%);
  color: var(--color-ultra-dark-navy);
}

.verify-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.38);
}

.verify-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}

.verify-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  box-shadow: none;
}

.cancel-btn {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
}

body.dark .cancel-btn {
  border-color: var(--terminal-border-color);
  color: var(--color-text-muted);
}

.cancel-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.16);
}

.resend-text {
  text-align: center;
  margin-top: 12px;
  font-size: 12px;
  color: var(--color-text-muted);
}

.resend-btn {
  background: transparent;
  border: none;
  color: var(--color-green);
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  margin-left: 4px;
  font-size: 12px;
}

.resend-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.resend-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
