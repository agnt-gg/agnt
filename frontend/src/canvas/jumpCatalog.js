import {
  buildJumpIndex,
  matches
} from './jumpIndex.js';

export const JUMP_CATEGORIES = [{
    id: 'conversation',
    label: 'Conversations & spaces',
    screens: ['ChatScreen', 'WorkspaceScreen']
  },
  {
    id: 'work',
    label: 'Goals & execution',
    screens: ['GoalsScreen', 'TracesScreen', 'DashboardScreen']
  },
  {
    id: 'knowledge',
    label: 'Files & knowledge',
    screens: ['ArtifactsScreen', 'MemoryScreen', 'LearningScreen']
  },
  {
    id: 'automation',
    label: 'Agents & automation',
    screens: ['AgentsScreen', 'WorkflowsScreen', 'WorkflowForgeScreen', 'ToolsScreen', 'ToolForgeScreen', 'SkillsScreen', 'WidgetManagerScreen', 'WidgetForgeScreen']
  },
  {
    id: 'connections',
    label: 'Connections & control',
    screens: ['ConnectorsScreen', 'PluginsScreen']
  },
  {
    id: 'workspace',
    label: 'Workspace & account',
    screens: ['MarketplaceScreen', 'SettingsScreen']
  },
];

/** Pages/resources only. Executes no tool or command; all old screens remain discoverable. */
export function buildJumpCatalog(src) {
  const groups = buildJumpIndex({
    ...src,
    query: ''
  }).groups;
  const pages = groups.find(g => g.id === 'goto')?.items || [];
  const assets = groups.find(g => g.id === 'open')?.items || [];
  // buildJumpIndex caps Open for its legacy list. Enumerate all loaded entities here.
  const entityPages = {
    agents: ['agent', 'AgentsScreen', 'fas fa-robot'],
    workflows: ['workflow', 'WorkflowsScreen', 'fas fa-project-diagram'],
    goals: ['goal', 'GoalsScreen', 'fas fa-bullseye']
  };
  const resources = [];
  for (const [key, [kind, screen, icon]] of Object.entries(entityPages))
    for (const item of src[key] || []) resources.push({
      id: `${kind}:${item.id}`,
      label: item.name || item.title || item.text || kind,
      icon,
      hint: kind,
      searchText:[item.description,item.text,item.category].filter(Boolean).join(' '),
      action: {
        type: 'inspect',
        kind,
        id: item.id,
        screen
      }
    });
  for (const item of src.chats || []) resources.push({
    id: `chat:${item.id}`,
    label: item.title || item.name || 'Conversation',
    icon: 'fas fa-comments',
    hint: item.archived_at?'conversation · archived':'conversation',
    searchText:item.description||'',
    action: {
      type: 'chat',
      id: item.id
    },
    screen: 'ChatScreen'
  });
  for (const item of src.tools || []) resources.push({
    id: `tool:${item.id}`,
    label: item.title || item.name || 'Tool',
    icon: 'fas fa-wrench',
    hint: 'tool',
    searchText:item.description||'',
    action: {
      type: 'screen',
      screen: 'ToolsScreen',
      opts: {
        select: {
          kind: 'tool',
          id: item.id
        }
      }
    }
  });
  for (const item of src.skills || []) resources.push({
    id: `skill:${item.id}`,
    label: item.name || item.title || 'Skill',
    icon: 'fas fa-graduation-cap',
    hint: 'skill',
    searchText:item.description||'',
    action: {
      type: 'screen',
      screen: 'SkillsScreen',
      opts: {
        select: {
          kind: 'skill',
          id: item.id
        }
      }
    }
  });
  for (const item of src.pages || []) resources.push({
    id: `page:${item.id}`,
    label: item.name || 'Workspace page',
    icon: item.icon || 'fas fa-columns',
    hint: 'workspace page',
    action: {
      type: 'page',
      id: item.id
    },
    screen: 'WorkspaceScreen'
  });
  for (const item of src.files || [])
    if (item.type === 'file') resources.push({
      id: 'file:' + item.path,
      label: item.name,
      icon: 'fas fa-file',
      hint: item.path,
      action: {
        type: 'screen',
        screen: 'ArtifactsScreen',
        opts: {
          select: {
            kind: 'artifact',
            id: item.path
          }
        }
      }
    });
  resources.push({id:'team-library',label:'Personal & team workspaces',icon:'fas fa-users',hint:'shared library',screen:'WorkspaceScreen',action:{type:'teams'}});
  // Saved outputs that are not conversations are NOT browse rows. They are old
  // untitled HTML snapshots (no conversation, tool or workflow recorded), so a
  // row can only read "Output"; listing them made unlabelled rows appear a few
  // seconds after opening, before anything was typed. Full-text history search
  // still finds them by what they say (searchSources historySearchItems).
  for(const [key,screen,kind] of [['widgets','WidgetManagerScreen','widget'],['plugins','PluginsScreen','plugin']])for(const item of src[key]||[])resources.push({id:kind+':'+(item.id||item.name),label:item.displayName||item.name||item.title,icon:kind==='widget'?'fas fa-shapes':'fas fa-puzzle-piece',hint:kind,searchText:item.description||'',action:{type:'screen',screen,opts:{select:{kind,id:item.id||item.name}}}});
  resources.push(...(src.history||[]));
  const byId = new Map([...pages, ...assets, ...resources].map(item => [item.id, item]));
  const result = JUMP_CATEGORIES.map(category => ({
    ...category,
    items: []
  }));
  for (const item of byId.values()) {
    const screen = item.action.screen || item.screen || (item.action.type === 'chat' ? 'ChatScreen' : null);
    const group = result.find(g => g.screens.includes(screen)) || result.at(-1);
    if (item.serverMatched || matches(src.query, item.label, item.hint, item.searchText, group.label, screen)) group.items.push({
      ...item,
      category: group.id
    });
  }
  return result;
}
