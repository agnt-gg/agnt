<template>
  <Teleport to="body">
  <div class="za">
  <div class="za-layer" data-testid="add-connection">
    <div class="scrim"></div>
    <div class="modal-wrap" @click.self="emit('close')">
      <!-- Pick: every app and AI model, or a team provider -->
      <div v-if="step === 'pick'" class="za-modal" :class="{ fit: team }" role="dialog" aria-modal="true" :aria-label="title">
        <div class="md-head">
          <h2>{{ title }}</h2>
          <button type="button" class="icon-btn" aria-label="Close" data-action="close" @click="emit('close')"><AppsGlyph name="x" /></button>
        </div>
        <div class="md-body picker">
          <template v-if="team">
            <p>Model connections may incur provider charges billed to the team.</p>
            <label class="search" style="margin: 12px 0 0">
              <AppsGlyph name="pen" size="sm" />
              <input v-model="teamName" maxlength="100" placeholder="Name, e.g. Company GitHub" aria-label="Connection name" data-testid="team-connection-name" />
            </label>
          </template>
          <label class="search" :style="team ? 'margin: 12px 0' : ''">
            <AppsGlyph name="find" size="sm" />
            <input ref="searchInput" v-model="q" :placeholder="team ? 'Search providers' : `Search ${items.length} apps and AI models`" aria-label="Search apps" autocomplete="off" spellcheck="false" data-testid="add-search" />
            <button v-if="q" type="button" class="clear" aria-label="Clear search" @click="clearSearch"><AppsGlyph name="x" size="sm" /></button>
          </label>
          <div v-if="!team" class="seg" role="tablist" aria-label="Kinds">
            <button v-for="choice in PICKER_TABS" :key="choice.id" type="button" :class="{ on: tab === choice.id }" role="tab" :aria-selected="tab === choice.id" :data-tab="choice.id" @click="tab = choice.id">
              {{ choice.label }}<span class="n">{{ counts[choice.id] }}</span>
            </button>
          </div>
          <div class="pick" :class="{ 'is-empty': !shown.length }" data-testid="pick">
            <template v-if="shown.length">
              <div v-for="item in shown" :key="item.id" class="pick-item" :data-item="item.id">
                <span class="logo"><SvgIcon :name="item.icon" /></span>
                <div class="grow"><strong>{{ item.name }}</strong><small>{{ describe(item) }}</small></div>
                <span v-if="item.status === 'ready'" class="done"><AppsGlyph name="check" size="xs" />Connected</span>
                <button v-else type="button" class="btn sm" data-action="connect" :disabled="busy.has(item.id)" @click="connectItem(item)">
                  {{ busy.has(item.id) ? 'Connecting…' : item.status === 'reconnect' ? 'Reconnect' : 'Connect' }}
                </button>
              </div>
            </template>
            <div v-else-if="q.trim() && !team" class="empty pick-empty" data-section="no-match">
              <span class="em-icon"><AppsGlyph name="plus" /></span>
              <h3>No app matches “{{ q.trim() }}”</h3>
              <p>Add it as a custom app. You’ll need its API key from the app’s settings.</p>
              <div class="row-gap">
                <button type="button" class="primary" data-action="custom-app-named" @click="openCustom(q.trim())"><AppsGlyph name="plus" size="sm" />Add “{{ q.trim() }}” as a custom app</button>
              </div>
            </div>
            <p v-else class="muted" style="padding: 24px 4px; text-align: center">{{ q.trim() ? `Nothing matches “${q.trim()}”.` : 'Nothing in this list.' }}</p>
          </div>
        </div>
        <div v-if="!team" class="md-foot split">
          <span class="foot-note"><AppsGlyph name="help" size="sm" /><span>Don’t see your app? Add it yourself.</span></span>
          <button type="button" class="btn" data-action="custom-app" @click="openCustom('')"><AppsGlyph name="plus" size="sm" />Add a custom app</button>
        </div>
      </div>

      <!-- An app that is not in the list -->
      <div v-else class="za-modal" role="dialog" aria-modal="true" aria-label="Add a custom app">
        <div class="md-head">
          <button type="button" class="icon-btn" aria-label="Back to all apps" data-action="back" @click="back"><AppsGlyph name="back" /></button>
          <h2>Add a custom app</h2>
          <button type="button" class="icon-btn" aria-label="Close" data-action="close" @click="emit('close')"><AppsGlyph name="x" /></button>
        </div>
        <form id="za-custom-app" class="md-body" novalidate @submit.prevent="saveCustom">
          <p>Connect an app that isn’t in the list. Once it’s connected, Annie can use it through custom tools.</p>
          <div class="fld">
            <label for="za-ca-name">App name</label>
            <input id="za-ca-name" ref="nameInput" v-model="form.name" class="input" :class="{ bad: errors.name }" maxlength="80" placeholder="e.g. Acme CRM" autocomplete="off" :aria-invalid="!!errors.name" />
            <small :class="{ err: errors.name }">{{ errors.name || 'The name you’ll see in Connections' }}</small>
          </div>
          <div class="fld">
            <span id="za-ca-type" class="lbl">How does it connect?</span>
            <div class="choice" role="radiogroup" aria-labelledby="za-ca-type">
              <button type="button" class="choice-item" :class="{ on: form.type === 'apikey' }" role="radio" :aria-checked="form.type === 'apikey'" data-type="apikey" @click="form.type = 'apikey'">
                <span class="radio"></span><span><strong>API key</strong><small>Paste a key from the app’s settings</small></span>
              </button>
              <button type="button" class="choice-item" :class="{ on: form.type === 'oauth' }" role="radio" :aria-checked="form.type === 'oauth'" data-type="oauth" @click="form.type = 'oauth'">
                <span class="radio"></span><span><strong>Sign-in page</strong><small>Sign in on the app’s own page</small></span>
              </button>
            </div>
          </div>
          <template v-if="form.type === 'apikey'">
            <div class="fld">
              <label for="za-ca-key">API key</label>
              <div class="pw">
                <input id="za-ca-key" ref="keyInput" v-model="form.key" class="input mono" :class="{ bad: errors.key }" :type="showKey ? 'text' : 'password'" placeholder="Paste the key" autocomplete="off" spellcheck="false" :aria-invalid="!!errors.key" />
                <button type="button" class="btn" data-action="show-key" @click="showKey = !showKey">{{ showKey ? 'Hide' : 'Show' }}</button>
              </div>
              <small :class="{ err: errors.key }">{{ errors.key || 'Find it in the app’s settings, usually under API or Developers.' }}</small>
            </div>
            <div class="fld">
              <label for="za-ca-where">Where to find the key<em>Optional</em></label>
              <input id="za-ca-where" v-model="form.where" class="input" maxlength="300" placeholder="e.g. Settings › API, or a link" autocomplete="off" />
              <small>Shown when the key needs replacing</small>
            </div>
            <p v-if="formError" class="md-error" role="alert">{{ formError }}</p>
          </template>
          <div v-else class="note" data-section="sign-in-page">
            <span class="logo"><AppsGlyph name="puzzle" size="sm" /></span>
            <div class="grow">
              <strong>Apps with a sign-in page connect through a plugin</strong>
              <p>A plugin adds the app’s own sign-in to AGNT, and it runs on this computer. Annie can build one for {{ form.name.trim() || 'your app' }}.</p>
              <div class="row-gap"><button type="button" class="primary sm" data-action="ask-annie" @click="emit('ask-annie', form.name.trim())">Ask Annie to build it</button></div>
            </div>
          </div>
        </form>
        <div class="md-foot">
          <button type="button" class="btn" @click="back">Back</button>
          <span class="grow"></span>
          <button v-if="form.type === 'apikey'" type="submit" form="za-custom-app" class="primary" data-action="save-custom" :disabled="saving">{{ saving ? 'Connecting…' : 'Add and connect' }}</button>
        </div>
      </div>
    </div>
  </div>
  </div>
  </Teleport>
