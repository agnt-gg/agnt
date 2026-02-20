<template>
  <div v-if="showModal" class="modal-backdrop-dashboard" @click.self="closeModal">
    <div class="modal-dashboard">
      <div class="modal-header-dashboard">
        <h3 v-if="agent" class="modal-title-dashboard">Enhance Agent: {{ agent.name }}</h3>
        <button class="modal-close-dashboard" @click="closeModal" aria-label="Close modal">×</button>
      </div>
      <div class="modal-body-dashboard">
        <p v-if="agent" class="skill-points-display-dashboard">
          Available Skill Points: <strong>{{ agent.skillPoints }} SP</strong>
        </p>
        
        <div v-if="agent && (efficiencyCoreUpgrades.length > 0 || cognitiveMatrixUpgrades.length > 0)" class="enhancements-container-dashboard">
          
          <div v-if="efficiencyCoreUpgrades.length > 0" class="enhancement-section-dashboard">
            <h4 class="enhancement-section-title-dashboard">Efficiency Core Progression (Mission Speed)</h4>
            <div class="enhancement-row-dashboard">
              <Tooltip
                v-for="option in efficiencyCoreUpgrades"
                :key="`${option.enhancementId}-${option.tier}`"
                :text="getOptionTitle(option)"
                width="auto"
              >
              <div
                class="skill-node-dashboard"
                :class="{
                  'purchased-dashboard': option.isPurchased,
                  'available-dashboard': !option.isPurchased && option.prerequisiteMet && agent.skillPoints >= option.cost,
                  'unavailable-dashboard': !option.isPurchased && (!option.prerequisiteMet || agent.skillPoints < option.cost),
                }"
                @click="(!option.isPurchased && option.prerequisiteMet && agent.skillPoints >= option.cost) ? selectUpgrade(option) : null"
              >
                <div class="skill-icon-dashboard">
                  <i :class="option.icon || 'fas fa-microchip'"></i>
                </div>
                <div class="skill-name-dashboard">{{ option.name }}</div>
                <div class="skill-description-dashboard">{{ option.description }}</div>
                <div class="skill-cost-dashboard">
                  <span v-if="option.isPurchased">PURCHASED</span>
                  <span v-else-if="option.tier > 1 && !option.prerequisiteMet" class="prerequisite-note-dashboard">
                    Requires T{{ option.tier - 1 }}
                  </span>
                  <span v-else-if="option.prerequisiteMet && agent.skillPoints >= option.cost">{{ option.cost }} SP</span>
                  <span v-else>Needs {{ option.cost }} SP</span>
                </div>
              </div>
              </Tooltip>
            </div>
          </div>

          <div v-if="cognitiveMatrixUpgrades.length > 0" class="enhancement-section-dashboard">
            <h4 class="enhancement-section-title-dashboard">Cognitive Matrix Progression (XP Gain)</h4>
            <div class="enhancement-row-dashboard">
              <Tooltip
                v-for="option in cognitiveMatrixUpgrades"
                :key="`${option.enhancementId}-${option.tier}`"
                :text="getOptionTitle(option)"
                width="auto"
              >
              <div
                class="skill-node-dashboard"
                :class="{
                  'purchased-dashboard': option.isPurchased,
                  'available-dashboard': !option.isPurchased && option.prerequisiteMet && agent.skillPoints >= option.cost,
                  'unavailable-dashboard': !option.isPurchased && (!option.prerequisiteMet || agent.skillPoints < option.cost),
                }"
                @click="(!option.isPurchased && option.prerequisiteMet && agent.skillPoints >= option.cost) ? selectUpgrade(option) : null"
              >
                <div class="skill-icon-dashboard">
                  <i :class="option.icon || 'fas fa-microchip'"></i>
                </div>
                <div class="skill-name-dashboard">{{ option.name }}</div>
                <div class="skill-description-dashboard">{{ option.description }}</div>
                <div class="skill-cost-dashboard">
                  <span v-if="option.isPurchased">PURCHASED</span>
                  <span v-else-if="option.tier > 1 && !option.prerequisiteMet" class="prerequisite-note-dashboard">
                    Requires T{{ option.tier - 1 }}
                  </span>
                  <span v-else-if="option.prerequisiteMet && agent.skillPoints >= option.cost">{{ option.cost }} SP</span>
                  <span v-else>Needs {{ option.cost }} SP</span>
                </div>
              </div>
              </Tooltip>
            </div>
          </div>

        </div>
        <div v-else-if="agent" class="empty-state-small modal-empty-state-dashboard">
          {{ agent.name }} has no applicable enhancement paths currently available or defined.
        </div>
         <div v-else class="empty-state-small modal-empty-state-dashboard">
          No agent selected for upgrade.
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { computed } from "vue";
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: "AgentUpgradePopup",
  components: {
    Tooltip,
  },
  props: {
    showModal: {
      type: Boolean,
      required: true,
    },
    agent: {
      type: Object,
      default: null, // Can be null if no agent is selected
    },
    upgradeOptions: {
      type: Array,
      required: true,
    },
  },
  emits: ["close", "select-upgrade"],
  setup(props, { emit }) {
    const closeModal = () => {
      emit("close");
    };

    const selectUpgrade = (option) => {
      emit("select-upgrade", option);
    };

    const efficiencyCoreUpgrades = computed(() => {
      return props.upgradeOptions
        .filter(opt => opt.enhancementId === 'agentSpeed')
        .sort((a, b) => a.tier - b.tier);
    });

    const cognitiveMatrixUpgrades = computed(() => {
      return props.upgradeOptions
        .filter(opt => opt.enhancementId === 'agentXPGain')
        .sort((a, b) => a.tier - b.tier);
    });

    const getOptionTitle = (option) => {
      if (!props.agent) return "Agent data not available"; 

      if (option.isPurchased) {
        return 'Already purchased';
      }

      // Not purchased path
      if (option.tier > 1 && !option.prerequisiteMet) {
        return `Requires Tier ${option.tier - 1} to unlock this Tier ${option.tier}. This tier costs ${option.cost} SP.`;
      }

      // Prerequisite is met (or it's Tier 1)
      const currentAgentSkillPoints = props.agent.skillPoints; // Use live skill points
      if (currentAgentSkillPoints >= option.cost) { 
        return `Purchase Tier ${option.tier} for ${option.cost} SP. You have ${currentAgentSkillPoints} SP.`;
      } else { 
        return `Tier ${option.tier} costs ${option.cost} SP. You have ${currentAgentSkillPoints} SP. Needs ${option.cost - currentAgentSkillPoints} more SP.`;
      }
    };

    return {
      closeModal,
      selectUpgrade,
      efficiencyCoreUpgrades,
      cognitiveMatrixUpgrades,
      getOptionTitle,
    };
  },
};
</script>

