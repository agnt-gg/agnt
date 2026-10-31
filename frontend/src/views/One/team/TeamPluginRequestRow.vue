<template>
  <!-- A plugin request on Home: the owner (or an allowed admin) decides; the person who asked sees the outcome. -->
  <div class="r" :data-testid="`plugin-request-${request.id}`">
    <span :class="decided ? 'read' : 'unread'"></span>
    <TeamAvatar :who="{ kind: 'person', id: request.requesterId }" :label="asker" size="lg" />
    <span class="r-text">
      <strong class="mk-wrap">
        <template v-if="decider">{{ asker }} <span style="font-weight: 400; color: var(--text-secondary)">wants to add the plugin</span> {{ title }}</template>
        <template v-else-if="request.status === 'approved'">{{ title }} <span style="font-weight: 400; color: var(--text-secondary)">is ready. Your request was approved.</span></template>
        <template v-else-if="request.status === 'declined'">{{ title }} <span style="font-weight: 400; color: var(--text-secondary)">was not approved.</span></template>
        <template v-else-if="request.status === 'failed'">{{ title }} <span style="font-weight: 400; color: var(--text-secondary)">could not be installed.</span></template>
        <template v-else>{{ title }} <span style="font-weight: 400; color: var(--text-secondary)">is waiting for the owner.</span></template>
      </strong>
      <small>
        <template v-if="decider">It can reach {{ reach }} · {{ tierLabel }}</template>
        <template v-else-if="request.status === 'failed' && request.error">{{ request.error }}</template>
        <template v-else>{{ ago(request.createdAt) }}</template>
      </small>
    </span>
    <span class="tag" :class="tone">{{ tagLabel }}</span>
    <template v-if="decider">
      <button type="button" class="btn sm" :disabled="busy" @click="$emit('decline', request)">Decline</button>
      <button type="button" class="primary sm" :disabled="busy" @click="$emit('approve', request)">{{ busy ? 'Installing…' : 'Approve' }}</button>
    </template>
    <button v-else-if="decided" type="button" class="btn ghost sm" @click="$emit('dismiss', request)">Dismiss</button>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import { ago } from './teamModel.js';
import { reachLabel } from '@/composables/usePluginRequests.js';

const props = defineProps({ request: { type: Object, required: true }, decider: { type: Boolean, default: false }, busy: { type: Boolean, default: false } });
defineEmits(['approve', 'decline', 'dismiss']);
const ctx = inject('teamCtx', null);
const asker = computed(() => ctx?.people.value.find((p) => p.id === props.request.requesterId)?.name || 'A teammate');
const title = computed(() => props.request.pluginName.replace(/-plugin$/, '').split(/[-_]/).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' '));
const reach = computed(() => reachLabel(props.request.report?.reaches || []));
const tierLabel = computed(() => (props.request.report?.trustTier === 'official' ? 'Official AGNT plugin' : 'Not an official plugin') + (props.request.report?.integrityState === 'verified' ? ', verified download' : ''));
const decided = computed(() => props.request.status !== 'pending');
const tagLabel = computed(() => (props.decider ? 'Plugin request' : { approved: 'Ready', declined: 'Declined', failed: 'Failed', pending: 'Requested' }[props.request.status]));
const tone = computed(() => (props.decider ? 'pink' : { approved: 'green', declined: '', failed: 'amber', pending: 'blue' }[props.request.status]));
</script>
