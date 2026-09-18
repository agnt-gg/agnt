import { MAIN_SECTIONS } from '@/canvas/sections.js';

export const NAVIGATION_STORAGE_KEY = 'agnt:sidebarNavigation:v1';
export const NAVIGATION_CHANGED_EVENT = 'agnt:navigation-changed';
export const PERSONAL_GROUP = 'PERSONAL';

const DEFAULT_VISIBLE = new Set(['chat','goals','artifacts']);
const DEFAULT_GROUPS = [...new Set(MAIN_SECTIONS.map((section) => section.group))];

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
  const sections = MAIN_SECTIONS.map((section, index) => {
    const key = navigationItemKey('section', section.id);
    const saved = preferences.items[key] || {};
    return {
      key,
      type: 'section',
      id: section.id,
      label: section.label,
      icon: section.icon,
      section,
      group: cleanGroup(saved.group, section.group),
      visible: typeof saved.visible === 'boolean' ? saved.visible : DEFAULT_VISIBLE.has(section.id),
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
  return [...sections, ...pages];
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
