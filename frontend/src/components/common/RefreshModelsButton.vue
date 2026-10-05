<template>
  <button
    type="button"
    class="refresh-models-btn"
    :class="[`size-${size}`, { spinning: isRefreshing, success: justSucceeded, error: hasError, stale: isStale }]"
    :disabled="disabled"
    v-tooltip="buttonTitle"
    @click.stop="handleClick"
  >
    <i :class="iconClass"></i>
    <span v-if="variant === 'icon+label'" class="label">{{ labelText }}</span>
  </button>
</template>

<script>
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import { describeStaleListing } from '@/store/app/aiProvider.js';

export default {
  name: 'RefreshModelsButton',
  props: {
    provider: { type: String, default: '' },
    variant: {
      type: String,
      default: 'icon',
      validator: (v) => ['icon', 'icon+label'].includes(v),
    },
    size: {
      type: String,
      default: 'sm',
      validator: (v) => ['sm', 'md'].includes(v),
    },
  },
  setup(props) {
    const store = useStore();
    const isRefreshing = ref(false);
    const justSucceeded = ref(false);
    const hasError = ref(false);
    const errorMessage = ref('');

    const isCustomProvider = computed(() => {
      const list = store.state.aiProvider?.customProviders || [];
      return list.some((cp) => cp.id === props.provider);
    });

    const disabled = computed(
      () => isRefreshing.value || isCustomProvider.value || !props.provider
    );

    // The vendor did not answer and the picker shows a saved or built-in list.
    // Persistent (not a 2.5s flash) because the list stays stale until the
    // vendor answers; the button stays clickable to retry.
    const listing = computed(() => store.getters['aiProvider/modelListingFor']?.(props.provider) || null);
    const isStale = computed(() => Boolean(listing.value?.stale) && !isRefreshing.value);

    const iconClass = computed(() => {
      if (justSucceeded.value) return 'fas fa-check';
      if (hasError.value || isStale.value) return 'fas fa-exclamation-triangle';
      return 'fas fa-sync-alt';
    });

    const labelText = computed(() => {
      if (isRefreshing.value) return 'Refreshing...';
      if (justSucceeded.value) return 'Refreshed';
      if (hasError.value) return 'Failed';
      if (isStale.value) return 'Not live';
      return 'Refresh';
    });

    const buttonTitle = computed(() => {
      if (isCustomProvider.value) return 'Refresh not supported for custom providers';
      if (!props.provider) return 'No provider selected';
      if (hasError.value && errorMessage.value) return `Refresh failed: ${errorMessage.value}`;
      if (isStale.value) return `${describeStaleListing(props.provider, listing.value)} Click to retry.`;
      // Models auto-revalidate every ~5 min via stale-while-revalidate; this
      // button is the escape hatch for when you know upstream just shipped
      // something new and don't want to wait for the next cycle.
      return `Force re-fetch ${props.provider} model list (models auto-refresh every 5 min)`;
    });

    async function handleClick() {
      if (disabled.value) return;
      isRefreshing.value = true;
      hasError.value = false;
      errorMessage.value = '';
      try {
        await store.dispatch('aiProvider/hardRefreshProviderModels', {
          provider: props.provider,
        });
        // A refresh the vendor did not answer is not a success.
        justSucceeded.value = !listing.value?.stale;
        setTimeout(() => {
          justSucceeded.value = false;
        }, 800);
      } catch (err) {
        console.error('[RefreshModelsButton] refresh failed:', err);
        hasError.value = true;
        errorMessage.value = err?.message || 'unknown error';
        setTimeout(() => {
          hasError.value = false;
          errorMessage.value = '';
        }, 2500);
      } finally {
        isRefreshing.value = false;
      }
    }

    return {
      isRefreshing,
      justSucceeded,
      hasError,
      isStale,
      disabled,
      iconClass,
      labelText,
      buttonTitle,
      handleClick,
    };
  },
};
</script>

<style scoped>
.refresh-models-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--color-text-muted, #8b93a7);
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s ease, color 0.15s ease, background 0.15s ease,
    border-color 0.15s ease;
  -webkit-app-region: no-drag;
  padding: 4px 6px;
  font-family: inherit;
}
.refresh-models-btn.size-sm {
  font-size: 11px;
  padding: 3px 5px;
}
.refresh-models-btn.size-sm i {
  font-size: 11px;
}
.refresh-models-btn.size-md {
  font-size: 12px;
  padding: 5px 9px;
}
.refresh-models-btn.size-md i {
  font-size: 12px;
}
.refresh-models-btn:hover:not(:disabled) {
  opacity: 1;
  color: var(--color-primary);
  border-color: rgba(var(--primary-rgb), 0.2);
  background: rgba(var(--primary-rgb), 0.04);
}
.refresh-models-btn:disabled {
  cursor: not-allowed;
  opacity: 0.3;
}
.refresh-models-btn.spinning {
  opacity: 1;
  color: var(--color-primary);
}
.refresh-models-btn.spinning i {
  animation: refresh-spin 0.8s linear infinite;
}
.refresh-models-btn.success {
  opacity: 1;
  color: var(--text-green);
  border-color: rgba(46, 160, 67, 0.3);
}
.refresh-models-btn.error {
  opacity: 1;
  color: var(--color-red);
  border-color: rgba(215, 58, 73, 0.3);
}
.refresh-models-btn.stale {
  opacity: 1;
  color: var(--text-yellow);
  border-color: rgba(210, 153, 34, 0.35);
}
.refresh-models-btn .label {
  letter-spacing: 0.3px;
}
@keyframes refresh-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
