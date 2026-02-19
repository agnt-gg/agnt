import { API_CONFIG } from '@/tt.config.js';
import { generateInstanceId, findEmptySlot } from '@/canvas/gridUtils.js';

const STORAGE_KEY = 'agnt-widget-layouts';

function loadFromLocalStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

function saveToLocalStorage(pages, layouts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pages, layouts }));
  } catch {}
}

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

const state = {
  pages: [],
  activePageId: null,
  layouts: {}, // { [pageId]: [widgetInstance, ...] }
  isDirty: false,
  isLoaded: false,
};

const getters = {
  allPages: (state) => state.pages,
  activePageId: (state) => state.activePageId,
  activePage: (state) => state.pages.find((p) => p.id === state.activePageId) || null,

  pageLayout: (state) => (pageId) => {
    return state.layouts[pageId] || [];
  },

  activeLayout: (state) => {
    return state.layouts[state.activePageId] || [];
  },

  isLoaded: (state) => state.isLoaded,

  pageForRoute: (state) => (route) => {
    return state.pages.find((p) => p.route === route) || null;
  },
};

const mutations = {
  SET_PAGES(state, pages) {
    state.pages = pages;
  },

  SET_ACTIVE_PAGE(state, pageId) {
    state.activePageId = pageId;
  },

  SET_LAYOUT(state, { pageId, layout }) {
    state.layouts = { ...state.layouts, [pageId]: layout };
  },

  SET_ALL_LAYOUTS(state, layouts) {
    state.layouts = layouts;
  },

  SET_LOADED(state, loaded) {
    state.isLoaded = loaded;
  },

  SET_DIRTY(state, dirty) {
    state.isDirty = dirty;
  },

  ADD_PAGE(state, page) {
    state.pages.push(page);
  },

  REMOVE_PAGE(state, pageId) {
    state.pages = state.pages.filter((p) => p.id !== pageId);
    const { [pageId]: _, ...rest } = state.layouts;
    state.layouts = rest;
  },

  UPDATE_PAGE(state, { pageId, updates }) {
    const page = state.pages.find((p) => p.id === pageId);
    if (page) Object.assign(page, updates);
  },

  ADD_WIDGET(state, { pageId, widget }) {
    if (!state.layouts[pageId]) {
      state.layouts = { ...state.layouts, [pageId]: [] };
    }
    state.layouts[pageId].push(widget);
  },

  REMOVE_WIDGET(state, { pageId, instanceId }) {
    if (state.layouts[pageId]) {
      state.layouts[pageId] = state.layouts[pageId].filter((w) => w.instanceId !== instanceId);
    }
  },

  UPDATE_WIDGET(state, { pageId, instanceId, updates }) {
    if (state.layouts[pageId]) {
      const widget = state.layouts[pageId].find((w) => w.instanceId === instanceId);
      if (widget) Object.assign(widget, updates);
    }
  },
};

