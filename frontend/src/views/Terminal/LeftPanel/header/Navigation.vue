<template>
  <div class="navigation-container">
    <!-- Primary Navigation -->
    <div class="primary-nav">
      <template v-for="category in primaryCategories" :key="category.id">
        <Tooltip v-if="category.disabled" :text="category.unlocksAt ? `${category.unlocksAt}` : 'Locked feature'" width="auto">
          <button
            :class="{
              active: activePrimary === category.id,
              disabled: category.disabled,
            }"
            @click="!category.disabled && selectPrimary(category.id)"
            :disabled="category.disabled"
            class="primary-nav-button"
          >
            {{ category.label }}
          </button>
        </Tooltip>
        <button
          v-else
          :class="{
            active: activePrimary === category.id,
            disabled: category.disabled,
          }"
          @click="!category.disabled && selectPrimary(category.id)"
          :disabled="category.disabled"
          class="primary-nav-button"
        >
          {{ category.label }}
        </button>
      </template>
    </div>

    <!-- Secondary Navigation -->
    <div class="secondary-nav">
      <template v-for="item in secondaryItems" :key="item.screen">
        <Tooltip v-if="item.disabled" :text="item.unlocksAt ? `${item.unlocksAt}` : 'Locked feature'" width="auto">
          <button
            :class="{
              active: activeScreen === item.screen,
              disabled: item.disabled,
            }"
            @click="!item.disabled && navigate(item.screen)"
            class="secondary-nav-button"
          >
            <i :class="getIconClass(item.icon)" style="margin-right: 4px"></i>
            {{ item.label }}
          </button>
        </Tooltip>
        <button
          v-else
          :class="{
            active: activeScreen === item.screen,
            disabled: item.disabled,
          }"
          @click="!item.disabled && navigate(item.screen)"
          class="secondary-nav-button"
        >
          <i :class="getIconClass(item.icon)" style="margin-right: 4px"></i>
          {{ item.label }}
        </button>
      </template>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue';
