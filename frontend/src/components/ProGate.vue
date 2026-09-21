<template>
  <div class="pro-gate">
    <slot v-if="allowed" />
    <div v-else class="pro-gate-locked" @click="openUpgrade" role="button" tabindex="0" @keydown.enter="openUpgrade" :aria-label="`${label} is included with AGNT Pro. Upgrade`">
      <div class="pro-gate-preview" aria-hidden="true"><slot name="preview"><slot /></slot></div>
      <div class="pro-gate-overlay">
        <span class="pro-badge"><i class="fas fa-lock"></i> PRO</span>
        <p class="pro-gate-title">{{ label }} is included with AGNT Pro</p>
        <p class="pro-gate-hint">{{ hint }}</p>
        <button class="pro-gate-cta" type="button" @click.stop="openUpgrade">Go Pro</button>
      </div>
    </div>
    <UpgradeModal :open="showUpgrade" :reason="`${label} is included with AGNT Pro.`" :suggest="suggest" @close="showUpgrade = false" />
  </div>
</template>

<script>
/**
 * Wrap anything that needs a paid plan. Renders the slot when the feature is
 * licensed; otherwise a dimmed preview with a PRO badge, and a click anywhere
 * opens the upgrade modal. One component, so every gate in the app looks and
 * behaves the same.
 *
 *   <ProGate feature="search" label="Web search">…</ProGate>
 *
 * `feature` is one of: models, search, sandbox, mail, hostedWebhooks — or any
 * legacy license feature name (webhooks, emailServer, plugins, …).
 */
import { computed, ref } from 'vue';
import { useLicense } from '@/composables/useLicense';
import UpgradeModal from './UpgradeModal.vue';

const SERVICE_FLAGS = { models: 'hasModels', search: 'hasSearch', sandbox: 'hasSandbox', mail: 'hasMail', hostedWebhooks: 'hasHostedWebhooks' };

export default {
  name: 'ProGate',
  components: { UpgradeModal },
  props: {
    feature: { type: String, required: true },
    label: { type: String, default: 'This feature' },
    hint: { type: String, default: 'Models, Search, Sandbox, Mail and Webhooks — one subscription, nothing else to buy.' },
    suggest: { type: String, default: 'personal' },
  },
  setup(props) {
    const license = useLicense();
    const showUpgrade = ref(false);
    const allowed = computed(() => {
      const flag = SERVICE_FLAGS[props.feature];
      if (flag) return !!license[flag].value;
      if (!license.isPremium.value) return false;
      const f = license.hasFeature(props.feature);
      return !!(f && (typeof f !== 'object' || f.enabled));
    });
    const openUpgrade = () => { showUpgrade.value = true; };
    return { allowed, showUpgrade, openUpgrade };
  },
};
</script>

<style scoped>
.pro-gate { position: relative; }
.pro-gate-locked { position: relative; cursor: pointer; border-radius: 8px; overflow: hidden; }
.pro-gate-preview { filter: blur(2px) grayscale(0.6); opacity: 0.45; pointer-events: none; user-select: none; }
.pro-gate-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 6px; padding: 16px; background: linear-gradient(180deg, rgba(20, 20, 26, 0.35), rgba(20, 20, 26, 0.8)); }
.pro-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: 0.12em; font-weight: 700; padding: 4px 8px; border-radius: 4px; color: var(--color-text); background: var(--color-pink); }
.pro-gate-title { margin: 6px 0 0; font-weight: 650; }
.pro-gate-hint { margin: 0; font-size: 12px; color: var(--color-text-secondary); max-width: 420px; }
.pro-gate-cta { margin-top: 8px; padding: 10px 18px; border: 0; border-radius: 6px; background: var(--color-text); color: var(--color-background); font-weight: 700; cursor: pointer; }
</style>
