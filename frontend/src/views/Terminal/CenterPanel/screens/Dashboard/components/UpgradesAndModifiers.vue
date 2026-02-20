<template>
  <div class="upgrades-modifiers-section data-section">
    <h4 class="section-title"><i class="fas fa-atom"></i> Network Enhancements</h4>
    <div class="tabs-container">
      <button
        class="tab-button"
        :class="{ active: activeTab === 'modifiers' }"
        @click="activeTab = 'modifiers'"
      >
        <i class="fas fa-cogs"></i> Global Modifiers
      </button>
      <button
        class="tab-button"
        :class="{ active: activeTab === 'upgrades' }"
        @click="activeTab = 'upgrades'"
      >
        <i class="fas fa-trophy"></i> Permanent Upgrades
      </button>
    </div>

    <div class="tab-content">
      <!-- Global Modifiers Tab -->
      <div v-if="activeTab === 'modifiers'" class="content-grid modifiers-grid">
        <div v-for="modifier in modifiers" :key="modifier.id" class="item-card modifier-card" :class="{ active: modifier.isActive, unavailable: !modifier.canActivate && !modifier.isActive }">
          <div class="card-header">
            <span class="item-name">{{ modifier.name }}</span>
            <span v-if="modifier.isActive" class="active-badge">ACTIVE</span>
          </div>
          <span class="item-effect">{{ modifier.effectDescription }}</span>

          <!-- Modifier Duration Progress Bar -->
          <Tooltip
            v-if="modifier.isActive && typeof modifier.initialDuration === 'number' && modifier.initialDuration > 0 && typeof modifier.durationLeft === 'number'"
            :text="`Time remaining: ${modifier.durationLeft}s`"
            width="auto"
          >
            <div class="modifier-duration-bar">
              <div
                class="duration-fill"
                :style="{ width: (Math.max(0, modifier.durationLeft) / modifier.initialDuration) * 100 + '%' }"
              ></div>
            </div>
          </Tooltip>

          <div class="status-and-action">
            <span class="item-status">
              {{ modifier.isActive ? 'Duration: ' + modifier.durationLeft + 's' : (modifier.canActivate ? 'Status: Ready to Activate' : 'Status: Researched / Prerequisite') }}
            </span>
            <button v-if="!modifier.isActive && modifier.canActivate" @click="activateModifier(modifier)" class="action-button activate-button" :disabled="totalTokens < modifier.cost">
              Activate ({{modifier.cost.toLocaleString()}}T)
            </button>
             <button v-else-if="modifier.isActive" class="action-button active-button" disabled>
              Active
            </button>
            <button v-else class="action-button unavailable-button" disabled>
              Unavailable
            </button>
          </div>
        </div>
        <div v-if="!modifiers.length && activeTab === 'modifiers'" class="empty-state-small">No global modifiers available...</div>
      </div>

      <!-- Permanent Upgrades Tab -->
      <div v-if="activeTab === 'upgrades'" class="content-grid upgrades-grid">
        <div v-for="upgrade in upgrades" :key="upgrade.id" class="item-card upgrade-card" :class="{ purchased: upgrade.purchased }">
          <div class="card-header">
            <span class="item-name">{{ upgrade.name }}</span>
            <span v-if="upgrade.purchased" class="purchased-badge"><i class="fas fa-check-circle"></i> PURCHASED</span>
          </div>
          <span class="item-description">{{ upgrade.description }}</span>
           <div class="status-and-action">
            <span class="item-status">
                {{ upgrade.purchased ? 'Effect: Permanent' : 'Status: Available for Purchase' }}
            </span>
            <button v-if="!upgrade.purchased" @click="purchaseUpgrade(upgrade)" class="action-button purchase-button" :disabled="totalTokens < upgrade.cost">
              Purchase ({{ upgrade.cost.toLocaleString() }}T)
            </button>
            <button v-else class="action-button purchased-button" disabled>
              <i class="fas fa-check-circle"></i> Acquired
            </button>
          </div>
        </div>
        <div v-if="!upgrades.length && activeTab === 'upgrades'" class="empty-state-small">No permanent upgrades available...</div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  components: {
    Tooltip,
  },
  name: "UpgradesAndModifiers",
  props: {
    modifiers: {
      type: Array,
      required: true,
      default: () => [],
    },
    upgrades: {
      type: Array,
      required: true,
      default: () => [],
    },
    totalTokens: {
      type: Number,
      required: true,
      default: 0,
    }
  },
  emits: ["activate-modifier", "purchase-upgrade"],
  setup(props, { emit }) {
    const activeTab = ref('modifiers'); // Default to modifiers

    const activateModifier = (modifier) => {
      emit("activate-modifier", modifier);
    };

    const purchaseUpgrade = (upgrade) => {
      emit("purchase-upgrade", upgrade);
    };

    return {
      activeTab,
      activateModifier,
      purchaseUpgrade,
    };
  },
};
</script>

