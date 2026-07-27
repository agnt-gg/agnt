<template>
  <div v-if="isExternalMode" class="external-mode-banner" role="status">
    <div class="banner-icon" aria-hidden="true">
      <i class="fas fa-network-wired"></i>
    </div>
    <div class="banner-body">
      <strong class="banner-title">External backend mode</strong>
      <p class="banner-text">
        <template v-if="!isAuthenticated">
          Sign in to load agents and chat from the remote server
          <span v-if="remoteHostLabel" class="remote-host"> ({{ remoteHostLabel }})</span>.
          This desktop origin is separate from a browser tab on that host — your data was not wiped.
        </template>
        <template v-else>
          Connected to remote
          <span v-if="remoteHostLabel" class="remote-host">{{ remoteHostLabel }}</span>
          <span v-else>backend</span>. Agents and history come from that server.
        </template>
      </p>
      <button v-if="showConnectionLink" type="button" class="banner-link" @click="$emit('open-connection')">
        Settings → Connection
      </button>
    </div>
  </div>
</template>

<script>
import { useDesktopConnection } from '@/composables/useDesktopConnection.js';

export default {
  name: 'ExternalModeBanner',
  props: {
    isAuthenticated: {
      type: Boolean,
      default: false,
    },
    showConnectionLink: {
      type: Boolean,
      default: true,
    },
  },
  emits: ['open-connection'],
  setup() {
    const { isExternalMode, remoteHostLabel, backendUrl } = useDesktopConnection();
    return { isExternalMode, remoteHostLabel, backendUrl };
  },
};
</script>

<style scoped>
.external-mode-banner {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  width: 100%;
  max-width: 420px;
  margin: 0 auto 20px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid rgba(var(--primary-rgb), 0.4);
  background: rgba(var(--primary-rgb), 0.1);
  text-align: left;
  box-sizing: border-box;
}

.banner-icon {
  color: var(--color-primary);
  font-size: 1.1rem;
  line-height: 1.4;
  flex-shrink: 0;
}

.banner-body {
  flex: 1;
  min-width: 0;
}

.banner-title {
  display: block;
  color: var(--color-text);
  font-size: 0.95rem;
  margin-bottom: 4px;
}

.banner-text {
  margin: 0 0 8px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1.45;
}

.remote-host {
  color: var(--color-primary);
  font-family: var(--font-family-mono, ui-monospace, monospace);
  font-size: 0.9em;
  word-break: break-all;
}

.banner-link {
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  color: var(--color-primary);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.banner-link:hover {
  opacity: 0.9;
}
</style>
