<template>
  <div v-if="isCodex" class="codex-speed-control">
    <span class="speed-label">Text generation</span>
    <div class="speed-options" role="group" aria-label="Codex speed">
      <button type="button" :aria-pressed="!priority" :class="{ active: !priority }" @click="setPriority(false)">
        <span aria-hidden="true">🐢</span> Standard
      </button>
      <button type="button" :aria-pressed="priority" :class="{ active: priority }" @click="setPriority(true)">
        <span aria-hidden="true">🐇</span> Fast
      </button>
    </div>
    <Tooltip v-if="creditMultiplier" :text="creditTooltip" width="240px"><span class="speed-hint" tabindex="0">Fast · {{ creditMultiplier }}× credit usage ⓘ</span></Tooltip>
    <span class="speed-hint">{{ priority ? 'Priority requested' : 'Default service tier' }} · reasoning unchanged.</span>
    <span class="speed-hint">Applies to Codex chats in this browser. Priority availability varies; may use more quota or cost more.</span>
    <span v-if="priority" class="speed-hint">Applies if routing or fallback selects Codex too. Cost estimates exclude the priority surcharge.</span>
    <div class="image-row">
      <span class="speed-label">Image generation</span>
      <label><input data-test="images-enabled" type="checkbox" :checked="images.enabled" @change="setImages({ enabled: $event.target.checked })" /> Use subscription</label>
    </div>
    <div class="speed-options" role="group" aria-label="Preferred image policy (currently blocked)">
      <button v-for="choice in imageChoices" :key="choice.policy" type="button" :data-test="'image-policy-' + choice.policy"
        :aria-pressed="images.policy === choice.policy" :class="{ active: images.policy === choice.policy }"
        @click="setImages({ policy: choice.policy })">{{ choice.label }}</button>
    </div>
    <span class="speed-hint image-blocked" role="status">Blocked · subscription model selection unverified. Preference only; neither choice can generate yet. No API-key fallback.</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';
import { useStore } from 'vuex';
import { resolveProviderKey } from '@/store/app/aiProvider.js';
import { cleanImagePreference, isCodexImageAccount } from '@/services/codexImagePreferences.js';

const props = defineProps({ provider: { type: String, default: null }, model: { type: String, default: null } });
const store = useStore();
const isCodex = computed(() => isCodexImageAccount(resolveProviderKey(props.provider)));
const priority = computed(() => store.state.aiProvider.codexPriority === true);
const setPriority = (enabled) => store.commit('aiProvider/SET_CODEX_PRIORITY', enabled);
const providerKey = computed(() => resolveProviderKey(props.provider));
const images = computed(() => cleanImagePreference(store.state.aiProvider.codexImages?.[providerKey.value]));
const setImages = (update) => store.commit('aiProvider/SET_CODEX_IMAGES', { provider: providerKey.value, ...images.value, ...update });
const imageChoices = [{ policy: 'latest', label: 'Latest · Quality' }, { policy: 'latest-fast', label: 'Latest · Fast' }];
const creditMultiplier = computed(() => {
  const model = props.model || '';
  if (/^gpt-(6-astra|5\.(5|6))(?:$|-)/.test(model)) return 2.5;
  return /^gpt-5\.4(?:$|-)/.test(model) ? 2 : null;
});
const creditTooltip = 'Published Codex Fast credit rate (OpenAI, 2026-09-09). Uses your allowance faster; not a subscription price increase or image-quality setting. Actual priority availability varies.';
</script>

<style scoped>
.codex-speed-control { display: flex; flex-direction: column; gap: 8px; }
.speed-label { font-size: 0.85em; font-weight: 500; color: var(--color-light-med-navy); }
.speed-options { display: flex; gap: 4px; }
.speed-options button {
  flex: 1;
  min-height: 36px;
  padding: 8px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  background: transparent;
  color: var(--color-light-med-navy);
  font: inherit;
  cursor: pointer;
}
.speed-options button.active { color: var(--color-green); border-color: var(--color-green); }
.speed-options button:focus-visible { outline: 2px solid var(--color-green); outline-offset: 2px; }
.speed-hint { color: var(--color-med-navy); font-size: 0.75em; line-height: 1.5; }
.speed-options button span { font-size: 12px; }
.speed-options button { font-size: 12px; padding: 6px 8px; }
.image-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px solid var(--terminal-border-color); padding-top: 10px; margin-top: 4px; }
.image-row label { font-size: 12px; display: flex; align-items: center; gap: 5px; }
.image-blocked { border-left: 2px solid var(--color-med-navy); padding-left: 8px; }
</style>