<style scoped>
.data-section {
  background: rgba(0,0,0,0.15); /* Simplified background */
  border: 1px solid rgba(var(--green-rgb), 0.2); /* Standard accent border */
  border-radius: 6px; /* Standard border-radius */
  padding: 16px; /* Standard padding */
  /* Removed: complex background, border-top, backdrop-filter, box-shadow */
}

.section-title {
  color: var(--color-light-green); /* Standard title color */
  font-size: 1.1em; /* Standard title font-size */
  margin: 0 0 12px 0; /* Standard margins */
  padding-bottom: 8px; /* Standard padding */
  border-bottom: 1px solid rgba(var(--green-rgb), 0.15); /* Standard border */
  display: flex;
  align-items: center;
  gap: 8px; /* Standard gap */
  font-weight: normal; /* Removed: font-weight: 700 */
  /* Removed: text-shadow */
}
.section-title i {
  color: var(--color-green); /* Standard icon color */
  font-size: 1.1em; /* Adjusted icon size */
  /* Removed: text-shadow */
}

.tabs-container {
  display: flex;
  margin-bottom: 16px; /* Adjusted margin */
  background-color: rgba(0,0,0,0.2);
  border-radius: 32px;
  padding: 5px;
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.4);
}

.tab-button {
  flex-grow: 1;
  text-align: center;
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-grey-light);
  padding: 10px 15px; /* Adjusted padding */
  cursor: pointer;
  font-size: 1em; /* Adjusted font-size */
  font-weight: 600;
  position: relative;
  transition: all 0.3s ease;
  border-radius: 24px;
  margin: 0 2px;
  color: var(--color-med-navy);
}
.tab-button:first-child {
    border-radius: 24px 4px 4px 24px;
}
.tab-button:last-child {
    border-radius: 4px 24px 24px 4px;
}
.tab-button i {
  margin-right: 8px; /* Adjusted margin */
  transition: transform 0.3s ease;
}
.tab-button:hover {
  color: var(--color-white);
  background-color: var(--color-primary-transparent-light);
}
.tab-button.active {
  color: var(--color-green);
  font-weight: 700;
  background: var(--color-accent);
  box-shadow: 0 0 8px rgba(var(--color-accent-rgb, 0, 255, 157), 0.3); /* Simplified shadow */
}
.tab-button.active i {
  transform: scale(1.1);
}

.tab-content {
  min-height: 180px; /* Adjusted min-height */
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); /* Adjusted card width */
  gap: 16px; /* Adjusted gap */
}

.item-card {
  background: rgba(var(--green-rgb), 0.03); /* Subtler theme base, slightly different from agent card for variety */
  border: 1px solid rgba(var(--green-rgb), 0.15); /* Standard accent border */
  border-radius: 4px; /* Standard border-radius */
  padding: 12px; /* Standardized padding */
  display: flex;
  flex-direction: column;
  gap: 8px; /* Adjusted gap slightly for potentially more elements */
  font-size: 0.9em; /* Adjusted base font size */
  transition: all 0.2s ease-out;
  /* Removed complex default box-shadow */
  position: relative;
  overflow: hidden;
}

.item-card::before { /* Decorative accent line */
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px; /* Adjusted width */
  /* background gradient will be set by specific card types */
  opacity: 0.7; /* Slightly more subtle base opacity */
  transition: all 0.3s ease;
  border-radius: 4px 0 0 4px; /* Match card radius */
}

.item-card:hover {
  transform: translateY(-2px); /* Standard hover transform */
  box-shadow: 0 2px 8px rgba(var(--color-accent-rgb, 0, 255, 157), 0.15); /* Standard hover shadow */
  border-color: rgba(var(--color-accent-rgb),0.3); /* Accentuated border on hover */
}
.item-card:hover::before {
  opacity: 1;
  box-shadow: 0 0 5px rgba(var(--color-accent-rgb, 0, 255, 157), 0.3); /* Subtle glow for accent */
}