</template>

<script setup>
// Add connection: everything AGNT can connect, one click each. An app that is not
// listed can be added with its API key; one with its own sign-in page connects
// through a plugin, which Annie can build.
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
import AppsGlyph from './AppsGlyph.vue';
import { PICKER_TABS, customAppErrors } from './appsModel.js';

const props = defineProps({
  items: { type: Array, default: () => [] },
  team: { type: Object, default: null },
  teamOptions: { type: Array, default: () => [] },
  // (item) => Promise<boolean>, (form) => Promise, ({ providerId, name }) => Promise
  connect: { type: Function, required: true },
  createCustom: { type: Function, required: true },
  teamConnect: { type: Function, default: null },
});
const emit = defineEmits(['close', 'ask-annie']);

const step = ref('pick');
const q = ref('');
const tab = ref('all');
const busy = ref(new Set());
const teamName = ref('');
const form = reactive({ name: '', key: '', where: '', type: 'apikey' });
const errors = ref({});
const formError = ref('');
const saving = ref(false);
const showKey = ref(false);
const searchInput = ref(null);
const nameInput = ref(null);
const keyInput = ref(null);

const title = computed(() => (props.team ? `Connect for ${props.team.name}` : 'Add a connection'));
const matching = computed(() => {
  const query = q.value.trim().toLowerCase();
  const source = props.team ? props.teamOptions.map((option) => ({ ...option, kind: option.ai ? 'Model key' : 'Sign-in', status: null })) : props.items;
  return source.filter((item) => !query || `${item.name} ${item.id}`.toLowerCase().includes(query));
});
const counts = computed(() => Object.fromEntries(PICKER_TABS.map((choice) => [choice.id, matching.value.filter(choice.test).length])));
const shown = computed(() => {
  if (props.team) return matching.value;
  const test = (PICKER_TABS.find((choice) => choice.id === tab.value) || PICKER_TABS[0]).test;
  return matching.value.filter(test);
});

