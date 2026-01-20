<template>
  <div class="field-group wide-group">
    <div class="mode-toggle-group">
      <Tooltip :text="isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'" width="auto">
        <button
          @click="toggleDarkMode"
          class="mode-toggle"
        >
          <i :class="isDarkMode ? 'fas fa-sun' : 'fas fa-moon'"></i>
        </button>
      </Tooltip>
      <Tooltip :text="isGreyscaleMode ? 'Disable Greyscale' : 'Enable Greyscale'" width="auto">
        <button
          @click="toggleGreyscaleMode"
          class="mode-toggle"
        >
          <i
            :class="isGreyscaleMode ? 'fas fa-toggle-on' : 'fas fa-toggle-off'"
          ></i>
        </button>
      </Tooltip>
    </div>
    <div class="mode-toggle-group">
      <Tooltip :text="isCyberpunkMode ? 'Disable Cyberpunk Mode' : 'Enable Cyberpunk Mode'" width="auto">
        <button
          @click="toggleCyberpunkMode"
          class="mode-toggle cyberpunk"
        >
          <i
            :class="isCyberpunkMode ? 'fas fa-microchip' : 'fas fa-microchip'"
          ></i>
        </button>
      </Tooltip>
    </div>
  </div>
</template>

<script>
import { mapActions, mapGetters } from "vuex";
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: "DarkModeToggle",
  components: {
    Tooltip,
  },
  computed: {
    ...mapGetters("theme", [
      "isDarkMode",
      "isGreyscaleMode",
      "isCyberpunkMode",
    ]),
  },
  methods: {
    ...mapActions("theme", [
      "toggleDarkMode",
      "toggleGreyscaleMode",
      "toggleCyberpunkMode",
    ]),
  },
};
</script>

<style scoped>
.field-group {
  display: flex;
  flex-direction: row;
  gap: 16px;
  margin-left: 2px;
}

.mode-toggle {
  color: var(--color-dark-navy);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  transition: background-color 0.3s, color 0.3s;
}

body.dark .mode-toggle {
  color: var(--color-dull-white);
}

.mode-toggle-group {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: flex-start;
  align-items: center;
  gap: 16px;
}

button.cyberpunk {
  opacity: 0.05;
  transition: opacity 0.3s;
  margin-right: 2px;
}

button.cyberpunk:hover {
  opacity: 1;
}

.wide-group {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-content: center;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  width: 100%;
}
</style>
