<template>
  <BaseScreen
    ref="baseScreenRef"
    activeRightPanel="MapPanel"
    screenId="MapScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :panelProps="{ selectedHex }"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>

        <!-- Map Controls -->
        <div class="map-controls">
          <BaseButton @click="zoomIn" variant="secondary">
            <i class="fas fa-plus"></i>
          </BaseButton>
          <BaseButton @click="zoomOut" variant="secondary">
            <i class="fas fa-minus"></i>
          </BaseButton>
          <BaseButton @click="resetView" variant="secondary">
            <i class="fas fa-home"></i>
          </BaseButton>
        </div>

        <TerminalHeader 
          title="Global Territory" 
          subtitle="Explore the map and claim territory for your polis guild."
          class="map"
        />
      <div class="map-container">
        

        <!-- Hexagonal Grid -->
        <div
          class="hex-grid"
          :style="{
            transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
          }"
          @mousedown="startPan"
          @mousemove="updatePan"
          @mouseup="endPan"
          @mouseleave="endPan"
        >
          <div
            v-for="hex in hexGrid"
            :key="hex.id"
            class="hex"
            :class="{
              selected: selectedHex?.id === hex.id,
              [hex.type]: true,
              'own-guild': isOwnGuild(hex),
              'enemy-guild': isEnemyGuild(hex)
            }"
            :style="getHexPosition(hex)"
            @click="selectHex(hex)"
          >
            <div class="hex-content">
              <i :class="[getHexIcon(hex), {
                'text-green': isOwnGuild(hex),
                'text-red': isEnemyGuild(hex),
                'text-grey': hex.type === 'locked'
              }]"></i>
            </div>
          </div>
        </div>
      </div>
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, onMounted, inject } from "vue";
import { useStore } from "vuex";
import BaseScreen from "../../components/LeftPanel/BaseScreen.vue";
import BaseButton from "../../components/shared/BaseButton.vue";
import TerminalHeader from "../../components/shared/TerminalHeader.vue";

export default {
  name: "MapScreen",
  components: { BaseScreen, BaseButton, TerminalHeader },
  emits: ["screen-change"],
  setup(props, { emit }) {
    const store = useStore();
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const zoom = ref(1);
    const pan = ref({ x: 0, y: 0 });
    const isPanning = ref(false);
    const panStart = ref({ x: 0, y: 0 });
    const playSound = inject("playSound", () => {});

    // Computed properties from store
    const hexGrid = computed(() => store.getters["map/allHexes"]);
    const selectedHex = computed(() => store.getters["map/selectedHex"]);
    const playerGuildId = computed(() => store.state.map.playerGuildId);

    // Hex positioning - pointy-topped honey-comb
    const getHexPosition = (hex) => {
      const size   = 55;                         // half the width (hex width = 100 px)
      const horiz  = Math.sqrt(3.25) * size;        // ≈ 86.6 px – horizontal step
      const vert   = 1.5 * size;                 // 75 px  – vertical step

      const x = horiz * (hex.q + hex.r / 2);     // axial → pixel
      const y = vert  *  hex.r;

      return { left: `${x}px`, top: `${y}px` };
    };

    const isOwnGuild = (hex) => {
      return hex.type === 'guild' && hex.guildId === playerGuildId.value;
    };

    const isEnemyGuild = (hex) => {
      return hex.type === 'guild' && hex.guildId !== playerGuildId.value;
    };

    const getHexIcon = (hex) => {
      if (hex.type === 'locked') return 'fas fa-lock';
      if (hex.type === 'guild') return 'fas fa-flag';
      return '';
    };

    // Zoom controls
    const zoomIn = () => {
      if (zoom.value < 2) zoom.value += 0.2;
      playSound("buttonClick");
    };

    const zoomOut = () => {
      if (zoom.value > 0.5) zoom.value -= 0.2;
      playSound("buttonClick");
    };

    const resetView = () => {
      zoom.value = 1;
      pan.value = { x: 0, y: 0 };
      playSound("buttonClick");
    };

    // Pan controls
    const startPan = (e) => {
      isPanning.value = true;
      panStart.value = {
        x: e.clientX - pan.value.x,
        y: e.clientY - pan.value.y,
      };
    };

    const updatePan = (e) => {
      if (!isPanning.value) return;
      pan.value = {
        x: e.clientX - panStart.value.x,
        y: e.clientY - panStart.value.y,
      };
    };

    const endPan = () => {
      isPanning.value = false;
    };

    // Hex selection
    const selectHex = (hex) => {
      store.dispatch("map/selectHex", hex);
      playSound("typewriterKeyPress");
      terminalLines.value = [
        `Selected hex: ${hex.id}`,
        `Type: ${hex.type}`,
        hex.guildId ? `Controlled by: ${hex.guildName}` : 'Unclaimed Territory',
        hex.resources ? `Resources: ${hex.resources}` : "",
        hex.defenseLevel ? `Defense Level: ${hex.defenseLevel}` : "",
      ].filter(Boolean);
    };

    // Panel actions
    const handlePanelAction = async (action, payload) => {
      switch (action) {
        case "claim":
          await store.dispatch("map/claimTerritory", payload.id);
          terminalLines.value.push(
            `Claiming territory at hex ${payload.id}`
          );
          break;
        case "fortify":
          await store.dispatch("map/fortifyTerritory", payload.id);
          terminalLines.value.push(
            `Fortifying defenses at hex ${payload.id}`
          );
          break;
        case "attack":
          terminalLines.value.push(`Attacking territory at hex ${payload.id}`);
          break;
        case "harvest":
          await store.dispatch("map/harvestResources", payload.id);
          terminalLines.value.push(
            `Harvested resources from hex ${payload.id}`
          );
          break;
      }
    };

    // Initialize
    const initializeScreen = async () => {
      await store.dispatch("map/initializeMap");
      terminalLines.value = ["Map initialized. Select a hex to view details."];
    };

    onMounted(() => {
      initializeScreen();
    });

    return {
      baseScreenRef,
      terminalLines,
      hexGrid,
      selectedHex,
      zoom,
      pan,
      getHexPosition,
      getHexIcon,
      zoomIn,
      zoomOut,
      resetView,
      startPan,
      updatePan,
      endPan,
      selectHex,
      handlePanelAction,
      initializeScreen,
      emit,
      isOwnGuild,
      isEnemyGuild,
    };
  },
};
</script>

