<!-- TeamPanel — the Team screen's left panel in Studio: the team at a glance, My Space, the teamspaces
     and quick actions. Built from the same parts and styles as the Activity panel (TracesPanel): bordered
     section cards with titled icons, a stats grid, rows with icons and count pills, action buttons.
     Every row asks the screen to go somewhere ('team-go' with a /team location, 'team-pick' for My Space
     rows and New…, 'team-new-space'); Team.vue does the going. -->
<template>
  <div class="ui-panel team-panel">
    <div class="panel-header">
      <h2 class="title">/ {{ team ? titled(team.name) : 'Team' }}</h2>
      <div v-if="team" class="panel-stats">
        <span class="stat-item" title="Members"><i class="fas fa-users"></i>{{ memberCount }}</span>
      </div>
    </div>

    <!-- At a glance -->
    <div v-if="team" class="panel-section">
      <h4 class="section-title"><i class="fas fa-chart-bar"></i>Team at a glance</h4>
      <div class="stats-grid">
        <button class="stat-card" :class="{ active: active === 'home' }" data-nav="home" @click="go({ view: 'home' })">
          <div class="stat-value">{{ needsYou }}</div>
          <div class="stat-label">Needs you</div>
        </button>
        <div class="stat-card">
          <div class="stat-value">{{ spaces.length }}</div>
          <div class="stat-label">Teamspaces</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ memberCount }}</div>
          <div class="stat-label">Members</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ counts.agents }}</div>
          <div class="stat-label">My agents</div>
        </div>
      </div>
    </div>

    <!-- My Space -->
    <div class="panel-section">
      <h4 class="section-title"><i class="fas fa-user"></i>My Space</h4>
      <div class="filter-list">
        <div class="filter-item" :class="{ active: active === 'home' }" data-nav="home-row" @click="go({ view: 'home' })">
          <i class="fas fa-inbox"></i><span>Home</span>
          <span v-if="needsYou" class="filter-count">{{ needsYou }}</span>
        </div>
        <div v-for="m in MINE" :key="m.id" class="filter-item" :class="{ active: active === m.id }" :data-nav="m.id" @click="pick(m.id)">
          <i :class="m.icon"></i><span>{{ m.label }}</span>
          <span v-if="m.count != null && counts[m.count] != null" class="filter-count">{{ counts[m.count] }}</span>
        </div>
      </div>
    </div>

    <!-- Teamspaces -->
    <div v-if="team" class="panel-section">
      <h4 class="section-title">
        <i class="fas fa-layer-group"></i>Teamspaces
        <button class="section-add" title="New teamspace" aria-label="New teamspace" @click="$emit('panel-action', 'team-new-space')"><i class="fas fa-plus"></i></button>
      </h4>
      <div class="filter-list">
        <div v-for="s in spaces" :key="s.id" class="filter-item" :class="{ active: active === 'space:' + s.id }" :data-nav="'space:' + s.id" @click="go({ view: 'space', space: s.id })">
          <i :class="spaceIcon(s)"></i><span>{{ s.name }}</span>
          <i v-if="s.access === 'invited'" class="fas fa-lock lock" title="Invite only"></i>
        </div>
        <p v-if="!spaces.length" class="note">No teamspaces yet. Add one with +.</p>
      </div>
    </div>
    <div v-else class="panel-section">
      <p class="note">This account is not on a team yet.</p>
    </div>

    <!-- Quick actions -->
    <div class="panel-section">
      <h4 class="section-title"><i class="fas fa-bolt"></i>Quick Actions</h4>
      <div class="action-buttons">
        <button v-for="n in NEW" :key="n.id" class="action-button" :data-nav="n.id" @click="pick(n.id)"><i :class="n.icon"></i>{{ n.label }}</button>
        <button v-if="team" class="action-button" data-nav="new-space" @click="$emit('panel-action', 'team-new-space')"><i class="fas fa-plus"></i>New teamspace</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useStore } from 'vuex';
import { useTeam } from '@/views/One/team/useTeam.js';
import { unreadCount } from '@/views/One/team/teamModel.js';

defineProps({ active: { type: String, default: null } });
const emit = defineEmits(['panel-action']);
const store = useStore();
const { state } = useTeam(store);
const team = computed(() => state.team);
const spaces = computed(() => state.spaces || []);
const memberCount = computed(() => (state.members || []).length);
const needsYou = computed(() => unreadCount(state.inbox || []));
const counts = computed(() => ({
  agents: (store.getters['agents/allAgents'] || []).length,
  routines: (store.getters['schedules/allSchedules'] || []).length,
}));

