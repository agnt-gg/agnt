<template>
  <div class="ot-scroll">
    <div class="ot-page">
      <div class="ot-head">
        <div><h1>Inbox</h1><p>Mentions, cards assigned to you, and agent results waiting for your approval. Everything lands here once.</p></div>
        <button v-if="team" type="button" class="focused-btn" :disabled="!ctx.unread.value" @click="readAll"><i class="fas fa-check" aria-hidden="true"></i>Mark all read</button>
      </div>
      <template v-if="team">
        <nav class="ot-tabs" aria-label="Filter">
          <button v-for="f in FILTERS" :key="f.id" type="button" class="ot-tab" :class="{ 'is-active': filter === f.id }" @click="filter = f.id">{{ f.label }}<span v-if="f.id === 'unread' && ctx.unread.value" class="ot-count">{{ ctx.unread.value }}</span></button>
        </nav>
        <ul class="ot-list">
          <li v-if="!items.length" class="ot-empty">You are all caught up.</li>
          <li v-for="item in items" :key="item.id"><TeamInboxRow :item="item" @open="ctx.openInbox(item)" /></li>
        </ul>
      </template>
      <ul v-else class="ot-list"><li class="ot-empty">The inbox is for teams. Open a team from the switcher to see what needs you there.</li></ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject } from 'vue';
import TeamInboxRow from './TeamInboxRow.vue';
import { teamApi } from './useTeam.js';

const FILTERS = [{ id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'approval', label: 'Approvals' }, { id: 'mention', label: 'Mentions' }, { id: 'assigned', label: 'Assigned' }];
const ctx = inject('teamCtx');
const team = computed(() => ctx.team.value);
const filter = ref('all');
const items = computed(() => ctx.inbox.value.filter((i) => filter.value === 'all' || (filter.value === 'unread' ? !i.read : i.kind === filter.value)));

async function readAll() {
  try { await teamApi.markAllRead(); ctx.markLocalRead(null); } catch (e) { ctx.toast(e.message); }
}
</script>
