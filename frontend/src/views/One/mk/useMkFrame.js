import { computed } from 'vue';
import { spaceEmoji } from '@/views/One/team/teamModel.js';
import { useWorkspaceFileCount } from '@/composables/useWorkspaceFileCount.js';

/**
 * The approved mockup's frame, driven by the app's real routes and data:
 * which rail item and drawer row are lit, the top bar's breadcrumbs, where
 * each rail / More / drawer entry goes, and the create flows (New… and
 * Home's chips): a chat, a file, an agent or a routine. Pure wiring: every
 * destination is an existing page.
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
      // Agents live in the Library now.
      if (v === 'agents' || v === 'agent' || v === 'library') return 'library';
      if (v === 'members') return 'me';
      return null; // a teamspace, My tasks or a doc: lit in the drawer
    }
    // Goals holds one-off goals and repeating ones (routines).
    if (p === 'goals' || p === 'scheduled') return 'goals';
    if (!p && screenName.value === 'GoalsScreen') return 'goals';
    if (p === 'connectors') return 'apps';
    // Your own things and where you get more: the Library.
    if (p === 'market' || p === 'library') return 'library';
    if (!p && ['WorkflowForgeScreen', 'ToolForgeScreen', 'WidgetForgeScreen'].includes(screenName.value)) return 'library';
    if (!p && screenName.value === 'PluginsScreen') return 'apps';
    // How Annie works: Settings and what opens from it.
    if (p === 'memory') return 'settings';
    if (!p && ['SettingsScreen', 'LearningScreen'].includes(screenName.value)) return 'settings';
    // Activity is Home's history, and the dashboard's useful parts live on Home.
    if (p === 'activity') return 'home';
    if (!p && screenName.value === 'DashboardScreen') return 'home';
    if (p === 'settings') return 'settings';
    return null;
  });
  // The account menu entry that is the page on screen.
  const mkActiveMore = computed(() => (page.value === 'team' && loc().view === 'members' ? 'members' : null));
  const mkDrawerActive = computed(() => {
    if (page.value === 'team') {
      const { view, space } = loc();
      if (view === 'mine') return 'mine-tasks';
      if ((view === 'space' || view === 'doc') && space) return 'space:' + space;
    }
    if (page.value === 'library' && loc().tab === 'files') return 'mine-files';
    return null;
  });
  const files = useWorkspaceFileCount();
  files.load();
  const mkCounts = computed(() => ({
    agents: (store.getters['agents/allAgents'] || []).length || 0,
    routines: (store.getters['schedules/allSchedules'] || []).length || 0,
    files: files.count.value ?? 0,
  }));

  // Your name as Members and Settings show it, so the rail's initials match theirs.
  const userName = computed(() => store.getters['userAuth/userName'] || store.getters['userAuth/userPseudonym'] || store.getters['userAuth/userEmail'] || '');
  const activeChatId = computed(() => store.state.chat?.savedOutputId || null);
  const activeConversationId = computed(() => store.state.chat?.activeConversationId || null);

  const team = (view, extra = {}) => nav.go({ page: 'team', view, ...extra });
  function mkSelect(id) {
    if (id === 'home') return team('home');
    if (id === 'chats') return nav.chat();
    if (id === 'apps') return nav.go({ page: 'connectors' });
    if (id === 'goals') return nav.go({ page: 'goals' });
    if (id === 'routines') return nav.go({ page: 'scheduled' });
    if (id === 'account') return nav.go({ page: 'settings' });
    if (id === 'library') return team('library');
    if (id === 'activity') return nav.go({ page: 'activity' });
    if (id === 'dashboard') return nav.openScreen('DashboardScreen');
    if (id === 'goals') return nav.openScreen('GoalsScreen');
    if (id === 'studio') return store.dispatch('theme/setUiMode', 'studio');
    if (id === 'members') return team('members');
    if (id === 'settings') return nav.go({ page: 'settings' });
    if (id === 'find') return store.dispatch('shell/openJump');
    if (id === 'wrapped') return nav.wrapped?.();
    return undefined;
  }
  function mkPick(what) {
    switch (what) {
      case 'mine-tasks': return team('mine');
      case 'mine-drafts': case 'mine-files': return nav.go({ page: 'library', tab: 'files', dir: '' });
      case 'mine-agents': return team('agents');
      // Studio's Team screen still lists My routines (it opens the routines page in place).
      case 'mine-routines': return nav.go({ page: 'scheduled' });
      case 'team-settings': return nav.go({ page: 'settings', section: 'members' });
      case 'new-chat': return nav.chat();
      case 'new-doc': return create('doc');
      case 'new-agent': return create('agent');
      case 'new-routine': return create('routine');
      default: return undefined;
    }
  }

  /** The teamspace on screen, if any. New work only goes to a teamspace when you are in it. */
  const openSpace = () => {
    const { view, space } = loc();
    if (page.value !== 'team' || !['space', 'doc'].includes(view)) return null;
    return (teamState.spaces || []).find((s) => s.id === space) || null;
  };
  function create(kind) {
    if (kind === 'agent') return nav.go({ page: 'library', tab: 'agents', isNew: true });
    if (kind === 'routine') return nav.go({ page: 'scheduled', isNew: true });
    if (kind === 'doc') {
      // Files: the open teamspace's, else your own private files.
      const space = teamState.team ? openSpace() : null;
      return space ? team('space', { space: space.id, tab: 'files' }) : nav.go({ page: 'library', tab: 'files', dir: '' });
    }
    return undefined;
  }

  const LABELS = Object.freeze({ home: 'Home', inbox: 'Home', agents: 'Agents', library: 'Library', members: 'Members', scheduled: 'Goals', goals: 'Goals', activity: 'Activity', settings: 'Settings', market: 'Market', connectors: 'Apps', memory: 'Memories' });
  // Every page names itself in its own heading; the top bar shows a trail only
  // when there is somewhere to step back to (Teamspaces › Product).
  const crumbs = computed(() => {
    const p = page.value;
    if (onChat.value) return [{ label: 'Chats' }];
    if (p === 'team') {
      const { view, space, item } = loc();
      const s = (teamState.spaces || []).find((x) => x.id === space);
      if (view === 'space') return [{ label: 'Teamspaces', go: () => team('home') }, { label: s ? spaceEmoji(s) + ' ' + s.name : 'Teamspace' }];
      if (view === 'doc') return [{ label: s ? s.name : 'Teamspace', go: () => team('space', { space, tab: 'files' }) }, { label: 'File' }];
      if (view === 'mine') return [{ label: 'My tasks' }];
      if (view === 'agents') return [{ label: 'Library', go: () => team('library') }, { label: 'Agents' }];
      if (view === 'agent') {
        const agent = (store.getters['agents/allAgents'] || []).find((a) => String(a.id) === String(item));
        return [{ label: 'Agents', go: () => team('agents') }, { label: agent?.name || 'Agent' }];
      }
      return [{ label: LABELS[view] || 'Home' }];
    }
    if (p === 'scheduled' && (loc().item || loc().isNew)) return [{ label: 'Goals', go: () => nav.go({ page: 'goals' }) }, { label: loc().isNew ? 'New routine' : 'Routine' }];
    // A run opens with its own way back to Activity.
    if (p === 'activity' && loc().item) return [{ label: 'Activity' }];
    if (p === 'activity') return [{ label: 'Home', go: () => team('home') }, { label: 'Activity' }];
    // An item opens with its own way back; the Library names itself.
    if (p === 'library') return [{ label: 'Library' }];
    if (p === 'market') return [{ label: 'Library', go: () => team('library') }, { label: 'Market' }];
    if (p === 'memory') return [{ label: 'Settings', go: () => nav.go({ page: 'settings' }) }, { label: 'Memories' }];
    return [{ label: LABELS[p] || (screenName.value || '').replace(/Screen$/, '') || 'AGNT' }];
  });

  return { mkActive, mkActiveMore, mkDrawerActive, mkCounts, crumbs, mkSelect, mkPick, create, userName, activeChatId, activeConversationId, onChat };
}
