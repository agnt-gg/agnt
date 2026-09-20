import { MAIN_SECTIONS } from '@/canvas/sections.js';

export const NAVIGATION_STORAGE_KEY = 'agnt:sidebarNavigation:v1';
export const NAVIGATION_CHANGED_EVENT = 'agnt:navigation-changed';
export const PERSONAL_GROUP = 'PERSONAL';

// Rail rows that are MODES rather than routed screens: Library browses every
// asset you own, Teams opens the shared workspace. They own no screen, so they
// cannot live in MAIN_SECTIONS — but they are destinations the user sees on the
// rail, and a row you can see is a row you must be able to hide, reorder and
// regroup. CanvasScreen.openPrimary(id) knows how to open them.
export const VIRTUAL_SECTIONS = [
  { id: 'library', group: 'ASSETS', icon: 'fas fa-book-open', label: 'Library' },
  { id: 'teams', group: 'ASSETS', icon: 'fas fa-users', label: 'Teams' },
];

// The single registry behind BOTH the rail and Settings → Navigation. The rail
// renders exactly this list filtered by `visible`; the only rows it hardcodes
// are the Search shortcut (an action, not a page) and Settings at the foot. If
// a row can appear on the rail it appears in this list, or Settings would be
// describing a sidebar that does not exist.
const BUILT_IN_ITEMS = [
  ...MAIN_SECTIONS.map((section) => ({
    type: 'section',
    id: section.id,
    label: section.label,
    icon: section.icon,
    group: section.group,
    section,
  })),
  ...VIRTUAL_SECTIONS.map((virtual) => ({
    type: 'virtual',
    id: virtual.id,
    label: virtual.label,
    icon: virtual.icon,
    group: virtual.group,
  })),
];

const DEFAULT_VISIBLE = new Set(['chat','goals','artifacts','library','teams']);
const DEFAULT_GROUPS = [...new Set(BUILT_IN_ITEMS.map((item) => item.group))];

function cleanGroup(value, fallback = PERSONAL_GROUP) {
  const group = typeof value === 'string' ? value.trim().toUpperCase().slice(0, 32) : '';
  return group || fallback;
}

function emptyPreferences() {
  return { version: 1, groups: [...DEFAULT_GROUPS, PERSONAL_GROUP], items: {} };
}

export function loadNavigationPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NAVIGATION_STORAGE_KEY) || 'null');
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.groups) || !parsed.items || Array.isArray(parsed.items)) {
      return emptyPreferences();
    }
    return {
      version: 1,
      groups: [...new Set(parsed.groups.map((group) => cleanGroup(group)).filter(Boolean))],
      items: { ...parsed.items },
    };
  } catch {
    return emptyPreferences();
  }
}

function persist(preferences) {
  try {
    localStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify(preferences));
    window.dispatchEvent(new CustomEvent(NAVIGATION_CHANGED_EVENT));
  } catch (error) {
    console.error('Failed to save sidebar navigation preferences:', error);
  }
  return preferences;
}

export function navigationItemKey(type, id) {
  return `${type}:${id}`;
}

export function navigationItems(customPages = []) {
  const preferences = loadNavigationPreferences();
  const builtIn = BUILT_IN_ITEMS.map((item, index) => {
    const key = navigationItemKey(item.type, item.id);
    const saved = preferences.items[key] || {};
    return {
      ...item,
      key,
      group: cleanGroup(saved.group, item.group),
      visible: typeof saved.visible === 'boolean' ? saved.visible : DEFAULT_VISIBLE.has(item.id),
      order: Number.isFinite(saved.order) ? saved.order : index,
    };
  });
  const pages = customPages.map((page, index) => {
    const key = navigationItemKey('page', page.id);
    const saved = preferences.items[key] || {};
    return {
      key,
      type: 'page',
      id: page.id,
      label: page.name,
      icon: page.icon || 'fas fa-th',
      page,
      group: cleanGroup(saved.group, PERSONAL_GROUP),
      visible: saved.visible !== false,
      order: Number.isFinite(saved.order) ? saved.order : index,
    };
  });
  return [...builtIn, ...pages];
}

