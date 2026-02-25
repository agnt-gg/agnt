/**
 * Widget registry singleton.
 * All widgets register here with their metadata and component references.
 *
 * Supports both built-in widgets (Vue components) and custom widgets
 * (dynamic definitions rendered via CustomWidgetRenderer).
 */

const registry = new Map();

/**
 * Register a widget definition.
 * @param {string} id - Unique widget identifier
 * @param {object} definition - Widget definition
 * @param {string} definition.name - Display name
 * @param {string} definition.icon - Font Awesome icon class (e.g. 'fas fa-comments')
 * @param {string} definition.category - Category: 'home' | 'assets' | 'forge' | 'system' | 'dashboard' | 'custom'
 * @param {object} definition.component - Vue component reference
 * @param {object} definition.defaultSize - { cols, rows }
 * @param {object} definition.minSize - { cols, rows }
 * @param {string} definition.description - Short description
 * @param {boolean} [definition.isScreenWidget=false] - Whether this wraps a full screen component
 * @param {boolean} [definition.isCustomWidget=false] - Whether this is a user-created custom widget
 * @param {object} [definition.customDefinition=null] - Full custom widget definition (for CustomWidgetRenderer)
 */
export function registerWidget(id, definition) {
  registry.set(id, { id, ...definition });
}

/**
 * Unregister a widget by ID.
 * Used when a custom widget is deleted.
 */
export function unregisterWidget(id) {
  registry.delete(id);
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

/**
 * Register a custom widget definition dynamically.
 * Custom widgets use CustomWidgetRenderer instead of a direct Vue component.
 * @param {object} definition - Custom widget definition from the database
 * @param {object} rendererComponent - The CustomWidgetRenderer Vue component
 */
export function registerCustomWidget(definition, rendererComponent) {
  registerWidget(definition.id, {
    name: definition.name,
    icon: definition.icon || 'fas fa-puzzle-piece',
    category: definition.category || 'custom',
    component: rendererComponent,
    defaultSize: definition.default_size || { cols: 4, rows: 3 },
    minSize: definition.min_size || { cols: 2, rows: 2 },
    description: definition.description || '',
    isScreenWidget: false,
    isCustomWidget: true,
    customDefinition: definition,
  });
}

/**
 * Bulk-register custom widget definitions.
 * Called at app boot after fetching from backend.
 * @param {Array} definitions - Array of custom widget definitions
 * @param {object} rendererComponent - The CustomWidgetRenderer Vue component
 */
export function registerCustomWidgets(definitions, rendererComponent) {
  for (const def of definitions) {
    registerCustomWidget(def, rendererComponent);
  }
}
