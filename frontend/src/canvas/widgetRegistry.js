/**
 * Widget registry singleton.
 * All widgets register here with their metadata and component references.
 */

const registry = new Map();

/**
 * Register a widget definition.
 * @param {string} id - Unique widget identifier
 * @param {object} definition - Widget definition
 * @param {string} definition.name - Display name
 * @param {string} definition.icon - Font Awesome icon class (e.g. 'fas fa-comments')
 * @param {string} definition.category - Category: 'home' | 'assets' | 'forge' | 'system' | 'dashboard'
 * @param {object} definition.component - Vue component reference
 * @param {object} definition.defaultSize - { cols, rows }
 * @param {object} definition.minSize - { cols, rows }
 * @param {string} definition.description - Short description
 * @param {boolean} [definition.isScreenWidget=false] - Whether this wraps a full screen component
 */
export function registerWidget(id, definition) {
  registry.set(id, { id, ...definition });
}

/**
 * Get a widget definition by ID.
 */
export function getWidget(id) {
  return registry.get(id);
}

/**
 * Get all registered widget definitions.
 */
export function getAllWidgets() {
  return Array.from(registry.values());
}

/**
 * Get widgets filtered by category.
 */
export function getWidgetsByCategory(category) {
  return Array.from(registry.values()).filter((w) => w.category === category);
}

/**
 * Get all unique categories.
 */
export function getCategories() {
  const cats = new Set();
  for (const w of registry.values()) {
    cats.add(w.category);
  }
  return Array.from(cats);
}

/**
 * Check if a widget ID is registered.
 */
export function hasWidget(id) {
  return registry.has(id);
}
