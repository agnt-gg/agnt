import { computed } from 'vue';
import { teamApi } from '@/views/One/team/useTeam.js';

/**
 * The approved mockup's frame, driven by the app's real routes and data:
 * which rail item and drawer row are lit, the top bar's breadcrumbs, where
 * each rail / More / drawer entry goes, and the four create flows (New…,
 * and Home's chips). Pure wiring: every destination is an existing page.
 */
export function useMkFrame({ store, page, location, screenName, teamState, nav }) {
  const loc = () => location.value || {};
  const onChat = computed(() => !page.value && screenName.value === 'ChatScreen');

  const mkActive = computed(() => {
    const p = page.value;
    if (onChat.value) return 'chats';
    if (p === 'team') {
      const v = loc().view;
      if (v === 'home' || v === 'inbox') return 'home';
      if (v === 'agents' || v === 'agent') return 'agents';
      if (v === 'library') return 'library';
      if (v === 'members') return 'more';
      return null; // a teamspace, My tasks or a doc: lit in the drawer
    }
    if (p === 'scheduled') return 'routines';
    if (p === 'market') return 'library';
    if (p === 'activity') return 'more';
    if (p === 'settings') return 'settings';
    return null;
  });
  const mkActiveMore = computed(() => (page.value === 'activity' ? 'activity' : page.value === 'team' && loc().view === 'members' ? 'members' : null));
  const mkDrawerActive = computed(() => {
    if (page.value === 'team') {
      const { view, space } = loc();
      if (view === 'mine') return 'mine-tasks';
      if ((view === 'space' || view === 'doc') && space) return 'space:' + space;
    }
    if (page.value === 'library' && loc().tab === 'files') return 'mine-files';
    return null;
  });
  const mkCounts = computed(() => ({
    agents: (store.getters['agents/allAgents'] || []).length || 0,
    routines: (store.getters['schedules/allSchedules'] || []).length || 0,
  }));

  const userName = computed(() => store.getters['userAuth/userPseudonym'] || store.getters['userAuth/userEmail'] || '');
  const activeChatId = computed(() => store.state.chat?.savedOutputId || null);
  const activeConversationId = computed(() => store.state.chat?.activeConversationId || null);

  const team = (view, extra = {}) => nav.go({ page: 'team', view, ...extra });
  function mkSelect(id) {
    if (id === 'home' || id === 'approvals') return team('home');
    if (id === 'chats') return nav.chat();
    if (id === 'agents') return team('agents');
    if (id === 'routines') return nav.go({ page: 'scheduled' });
    if (id === 'library') return team('library');
    if (id === 'activity') return nav.go({ page: 'activity' });
    if (id === 'members') return team('members');
    if (id === 'settings') return nav.go({ page: 'settings' });
    if (id === 'find') return store.dispatch('shell/openJump');
    return undefined;
  }
  function mkPick(what) {
    switch (what) {
      case 'mine-tasks': return team('mine');
      case 'mine-drafts': case 'mine-files': return nav.go({ page: 'library', tab: 'files', dir: '' });
      case 'mine-agents': return team('agents');
      case 'mine-routines': return nav.go({ page: 'scheduled' });
      case 'team-settings': return nav.go({ page: 'settings', section: 'members' });
      case 'new-task': return create('task');
      case 'new-doc': return create('doc');
      case 'new-agent': return create('agent');
      case 'new-routine': return create('routine');
      default: return undefined;
    }
  }

  /** The teamspace new work lands in: the one open, else the team's default, else the first. */
  const targetSpace = () => {
    const spaces = teamState.spaces || [];
    return spaces.find((s) => s.id === loc().space) || spaces.find((s) => s.is_default) || spaces[0] || null;
  };
  async function create(kind) {
    if (kind === 'agent') return nav.go({ page: 'library', tab: 'agents', isNew: true });
    if (kind === 'routine') return nav.go({ page: 'scheduled', isNew: true });
    const space = teamState.team ? targetSpace() : null;
    if (!space) {
      // Personal: a task is something Annie does with you (she shows the plan first); a doc is a private file.
      if (kind === 'task') return nav.ask('Make this a task: ');
      return nav.go({ page: 'library', tab: 'files', dir: '' });
    }
    const name = await nav.prompt({ title: kind === 'task' ? 'New task' : 'New doc', message: `In ${space.name}. Everyone there can see it.`, placeholder: kind === 'task' ? 'Call Northwind about the renewal' : 'Q4 plan', confirmText: 'Create' });
    if (!name || !name.trim()) return undefined;
    try {
      if (kind === 'task') {
        const task = await teamApi.createTask(space.id, { title: name.trim() });
        return team('space', { space: space.id, tab: 'board', task: task.id });
      }
      const doc = await teamApi.createDoc(space.id, name.trim(), '');
      return team('doc', { space: space.id, doc: doc.id });
    } catch (error) {
      nav.toast(error.message);
      return undefined;
    }
  }

  const LABELS = Object.freeze({ home: 'Home', inbox: 'Home', agents: 'Agents', library: 'Library', members: 'Members', scheduled: 'Routines', activity: 'Activity', settings: 'Settings', market: 'Market', connectors: 'Apps', memory: 'Memories' });
  const crumbs = computed(() => {
    const p = page.value;
    if (onChat.value) return [{ label: 'Chats with Annie' }];
    if (p === 'team') {
      const { view, space, item } = loc();
      const s = (teamState.spaces || []).find((x) => x.id === space);
      if (view === 'space') return [{ label: 'Teamspaces', go: () => team('home') }, { label: s ? '# ' + s.name : 'Teamspace' }];
      if (view === 'doc') return [{ label: s ? s.name : 'Teamspace', go: () => team('space', { space, tab: 'docs' }) }, { label: 'Doc' }];
      if (view === 'mine') return [{ label: 'My Space', go: () => team('mine') }, { label: 'My tasks' }];
      if (view === 'agent') {
        const agent = (store.getters['agents/allAgents'] || []).find((a) => String(a.id) === String(item));
        return [{ label: 'Agents', go: () => team('agents') }, { label: agent?.name || 'Agent' }];
      }
      return [{ label: LABELS[view] || 'Home' }];
    }
    if (p === 'scheduled' && loc().item) return [{ label: 'Routines', go: () => nav.go({ page: 'scheduled' }) }, { label: 'Routine' }];
    if (p === 'library') return [{ label: 'My Space', go: () => team('mine') }, { label: loc().tab === 'files' ? 'My files' : 'Library' }];
    return [{ label: LABELS[p] || (screenName.value || '').replace(/Screen$/, '') || 'AGNT' }];
  });

  return { mkActive, mkActiveMore, mkDrawerActive, mkCounts, crumbs, mkSelect, mkPick, create, userName, activeChatId, activeConversationId, onChat };
}
