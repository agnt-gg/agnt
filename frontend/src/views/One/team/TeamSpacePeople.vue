<template>
  <!-- The approved mockup's "People in <space>": every teammate, a tick for who is in. Like a Slack
       channel, only the people in a teamspace see it; owners and admins inside it change who that is. -->
  <Teleport to="body">
    <div class="mk layer" role="presentation" @mousedown.self="$emit('close')">
      <div class="modal" role="dialog" aria-modal="true" :aria-label="'People in ' + space.name">
        <div class="modal-head">
          <h3>People in {{ space.name }}</h3>
          <button type="button" class="icon-btn" aria-label="Close" @click="$emit('close')"><MkIcon name="x" /></button>
        </div>
        <div class="modal-body">
          <p v-if="isDefault" class="mk-muted" style="margin: 4px 2px 0">Everyone on {{ teamName }} is in {{ space.name }}.</p>
          <button
            v-for="p in people"
            :key="p.id"
            type="button"
            class="opt"
            :class="{ on: isIn(p.id) }"
            :data-testid="'space-person-' + p.id"
            :aria-pressed="String(isIn(p.id))"
            :disabled="p.isMe || isDefault || !canManage || busy === p.id"
            @click="toggle(p)"
          >
            <TeamAvatar :who="{ kind: 'person', id: p.id }" :label="p.name" />
            <span style="flex: 1"><strong>{{ p.name }}{{ p.isMe ? ' (you)' : '' }}</strong><small>{{ roleLabel(p.role) }}</small></span>
            <MkIcon v-if="isIn(p.id)" name="check" size="sm" />
          </button>
        </div>
        <div class="modal-foot">
          <button v-if="canManage" type="button" class="btn" @click="$emit('invite')">Invite someone new</button>
          <button type="button" class="primary" @click="$emit('close')">Done</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref } from 'vue';
import MkIcon from '@/views/One/mk/MkIcon.vue';
import TeamAvatar from './TeamAvatar.vue';
import { roleLabel } from '@/utils/teamClient.js';
import { teamApi } from './useTeam.js';

const props = defineProps({
  space: { type: Object, required: true },
  teamName: { type: String, default: 'the team' },
  people: { type: Array, required: true }, // the team: [{ id, name, role, isMe }]
  memberIds: { type: Array, required: true },
  isDefault: { type: Boolean, default: false },
  canManage: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'invite', 'changed', 'error']);
const busy = ref(null);
const isIn = (id) => props.memberIds.includes(id);

async function toggle(person) {
  busy.value = person.id;
  try {
    emit('changed', await teamApi.setSpaceMember(props.space.id, person.id, !isIn(person.id)));
  } catch (error) {
    emit('error', error.message);
  } finally {
    busy.value = null;
  }
}
</script>