const actions = {
  /**
   * Load layouts from backend, fallback to localStorage.
   */
  async fetchLayouts({ commit }) {
    // Try localStorage first for instant load
    const cached = loadFromLocalStorage();
    if (cached) {
      commit('SET_PAGES', cached.pages || []);
      commit('SET_ALL_LAYOUTS', cached.layouts || {});
      if (cached.pages?.length > 0) {
        commit('SET_ACTIVE_PAGE', cached.pages[0].id);
      }
      commit('SET_LOADED', true);
    }

    // Then try backend
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL}/layouts`, {
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.pages && data.pages.length > 0) {
          const pages = data.pages.map((p) => ({
            id: p.page_id,
            name: p.page_name,
            icon: p.page_icon,
            route: p.route,
            order: p.page_order,
          }));
          const layouts = {};
          for (const p of data.pages) {
            layouts[p.page_id] = JSON.parse(p.layout_data || '[]');
          }
          commit('SET_PAGES', pages);
          commit('SET_ALL_LAYOUTS', layouts);
          if (!cached) {
            commit('SET_ACTIVE_PAGE', pages[0].id);
          }
          commit('SET_LOADED', true);
          saveToLocalStorage(pages, layouts);
        }
      }
    } catch {
      // Backend unavailable - localStorage data is fine
    }

    commit('SET_LOADED', true);
  },

  /**
   * Save a page's layout to backend + localStorage.
   */
  async saveLayout({ state }) {
    const pageId = state.activePageId;
    const page = state.pages.find((p) => p.id === pageId);
    if (!page) return;

    const layout = state.layouts[pageId] || [];
    saveToLocalStorage(state.pages, state.layouts);

    try {
      await fetch(`${API_CONFIG.BASE_URL}/layouts/${pageId}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          page_name: page.name,
          page_icon: page.icon,
          page_order: page.order || 0,
          route: page.route,
          layout_data: JSON.stringify(layout),
        }),
      });
    } catch {
      // Silently fail - localStorage has the data
    }
  },

  /**
   * Set active page and save.
   */
  setActivePage({ commit, dispatch }, pageId) {
    commit('SET_ACTIVE_PAGE', pageId);
    dispatch('saveLayout');
  },

  /**
   * Create a new empty page.
   */
  async addPage({ commit, dispatch, state }, { name, icon, route }) {
    const pageId = 'page_' + Math.random().toString(36).slice(2, 8);
    const page = {
      id: pageId,
      name: name || 'New Page',
      icon: icon || 'fas fa-th',
      route: route || null,
      order: state.pages.length,
    };
    commit('ADD_PAGE', page);
    commit('SET_LAYOUT', { pageId, layout: [] });
    commit('SET_ACTIVE_PAGE', pageId);

    saveToLocalStorage(state.pages, state.layouts);

    try {
      await fetch(`${API_CONFIG.BASE_URL}/layouts`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          page_id: pageId,
          page_name: page.name,
          page_icon: page.icon,
          page_order: page.order,
          route: page.route,
          layout_data: '[]',
        }),
      });
    } catch {}

    return pageId;
  },

  /**
   * Delete a page.
   */
  async deletePage({ commit, dispatch, state }, pageId) {
    if (state.pages.length <= 1) return;
    commit('REMOVE_PAGE', pageId);

    if (state.activePageId === pageId) {
      commit('SET_ACTIVE_PAGE', state.pages[0]?.id || null);
    }

    saveToLocalStorage(state.pages, state.layouts);

    try {
      await fetch(`${API_CONFIG.BASE_URL}/layouts/${pageId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
    } catch {}
  },

  /**
   * Rename a page.
   */
  renamePage({ commit, dispatch, state }, { pageId, name }) {
    commit('UPDATE_PAGE', { pageId, updates: { name } });
    saveToLocalStorage(state.pages, state.layouts);
    dispatch('saveLayout');
  },

  /**
   * Create page from a default layout.
   */
  async createPageFromDefault({ commit, dispatch, state }, { screenName, defaultWidgets }) {
    const pageId = 'page_' + Math.random().toString(36).slice(2, 8);

    // Map screen names to readable page names
    const nameMap = {
      ChatScreen: 'Chat',
      DashboardScreen: 'Dashboard',
      AgentsScreen: 'Agents',
      ToolsScreen: 'Tools',
      WorkflowsScreen: 'Workflows',
      SettingsScreen: 'Settings',
      GoalsScreen: 'Goals',
      RunsScreen: 'Runs',
      SecretsScreen: 'Secrets',
      MarketplaceScreen: 'Marketplace',
      WorkflowForgeScreen: 'Workflow Forge',
      ToolForgeScreen: 'Tool Forge',
      AgentForgeScreen: 'Agent Forge',
    };

    const iconMap = {
      ChatScreen: 'fas fa-comments',
      DashboardScreen: 'fas fa-tachometer-alt',
      AgentsScreen: 'fas fa-robot',
      ToolsScreen: 'fas fa-wrench',
      WorkflowsScreen: 'fas fa-project-diagram',
      SettingsScreen: 'fas fa-cog',
      GoalsScreen: 'fas fa-bullseye',
      RunsScreen: 'fas fa-play-circle',
      SecretsScreen: 'fas fa-key',
      MarketplaceScreen: 'fas fa-store',
      WorkflowForgeScreen: 'fas fa-hammer',
      ToolForgeScreen: 'fas fa-tools',
      AgentForgeScreen: 'fas fa-user-cog',
    };

    const page = {
      id: pageId,
      name: nameMap[screenName] || screenName.replace('Screen', ''),
      icon: iconMap[screenName] || 'fas fa-th',
      route: screenName,
      order: state.pages.length,
    };

    // Create widget instances from default layout
    const layout = (defaultWidgets || []).map((w) => ({
      instanceId: generateInstanceId(),
      widgetId: w.widgetId,
      col: w.col,
      row: w.row,
      cols: w.cols,
      rows: w.rows,
      collapsed: false,
      visible: true,
      zIndex: 1,
    }));

    commit('ADD_PAGE', page);
    commit('SET_LAYOUT', { pageId, layout });
    commit('SET_ACTIVE_PAGE', pageId);

    saveToLocalStorage(state.pages, state.layouts);

    try {
      await fetch(`${API_CONFIG.BASE_URL}/layouts`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          page_id: pageId,
          page_name: page.name,
          page_icon: page.icon,
          page_order: page.order,
          route: page.route,
          layout_data: JSON.stringify(layout),
        }),
      });
    } catch {}

    return pageId;
  },

  /**
   * Add a widget to a page.
   */
  addWidget({ commit, dispatch, state }, { pageId, widgetId, col, row, cols, rows }) {
    const existing = state.layouts[pageId] || [];
    const defaultCol = col;
    const defaultRow = row;

    // Find empty slot if position not provided
    let finalCol = defaultCol;
    let finalRow = defaultRow;
    if (finalCol === undefined || finalRow === undefined) {
      const slot = findEmptySlot(existing, cols || 3, rows || 2);
      finalCol = slot.col;
      finalRow = slot.row;
    }

    const widget = {
      instanceId: generateInstanceId(),
      widgetId,
      col: finalCol,
      row: finalRow,
      cols: cols || 3,
      rows: rows || 2,
      collapsed: false,
      visible: true,
      zIndex: 1,
    };

    commit('ADD_WIDGET', { pageId, widget });
    saveToLocalStorage(state.pages, state.layouts);
    dispatch('saveLayout');
  },

  /**
   * Remove a widget from a page.
   */
  removeWidget({ commit, dispatch, state }, { pageId, instanceId }) {
    commit('REMOVE_WIDGET', { pageId, instanceId });
    saveToLocalStorage(state.pages, state.layouts);
    dispatch('saveLayout');
  },

  /**
   * Update a widget's position.
   */
  updateWidgetPosition({ commit, dispatch, state }, { pageId, instanceId, col, row }) {
    commit('UPDATE_WIDGET', { pageId, instanceId, updates: { col, row } });
    saveToLocalStorage(state.pages, state.layouts);
    dispatch('saveLayout');
  },

  /**
   * Update a widget's size.
   */
  updateWidgetSize({ commit, dispatch, state }, { pageId, instanceId, cols, rows }) {
    commit('UPDATE_WIDGET', { pageId, instanceId, updates: { cols, rows } });
    saveToLocalStorage(state.pages, state.layouts);
    dispatch('saveLayout');
  },

  /**
   * Toggle widget collapsed state.
   */
  toggleWidgetCollapse({ commit, dispatch, state }, { pageId, instanceId }) {
    const layout = state.layouts[pageId] || [];
    const widget = layout.find((w) => w.instanceId === instanceId);
    if (widget) {
      commit('UPDATE_WIDGET', { pageId, instanceId, updates: { collapsed: !widget.collapsed } });
      saveToLocalStorage(state.pages, state.layouts);
      dispatch('saveLayout');
    }
  },

  /**
   * Update widget z-index.
   */
  updateWidgetZIndex({ commit, state }, { pageId, instanceId, zIndex }) {
    commit('UPDATE_WIDGET', { pageId, instanceId, updates: { zIndex } });
    // Don't save on every z-index change (too noisy)
  },

  /**
   * Reset a page to its default layout.
   */
  async resetPageToDefault({ commit, dispatch, state }, { pageId, defaultWidgets }) {
    const layout = (defaultWidgets || []).map((w) => ({
      instanceId: generateInstanceId(),
      widgetId: w.widgetId,
      col: w.col,
      row: w.row,
      cols: w.cols,
      rows: w.rows,
      collapsed: false,
      visible: true,
      zIndex: 1,
    }));

    commit('SET_LAYOUT', { pageId, layout });
    saveToLocalStorage(state.pages, state.layouts);
    dispatch('saveLayout');
  },
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions,
};