const MINE = [
  { id: 'mine-tasks', label: 'My tasks', icon: 'fas fa-check-square' },
  { id: 'mine-agents', label: 'My agents', icon: 'fas fa-robot', count: 'agents' },
  { id: 'mine-routines', label: 'My routines', icon: 'fas fa-redo', count: 'routines' },
  { id: 'mine-files', label: 'My files', icon: 'fas fa-folder' },
];
const NEW = [
  { id: 'new-task', label: 'New task', icon: 'fas fa-check-square' },
  { id: 'new-doc', label: 'New doc', icon: 'fas fa-file-alt' },
  { id: 'new-agent', label: 'New agent', icon: 'fas fa-robot' },
  { id: 'new-routine', label: 'New routine', icon: 'fas fa-redo' },
];
// Font Awesome, like every other Studio panel (One shows the teamspace's emoji instead).
const SPACE_ICONS = [[/sales|deal|revenue|customer/i, 'fas fa-briefcase'], [/eng|dev|product|build/i, 'fas fa-tools'], [/design|creative/i, 'fas fa-palette'], [/support|help|service/i, 'fas fa-hands-helping'], [/market/i, 'fas fa-bullhorn'], [/general|team|company|all/i, 'fas fa-comments']];
const spaceIcon = (s) => SPACE_ICONS.find(([re]) => re.test(s?.name || ''))?.[1] || 'fas fa-hashtag';
const titled = (name) => { const s = String(name || ''); return s ? s[0].toUpperCase() + s.slice(1) : s; };
const go = (loc) => emit('panel-action', 'team-go', loc);
const pick = (id) => emit('panel-action', 'team-pick', id);
</script>

<style scoped>
/* Same values as TracesPanel (the Activity panel), so the two read as one system. */
.ui-panel { display: flex; flex-direction: column; gap: 20px; width: 100%; height: 100%; position: relative; padding-right: 4px; z-index: 3; overflow-y: auto; scrollbar-color: var(--color-duller-navy) transparent; scrollbar-width: thin; }
.panel-header { display: flex; justify-content: space-between; align-items: center; padding: 0 0 12px 0; border-bottom: 1px solid var(--terminal-border-color-light); user-select: none; }
.panel-header .title { color: var(--text-green); font-family: var(--font-family-primary); font-size: 16px; font-weight: 400; letter-spacing: 0.48px; margin: 0; }
.panel-stats { display: flex; gap: 12px; }
.stat-item { display: flex; align-items: center; gap: 6px; color: var(--color-light-med-navy); font-size: 0.85em; opacity: 0.8; }
.stat-item i { width: 14px; text-align: center; }

.panel-section { background: transparent; border: 1px solid var(--terminal-border-color); padding: 16px; border-radius: 8px; }
.section-title { color: var(--color-text-muted); font-size: 0.9em; display: flex; align-items: center; gap: 8px; margin: 0 0 16px 0; font-weight: 600; opacity: 0.95; }
.section-title i { color: var(--text-green); }
.section-add { margin-left: auto; border: 1px solid var(--terminal-border-color); border-radius: 6px; background: var(--color-darker-0); color: var(--color-text-muted); cursor: pointer; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; }
.section-add:hover { border-color: rgba(var(--green-rgb), 0.5); color: var(--text-green); }
.section-add i { color: inherit; font-size: 0.85em; }

.stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.stat-card { background: var(--color-darker-0); border: 1px solid var(--terminal-border-color); padding: 12px; border-radius: 6px; text-align: center; font: inherit; color: inherit; }
button.stat-card { cursor: pointer; }
button.stat-card:hover, .stat-card.active { border-color: rgba(var(--green-rgb), 0.4); }
.stat-value { font-size: 1.8em; font-weight: bold; color: var(--color-text); margin-bottom: 4px; }
.stat-label { font-size: 0.8em; color: var(--text-info); text-transform: uppercase; }

.filter-list { display: flex; flex-direction: column; gap: 4px; }
.filter-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; color: var(--color-text-muted); border: 1px solid transparent; }
.filter-item:hover { background: rgba(var(--green-rgb), 0.1); color: var(--color-text); }
.filter-item.active { background: rgba(var(--green-rgb), 0.15); border-color: rgba(var(--green-rgb), 0.3); color: var(--text-green); }
.filter-item i { width: 16px; text-align: center; font-size: 0.9em; }
.filter-item span:first-of-type { flex: 1; font-size: 0.9em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.filter-item .lock { width: auto; font-size: 0.75em; opacity: 0.6; }
.filter-count { background: var(--color-darker-0); color: var(--text-info); padding: 2px 6px; border-radius: 10px; font-size: 0.8em; font-weight: 600; min-width: 20px; text-align: center; border: 2px solid var(--terminal-border-color); }
.filter-item.active .filter-count { color: var(--color-text); border-color: var(--color-green); }

.action-buttons { display: flex; flex-direction: column; gap: 8px; }
.action-button { padding: 8px 16px; background: var(--color-darker-0); border: 1px solid var(--terminal-border-color); border-radius: 4px; color: var(--color-text); cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s; font-size: 0.9em; width: 100%; font-family: inherit; }
.action-button:hover { background: rgba(var(--green-rgb), 0.1); border-color: rgba(var(--green-rgb), 0.5); }
.action-button i { width: 16px; text-align: center; }

.note { margin: 0; color: var(--color-text-muted); font-size: 0.85em; }
</style>
