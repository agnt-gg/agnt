<template>
  <div class="pro-gate">
    <slot v-if="allowed" />
    <section v-else class="pro-gate-locked" :aria-label="label">
      <div class="pro-gate-preview" aria-hidden="true"><slot name="preview"><slot /></slot></div>
      <div class="pro-gate-overlay">
        <span class="pro-badge"><i class="fas fa-crown" aria-hidden="true"></i> {{ planName }}</span>
        <p class="pro-gate-title">{{ label }} with {{ planName }}</p>
        <p class="pro-gate-hint">{{ hint }}</p>
        <button class="pro-gate-cta" type="button" @click="openUpgrade"><i class="fas fa-arrow-up" aria-hidden="true"></i> Upgrade <i class="fas fa-arrow-right" aria-hidden="true"></i></button>
      </div>
    </section>
    <UpgradeModal :open="showUpgrade" :reason="`${label} with ${planName}.`" :suggest="suggest" @close="showUpgrade = false" />
  </div>
</template>

<script>
/**
 * Wrap anything that needs a paid plan. Renders the slot when the feature is
 * licensed; otherwise a readable plan card with a gold Upgrade button
 * opens the pricing modal. One component, so every gate in the app looks and
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
// Feature names that map onto an existing license key.
const ALIASES = { teams: 'multiUser' };

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
      const f = license.hasFeature(ALIASES[props.feature] || props.feature);
      return !!(f && (typeof f !== 'object' || f.enabled));
    });
    const openUpgrade = () => { showUpgrade.value = true; };
    const planName = computed(() => props.suggest === 'business' ? 'AGNT Team' : 'AGNT Pro');
    return { allowed, showUpgrade, openUpgrade, planName };
  },
};
</script>

<style scoped>
.pro-gate { position: relative; width: 100%; }
.pro-gate-locked { display: flex; flex-direction: column; min-height: 240px; padding: 28px; box-sizing: border-box; border: 1px solid var(--terminal-border-color); border-radius: 14px; background: var(--color-background); color: var(--text-primary); overflow: hidden; }
.pro-gate-preview { display: none; }
.pro-gate-overlay { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 14px; flex: 1; }
.pro-badge { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; padding: 6px 9px; border: 1px solid rgba(var(--yellow-rgb), .35); border-radius: 5px; color: var(--text-primary); background: rgba(var(--yellow-rgb), .1); }
.pro-gate-title { margin: 0; font-size: 24px; line-height: 1.2; letter-spacing: -.025em; font-weight: 650; color: var(--text-primary); }
.pro-gate-hint { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-secondary); max-width: 580px; }
.pro-gate-cta { display: inline-flex; align-items: center; justify-content: center; gap: 12px; min-height: 44px; margin-top: 6px; padding: 10px 18px; border: 1px solid var(--color-yellow); border-radius: 7px; background: var(--color-yellow); color: #18140b; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 3px 12px rgba(var(--yellow-rgb), .12); }
.pro-gate-cta:hover { filter: brightness(1.08); }
.pro-gate-cta:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }
@media (max-width: 640px) { .pro-gate-locked { padding: 22px; } .pro-gate-title { font-size: 21px; } }
</style>
