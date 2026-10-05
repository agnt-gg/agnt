<template>
  <section class="ta" :aria-busy="loading">
    <div class="ta-head">
      <div>
        <h3 class="ta-title"><i class="fas fa-comment-dots"></i> Text Annie</h3>
        <p class="ta-sub">Message Annie from iMessage, RCS or SMS. She answers from this AGNT, with its tools and models. No app to install.</p>
      </div>
      <a class="ta-link" href="https://mobile.agnt.gg/docs.html" target="_blank" rel="noopener">How it works</a>
    </div>

    <div v-if="loading && !state" class="ta-skeleton" aria-hidden="true"><span></span><span></span></div>

    <p v-else-if="loadError" class="ta-note ta-note-error"><i class="fas fa-exclamation-circle"></i><span>{{ loadError }}</span></p>

    <template v-else-if="state">
      <p v-if="!planEligible" class="ta-note ta-note-warn">
        <i class="fas fa-lock"></i>
        <span>Texting needs AGNT Mobile — included with paid AGNT plans, or $5/month.
          <a href="https://mobile.agnt.gg/app.html#billing" target="_blank" rel="noopener">Add it</a>.</span>
      </p>

      <div v-for="phone in phones" :key="phone.id" class="ta-phone">
        <div class="ta-phone-main">
          <strong>{{ formatNumber(phone.number) }}</strong>
          <small>
            <template v-if="phone.state === 'pending'">Waiting for your code</template>
            <template v-else-if="phone.state === 'paused'">Paused — text START to resume</template>
            <template v-else>
              Texts go to {{ routeLabel(phone.route) }} ·
              <span :class="isOnline(phone.route) ? 'ta-on' : 'ta-off'">{{ isOnline(phone.route) ? 'online' : 'offline' }}</span>
            </template>
            <template v-if="phone.line"> · Annie: {{ formatNumber(phone.line) }}</template>
          </small>
        </div>
        <div class="ta-phone-actions">
          <button v-if="phone.state === 'pending'" class="ta-btn ta-btn-primary" :disabled="busy" @click="refreshCode(phone)">Finish linking</button>
          <CustomSelect
            v-else
            class="ta-select"
            :model-value="phone.route"
            :options="targets"
            :disabled="busy"
            :aria-label="`Where texts from ${phone.number} go`"
            @update:modelValue="onRoute(phone, $event)"
          />
          <button class="ta-btn" :disabled="busy" @click="onUnlink(phone)">Unlink</button>
        </div>
      </div>

      <div v-if="linking" class="ta-link-panel">
        <div class="ta-link-row">
          <div>
            <div class="ta-step">From <strong>{{ formatNumber(linking.phone.number) }}</strong>, text this code</div>
            <code class="ta-code">{{ linking.code }}</code>
          </div>
          <div>
            <div class="ta-step">to Annie at</div>
            <strong class="ta-line">{{ formatNumber(linking.phone.line) || 'your Annie number' }}</strong>
          </div>
          <div v-if="qrSvg" class="ta-qr" v-html="qrSvg" v-tooltip="'Scan to open Messages with the code ready'"></div>
        </div>
        <p class="ta-fine">
          Or scan with that phone's camera: Messages opens with the code filled in.
          Just tap send.
          This updates by itself once your text arrives · {{ expiresIn }}
          · <button class="ta-inline" type="button" @click="copy(linking.code)">{{ copied ? 'Copied' : 'Copy code' }}</button>
        </p>
      </div>

      <form v-if="canAddPhone" class="ta-add" @submit.prevent="onAdd">
        <label class="ta-field">
          <span>Your mobile number</span>
          <input v-model="number" type="tel" inputmode="tel" autocomplete="tel" placeholder="+1 970 555 0101" required />
        </label>
        <div class="ta-field">
          <span>Send texts to</span>
          <CustomSelect v-model="route" class="ta-select" :options="targets" aria-label="Send texts to" />
        </div>
        <button class="ta-btn ta-btn-primary" type="submit" :disabled="busy || !number.trim()">Link phone</button>
      </form>

      <p v-if="error" class="ta-note ta-note-error"><i class="fas fa-exclamation-circle"></i><span>{{ error }}</span></p>
      <p v-if="planEligible && state.plan" class="ta-fine">
        {{ state.plan.planName }} · {{ (state.plan.remainingUnits ?? 0).toLocaleString() }} of
        {{ (state.plan.includedUnits ?? 0).toLocaleString() }} texts left this month ·
        <a href="https://mobile.agnt.gg/app.html" target="_blank" rel="noopener">Manage</a>
      </p>
    </template>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { toSvg } from '@/utils/qrcode.js';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