/* Modifier Card Specifics */
.modifier-card::before {
  background: linear-gradient(180deg, rgba(var(--color-blue-rgb, 52, 152, 219),0.5), var(--color-blue));
}
.modifier-card.active {
  background: linear-gradient(135deg, rgba(var(--color-yellow-rgb, 241, 196, 15), 0.1), rgba(var(--color-yellow-rgb, 241, 196, 15), 0.2)); /* Subtler active background */
  box-shadow: 0 0 10px rgba(var(--color-yellow-rgb, 241, 196, 15), 0.2), inset 0 0 5px rgba(var(--color-yellow-rgb, 241, 196, 15),0.05); /* Simplified shadow */
}
.modifier-card.active::before {
  background: linear-gradient(180deg, rgba(var(--color-yellow-rgb, 241, 196, 15),0.7), var(--color-yellow));
  box-shadow: 0 0 8px var(--color-yellow-transparent); /* Assuming var(--color-yellow-transparent) exists or use rgba */
}
.modifier-card.unavailable {
  opacity: 0.65; /* Adjusted opacity */
  filter: saturate(0.4);
}
.modifier-card.unavailable::before {
  background: linear-gradient(180deg, var(--color-grey-dark), var(--color-grey));
}


/* Upgrade Card Specifics */
.upgrade-card::before {
  background: linear-gradient(180deg, rgba(var(--color-purple-rgb, 155, 89, 182),0.5), var(--color-purple));
}
.upgrade-card.purchased {
  background: linear-gradient(135deg, rgba(var(--color-green-rgb, 46, 204, 113), 0.1), rgba(var(--color-green-rgb, 46, 204, 113), 0.2)); /* Subtler purchased background */
  opacity: 0.95;
  box-shadow: 0 0 10px rgba(var(--color-green-rgb, 46, 204, 113), 0.2), inset 0 0 5px rgba(var(--color-green-rgb, 46, 204, 113),0.05); /* Simplified shadow */
}
.upgrade-card.purchased::before {
  background: linear-gradient(180deg, rgba(var(--color-green-rgb, 46, 204, 113),0.7), var(--color-green));
  box-shadow: 0 0 8px var(--color-green-transparent); /* Assuming var(--color-green-transparent) exists or use rgba */
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1); /* Standardized border color */
}

.item-name {
  font-weight: 600; /* Adjusted font-weight */
  color: var(--color-white);
  font-size: 1.05em; /* Adjusted font-size */
  /* Removed text-shadow */
}

.active-badge, .purchased-badge {
  font-size: 0.75em; /* Adjusted font-size */
  font-weight: bold;
  padding: 3px 8px; /* Adjusted padding */
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2); /* Simplified shadow */
}
.active-badge {
  background-color: var(--color-yellow);
  color: var(--color-dark-navy);
  text-shadow: none; /* Removed text-shadow for flatness */
}
.purchased-badge {
  background-color: var(--color-green);
  color: var(--color-dark-navy);
  text-shadow: none; /* Removed text-shadow */
}
.purchased-badge i {
  margin-right: 4px;
}


.item-effect, .item-description {
  color: var(--color-grey-lighter);
  font-size: 0.9em; /* Consistent with card base font-size or slightly smaller */
  line-height: 1.45; /* Adjusted line-height */
  flex-grow: 1;
  min-height: 2.9em; /* Ensure a minimum height for consistency, approx 2 lines */
}
.item-description {
  color: var(--color-grey-light);
}

.status-and-action {
  margin-top: auto;
  padding-top: 10px; /* Adjusted padding */
  border-top: 1px solid rgba(var(--green-rgb), 0.1); /* Standardized border color */
  display: flex;
  flex-direction: column;
  gap: 8px; /* Adjusted gap */
}

.item-status {
  font-size: 0.8em; /* Adjusted font-size */
  color: var(--color-grey-light);
}
.modifier-card.active .item-status {
  color: var(--color-yellow);
  font-weight: bold;
  text-shadow: 0 0 4px rgba(var(--color-yellow-rgb, 241, 196, 15), 0.4); /* Subtle shadow */
}
.upgrade-card.purchased .item-status {
  color: var(--color-green);
  font-weight: bold;
  text-shadow: 0 0 4px rgba(var(--color-green-rgb, 46, 204, 113), 0.4); /* Subtle shadow */
}

.action-button {
  color: var(--color-white); /* Default text color for contrast */
  border: 1px solid transparent;
  padding: 8px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 0.85em;
  font-weight: 600;
  transition: background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.1s ease;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-shadow: none;
  position: relative;
  overflow: hidden;
  box-shadow: none; 
}
.action-button::before {
  content: none;
}

.activate-button {
  background-color: var(--color-green); /* Use main accent color */
  border-color: var(--color-green);
  color: var(--color-dark-navy); /* Dark text for contrast on green */
}
.activate-button:hover:not(:disabled) {
  background-color: var(--color-accent-light); /* Lighter accent for hover */
  border-color: var(--color-green);
  color: var(--color-dull-white);
  transform: translateY(-1px);
}
.activate-button:active:not(:disabled) {
  transform: translateY(0px);
  background-color: var(--color-green-dark);
}