<style scoped>
.map-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  margin-top: -24px;
}

.map-controls {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
  z-index: 10;
}

.hex-grid {
  position: absolute;
  top: 45%;
  left: 50%;
  transform-origin: center;
  transition: transform 0.1s ease;
}

.hex {
  position: absolute;
  width: 90px;
  height: 100px;
  margin: 1px;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  transition: all 0.2s ease;
  cursor: pointer;
}

.hex.locked {
  background-color: rgba(128, 128, 128, 0.1);
  /* cursor: not-allowed; */
  filter: grayscale(1);
  opacity: 0.5;
}

.hex.unclaimed {
  background-color: rgba(156, 156, 156, 0.349);
  /* filter: grayscale(1); */
}

.hex.guild {
  background-color: rgba(var(--green-rgb), 0.05);
}

.hex.guild.own-guild {
  background-color: rgba(var(--green-rgb), 0.25);
}

.hex.guild.enemy-guild {
  background-color: rgba(255, 69, 0, 0.15);
}

.hex-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.hex-icon {
  font-size: 1.5em;
}

.hex.locked .hex-content {
  color: var(--color-grey);
  opacity: 0.5;
}

.hex.guild.own-guild .hex-icon {
  color: var(--color-light-green);
}

.hex.guild.enemy-guild .hex-icon {
  color: var(--color-red);
}

.hex:hover:not(.locked) {
  filter: brightness(1.2);
}

.hex.selected:not(.locked) {
  background-color: var(--color-green);
}

.hex.selected {
  background-color: var(--color-green);
}
.hex.enemy-guild.selected {
  background-color: #fe4e4e8e;
}

.hex-boost {
  font-size: 0.7em;
  color: var(--color-blue);
  text-align: center;
  padding: 0 5px;
}

.hex.locked .hex-boost {
  color: var(--color-grey);
}

.text-green {
  color: var(--color-light-green) !important;
}

.text-red {
  color: var(--color-red) !important;
}

.text-grey {
  color: var(--color-grey) !important;
}

i.fas.fa-flag.text-red {
    text-shadow: 0 0 3px rgb(0 0 0 / 40%);
}

i.fas.fa-flag.text-green {
    text-shadow: 0 0 3px rgb(0 0 0 / 40%);
}

.terminal-line {
  line-height: 1.3;
  margin-bottom: 2px;
}

.log-line {
  opacity: 0.8; /* Make log lines slightly less prominent */
  font-size: 0.9em;
}

.text-bright-green {
  color: var(--color-green);
  text-shadow: 0 0 5px rgba(var(--green-rgb), 0.4);
}
.font-bold {
  font-weight: bold;
}
.text-xl {
  font-size: 1.25rem;
}
.map-controls .base-button {
    padding: 8px 8px 6px;
}

</style>
