<!-- TeamPanel — the Team screen's navigation in Studio: My Space and the teamspaces.
     Drawn like SettingsPanel. Every row asks the screen to go somewhere ('team-go' with a /team
     location, 'team-pick' for My Space rows and New…, 'team-new-space'); Team.vue does the going. -->
<template>
  <div class="team-panel">
    <div class="panel-header">
      <h2 class="title">/ {{ team ? titled(team.name) : 'Team' }}</h2>
    </div>

    <div class="team-nav">
      <div class="nav-section">
        <div class="nav-items">
          <button class="nav-item" :class="{ active: active === 'home' }" data-nav="home" @click="go({ view: 'home' })"><i class="fas fa-inbox"></i><span>Home</span></button>
          <div class="new-anchor">
            <button class="nav-item" data-nav="new" @click="newOpen = !newOpen"><i class="fas fa-plus"></i><span>New…</span></button>
            <div v-if="newOpen" class="new-menu" role="menu">
              <button v-for="n in NEW" :key="n.id" class="nav-item" role="menuitem" @click="pick(n.id)"><i :class="n.icon"></i><span>{{ n.label }}</span></button>
            </div>
          </div>
        </div>
      </div>

      <div class="nav-section">
        <h4>My Space</h4>
        <div class="nav-items">
          <button v-for="m in MINE" :key="m.id" class="nav-item" :class="{ active: active === m.id }" :data-nav="m.id" @click="pick(m.id)">
            <i :class="m.icon"></i><span>{{ m.label }}</span>
          </button>
        </div>
      </div>

      <div v-if="team" class="nav-section">
        <h4>Teamspaces <button class="add" title="New teamspace" aria-label="New teamspace" @click="$emit('panel-action', 'team-new-space')"><i class="fas fa-plus"></i></button></h4>
        <div class="nav-items">
          <button v-for="s in spaces" :key="s.id" class="nav-item" :class="{ active: active === 'space:' + s.id }" :data-nav="'space:' + s.id" @click="go({ view: 'space', space: s.id })">
            <i class="fas fa-hashtag"></i><span>{{ s.name }}</span>
          </button>
          <p v-if="!spaces.length" class="note">No teamspaces yet. Add one with +.</p>
        </div>
      </div>
      <p v-else class="note">This account is not on a team yet.</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useStore } from 'vuex';
import { useTeam } from '@/views/One/team/useTeam.js';

defineProps({ active: { type: String, default: null } });
const emit = defineEmits(['panel-action']);
const { state } = useTeam(useStore());
const team = computed(() => state.team);
const spaces = computed(() => state.spaces || []);
const newOpen = ref(false);

const MINE = [
  { id: 'mine-tasks', label: 'My tasks', icon: 'fas fa-check-square' },
  { id: 'mine-agents', label: 'My agents', icon: 'fas fa-robot' },
  { id: 'mine-routines', label: 'My routines', icon: 'fas fa-redo' },
  { id: 'mine-files', label: 'My files', icon: 'fas fa-folder' },
];
const NEW = [
  { id: 'new-task', label: 'Task', icon: 'fas fa-check-square' },
  { id: 'new-doc', label: 'Doc', icon: 'fas fa-file-alt' },
  { id: 'new-agent', label: 'Agent', icon: 'fas fa-robot' },
  { id: 'new-routine', label: 'Routine', icon: 'fas fa-redo' },
];
const titled = (name) => { const s = String(name || ''); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const go = (loc) => emit('panel-action', 'team-go', loc);
function pick(id) { newOpen.value = false; emit('panel-action', 'team-pick', id); }
</script>

<style scoped>
.team-panel { flex: 1; display: flex; flex-direction: column; gap: 20px; }
.panel-header { display: flex; align-items: center; padding: 0 0 12px 0; border-bottom: 1px solid var(--terminal-border-color-light); user-select: none; }
.panel-header .title { color: var(--color-primary); font-family: var(--font-family-primary); font-size: 16px; font-weight: 400; letter-spacing: 0.48px; margin: 0; }
.team-nav { flex: 1; display: flex; flex-direction: column; gap: 16px; }
.nav-section { display: flex; flex-direction: column; gap: 12px; }
.nav-section h4 { display: flex; align-items: center; color: var(--color-primary); font-size: 0.9em; font-weight: 500; margin: 0; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.8; }
.nav-section h4 .add { margin-left: auto; border: 0; background: none; color: inherit; cursor: pointer; padding: 2px 4px; opacity: 0.8; }
.nav-section h4 .add:hover { opacity: 1; }
.nav-items { display: flex; flex-direction: column; gap: 4px; }
.nav-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; color: var(--color-text-muted); font-size: 0.9em; background: none; border: none; font-family: inherit; text-align: left; width: 100%; }
.nav-item:hover { background: rgba(var(--primary-rgb), 0.1); color: var(--color-primary); transform: translateX(4px); }
.nav-item.active { background: rgba(var(--primary-rgb), 0.15); color: var(--color-text); border-left: 3px solid var(--color-primary); padding-left: 9px; }
.nav-item i { width: 16px; text-align: center; opacity: 0.8; }
.nav-item span { font-weight: 400; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new-anchor { position: relative; }
.new-menu { margin: 4px 0 0 16px; display: flex; flex-direction: column; gap: 2px; }
.note { margin: 0; color: var(--color-text-muted); font-size: 0.85em; }
</style>
