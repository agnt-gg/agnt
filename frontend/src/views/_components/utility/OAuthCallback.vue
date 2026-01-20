<template>
  <div class="oauth-callback">
    <div class="callback-content">
      <img src="/images/agnt-logo.png" alt="AGNT Logo" class="logo" />

      <div v-if="status === 'processing'" class="status-processing">
        <div class="spinner"></div>
        <h2>Completing authentication...</h2>
        <p class="subtitle">Please wait while we finalize your connection.</p>
      </div>

      <div v-else-if="status === 'success'" class="status-success">
        <div class="success-icon">✓</div>
        <h2>Authentication Successful!</h2>
        <p class="subtitle">You have successfully connected to {{ providerName }}.</p>
        <p class="closing-message">This window will close automatically...</p>
      </div>

      <div v-else-if="status === 'error'" class="status-error">
        <div class="error-icon">✕</div>
        <h2>Authentication Failed</h2>
        <p class="subtitle">{{ errorMessage }}</p>
        <button @click="closeWindow" class="close-button">Close Window</button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue';
import { API_CONFIG } from '@/tt.config.js';

export default {
  name: 'OAuthCallback',
  setup() {
    const status = ref('processing');
    const providerName = ref('');
    const errorMessage = ref('');

    const closeWindow = () => {
      window.close();
    };

    const handleCallback = async () => {
      try {
        // Get URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');
        const error = urlParams.get('error');

        if (error) {
          throw new Error(error);
        }

        if (!code || !state) {
          throw new Error('Missing authorization code or state');
        }

        // Parse state to get provider
        const colonIndex = state.indexOf(':');
        const provider = state.substring(0, colonIndex);
        providerName.value = provider.charAt(0).toUpperCase() + provider.slice(1);

        // Exchange code for tokens via backend
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_CONFIG.REMOTE_URL}/auth/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ code, state }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to complete authentication');
        }

        const result = await response.json();

        if (result.success) {
          status.value = 'success';

          // Notify parent window
          if (window.opener) {
            window.opener.postMessage(
              {
                type: 'oauth_success',
                provider: providerName.value,
              },
              window.location.origin
            );
          }

          // Close window after 2 seconds
          setTimeout(() => {
            window.close();
          }, 2000);
        } else {
          throw new Error('Authentication was not successful');
        }
      } catch (error) {
        console.error('OAuth callback error:', error);
        status.value = 'error';
        errorMessage.value = error.message || 'An unexpected error occurred';

        // Notify parent window of error
        if (window.opener) {
          window.opener.postMessage(
            {
              type: 'oauth_error',
              provider: providerName.value || 'the service',
              message: errorMessage.value,
            },
            window.location.origin
          );
        }
      }
    };

    onMounted(() => {
      handleCallback();
    });

    return {
      status,
      providerName,
      errorMessage,
      closeWindow,
    };
  },
};
</script>

<style scoped>
.oauth-callback {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--color-navy);
  font-family: 'League Spartan', sans-serif;
}

.callback-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px;
  background: radial-gradient(circle at top, rgba(0, 255, 153, 0.06), transparent 55%),
    linear-gradient(135deg, var(--color-darker-1) 0%, var(--color-darker-0) 100%);
  border-radius: 16px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(12px);
  max-width: 440px;
  text-align: center;
  position: relative;
}

.callback-content::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.02);
}

.callback-content::after {
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

.callback-content > * {
  position: relative;
  z-index: 1;
}

.logo {
  width: 100px;
  height: 100px;
  margin-bottom: 24px;
  filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.45));
}

.status-processing,
.status-success,
.status-error {
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.spinner {
  width: 60px;
  height: 60px;
  border: 4px solid rgba(0, 255, 153, 0.2);
  border-top-color: var(--color-green);
  border-radius: 50%;
  margin: 0 auto 24px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.success-icon {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, var(--color-green) 0%, #00d084 100%);
  color: var(--color-ultra-dark-navy);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  font-weight: 700;
  margin: 0 auto 24px;
  animation: scaleIn 0.5s ease-out;
  box-shadow: 0 8px 24px rgba(0, 255, 153, 0.3);
}

.error-icon {
  width: 80px;
  height: 80px;
  background: var(--color-red);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  font-weight: 700;
  margin: 0 auto 24px;
  animation: scaleIn 0.5s ease-out;
  box-shadow: 0 8px 24px rgba(255, 0, 0, 0.3);
}

@keyframes scaleIn {
  from {
    transform: scale(0);
  }
  to {
    transform: scale(1);
  }
}

h2 {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.02em;
  background: linear-gradient(135deg, var(--color-text) 0%, var(--color-text-muted) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  margin-bottom: 12px;
}

.subtitle {
  font-size: 14px;
  color: var(--color-text-muted);
  opacity: 0.85;
  line-height: 1.5;
  margin-bottom: 8px;
}

.closing-message {
  font-size: 12px;
  color: var(--color-text-muted);
  opacity: 0.7;
  margin-top: 16px;
}

.close-button {
  margin-top: 24px;
  padding: 10px 32px;
  background: transparent;
  border: 1px solid rgba(255, 0, 0, 0.32);
  color: var(--color-red);
  border-radius: 999px;
  font-family: 'League Spartan', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.close-button:hover {
  background: rgba(255, 0, 0, 0.08);
  border-color: var(--color-red);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(255, 0, 0, 0.18);
}

.close-button:active {
  transform: translateY(0);
  box-shadow: 0 4px 14px rgba(255, 0, 0, 0.2);
}
</style>