export function groupedNavigation(customPages = [], { includeHidden = false } = {}) {
  const preferences = loadNavigationPreferences();
  const items = navigationItems(customPages).filter((item) => includeHidden || item.visible);
  const discoveredGroups = items.map((item) => item.group);
  const groups = [...new Set([...preferences.groups, ...DEFAULT_GROUPS, ...discoveredGroups])];
  return groups
    .map((name) => ({
      name,
      items: items
        .filter((item) => item.group === name)
        .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label)),
    }))
    .filter((group) => includeHidden || group.items.length > 0);
}

export function updateNavigationItem(key, updates) {
  const preferences = loadNavigationPreferences();
  const current = preferences.items[key] || {};
  const next = { ...current, ...updates };
  if ('group' in updates) {
    next.group = cleanGroup(updates.group);
    if (!preferences.groups.includes(next.group)) preferences.groups.push(next.group);
  }
  preferences.items[key] = next;
  return persist(preferences);
}

export function reorderNavigationItem(key, direction, customPages = []) {
  const item = navigationItems(customPages).find((candidate) => candidate.key === key);
  if (!item) return loadNavigationPreferences();
  const siblings = groupedNavigation(customPages, { includeHidden: true }).find((group) => group.name === item.group)?.items || [];
  const index = siblings.findIndex((candidate) => candidate.key === key);
  const otherIndex = index + direction;
  if (index < 0 || otherIndex < 0 || otherIndex >= siblings.length) return loadNavigationPreferences();

  const preferences = loadNavigationPreferences();
  siblings.forEach((candidate, siblingIndex) => {
    preferences.items[candidate.key] = { ...(preferences.items[candidate.key] || {}), order: siblingIndex };
  });
  const firstKey = siblings[index].key;
  const secondKey = siblings[otherIndex].key;
  const firstOrder = preferences.items[firstKey].order;
  preferences.items[firstKey].order = preferences.items[secondKey].order;
  preferences.items[secondKey].order = firstOrder;
  return persist(preferences);
}

export function addNavigationGroup(name) {
  const preferences = loadNavigationPreferences();
  const group = cleanGroup(name, '');
  if (group && !preferences.groups.includes(group)) preferences.groups.push(group);
  return persist(preferences);
}

export function renameNavigationGroup(previousName, nextName) {
  const previous = cleanGroup(previousName);
  const next = cleanGroup(nextName, '');
  if (!next || previous === next) return loadNavigationPreferences();
  const preferences = loadNavigationPreferences();
  preferences.groups = [...new Set(preferences.groups.map((group) => (group === previous ? next : group)))];
  for (const [key, item] of Object.entries(preferences.items)) {
    if (cleanGroup(item.group) === previous) preferences.items[key] = { ...item, group: next };
  }
  return persist(preferences);
}

export function moveNavigationGroup(name, direction) {
  const preferences = loadNavigationPreferences();
  const index = preferences.groups.indexOf(name);
  const otherIndex = index + direction;
  if (index < 0 || otherIndex < 0 || otherIndex >= preferences.groups.length) return preferences;
  [preferences.groups[index], preferences.groups[otherIndex]] = [preferences.groups[otherIndex], preferences.groups[index]];
  return persist(preferences);
}

export function removeNavigationItemPreference(key) {
  const preferences = loadNavigationPreferences();
  delete preferences.items[key];
  return persist(preferences);
}

export function resetNavigationPreferences() {
  try {
    localStorage.removeItem(NAVIGATION_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(NAVIGATION_CHANGED_EVENT));
  } catch (error) {
    console.error('Failed to reset sidebar navigation preferences:', error);
  }
}