<style scoped>
/* Agent Upgrade Modal Styles (adapted from user's example) */
.modal-backdrop-dashboard {
  position: fixed;
  inset: 0;
  background: rgba(7, 7, 16, 0.85); /* Slightly darker for better focus */
  backdrop-filter: blur(10px); /* Less blur than example for clarity */
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9990; /* Ensure it's above BaseScreen but potentially below global popups */
  opacity: 1;
  transition: opacity 0.3s ease;
}

.modal-dashboard {
  background: var(--color-dark-navy, #10101f); /* Using CSS var from example if available */
  border: 1px solid rgba(var(--green-rgb), 0.2); /* Green border to match dashboard theme */
  border-radius: 8px;
  max-width: 700px; /* Increased max-width to accommodate 4 items per row comfortably */
  width: 90%;
  max-height: 85vh; /* Adjusted max-height slightly */
  min-height: 200px; /* Ensure a minimum height */
  position: relative;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  animation: modal-appear-dashboard 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes modal-appear-dashboard {
  0% { transform: scale(0.9) translateY(15px); opacity: 0; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}

.modal-header-dashboard {
  padding: 20px 24px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.15);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0; /* Prevent header from shrinking */
}

.modal-title-dashboard {
  font-size: 1.2em;
  font-weight: 600;
  color: var(--color-light-green, #a0e0b0);
}

.modal-close-dashboard {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--color-grey-light, #ccc);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 1.2em;
  line-height: 1;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-close-dashboard:hover {
  border-color: var(--color-red, var(--color-red));
  color: var(--color-red, var(--color-red));
  background-color: rgba(254, 78, 78, 0.1);
  transform: rotate(90deg);
}

.modal-body-dashboard {
  padding: 24px;
  overflow-y: auto;
  flex-grow: 1;
  color: var(--color-light-navy, #d9d9d9);
}

.modal-body-dashboard p {
  margin-bottom: 16px;
  line-height: 1.6;
}
.modal-body-dashboard .error-text {
  color: var(--color-red, var(--color-red));
  font-weight: bold;
}

.skill-points-display-dashboard {
  text-align: center;
  font-size: 1.1em;
  margin-bottom: 20px !important; /* Override p margin */
  color: var(--color-light-green);
}
.skill-points-display-dashboard strong {
  color: var(--color-yellow);
}

/* New styles for enhancement sections and rows */
.enhancements-container-dashboard {
  display: flex;
  flex-direction: column;
  gap: 24px; /* Space between enhancement sections */
}

.enhancement-section-dashboard {
  /* No specific styles needed unless for border/background */
}

.enhancement-section-title-dashboard {
  font-size: 1em;
  color: var(--color-light-green, #a0e0b0);
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  font-weight: 500;
}

.enhancement-row-dashboard {
  display: grid;
  grid-template-columns: repeat(4, 1fr); /* 4 equal columns for T1-T4 */
  gap: 12px; /* Gap between skill nodes in a row */
}

/* Skill Node Styling (mimicking index.html example) */
/* .skill-tree-dashboard class removed as it's no longer used as main container */

.skill-node-dashboard {
  background: rgba(255, 255, 255, 0.02); /* Darker base */
  border: 1px solid rgba(255, 255, 255, 0.08); /* Slightly more visible border */
  padding: 12px; /* Slightly reduced padding for tighter fit */
  text-align: center;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  border-radius: 6px; /* Added border-radius */
  display: flex; /* Added flex for better internal alignment */
  flex-direction: column; /* Align items vertically */
  justify-content: space-between; /* Distribute space */
  min-height: 160px; /* Ensure nodes have a minimum height */
}

.skill-node-dashboard.available-dashboard {
  border-color: var(--color-blue-medium, rgba(18, 224, 255, 0.4)); /* Using a themed blue */
  background: rgba(18, 224, 255, 0.05); /* Light blue background */
}
.skill-node-dashboard.available-dashboard:hover {
  transform: translateY(-3px) scale(1.02);
  box-shadow: 0 8px 20px rgba(18, 224, 255, 0.2);
  border-color: var(--color-blue, #12e0ff);
}

/* Style for nodes that are upgradeable but agent can't afford */
.skill-node-dashboard.unavailable-dashboard {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.01);
  cursor: not-allowed;
  opacity: 0.6;
}
.skill-node-dashboard.unavailable-dashboard:hover {
   /* No hover effect for unavailable */
}

/* Style for nodes that are already purchased */
.skill-node-dashboard.purchased-dashboard {
  border-color: var(--color-green-medium, rgba(var(--green-rgb), 0.4)); /* Using a themed green */
  background: rgba(var(--green-rgb), 0.05); /* Light green background */
  cursor: default; /* Not clickable if purchased */
  opacity: 0.7; /* Slightly less prominent */
}
.skill-node-dashboard.purchased-dashboard:hover {
  /* No special hover for purchased, or a very subtle one if desired */
   transform: none;
   box-shadow: none;
}
.skill-node-dashboard.purchased-dashboard .skill-icon-dashboard {
  color: var(--color-green, #19ef83);
}
.skill-node-dashboard.purchased-dashboard .skill-cost-dashboard {
  color: var(--color-green-dark, #10a060);
  font-weight: bold;
}

.skill-icon-dashboard {
  font-size: 24px; /* Adjusted size */
  margin-bottom: 10px; /* Adjusted margin */
  color: var(--color-duller-navy, #3e405a); /* Default icon color */
}
.skill-node-dashboard.available-dashboard .skill-icon-dashboard {
  color: var(--color-blue, #12e0ff); /* Blue for available */
}
.skill-node-dashboard.unavailable-dashboard .skill-icon-dashboard {
  color: var(--color-med-navy, #7f8193); /* Greyer for unavailable */
}

.skill-name-dashboard {
  font-size: 0.85em; /* Adjusted size */
  color: var(--color-white, #f7f8f0);
  font-weight: 600; /* Bolder name */
  margin-bottom: 6px;
  line-height: 1.2; /* Adjusted line height */
  flex-grow: 1; /* Allow name to take space if description is short */
}

.skill-description-dashboard {
  font-size: 0.75em; /* Adjusted size */
  color: var(--color-light-navy, #d1d1db);
  margin-bottom: 8px;
  min-height: 2.4em; /* approx 2 lines */
  line-height: 1.2;
  flex-grow: 2; /* Allow description to take more space */
}

.skill-cost-dashboard {
  font-size: 0.8em; /* Adjusted size */
  font-weight: 700; /* Bolder cost */
  color: var(--color-grey-light, #ccc); /* Default cost color */
  margin-top: auto; /* Push cost to the bottom */
}
.skill-node-dashboard.available-dashboard .skill-cost-dashboard {
  color: var(--color-yellow, #ffd700); /* Yellow for cost of available */
}
.skill-node-dashboard.unavailable-dashboard .skill-cost-dashboard {
  color: var(--color-red-desaturated, #aa5555); /* Muted red for "needs X SP" */
}

/* Style for the prerequisite note */
.skill-cost-dashboard .prerequisite-note-dashboard {
  color: var(--color-orange, #ff8c00); /* A distinct orange for prerequisites */
  font-weight: 600; /* Slightly bolder to stand out */
}

/* empty-state-small in modal body - Renamed to avoid conflict & make specific */
.modal-empty-state-dashboard {
    color: var(--color-grey);
    font-style: italic;
    padding: 20px; /* More padding in modal */
    text-align: center;
    font-size: 0.9em;
    border: 1px dashed rgba(255,255,255,0.1);
    border-radius: 4px;
    margin-top: 16px;
}
.empty-state-small { /* Keep a general empty state for other uses if needed, but modal gets priority */
    color: var(--color-grey);
    font-style: italic;
    padding: 10px;
    text-align: center;
    font-size: 0.9em;
}
</style>