import { useStore } from 'vuex';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'Navigation',
  components: { Tooltip },
  props: {
    activeScreen: {
      type: String,
      required: true,
    },
  },
  emits: ['navigate'],
  setup(props, { emit }) {
    const store = useStore();
    const userLevel = computed(() => store.getters['userStats/level']);
    const isAuthenticated = computed(() => store.getters['userAuth/isAuthenticated']);

    // Define primary navigation categories
    const primaryCategories = computed(() => [
      { id: 'home', label: 'Home', disabled: false },
      {
        id: 'assets',
        label: 'Assets',
        // disabled: userLevel.value < 4,
        // unlocksAt: 4,
      },
      {
        id: 'forge',
        label: 'Studio',
        // disabled: userLevel.value < 9,
        // unlocksAt: 9,
      },

      {
        id: 'system',
        label: 'AGNT',
        // disabled: userLevel.value < 17,
        // unlocksAt: 17,
      },
    ]);

    // Map primary categories to secondary items
    const categoryMap = computed(() => ({
      home: [
        {
          screen: 'ChatScreen',
          icon: 'chat',
          label: 'Chat',
          // disabled: userLevel.value < 1,
          // unlocksAt: 1,
        },
        {
          screen: 'DashboardScreen',
          icon: 'dashboard',
          label: 'Dashboard',
          // disabled: userLevel.value < 3,
          // unlocksAt: 3,
          // disabled: true,
        },
        // {
        //   screen: 'GoalsScreen',
        //   icon: 'goals',
        //   label: 'Goals',
        // },
        {
          screen: 'RunsScreen',
          icon: 'runs',
          label: 'Runs',
        },
        // {
        //   screen: 'DashboardScreen',
        //   icon: 'data',
        //   label: 'Dashboard',
        // },
      ],
      forge: [
        {
          screen: 'WorkflowForgeScreen',
          icon: 'workflow',
          label: 'Workflow',
          // disabled: userLevel.value < 12,
          // unlocksAt: 12,
        },
        {
          screen: 'AgentForgeScreen',
          icon: 'agent',
          label: 'Agent',
          // disabled: true,
          // unlocksAt: 'Soon...',
        },
        {
          screen: 'ToolForgeScreen',
          icon: 'tool',
          label: 'Tool',
          // disabled: true,
          // unlocksAt: 'Custom Tool Forge (Soon...)',
        },
      ],
      assets: [
        {
          screen: 'WorkflowsScreen',
          icon: 'workflows',
          label: 'Workflows',
          // disabled: userLevel.value < 4,
          // unlocksAt: 4,
        },
        {
          screen: 'AgentsScreen',
          icon: 'agents',
          label: 'Agents',
          // disabled: userLevel.value < 5,
          // unlocksAt: 5,
        },
        {
          screen: 'ToolsScreen',
          icon: 'tools',
          label: 'Tools',
          // disabled: userLevel.value < 7,
          // unlocksAt: 7,
        },
        // {
        //   screen: 'ResourcesScreen',
        //   icon: 'resources',
        //   label: 'Resources',
        //   disabled: userLevel.value < 5,
        //   unlocksAt: 5,
        // },
      ],
      ops: [
        {
          screen: 'MarketScreen',
          icon: 'marketplace',
          label: 'Marketplace',
          // disabled: userLevel.value < 14,
          // unlocksAt: 14,
        },
        {
          screen: 'MissionsScreen',
          icon: 'missions',
          label: 'Missions',
          // disabled: userLevel.value < 15,
          // unlocksAt: 15,
        },
        {
          screen: 'MapScreen',
          icon: 'territory',
          label: 'Territory',
          // disabled: userLevel.value < 16,
          // unlocksAt: 16,
        },
      ],
      system: [
        {
          screen: 'MarketplaceScreen',
          icon: 'marketplace',
          label: 'Market',
          // disabled: userLevel.value < 14,
          // unlocksAt: 14,
        },
        {
          screen: 'ConnectorsScreen',
          icon: 'integrations',
          label: 'Connectors',
          // disabled: userLevel.value < 18,
          // unlocksAt: 18,
        },
        {
          screen: 'SettingsScreen',
          icon: 'settings',
          label: 'Account',
          // disabled: userLevel.value < 19,
          // unlocksAt: 19,
        },
        // {
        //   screen: 'BallJumperScreen',
        //   icon: 'game',
        //   label: 'Blue Ball 🎮',
        //   disabled: userLevel.value < 20,
        //   unlocksAt: 20,
        // },
        // {
        //   screen: "ProfileScreen",
        //   icon: 'profile',
        //   label: "Profile 💼",
        //   disabled: userLevel.value < 1,
        //   unlocksAt: 1,
        // },
      ],
    }));

    // Track active primary category
    const activePrimary = ref('home');

    // Compute secondary items based on active primary
    const secondaryItems = computed(() => {
      return categoryMap.value[activePrimary.value] || [];
    });

    // Select primary category
    const selectPrimary = (categoryId) => {
      activePrimary.value = categoryId;

      // Navigate to first enabled item in the category if available
      const items = categoryMap.value[categoryId] || [];
      const firstEnabledItem = items.find((item) => !item.disabled);
      if (firstEnabledItem) {
        navigate(firstEnabledItem.screen);
      }
    };

    // Navigate to a screen
    const navigate = (screenName) => {
      // Only allow navigation to SettingsScreen if not authenticated
      if (!isAuthenticated.value && screenName !== 'SettingsScreen') {
        console.warn('Navigation blocked: User not authenticated');
        return;
      }
      emit('navigate', screenName);
    };

    // Find which primary category contains the active screen
    const findPrimaryForScreen = (screenName) => {
      for (const [primary, items] of Object.entries(categoryMap.value)) {
        if (items.some((item) => item.screen === screenName)) {
          return primary;
        }
      }
      return 'home'; // Default to home if not found
    };

    // Initialize based on active screen
    const initializeNavigation = () => {
      activePrimary.value = findPrimaryForScreen(props.activeScreen);
    };

    // Initialize on component creation
    initializeNavigation();

    // Watch for activeScreen changes to update primary category
    watch(
      () => props.activeScreen,
      (newScreen) => {
        activePrimary.value = findPrimaryForScreen(newScreen);
      }
    );

    // Watch for userLevel changes to potentially re-evaluate navigation
    // if the current screen becomes locked/unlocked or first item changes.
    watch(userLevel, (newLevel, oldLevel) => {
      if (newLevel !== oldLevel) {
        // Re-initialize or re-evaluate activePrimary if needed,
        // especially if a previously active item gets locked.
        const currentItems = categoryMap.value[activePrimary.value] || [];
        const activeItem = currentItems.find((item) => item.screen === props.activeScreen);

        if (activeItem && activeItem.disabled) {
          // If current active screen became disabled, try to navigate to the first available in current primary
          const firstEnabledInCurrentPrimary = currentItems.find((item) => !item.disabled);
          if (firstEnabledInCurrentPrimary) {
            navigate(firstEnabledInCurrentPrimary.screen);
          } else {
            // If no item is available in current primary, switch to 'home' and its first available.
            activePrimary.value = 'home';
            const homeItems = categoryMap.value['home'] || [];
            const firstEnabledInHome = homeItems.find((item) => !item.disabled);
            if (firstEnabledInHome) {
              navigate(firstEnabledInHome.screen);
            }
            // If nothing is available at all (e.g. level 1), it will just stay as is.
          }
        } else {
          // If the primary category itself became disabled, switch to home
          const currentPrimaryCategory = primaryCategories.value.find((cat) => cat.id === activePrimary.value);
          if (currentPrimaryCategory && currentPrimaryCategory.disabled) {
            activePrimary.value = 'home'; // Default to home
            const homeItems = categoryMap.value['home'] || [];
            const firstEnabledInHome = homeItems.find((item) => !item.disabled);
            if (firstEnabledInHome) {
              navigate(firstEnabledInHome.screen);
            }
          }
        }
      }
    });

    // Map icon names to Font Awesome 5 icons
    const getIconClass = (icon) => {
      const iconMap = {
        chat: 'fas fa-comments',
        goals: 'fas fa-bullseye',
        runs: 'fas fa-play',
        data: 'fas fa-database',
        dashboard: 'fas fa-chart-bar',
        workflow: 'fas fa-project-diagram',
        agent: 'fas fa-robot',
        tool: 'fas fa-tools',
        workflows: 'fas fa-project-diagram',
        agents: 'fas fa-robot',
        tools: 'fas fa-tools',
        marketplace: 'fas fa-store',
        missions: 'fas fa-flag',
        territory: 'fas fa-map',
        integrations: 'fas fa-plug',
        settings: 'fas fa-cog',
      };
      return iconMap[icon] || 'fas fa-circle';
    };

    return {
      primaryCategories,
      activePrimary,
      secondaryItems,
      selectPrimary,
      navigate,
      getIconClass,
      userLevel, // Expose for debugging or other potential uses
    };
  },
};
</script>