import * as textAnnie from '@/services/textAnnieService.js';

const state = ref(null);
const loading = ref(true);
const loadError = ref('');
const error = ref('');
const busy = ref(false);
const number = ref('');
const route = ref('');
const linking = ref(null); // { phone, code }
const copied = ref(false);
const now = ref(Date.now());
let poller = null;
let ticker = null;

const phones = computed(() => state.value?.phones || []);
const planEligible = computed(() => state.value?.plan?.eligible === true);
const thisInstance = computed(() => state.value?.instance || 'desktop');
const canAddPhone = computed(() => {
  if (!state.value?.linking || !planEligible.value) return false;
  const max = state.value.plan?.maxPhones || 0;
  return phones.value.length < max;
});

/** This AGNT first, then every other AGNT the account owns. */
const targets = computed(() => {
  const list = [{ value: thisInstance.value, label: thisInstance.value === 'desktop' ? 'This computer' : `This cloud AGNT (${thisInstance.value})` }];
  if (thisInstance.value !== 'desktop') list.push({ value: 'desktop', label: 'My desktop app' });
  for (const instance of state.value?.instances || []) {
    if (instance.slug !== thisInstance.value) list.push({ value: instance.slug, label: `Cloud AGNT (${instance.slug})` });
  }
  return list;
});

const routeLabel = (value) => targets.value.find((t) => t.value === value)?.label.toLowerCase() || value;
const isOnline = (target) => !!state.value?.targets?.find((t) => t.target === target)?.online;
const formatNumber = (value) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value || '');
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : value || '';
};

/** SMSTO:<line>:<code> - the camera opens Messages directly (see linkQrPayload). */
const qrSvg = computed(() => {
  const payload = linking.value && textAnnie.linkQrPayload(linking.value.phone.line, linking.value.code);
  if (!payload) return '';
  try {
    return toSvg(payload, { moduleSize: 6, quietZone: 4, dark: '#000000', light: '#ffffff' });
  } catch {
    return ''; // never render a corrupt code; the number and code are on screen
  }
});
const expiresIn = computed(() => {
  const left = (linking.value?.phone.codeExpiresAt || 0) - now.value;
  return left > 0 ? `code expires in ${Math.ceil(left / 60000)} min` : 'code expired — Finish linking for a new one';
});

async function load() {
  try {
    state.value = await textAnnie.getStatus();
    loadError.value = '';
    if (!route.value) route.value = thisInstance.value;
    const pending = linking.value && phones.value.find((p) => p.id === linking.value.phone.id);
    if (linking.value && (!pending || pending.state !== 'pending')) stopLinking();
  } catch (e) {
    if (!state.value) loadError.value = textAnnie.explain(e);
  } finally {
    loading.value = false;
  }
}

function startLinking(phone, code) {
  linking.value = { phone, code };
  clearInterval(poller);
  poller = setInterval(load, 4000);
}
function stopLinking() {
  linking.value = null;
  clearInterval(poller);
  poller = null;
}

async function run(task) {
  busy.value = true;
  error.value = '';
  try {
    await task();
  } catch (e) {
    error.value = textAnnie.explain(e);
  } finally {
    busy.value = false;
  }
}

const onAdd = () => run(async () => {
  const result = await textAnnie.addPhone(number.value, route.value || thisInstance.value);
  number.value = '';
  await load();
  if (!result.alreadyLinked) startLinking(result.phone, result.code);
});
const refreshCode = (phone) => run(async () => {
  const result = await textAnnie.newCode(phone.id);
  startLinking(result.phone, result.code);
});
const onRoute = (phone, value) => run(async () => {
  await textAnnie.setRoute(phone.id, value);
  await load();
});
const onUnlink = (phone) => run(async () => {
  if (!window.confirm(`Unlink ${formatNumber(phone.number)}? Texts from it will stop reaching AGNT.`)) return;
  await textAnnie.removePhone(phone.id);
  if (linking.value?.phone.id === phone.id) stopLinking();
  await load();
});

