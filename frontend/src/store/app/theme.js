import { mediaStorage } from '../../utils/mediaStorage.js';

// Helper function to remove legacy body-level background media
function removeLegacyBackgroundMedia() {
  const existingVideo = document.getElementById('background-video');
  if (existingVideo) {
    existingVideo.remove();
  }
  document.body.style.backgroundImage = 'none';
}

export default {
  namespaced: true,
  state: {
    // New unified theme system
    currentTheme: localStorage.getItem('currentTheme') !== null ? localStorage.getItem('currentTheme') : 'dark', // Default theme is dark

    // Keep greyscale as separate overlay
    isGreyscaleMode: localStorage.getItem('greyscaleMode') !== null ? localStorage.getItem('greyscaleMode') === 'true' : false,

    // Use custom background toggle
    useCustomBackground: localStorage.getItem('useCustomBackground') !== null ? localStorage.getItem('useCustomBackground') === 'true' : false,

    // Font setting
    fontFamily: localStorage.getItem('fontFamily') || 'sans',

    // UI scale (75-150, stored as integer percentage)
    uiScale: localStorage.getItem('uiScale') !== null ? parseInt(localStorage.getItem('uiScale')) : 100,

    // Background opacity (50-100, default 90)
    bgOpacity: Math.max(50, Math.min(100, localStorage.getItem('bgOpacity') !== null ? parseInt(localStorage.getItem('bgOpacity')) : 90)),

    // Background blur (0-20)
    bgBlur: localStorage.getItem('bgBlur') !== null ? parseInt(localStorage.getItem('bgBlur')) : 0,

    // Keep existing asset panel setting
    isAssetPanelFullWidth: localStorage.getItem('assetPanelFullWidth') !== null ? localStorage.getItem('assetPanelFullWidth') === 'true' : false,

    // Panel position setting
    panelPosition: localStorage.getItem('panelPosition') !== null ? localStorage.getItem('panelPosition') : 'right',

    // Panel width settings
    leftPanelWidth: localStorage.getItem('leftPanelWidth') !== null ? parseInt(localStorage.getItem('leftPanelWidth')) : 0,
    rightPanelWidth: localStorage.getItem('rightPanelWidth') !== null ? parseInt(localStorage.getItem('rightPanelWidth')) : 384,

    // 3-Panel system settings
    actualLeftPanelWidth: localStorage.getItem('actualLeftPanelWidth') !== null ? parseInt(localStorage.getItem('actualLeftPanelWidth')) : 384,
    mainContentWidth: localStorage.getItem('mainContentWidth') !== null ? parseInt(localStorage.getItem('mainContentWidth')) : 0, // Calculated dynamically
    showLeftPanel: localStorage.getItem('showLeftPanel') !== null ? localStorage.getItem('showLeftPanel') === 'true' : true,
    showRightPanel: localStorage.getItem('showRightPanel') !== null ? localStorage.getItem('showRightPanel') === 'true' : true,
    leftPanelCollapsed: localStorage.getItem('leftPanelCollapsed') !== null ? localStorage.getItem('leftPanelCollapsed') === 'true' : false,
    rightPanelCollapsed: localStorage.getItem('rightPanelCollapsed') !== null ? localStorage.getItem('rightPanelCollapsed') === 'true' : false,

    // Custom background images for each theme (stores references, actual data in IndexedDB)
    customBackgroundImages: {
      light: null,
      dark: null,
      cyberpunk: null,
      midnight: null,
      ember: null,
      nord: null,
      hacker: null,
      rose: null,
    },

    // Default background image for all themes
    defaultBackgroundImage: '/images/backgrounds/bg7.jpg',

    // Promo banner state
    isPromoBannerClosed: localStorage.getItem('isPromoBannerClosed') !== null ? localStorage.getItem('isPromoBannerClosed') === 'true' : false,

    // Rate limit banner state
    isRateLimited: false,
    isRateLimitBannerClosed:
      localStorage.getItem('isRateLimitBannerClosed') !== null ? localStorage.getItem('isRateLimitBannerClosed') === 'true' : false,
    rateLimitInfo: null, // { resetAt, limit, window, currentPlan, hitCount }
    rateLimitHitCount: 0,

    // Legacy support - computed from currentTheme
    isDarkMode: localStorage.getItem('currentTheme') !== null ? !['light', 'rose'].includes(localStorage.getItem('currentTheme')) : true,
    isCyberpunkMode: localStorage.getItem('currentTheme') !== null ? localStorage.getItem('currentTheme') === 'cyberpunk' : true,
  },
  mutations: {
    // New unified theme mutation
    SET_THEME(state, theme) {
      state.currentTheme = theme;
      localStorage.setItem('currentTheme', theme);

      // Update legacy state for backward compatibility
      state.isDarkMode = !['light', 'rose'].includes(theme);
      state.isCyberpunkMode = theme === 'cyberpunk';

      // Apply theme classes to body
      document.body.classList.remove('dark', 'cyberpunk', 'midnight', 'ember', 'nord', 'hacker', 'rose');
      const darkVariants = ['dark', 'cyberpunk', 'midnight', 'ember', 'nord', 'hacker'];
      if (darkVariants.includes(theme)) {
        document.body.classList.add('dark');
        if (theme !== 'dark') {
          document.body.classList.add(theme);
        }
      } else if (theme === 'rose') {
        document.body.classList.add('rose');
      }
      // light theme has no classes (default)
    },

    // Legacy mutations for backward compatibility
    SET_DARK_MODE(state, isDarkMode) {
      state.isDarkMode = isDarkMode;
      localStorage.setItem('darkMode', isDarkMode);
      document.body.classList.toggle('dark', isDarkMode);
    },
    SET_CYBERPUNK_MODE(state, isCyberpunkMode) {
      state.isCyberpunkMode = isCyberpunkMode;
      localStorage.setItem('cyberpunkMode', isCyberpunkMode);
      document.body.classList.toggle('cyberpunk', isCyberpunkMode);
    },
    SET_GREYSCALE_MODE(state, isGreyscaleMode) {
      state.isGreyscaleMode = isGreyscaleMode;
      localStorage.setItem('greyscaleMode', isGreyscaleMode);
      document.documentElement.classList.toggle('greyscale', isGreyscaleMode);
    },
    SET_USE_CUSTOM_BACKGROUND(state, useCustomBackground) {
      state.useCustomBackground = useCustomBackground;
      localStorage.setItem('useCustomBackground', useCustomBackground);
    },
    SET_FONT_FAMILY(state, fontFamily) {
      state.fontFamily = fontFamily;
      localStorage.setItem('fontFamily', fontFamily);
    },
    SET_UI_SCALE(state, scale) {
      state.uiScale = scale;
      localStorage.setItem('uiScale', scale);
    },
    SET_BG_OPACITY(state, opacity) {
      state.bgOpacity = opacity;
      localStorage.setItem('bgOpacity', opacity);
    },
    SET_BG_BLUR(state, blur) {
      state.bgBlur = blur;
      localStorage.setItem('bgBlur', blur);
    },
    SET_ASSET_PANEL_FULL_WIDTH(state, isFullWidth) {
      state.isAssetPanelFullWidth = isFullWidth;
      localStorage.setItem('assetPanelFullWidth', isFullWidth);
    },
    SET_PANEL_POSITION(state, position) {
      state.panelPosition = position;
      localStorage.setItem('panelPosition', position);
    },
    SET_PANEL_WIDTHS(state, { leftWidth, rightWidth }) {
      state.leftPanelWidth = leftWidth;
      state.rightPanelWidth = rightWidth;
      localStorage.setItem('leftPanelWidth', leftWidth);
      localStorage.setItem('rightPanelWidth', rightWidth);
    },
    // 3-Panel system mutations
    SET_ACTUAL_LEFT_PANEL_WIDTH(state, width) {
      state.actualLeftPanelWidth = width;
      localStorage.setItem('actualLeftPanelWidth', width);
    },
    SET_MAIN_CONTENT_WIDTH(state, width) {
      state.mainContentWidth = width;
      localStorage.setItem('mainContentWidth', width);
    },
    SET_SHOW_LEFT_PANEL(state, show) {
      state.showLeftPanel = show;
      localStorage.setItem('showLeftPanel', show);
    },
    SET_SHOW_RIGHT_PANEL(state, show) {
      state.showRightPanel = show;
      localStorage.setItem('showRightPanel', show);
    },
    SET_THREE_PANEL_WIDTHS(state, { actualLeftWidth, mainWidth, rightWidth }) {
      state.actualLeftPanelWidth = actualLeftWidth;
      state.mainContentWidth = mainWidth;
      state.rightPanelWidth = rightWidth;
      localStorage.setItem('actualLeftPanelWidth', actualLeftWidth);
      localStorage.setItem('mainContentWidth', mainWidth);
      localStorage.setItem('rightPanelWidth', rightWidth);
    },
    SET_LEFT_PANEL_COLLAPSED(state, collapsed) {
      state.leftPanelCollapsed = collapsed;
      localStorage.setItem('leftPanelCollapsed', collapsed);
    },
    SET_RIGHT_PANEL_COLLAPSED(state, collapsed) {
      state.rightPanelCollapsed = collapsed;
      localStorage.setItem('rightPanelCollapsed', collapsed);
    },
    // Promo banner mutation
    SET_PROMO_BANNER_CLOSED(state, isClosed) {
      state.isPromoBannerClosed = isClosed;
      localStorage.setItem('isPromoBannerClosed', isClosed);
    },
    // Rate limit banner mutations
    SET_RATE_LIMITED(state, info) {
      state.isRateLimited = true;
      state.rateLimitInfo = info;
      state.rateLimitHitCount += 1;
    },
    SET_RATE_LIMIT_BANNER_CLOSED(state, isClosed) {
      state.isRateLimitBannerClosed = isClosed;
      localStorage.setItem('isRateLimitBannerClosed', isClosed);
    },
    CLEAR_RATE_LIMIT(state) {
      state.isRateLimited = false;
      state.rateLimitInfo = null;
      // Don't reset hit count - it persists for the session
    },
    RESET_RATE_LIMIT_HIT_COUNT(state) {
      state.rateLimitHitCount = 0;
    },
    // Custom background image mutations
    async SET_CUSTOM_BACKGROUND_IMAGE(state, { theme, imageDataUrl }) {
      state.customBackgroundImages[theme] = imageDataUrl;

      // Store in IndexedDB for large files (videos)
      try {
        await mediaStorage.setItem(`customBackgroundImage_${theme}`, imageDataUrl);
        // Store a flag in localStorage to indicate media exists
        localStorage.setItem(`customBackgroundImage_${theme}_exists`, 'true');
      } catch (error) {
        console.error('Error storing background media:', error);
      }
    },
    async REMOVE_CUSTOM_BACKGROUND_IMAGE(state, theme) {
      state.customBackgroundImages[theme] = null;

      // Remove from IndexedDB
      try {
        await mediaStorage.removeItem(`customBackgroundImage_${theme}`);
        localStorage.removeItem(`customBackgroundImage_${theme}_exists`);
      } catch (error) {
        console.error('Error removing background media:', error);
      }
    },
  },
  actions: {
    // New unified theme action
    setTheme({ commit, dispatch }, theme) {
      commit('SET_THEME', theme);
      // Apply background based on useCustomBackground setting
      dispatch('applyCurrentThemeBackground');
    },

    // Initialize theme on app startup
    async initTheme({ commit, state, dispatch }) {
      // Load background images from IndexedDB first
      await dispatch('loadBackgroundImages');

      // Apply the current theme classes
      document.body.classList.remove('dark', 'cyberpunk', 'midnight', 'ember', 'nord', 'hacker', 'rose');
      const darkVariants = ['dark', 'cyberpunk', 'midnight', 'ember', 'nord', 'hacker'];
      if (darkVariants.includes(state.currentTheme)) {
        document.body.classList.add('dark');
        if (state.currentTheme !== 'dark') {
          document.body.classList.add(state.currentTheme);
        }
      } else if (state.currentTheme === 'rose') {
        document.body.classList.add('rose');
      }

      // Initialize greyscale
      document.documentElement.classList.toggle('greyscale', state.isGreyscaleMode);

      // Apply all visual settings
      dispatch('applyCurrentThemeBackground');
      dispatch('applyFont');
      dispatch('applyScale');
    },

    // Legacy actions for backward compatibility
    toggleDarkMode({ commit, state }) {
      commit('SET_DARK_MODE', !state.isDarkMode);
    },
    initDarkMode({ commit, state }) {
      document.body.classList.toggle('dark', state.isDarkMode);
    },
    toggleCyberpunkMode({ commit, state }) {
      commit('SET_CYBERPUNK_MODE', !state.isCyberpunkMode);
    },
    initCyberpunkMode({ state }) {
      document.body.classList.toggle('cyberpunk', state.isCyberpunkMode);
    },
    toggleGreyscaleMode({ commit, state }) {
      commit('SET_GREYSCALE_MODE', !state.isGreyscaleMode);
    },
    toggleUseCustomBackground({ commit, state, dispatch }) {
      const newValue = !state.useCustomBackground;
      commit('SET_USE_CUSTOM_BACKGROUND', newValue);
      dispatch('applyCurrentThemeBackground');
    },
    setFontFamily({ commit, dispatch }, fontFamily) {
      commit('SET_FONT_FAMILY', fontFamily);
      dispatch('applyFont');
      dispatch('applyScale');
    },
    setUiScale({ commit, dispatch }, scale) {
      commit('SET_UI_SCALE', scale);
      dispatch('applyScale');
    },
    setBgOpacity({ commit, dispatch }, opacity) {
      commit('SET_BG_OPACITY', opacity);
      dispatch('applyCurrentThemeBackground');
    },
    setBgBlur({ commit, dispatch }, blur) {
      commit('SET_BG_BLUR', blur);
      dispatch('applyCurrentThemeBackground');
    },
    applyFont({ state }) {
      const fontMap = {
        mono: "'Fira Code', monospace",
        sans: "'League Spartan', sans-serif",
      };
      document.documentElement.style.setProperty('--font-family-primary', fontMap[state.fontFamily] || fontMap.sans);
      document.documentElement.style.setProperty('--font-family-mono', fontMap.mono);
    },
    applyScale({ state }) {
      const scale = state.uiScale / 100;
      const fontScale = state.fontFamily === 'mono' ? 0.85 : 1;
      document.documentElement.style.setProperty('--scale', scale);
      document.documentElement.style.setProperty('--base-font-size', `${16 * scale * fontScale}px`);
    },
    initGreyscaleMode({ state }) {
      document.documentElement.classList.toggle('greyscale', state.isGreyscaleMode);
    },
    toggleAssetPanelWidth({ commit, state }) {
      commit('SET_ASSET_PANEL_FULL_WIDTH', !state.isAssetPanelFullWidth);
    },
    setPanelPosition({ commit }, position) {
      commit('SET_PANEL_POSITION', position);
    },
    setPanelWidths({ commit }, { leftWidth, rightWidth }) {
      commit('SET_PANEL_WIDTHS', { leftWidth, rightWidth });
    },
    // 3-Panel system actions
    setActualLeftPanelWidth({ commit }, width) {
      commit('SET_ACTUAL_LEFT_PANEL_WIDTH', width);
    },
    setMainContentWidth({ commit }, width) {
      commit('SET_MAIN_CONTENT_WIDTH', width);
    },
    toggleLeftPanel({ commit, state }) {
      commit('SET_SHOW_LEFT_PANEL', !state.showLeftPanel);
    },
    toggleRightPanel({ commit, state }) {
      commit('SET_SHOW_RIGHT_PANEL', !state.showRightPanel);
    },
    setShowLeftPanel({ commit }, show) {
      commit('SET_SHOW_LEFT_PANEL', show);
    },
    setShowRightPanel({ commit }, show) {
      commit('SET_SHOW_RIGHT_PANEL', show);
    },
    setThreePanelWidths({ commit }, { actualLeftWidth, mainWidth, rightWidth }) {
      commit('SET_THREE_PANEL_WIDTHS', { actualLeftWidth, mainWidth, rightWidth });
    },
    setLeftPanelCollapsed({ commit }, collapsed) {
      commit('SET_LEFT_PANEL_COLLAPSED', collapsed);
    },
    setRightPanelCollapsed({ commit }, collapsed) {
      commit('SET_RIGHT_PANEL_COLLAPSED', collapsed);
    },
    // Promo banner action
    setPromoBannerClosed({ commit }, isClosed) {
      commit('SET_PROMO_BANNER_CLOSED', isClosed);
    },
    // Rate limit banner actions
    setRateLimited({ commit }, info) {
      commit('SET_RATE_LIMITED', info);
    },
    setRateLimitBannerClosed({ commit }, isClosed) {
      commit('SET_RATE_LIMIT_BANNER_CLOSED', isClosed);
    },
    clearRateLimitIfExpired({ commit, state }) {
      if (state.rateLimitInfo && state.rateLimitInfo.resetAt) {
        const now = Date.now();
        if (now >= state.rateLimitInfo.resetAt) {
          commit('CLEAR_RATE_LIMIT');
        }
      }
    },
    clearRateLimit({ commit }) {
      commit('CLEAR_RATE_LIMIT');
    },
    // Custom background image actions
    async setCustomBackgroundImage({ commit, dispatch }, { theme, imageDataUrl }) {
      await commit('SET_CUSTOM_BACKGROUND_IMAGE', { theme, imageDataUrl });
      dispatch('applyCurrentThemeBackground');
    },
    async removeCustomBackgroundImage({ commit, dispatch }, theme) {
      await commit('REMOVE_CUSTOM_BACKGROUND_IMAGE', theme);
      dispatch('applyCurrentThemeBackground');
    },
    // Load background images from IndexedDB on startup
    async loadBackgroundImages({ state }) {
      const themes = ['light', 'dark', 'cyberpunk', 'midnight', 'ember', 'nord', 'hacker', 'rose'];

      for (const theme of themes) {
        const exists = localStorage.getItem(`customBackgroundImage_${theme}_exists`);
        if (exists) {
          try {
            const mediaDataUrl = await mediaStorage.getItem(`customBackgroundImage_${theme}`);
            if (mediaDataUrl) {
              state.customBackgroundImages[theme] = mediaDataUrl;
            }
          } catch (error) {
            console.error(`Error loading background for ${theme}:`, error);
          }
        }
      }
    },
    // Apply background for current theme based on useCustomBackground setting
    // Background rendering is handled by the #bg-layer in TerminalLayout.vue (reactive).
    // This action only manages CSS custom properties.
    applyCurrentThemeBackground({ state }) {
      // Clean up any legacy body-level backgrounds
      removeLegacyBackgroundMedia();

      if (state.useCustomBackground) {
        // Set on body.style so it overrides theme CSS declarations on body selectors
        document.body.style.setProperty('--color-background', 'transparent');
        document.body.classList.add('custom-bg');
        // Opacity slider controls how dark/opaque panels are over the background image
        // 100% = fully opaque panels (darkest), 90% = slightly transparent (image peeks through)
        document.documentElement.style.setProperty('--bg-opacity', state.bgOpacity / 100);
        document.documentElement.style.setProperty('--bg-blur', `${state.bgBlur}px`);
      } else {
        // Let each theme's CSS --color-background take effect
        document.body.style.removeProperty('--color-background');
        document.body.classList.remove('custom-bg');
        document.documentElement.style.removeProperty('--bg-opacity');
        document.documentElement.style.removeProperty('--bg-blur');
      }

      // Terminal styling (same for both modes)
      document.documentElement.style.setProperty('--terminal-container-padding', '0');
      document.documentElement.style.setProperty('--terminal-screen-border-radius', '0');
      document.documentElement.style.setProperty('--terminal-screen-border', 'none');
      document.documentElement.style.setProperty('--terminal-screen-box-shadow', 'none');
    },
  },
  getters: {
    // New unified theme getter
    currentTheme: (state) => state.currentTheme,

    // Legacy getters for backward compatibility
    isDarkMode: (state) => state.isDarkMode,
    isCyberpunkMode: (state) => state.isCyberpunkMode,
    isGreyscaleMode: (state) => state.isGreyscaleMode,
    isAssetPanelFullWidth: (state) => state.isAssetPanelFullWidth,
    panelPosition: (state) => state.panelPosition,
    leftPanelWidth: (state) => state.leftPanelWidth,
    rightPanelWidth: (state) => state.rightPanelWidth,
    // 3-Panel system getters
    actualLeftPanelWidth: (state) => state.actualLeftPanelWidth,
    mainContentWidth: (state) => state.mainContentWidth,
    showLeftPanel: (state) => state.showLeftPanel,
    showRightPanel: (state) => state.showRightPanel,
    leftPanelCollapsed: (state) => state.leftPanelCollapsed,
    rightPanelCollapsed: (state) => state.rightPanelCollapsed,
    // Font/scale/opacity getters
    fontFamily: (state) => state.fontFamily,
    uiScale: (state) => state.uiScale,
    bgOpacity: (state) => state.bgOpacity,
    bgBlur: (state) => state.bgBlur,
    // Custom background image getters
    customBackgroundImages: (state) => state.customBackgroundImages,
    currentThemeBackgroundImage: (state) => state.customBackgroundImages[state.currentTheme],
    useCustomBackground: (state) => state.useCustomBackground,
    // Promo banner getter
    isPromoBannerClosed: (state) => state.isPromoBannerClosed,
    // Rate limit banner getters
    isRateLimited: (state) => state.isRateLimited,
    isRateLimitBannerClosed: (state) => state.isRateLimitBannerClosed,
    rateLimitInfo: (state) => state.rateLimitInfo,
    rateLimitHitCount: (state) => state.rateLimitHitCount,
  },
};
