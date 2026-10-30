<template>
  <!-- The approved mockup's Agents page: yours (private), then each teamspace's. -->
  <div class="content">
    <div class="page">
      <div class="page-head">
        <div><h1>Agents</h1><p>Your private agents, and the ones each teamspace has published. Agents show up as members: @mention them or assign them a card.</p></div>
        <button type="button" class="primary" @click="ctx.create('agent')"><MkIcon name="plus" size="sm" />New agent</button>
      </div>
      <div class="sec-head"><h3><MkIcon name="lock" size="xs" /> Mine · private</h3></div>
      <div class="cards">
        <div class="card clickable" @click="ctx.ask('')">
          <div class="card-top"><span class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span><div><h4>Annie</h4><div class="mk-muted">Built in</div></div></div>
          <p>Your assistant. Knows everything you can see, nothing you can’t.</p>
          <div class="card-foot"><span class="tag pink">Always on</span></div>
        </div>
        <template v-if="!team">
          <div v-for="a in mine" :key="a.id" class="card clickable" @click="ctx.go({ view: 'agent', item: String(a.id) })">
            <div class="card-top"><span class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span><div style="min-width: 0"><h4>{{ a.name }}</h4><div class="mk-muted">by you</div></div></div>
            <p>{{ a.description || 'No description yet.' }}</p>
            <div class="card-foot"><span class="tag">Draft</span><span>{{ (a.assignedTools || []).length }} tools</span><span class="fill"></span><span class="scope sm mk-private"><MkIcon name="lock" size="sm" />Private</span></div>
          </div>
        </template>
        <div v-else class="card">
          <div class="card-top"><span class="r-icon"><MkIcon name="lock" size="sm" /></span><div><h4>Your private agents</h4></div></div>
          <p>They live in your Personal space. Copy one in from there to share it with a teamspace.</p>
        </div>
      </div>
      <template v-if="team">
        <template v-for="s in spaces" :key="s.id">
          <div class="sec-head"><h3># {{ s.name }}</h3><button type="button" class="btn ghost sm" @click="ctx.go({ view: 'space', space: s.id, tab: 'agents' })">Open</button></div>
          <div class="cards">
            <div v-for="a in bySpace[s.id] || []" :key="a.id" class="card clickable" @click="ctx.go({ view: 'space', space: s.id, tab: 'agents' })">
              <div class="card-top"><span class="av agent lg"><img src="/images/agnt-logo-mark.svg" alt="" /></span><div style="min-width: 0"><h4>{{ a.name }}</h4><div class="mk-muted">{{ s.name }}</div></div></div>
              <div class="card-foot"><span class="tag" :class="a.status === 'published' ? 'green' : ''">{{ a.status === 'published' ? 'Published' : a.status === 'changed' ? 'Changed since publishing' : 'Draft' }}</span><span class="fill"></span><span class="scope sm"><MkIcon name="users" size="sm" />{{ s.name }}</span></div>
            </div>
            <div v-if="loaded && !(bySpace[s.id] || []).length" class="empty">None yet</div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from 'vue';
import { useStore } from 'vuex';
import MkIcon from './MkIcon.vue';
import { teamApi } from '@/views/One/team/useTeam.js';

const ctx = inject('teamCtx');
const store = useStore();
const team = computed(() => ctx.team.value);
const spaces = computed(() => ctx.spaces.value);
const mine = computed(() => store.getters['agents/allAgents'] || []);
const bySpace = ref({});
const loaded = ref(false);

onMounted(async () => {
  if (!team.value) {
    if (!mine.value.length) store.dispatch('agents/fetchAgents').catch(() => {});
    loaded.value = true;
    return;
  }
  const entries = await Promise.all(spaces.value.map(async (s) => [s.id, (await teamApi.native(s.id).catch(() => [])).filter((x) => x.kind === 'agent')]));
  bySpace.value = Object.fromEntries(entries);
  loaded.value = true;
});
</script>