async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    /* clipboard denied: the code is on screen */
  }
}

onMounted(() => {
  load();
  ticker = setInterval(() => (now.value = Date.now()), 15000);
});
onBeforeUnmount(() => {
  clearInterval(poller);
  clearInterval(ticker);
});
</script>

<style scoped>
.ta {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 10px;
  border: 1px solid rgba(var(--primary-rgb), 0.35);
  background: var(--color-darker-1, #1b1b2b);
}
.ta-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.ta-title { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: var(--color-text, #e0e0e0); }
.ta-title i { color: var(--color-primary, #19ef83); margin-right: 6px; }
.ta-sub { margin: 0; font-size: 13px; color: var(--color-light-med-navy, #8b93a7); }
.ta-link { font-size: 12px; color: var(--color-primary, #19ef83); white-space: nowrap; }
.ta-note { display: flex; gap: 8px; align-items: flex-start; margin: 0; padding: 10px 12px; border-radius: 8px; font-size: 13px; border: 1px solid var(--color-dull-navy, #2e3350); color: var(--color-light-med-navy, #8b93a7); }
.ta-note a { color: inherit; text-decoration: underline; }
.ta-note-warn { border-color: rgba(var(--yellow-rgb), 0.4); color: var(--text-yellow); }
.ta-note-error { border-color: rgba(var(--red-rgb), 0.5); color: var(--color-red); }
.ta-phone { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--color-dull-navy, #2e3350); }
.ta-phone-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ta-phone-main strong { font-size: 14px; color: var(--color-text, #e0e0e0); }
.ta-phone-main small { font-size: 12px; color: var(--color-light-med-navy, #8b93a7); }
.ta-on { color: var(--color-primary, #19ef83); }
.ta-off { color: var(--text-yellow); }
.ta-phone-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ta-select { min-width: 220px; }
/* Fill comes from _forms.css (--color-darker-0), which composites on any surface. */
.ta-field input { min-height: 34px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--color-dull-navy, #2e3350); color: var(--color-text, #e0e0e0); font: inherit; font-size: 13px; }
.ta-btn { min-height: 34px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--color-dull-navy, #2e3350); background: transparent; color: var(--color-text, #e0e0e0); font: inherit; font-size: 13px; cursor: pointer; }
.ta-btn:hover:not(:disabled) { border-color: var(--color-primary, #19ef83); }
.ta-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ta-btn-primary { background: var(--color-primary, var(--color-green)); border-color: var(--color-primary, #19ef83); color: var(--on-fill-accent, #0b0b14); font-weight: 600; }
.ta-add { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; }
.ta-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--color-light-med-navy, #8b93a7); }
.ta-field input { width: 200px; }
.ta-link-panel { padding: 14px; border-radius: 8px; background: rgba(var(--primary-rgb), 0.08); border: 1px solid rgba(var(--primary-rgb), 0.4); }
.ta-link-row { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
.ta-step { font-size: 12px; color: var(--color-light-med-navy, #8b93a7); margin-bottom: 4px; }
.ta-code { display: inline-block; font-size: 22px; font-weight: 700; letter-spacing: 0.08em; padding: 4px 12px; border-radius: 6px; background: var(--color-background, #12121c); color: var(--color-text, #e0e0e0); user-select: all; }
.ta-line { font-size: 18px; color: var(--color-text, #e0e0e0); }
.ta-qr { width: 168px; height: 168px; border-radius: 8px; background: #fff; margin-left: auto; }
.ta-qr :deep(svg) { width: 100%; height: 100%; display: block; }
.ta-fine { margin: 6px 0 0; font-size: 12px; color: var(--color-light-med-navy, #8b93a7); }
.ta-fine a, .ta-inline { color: var(--color-primary, #19ef83); }
.ta-inline { background: none; border: none; padding: 0; font: inherit; cursor: pointer; text-decoration: underline; }
.ta-skeleton { display: flex; flex-direction: column; gap: 8px; }
.ta-skeleton span { height: 40px; border-radius: 8px; background: var(--color-dull-navy, #2e3350); opacity: 0.35; }
@media (max-width: 640px) { .ta-qr { margin-left: 0; } .ta-field input { width: 100%; } }
</style>
