/**
 * How each shareable kind looks in the app. The list of kinds itself belongs to
 * the backend (backend/src/services/sharing/kinds.js, served at /share/kinds);
 * this only names and routes them, and falls back gracefully for a kind a newer
 * backend knows and this build does not.
 */
export const SHARE_KINDS = Object.freeze({
  agent: { label: 'Agent', icon: 'fas fa-robot', route: '/agents' },
  workflow: { label: 'Workflow', icon: 'fas fa-project-diagram', route: '/workflows' },
  tool: { label: 'Tool', icon: 'fas fa-wrench', route: '/tools' },
  skill: { label: 'Skill', icon: 'fas fa-brain', route: '/skills' },
  widget: { label: 'Widget', icon: 'fas fa-th-large', route: '/widget-manager' },
  goal: { label: 'Goal', icon: 'fas fa-bullseye', route: '/goals' },
  workspace: { label: 'Workspace', icon: 'fas fa-columns', route: '/workspace' },
  conversation: { label: 'Conversation', icon: 'fas fa-comments', route: '/chat' },
});

/** Kinds that travel as an installable bundle (everything but a conversation snapshot). */
export const isBundleKind = kind => kind !== 'conversation';
export const kindLabel = kind => SHARE_KINDS[kind]?.label || (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : 'Item');
export const kindIcon = kind => SHARE_KINDS[kind]?.icon || 'fas fa-cube';
export const kindRoute = kind => SHARE_KINDS[kind]?.route || '/dashboard';
