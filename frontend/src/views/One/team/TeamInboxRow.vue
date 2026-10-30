<template>
  <div class="r clickable" role="button" tabindex="0" @click="onRow" @keydown.enter="onRow">
    <span :class="item.read ? 'read' : 'unread'"></span>
    <TeamAvatar :who="item.actor" :label="actorName" size="lg" />
    <span class="r-text">
      <strong class="mk-wrap">{{ actorName }} <span style="font-weight: 400; color: var(--text-secondary)">{{ inboxSentence(item) }}</span></strong>
      <small>{{ ago(item.createdAt) }}<template v-if="spaceName"> · {{ spaceName }}</template></small>
    </span>
    <span class="tag" :class="TAG[item.kind]?.tone">{{ TAG[item.kind]?.label || item.kind }}</span>
    <button v-if="item.kind === 'approval' && item.state === 'pending'" type="button" class="primary sm" @click.stop="$emit('open', item)">Review</button>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue';
import TeamAvatar from './TeamAvatar.vue';
import { ago, inboxSentence, nameOf } from './teamModel.js';

const TAG = Object.freeze({
  approval: { label: 'Approval', tone: 'pink' },
  mention: { label: 'Mention', tone: 'blue' },
  assigned: { label: 'Assigned', tone: '' },
  run: { label: 'Run', tone: 'amber' },
  shared: { label: 'Shared', tone: 'green' },
});
const props = defineProps({ item: { type: Object, required: true } });
const emit = defineEmits(['open']);
const ctx = inject('teamCtx');
const actorName = computed(() => (props.item.actor.kind === 'agent' ? 'An agent' : nameOf(props.item.actor, { people: ctx.people.value, me: ctx.me.value })));
const spaceName = computed(() => ctx.spaces.value.find((s) => s.id === props.item.workspaceId)?.name || '');
const onRow = () => emit('open', props.item);
</script>