<style scoped>
.navigation-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.primary-nav {
  display: flex;
  width: 100%;
  overflow-x: auto;
  border-bottom: 1px solid var(--terminal-border-color);
  gap: 2px;
  scrollbar-width: thin;
}

.primary-nav-button {
  padding: 8px 8px;
  background: var(--color-dark-0);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-light-0);
  font-weight: var(--font-weight);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: color 0.2s, text-shadow 0.2s, background 0.2s;
  flex: 1;
  min-width: 0;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 0;
  opacity: 0.5;
}

/* button.primary-nav-button:last-child {
  border-radius: 0 6px 0 0;
} */

.primary-nav-button:hover {
  /* color: var(--color-white); */
  opacity: 0.75;
}

/* .primary-nav-button:hover:not(.active) {
  opacity: 1;
} */

.primary-nav-button.active {
  /* background: var(--color-primary); */
  box-shadow: inset 0 -2px 0 var(--color-primary);
  opacity: 1;
}

.primary-nav-button.disabled {
  cursor: not-allowed !important;
  opacity: 0.25;
}

.primary-nav-button.disabled:hover {
  background: var(--color-dark-0);
  text-shadow: none;
}

.secondary-nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  width: 100%;
  overflow-x: auto;
  padding: 4px 0 0;
  border-bottom: 1px solid var(--terminal-border-color);
  gap: 2px;
  scrollbar-width: thin;
}

.secondary-nav-button {
  color: var(--color-text);
  font-size: var(--font-size-xs);
  flex: 1 1 auto;
  min-width: fit-content;
  padding: 5px 8px 6px;
  background: var(--color-dark-0);
  border: 1px solid var(--terminal-border-color);
  color: var(--color-light-0);
  cursor: pointer;
  transition: color 0.2s, text-shadow 0.2s, background 0.2s;
  text-align: center;
  white-space: nowrap;
  border-radius: 0;
  opacity: 0.5;
}

.secondary-nav-button:hover {
  opacity: 0.75;
}

.secondary-nav-button.active {
  /* background: var(--color-primary); */
  box-shadow: inset 0 -2px 0 var(--color-primary);
  opacity: 1;
}

.secondary-nav-button.disabled {
  cursor: not-allowed !important;
  opacity: 0.25;
}

.secondary-nav-button.disabled:hover {
  background: var(--color-dark-0);
  text-shadow: none;
}

/* Compact mode for narrow panels - uses container query from parent left-panel */
/* Keep single row layout, just reduce padding and font sizes */
@container left-panel (max-width: 350px) {
  .primary-nav-button {
    padding: 6px 4px;
    font-size: 12px;
  }

  .secondary-nav-button {
    padding: 4px 5px;
    font-size: 11px;
  }

  .secondary-nav-button i {
    margin-right: 2px !important;
  }
}

@container left-panel (max-width: 300px) {
  .primary-nav-button {
    padding: 5px 2px;
    font-size: 12px;
  }

  .secondary-nav-button {
    padding: 4px 3px;
    font-size: 11px;
  }

  .secondary-nav-button i {
    margin-right: 1px !important;
  }
}

@container left-panel (max-width: 260px) {
  .primary-nav-button {
    padding: 4px 1px;
    font-size: 11px;
  }

  .secondary-nav-button {
    padding: 3px 2px;
    font-size: 10px;
  }

  /* Hide icons at very narrow widths to save space */
  .secondary-nav-button i {
    display: none;
  }
}

/* Fallback for browsers without container queries */
@supports not (container-type: inline-size) {
  @media (max-width: 1280px) {
    .primary-nav-button {
      padding: 6px 4px;
      font-size: var(--font-size-xs);
    }

    .secondary-nav-button {
      padding: 4px 5px;
    }
  }

  @media (max-width: 1100px) {
    .primary-nav-button {
      padding: 5px 2px;
      font-size: 10px;
    }

    .secondary-nav-button {
      padding: 4px 3px;
      font-size: 10px;
    }

    .secondary-nav-button i {
      margin-right: 1px !important;
    }
  }
}
</style>
