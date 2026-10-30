<template>
  <div class="ot-r is-click" role="button" tabindex="0" @click="onRow" @keydown.enter="onRow">
    <span :class="item.read ? 'ot-read' : 'ot-unread'"></span>
    <TeamAvatar :who="item.actor" :label="actorName" size="lg" />
    <span class="ot-r-text">
      <strong class="is-wrap">{{ actorName }} <span style="font-weight: 400; color: var(--text-secondary)">{{ inboxSentence(item) }}</span></strong>
      <small>{{ ago(item.createdAt) }}<template v-if="spaceName"> · {{ spaceName }}</template></small>
    </span>
    <span class="ot-tag" :class="TAG[item.kind]?.tone">{{ TAG[item.kind]?.label || item.kind }}</span>
    <button v-if="item.kind === 'approval' && item.state === 'pending'" type="button" class="focused-primary is-small" @click.stop="$emit('open', item)">Review</button>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import { ago, inboxSentence, nameOf } from './teamModel.js';

const TAG = Object.freeze({
  approval: { label: 'Approval', tone: 'is-pink' },
  mention: { label: 'Mention', tone: 'is-blue' },
  assigned: { label: 'Assigned', tone: '' },
  run: { label: 'Run', tone: 'is-amber' },
  shared: { label: 'Shared', tone: 'is-green' },
});
const props = defineProps({ item: { type: Object, required: true } });
const emit = defineEmits(['open']);
const ctx = inject('teamCtx');
const actorName = computed(() => (props.item.actor.kind === 'agent' ? 'An agent' : nameOf(props.item.actor, { people: ctx.people.value, me: ctx.me.value })));
const spaceName = computed(() => ctx.spaces.value.find((s) => s.id === props.item.workspaceId)?.name || '');
const onRow = () => emit('open', props.item);
</script>
