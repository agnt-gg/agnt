<template>
  <BaseDashboardCard title="TOOLS INVENTORY" footer-text="Click [T-family] to detail">
    <div class="tool-families">
      <div v-for="family in toolFamilies" :key="family.name" class="tool-family">
        <div class="family-name">{{ family.name }}:</div>
        <div class="tools-list">
          <span v-for="tool in family.tools" :key="tool.id" class="tool-item" :title="tool.name">
            <SvgIcon :name="tool.icon" class="tool-icon" :class="tool.statusClass" />
          </span>
        </div>
      </div>
    </div>
  </BaseDashboardCard>
</template>

<script>
import { computed, onMounted } from 'vue';
import { useStore } from 'vuex';
import BaseDashboardCard from './BaseDashboardCard.vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';
// NOTE: Static toolLibrary import removed - now using centralized Vuex store (tools/fetchWorkflowTools)

export default {
  name: 'ToolsInventory',
  components: {
    BaseDashboardCard,
    SvgIcon,
  },
  setup() {
    const store = useStore();

    // Fetch workflow tools on mount
    onMounted(() => {
      store.dispatch('tools/fetchWorkflowTools');
    });

    // Get all tools from Vuex store (centralized source)
    const allTools = computed(() => {
      const toolLibrary = store.getters['tools/workflowTools'];
      if (!toolLibrary) return [];

      const tools = [];

      // Add all triggers
      if (toolLibrary.triggers) {
        tools.push(...toolLibrary.triggers);
      }

      // Add all actions
      if (toolLibrary.actions) {
        tools.push(...toolLibrary.actions);
      }

      // Add all utilities
      if (toolLibrary.utilities) {
        tools.push(...toolLibrary.utilities);
      }

      // Add all widgets
      if (toolLibrary.widgets) {
        tools.push(...toolLibrary.widgets);
      }

      // Add all controls
      if (toolLibrary.controls) {
        tools.push(...toolLibrary.controls);
      }

      // Add all custom tools
      if (toolLibrary.custom) {
        tools.push(...toolLibrary.custom);
      }

      return tools;
    });

    // Get tool status (placeholder - you can enhance this with actual health checks)
    const getToolStatus = (tool) => {
      // For now, assume all tools are healthy
      // You can add logic here to check actual tool health
      return {
        status: 'healthy',
        statusClass: 'status-healthy',
      };
    };

    // Group tools by family/category
    const toolFamilies = computed(() => {
      const families = {
        Triggers: [],
        Actions: [],
        Utilities: [],
        Widgets: [],
        Controls: [],
        Custom: [],
      };

      allTools.value.forEach((tool) => {
        const status = getToolStatus(tool);
        const toolData = {
          id: tool.type || tool.id,
          name: tool.title || tool.name || tool.type,
          icon: tool.icon || 'custom',
          ...status,
        };

        // Categorize by the actual category
        const category = tool.category;

        if (category === 'trigger') {
          families['Triggers'].push(toolData);
        } else if (category === 'action') {
          families['Actions'].push(toolData);
        } else if (category === 'utility') {
          families['Utilities'].push(toolData);
        } else if (category === 'widget') {
          families['Widgets'].push(toolData);
        } else if (category === 'control') {
          families['Controls'].push(toolData);
        } else if (category === 'custom') {
          families['Custom'].push(toolData);
        }
      });

      // Convert to array format and filter out empty families
      return Object.entries(families)
        .filter(([_, tools]) => tools.length > 0)
        .map(([name, tools]) => ({ name, tools }));
    });

    return {
      toolFamilies,
    };
  },
};
</script>

<style scoped>
.tool-families {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  overflow-y: auto;
}

.tool-family {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  flex: 1;
}

.family-name {
  color: var(--color-text-muted);
  font-weight: 600;
  min-width: 60px;
  font-size: 0.85em;
  flex-shrink: 0;
}

.tools-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  flex: 1;
}

.tool-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.tool-item:hover {
  transform: translateY(-1px) scale(1.1);
  filter: brightness(1.2);
}

.tool-icon {
  width: 14px;
  height: 14px;
  color: var(--color-primary);
}

.tool-icon.status-healthy {
  color: var(--color-green);
}

.tool-icon.status-warning {
  color: var(--color-yellow);
}

.tool-icon.status-error {
  color: var(--color-red);
}
</style>