.purchase-button {
  background-color: var(--color-purple);
  border-color: var(--color-purple-dark);
  color: var(--color-white); /* White text on purple */
}
.purchase-button:hover:not(:disabled) {
  background-color: var(--color-purple-light);
  border-color: var(--color-purple);
  transform: translateY(-1px);
}
.purchase-button:active:not(:disabled) {
  transform: translateY(0px);
  background-color: var(--color-purple-dark);
}

.action-button.active-button {
  background-color: var(--color-yellow);
  border-color: var(--color-yellow-dark);
  color: var(--color-dark-navy); /* Ensure this is a very dark, neutral color for contrast */
  /* Fallback if --color-dark-navy is not sufficiently dark or has a tint: */
  /* color: #1a202c; /* Example: A very dark grey/blue */
  cursor: default;
}


.action-button.purchased-button,
.action-button.unavailable-button {
  background-color: var(--color-grey-dark);
  border-color: var(--color-grey-darker);
  color: var(--color-grey-light); 
  cursor: default;
  opacity: 0.8; 
}


.action-button:disabled:not(.active-button):not(.purchased-button):not(.unavailable-button) {
  background-color: var(--color-grey-darker);
  border-color: #2c2c2c;
  color: var(--color-grey); 
  opacity: 0.6; 
  cursor: not-allowed;
  box-shadow: none;
}


.empty-state-small {
    color: var(--color-grey);
    padding: 20px; /* Adjusted padding */
    text-align: center;
    font-size: 1em; /* Adjusted font-size */
    grid-column: 1 / -1;
    border: 1px dashed rgba(var(--green-rgb), 0.3); /* Adjusted border */
    border-radius: 4px; /* Standard radius */
    background-color: rgba(var(--green-rgb), 0.03); /* Subtle theme background */
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px; /* Adjusted gap */
    min-height: 120px; /* Adjusted min-height */
}
.empty-state-small::before {
    font-family: "Font Awesome 5 Free"; 
    font-weight: 900; 
    content: "\f00e"; 
    font-size: 1.8em; /* Adjusted icon size */
    color: var(--color-grey-light); /* Adjusted color */
    margin-bottom: 8px;
}

/* Assuming these CSS variables are defined globally or in a theme file:
  --color-dark-navy: #1a2a3a; (example)
  --color-dark-navy-transparent: rgba(26, 42, 58, 0.8); (example - used in card background)
  --color-primary-transparent: rgba(26, 42, 58, 0.5); (example)
  --color-primary-transparent-light: rgba(26, 42, 58, 0.3); (example)
  
  --color-accent: #00ff9d; (example, a bright green/cyan)
  --color-accent-light: #64ffda; (example)
  --color-accent-rgb: 0, 255, 157; (example for box-shadow, text-shadow)
  --color-accent-transparent: rgba(var(--color-accent-rgb), 0.3); (New - used for borders/gradients)
  --color-accent-transparent-light: rgba(var(--color-accent-rgb), 0.15); (New - used for borders/gradients)

  --color-white: #f0f0f0;
  --color-grey: #888;
  --color-grey-light: #bbb;
  --color-grey-lighter: #ddd;
  --color-grey-dark: #555;
  --color-grey-darker: #333;
  
  --color-blue: #3498db;
  --color-blue-dark: #2980b9;
  --color-blue-rgb: 52, 152, 219;
  --color-blue-light: #5dade2; (New - for button gradients)

  --color-yellow: #f1c40f;
  --color-yellow-dark: #c8a209;
  --color-yellow-rgb: 241, 196, 15;
  
  --color-green: #2ecc71;
  --color-green-dark: #27ae60;
  --color-green-rgb: 46, 204, 113;
  
  --color-purple: #9b59b6;
  --color-purple-dark: #8e44ad;
  --color-purple-rgb: 155, 89, 182;
  --color-purple-light: #af7ac5; (New - for button gradients)
*/

.modifier-duration-bar {
  width: 100%;
  height: 8px; /* Slimmer than XP bar */
  background-color: rgba(0, 0, 0, 0.4); /* Dark background for the bar */
  border-radius: 4px; /* Rounded corners for the bar container */
  overflow: hidden; /* Ensures the fill stays within the rounded bounds */
  border: 1px solid rgba(var(--color-accent-rgb), 0.1); /* Subtle border, consistent with other elements */
  /* Relies on parent flex gap for spacing, or add margin-top/bottom if needed */
}

.duration-fill {
  height: 100%;
  background-color: var(--color-yellow); /* Yellow color for the fill */
  transition: width 0.25s linear; /* Smooth linear transition for time countdown */
  /* No border-radius on fill itself; parent's overflow:hidden and border-radius will clip it */
}
</style>
