<template>
  <section v-if="state.hosted" class="member-ai" aria-label="Members' AI">
    <div class="intro">
      <h3>Members' AI</h3>
      <p v-if="state.isOwner">Choose whose keys your teammates' chats run on. A teammate's own key, added in Settings &rarr; Connected Apps, is always used first.</p>
      <p v-else class="member-line">{{ memberLine }}</p>
    </div>
    <div v-if="state.isOwner" class="choices" role="radiogroup" aria-label="Who pays for members' AI">
      <label v-for="choice in CHOICES" :key="choice.value" :class="['choice', { active: state.billing === choice.value }]">
        <input type="radio" name="member-ai-billing" :value="choice.value" :checked="state.billing === choice.value" :disabled="busy" @change="save(choice.value)" />
        <span><strong>{{ choice.title }}</strong><small>{{ choice.detail }}</small></span>
      </label>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { API_CONFIG } from '@/tt.config.js';

const CHOICES = [
  { value: 'team', title: 'The team pays', detail: "Teammates without their own key use the team's AI keys and AGNT Models." },
  { value: 'member', title: 'Each member pays', detail: 'Teammates use only their own keys.' },
];

const state = ref({ hosted: false, isOwner: false, billing: 'team' });
const busy = ref(false);
const error = ref('');

const memberLine = computed(() => (state.value.billing === 'team'
  ? "Your chats use the team's AI keys, or your own key when you add one in Settings \u2192 Connected Apps."
  : 'Add your own AI key in Settings \u2192 Connected Apps to chat here. The team pays only for its own use.'));

async function request(options = {}) {
  const response = await fetch(API_CONFIG.BASE_URL + '/instance/member-ai', {
    ...options,
    headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || ''), 'Content-Type': 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not load who pays for members\u2019 AI');
  return body;
}

async function save(billing) {
  busy.value = true;
  error.value = '';
  try {
    state.value = await request({ method: 'PUT', body: JSON.stringify({ billing }) });
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    state.value = await request();
  } catch {
    // A desktop or an older backend has no such setting: show nothing.
  }
});

defineExpose({ save });
</script>

<style scoped>
.member-ai { display: flex; flex-direction: column; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--terminal-border-color); }
.intro h3 { margin: 0 0 4px; font-size: 14px; }
.intro p { margin: 0; color: var(--color-text-muted); font-size: 13px; line-height: 1.5; }
.choices { display: flex; gap: 10px; flex-wrap: wrap; }
.choice { display: flex; gap: 10px; align-items: flex-start; flex: 1 1 240px; padding: 12px 14px; border: 1px solid var(--terminal-border-color); border-radius: 12px; cursor: pointer; }
.choice.active { border-color: rgba(var(--primary-rgb), .45); }
.choice input { margin-top: 3px; accent-color: var(--color-primary); }
.choice span { display: flex; flex-direction: column; gap: 2px; }
.choice strong { font-size: 13px; }
.choice small { font-size: 12px; color: var(--color-text-muted); line-height: 1.45; }
.error { margin: 0; font-size: 12px; color: var(--color-red, #ff6b6b); }
</style>