const describe = (item) => [item.ai ? 'AI model' : null, item.kind, item.local ? 'on this computer' : null, item.custom ? 'custom app' : null].filter(Boolean).join(' · ');
const focus = (input) => nextTick(() => input.value?.focus({ preventScroll: true }));

function clearSearch() {
  q.value = '';
  focus(searchInput);
}
async function connectItem(item) {
  if (busy.value.has(item.id)) return;
  busy.value = new Set([...busy.value, item.id]);
  try {
    if (props.team) await props.teamConnect({ providerId: item.id, name: teamName.value.trim() || item.name });
    else await props.connect(item);
  } finally {
    const next = new Set(busy.value);
    next.delete(item.id);
    busy.value = next;
  }
}
function openCustom(name) {
  Object.assign(form, { name, key: '', where: '', type: 'apikey' });
  errors.value = {};
  formError.value = '';
  showKey.value = false;
  step.value = 'custom';
  focus(name ? keyInput : nameInput);
}
function back() {
  step.value = 'pick';
  focus(searchInput);
}
async function saveCustom() {
  if (saving.value || form.type !== 'apikey') return;
  formError.value = '';
  errors.value = customAppErrors(form, props.items);
  const invalid = Object.keys(errors.value);
  if (invalid.length) return focus(invalid[0] === 'name' ? nameInput : keyInput);
  saving.value = true;
  try {
    await props.createCustom({ ...form });
  } catch (error) {
    formError.value = error?.message || String(error);
  } finally {
    saving.value = false;
  }
}

// A field's error clears as soon as it is edited.
watch(() => form.name, () => { if (errors.value.name) errors.value = { ...errors.value, name: undefined }; });
watch(() => form.key, () => { if (errors.value.key) errors.value = { ...errors.value, key: undefined }; });

onMounted(() => focus(searchInput));
</script>
