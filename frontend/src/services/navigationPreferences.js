import { MAIN_SECTIONS, SECTION_ROUTES } from '@/canvas/sections.js';
import { isUnlocked, loadOnionState } from '@/services/navigationOnion.js';

export const NAVIGATION_STORAGE_KEY = 'agnt:sidebarNavigation:v1';
export const NAVIGATION_CHANGED_EVENT = 'agnt:navigation-changed';
export const PERSONAL_GROUP = 'PERSONAL';

// Members is Settings → Account → Members, not a separate rail mode.
// Keep the registry export for readers that compose navigation dynamically.
export const VIRTUAL_SECTIONS = [];

// Captions the rail used before WORK · PLAN · BUILD · SYSTEM. A saved layout
// stores the whole caption list, so without this the old names would linger
// as empty groups and push the new ones out of order. Groups a person made
// themselves are kept, after the built-in ones.
const LEGACY_GROUPS = new Set(['TODAY', 'ASSETS', 'CONNECTORS']);

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

// No static default list. A built-in row with no explicit Shown/Hidden from
// Settings is on the rail when the account has unlocked it (see
// navigationOnion.js): Chat from the first second, everything else the first
// time the thing it manages exists.
const DEFAULT_GROUPS = [...new Set(BUILT_IN_ITEMS.map((item) => item.group))];

function cleanGroup(value, fallback = PERSONAL_GROUP) {
  const group = typeof value === 'string' ? value.trim().toUpperCase().slice(0, 32) : '';
  return group || fallback;
}

function emptyPreferences() {
  return { version: 1, groups: [...DEFAULT_GROUPS, PERSONAL_GROUP], items: {} };
}

/**
 * A layout saved under the old captions, moved onto the current ones. Pure and
 * idempotent: a layout with no legacy caption comes back unchanged, so this is
 * safe to run on every load and never needs a version bump.
 */
export function migrateLegacyGroups(preferences) {
  const legacy = new Set([...LEGACY_GROUPS].filter((group) => !preferences.customGroups?.includes(group)));
  if (!preferences.groups.some((group) => legacy.has(group))) return preferences;
  const custom = preferences.groups.filter((group) => !legacy.has(group) && !DEFAULT_GROUPS.includes(group) && group !== PERSONAL_GROUP);
  const items = {};
  for (const [key, item] of Object.entries(preferences.items)) {
    if (!item || typeof item !== 'object') continue;
    // Saved orders are positions inside the OLD groups, which no longer exist;
    // kept, they would interleave rows at random. Visibility, and any group the
    // person chose that still exists, are kept. A row parked under an old
    // caption returns to its built-in group.
    const { order: _order, ...rest } = item;
    if (legacy.has(cleanGroup(rest.group))) delete rest.group;
    items[key] = rest;
  }
  return { ...preferences, groups: [...DEFAULT_GROUPS, PERSONAL_GROUP, ...custom], items };
}

/** Retire only the built-in Members row and its now-empty SYSTEM caption.
 * Custom pages or rows deliberately assigned to SYSTEM remain untouched. */
export function migrateMembersNavigation(preferences) {
  const { ['virtual:teams']: retired, ...items } = preferences.items;
  const systemInUse = preferences.customGroups?.includes('SYSTEM') || Object.values(items).some(item => item && typeof item === 'object' && cleanGroup(item.group) === 'SYSTEM');
  if (!retired && (systemInUse || !preferences.groups.includes('SYSTEM'))) return preferences;
  return { ...preferences, items, groups: preferences.groups.filter(group => group !== 'SYSTEM' || systemInUse) };
}

export function loadNavigationPreferences() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NAVIGATION_STORAGE_KEY) || 'null');
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.groups) || !parsed.items || Array.isArray(parsed.items)) {
      return emptyPreferences();
    }
    return migrateMembersNavigation(migrateLegacyGroups({
      version: 1,
      groups: [...new Set(parsed.groups.map((group) => cleanGroup(group)).filter(Boolean))],
      items: { ...parsed.items },
      ...(Array.isArray(parsed.customGroups) ? { customGroups: parsed.customGroups.map((group) => cleanGroup(group)) } : {}),
    }));
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

// A custom page is any page no section owns. workspace:* rows are owned by
// /api/workspaces and appear as a tab of Chat, so tab names like General or
// Coding must never become rail rows.
//
// This lives here, once, because the rail and Settings → Navigation must be
// looking at the same list: they each used to carry their own filter, and
// Settings' (`!page.route`) was the stricter of the two, so a routed custom
// page like custom:scratch appeared on the rail while Settings claimed there
// were no custom pages to arrange.
export function customNavigationPages(pages = []) {
  return pages.filter(
    (page) => !SECTION_ROUTES.has(page.route) && !(typeof page.route === 'string' && page.route.startsWith('workspace:')),
  );
}

export function navigationItems(customPages = []) {
  const preferences = loadNavigationPreferences();
  const onion = loadOnionState();
  const builtIn = BUILT_IN_ITEMS.map((item, index) => {
    const key = navigationItemKey(item.type, item.id);
    const saved = preferences.items[key] || {};
    const explicit = typeof saved.visible === 'boolean';
    return {
      ...item,
      key,
      group: cleanGroup(saved.group, item.group),
      visible: explicit ? saved.visible : isUnlocked(item.id, onion),
      // Settings shows WHY a row is where it is: chosen by you, or earned.
      unlocked: isUnlocked(item.id, onion),
      explicit,
      fresh: onion.fresh.includes(item.id),
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
  if (group && !preferences.groups.includes(group)) {
    preferences.groups.push(group);
    preferences.customGroups = [...new Set([...(preferences.customGroups || []), group])];
  }
  return persist(preferences);
}

export function renameNavigationGroup(previousName, nextName) {
  const previous = cleanGroup(previousName);
  const next = cleanGroup(nextName, '');
  if (!next || previous === next) return loadNavigationPreferences();
  const preferences = loadNavigationPreferences();
  preferences.groups = [...new Set(preferences.groups.map((group) => (group === previous ? next : group)))];
  preferences.customGroups = [...new Set([...(preferences.customGroups || []).filter((group) => group !== previous), next])];
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

/**
 * Every built-in row on, in one step, for the person who already knows what
 * they want. Written as explicit choices so it survives any later unlock
 * logic; "Reset defaults" hands the rail back to the onion.
 */
export function showAllNavigation() {
  const preferences = loadNavigationPreferences();
  for (const item of BUILT_IN_ITEMS) {
    const key = navigationItemKey(item.type, item.id);
    preferences.items[key] = { ...(preferences.items[key] || {}), visible: true };
  }
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
