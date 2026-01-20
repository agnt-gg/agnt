<template>
  <div class="map-panel">
    <div v-if="selectedHex">
      <template v-if="selectedHex.type === 'locked'">
        <div class="locked-message">
          <i class="fas fa-lock"></i>
          <span>
            {{
              selectedHex.lockReason === 'expansion'
                ? 'Requires Map Expansion'
                : 'Requires Advanced Technology'
            }}
          </span>
        </div>
      </template>
      <template v-else>
        <div class="hex-details">
          <div class="hex-header">
            <h2>Territory Details</h2>
            <div class="hex-coords">[{{ selectedHex.id }}]</div>
          </div>

          <!-- Show token cost for unclaimed territory -->
          <div v-if="selectedHex.type === 'unclaimed'" class="token-cost">
            <i class="fas fa-coins"></i>
            <span>Cost to claim: <strong>{{ selectedHex.tokenCost || defaultTokenCost }}</strong> Tokens</span>
          </div>

          <!-- Guild control information -->
          <div 
            v-if="selectedHex.guildId" 
            class="territory-info"
            :class="{ enemy: !isOwnGuild }"
          >
            <h3>Territory Control</h3>
            <div class="guild-name" :class="{ 'text-green': isOwnGuild, 'text-red': !isOwnGuild }">
              {{ selectedHex.guildName }}
            </div>
            <div v-if="selectedHex.defenseLevel" class="defense-level">
              <i class="fas fa-shield"></i> Defense Level: {{ selectedHex.defenseLevel }}
            </div>
          </div>

          <!-- Resource information -->
          <div v-if="selectedHex.resources" class="hex-resources">
            <h3>Resources</h3>
            <div class="resource-type">
              <i :class="getResourceIcon(selectedHex.resourceType)"></i>
              {{ formatResourceType(selectedHex.resourceType) }}
            </div>
            <div class="resource-value">{{ selectedHex.resources }} units</div>
          </div>

          <!-- Territory boost -->
          <div v-if="selectedHex.boost" class="territory-boost">
            <h3>Territory Bonus</h3>
            <div class="boost-value">
              <i :class="getBoostIcon(selectedHex.boostType)"></i>
              {{ selectedHex.boost }}
            </div>
          </div>

          <div class="hex-actions">
            <!-- Unclaimed territory -->
            <BaseButton 
              v-if="selectedHex.type === 'unclaimed'"
              @click="handleAction('claim')"
              variant="success"
              full-width
            >
              <i class="fas fa-flag text-green"></i> Claim Territory
            </BaseButton>

            <!-- Own territory -->
            <template v-if="selectedHex.type === 'guild' && isOwnGuild">
              <BaseButton 
                @click="handleAction('fortify')"
                variant="primary"
                full-width
              >
                <i class="fas fa-shield"></i> Fortify Defenses
              </BaseButton>

              <BaseButton 
                v-if="selectedHex.resources"
                @click="handleAction('harvest')"
                full-width
              >
                <i class="fas fa-hand-paper"></i> Harvest Resources
              </BaseButton>
            </template>

            <!-- Enemy territory -->
            <BaseButton 
              v-if="selectedHex.type === 'guild' && !isOwnGuild"
              @click="handleAction('attack')"
              variant="danger"
              full-width
            >
              <i class="fas fa-swords text-red"></i> Attack Territory
            </BaseButton>
          </div>
        </div>
      </template>
    </div>
    <div v-else class="no-hex-selected">
      Select a territory to view details
    </div>
  </div>
</template>

<script>
import BaseButton from '../../../shared/BaseButton.vue';
import { computed } from 'vue';
import { useStore } from 'vuex';

export default {
  name: 'MapPanel',
  components: { BaseButton },
  props: {
    selectedHex: {
      type: Object,
      default: null
    }
  },
  emits: ['panel-action'],
  setup(props, { emit }) {
    const store = useStore();

    // Default token cost if not provided by hex
    const defaultTokenCost = 1000;

    const getHexIcon = (hex) => {
      if (hex.type === 'locked') return 'fas fa-lock';
      if (hex.type === 'guild') {
        const playerGuildId = store.state.player?.guildId;
        return hex.guildId === playerGuildId ? 'fas fa-flag text-green' : 'fas fa-flag text-red';
      }
      return '';
    };

    const getResourceIcon = (type) => {
      switch (type) {
        case 'crystals': return 'fas fa-gem';
        case 'metals': return 'fas fa-hammer';
        case 'energy': return 'fas fa-bolt';
        default: return 'fas fa-cube';
      }
    };

    const getBoostIcon = (type) => {
      switch (type) {
        case 'xp': return 'fas fa-star';
        case 'token': return 'fas fa-coins';
        case 'tools': return 'fas fa-tools';
        case 'mining': return 'fas fa-mountain';
        case 'research': return 'fas fa-microscope';
        case 'defense': return 'fas fa-shield-alt';
        case 'attack': return 'fas fa-sword';
        default: return 'fas fa-plus';
      }
    };

    const formatResourceType = (type) => {
      return type ? type.charAt(0).toUpperCase() + type.slice(1) : '';
    };

    const getHexTypeDisplay = (type) => {
      switch (type) {
        case 'unclaimed': return 'Unclaimed Territory';
        case 'guild': return 'Territory';
        case 'locked': return 'Locked Territory';
        default: return type.charAt(0).toUpperCase() + type.slice(1);
      }
    };

    const isOwnGuild = computed(() => {
      const playerGuildId = store.state.map.playerGuildId;
      if (!playerGuildId || !props.selectedHex?.guildId) return false;
      return props.selectedHex.guildId === playerGuildId;
    });

    const handleAction = async (action) => {
      if (!props.selectedHex) return;

      try {
        switch (action) {
          case 'claim':
            await store.dispatch('map/claimTerritory', props.selectedHex.id);
            // Force a re-render of the hex grid
            await store.dispatch('map/selectHex', props.selectedHex);
            break;
          case 'fortify':
            await store.dispatch('map/fortifyTerritory', props.selectedHex.id);
            break;
          case 'attack':
            await store.dispatch('map/attackTerritory', props.selectedHex.id);
            break;
          case 'harvest':
            await store.dispatch('map/harvestResources', props.selectedHex.id);
            break;
        }
        
        emit('panel-action', action, props.selectedHex);
      } catch (error) {
        console.error('Error handling action:', error);
      }
    };

    return {
      getHexIcon,
      getResourceIcon,
      getBoostIcon,
      formatResourceType,
      getHexTypeDisplay,
      isOwnGuild,
      handleAction,
      defaultTokenCost,
    };
  }
};
</script>

<style scoped>
.map-panel {
  padding: 1rem;
  color: var(--color-white);
}

.locked-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-grey);
  margin: 2rem 0;
  padding: 1rem;
  background: rgba(128, 128, 128, 0.15);
  border-radius: 6px;
  font-size: 1.1em;
  justify-content: center;
}

.token-cost {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-yellow);
  font-size: 1.1em;
  margin-bottom: 1em;
}

.text-green {
  color: var(--color-light-green) !important;
}

.text-red {
  color: var(--color-red) !important;
}

.hex-header {
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-light-green);
}

.hex-header h2 {
  color: var(--color-light-green);
  margin: 0 0 0.5rem 0;
  font-size: 1.2rem;
}

.hex-coords {
  color: var(--color-grey);
  font-family: monospace;
}

.territory-lock {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-grey);
  margin: 1rem 0;
  padding: 0.5rem;
  background: rgba(128, 128, 128, 0.2);
  border-radius: 4px;
}

.territory-info {
  margin: 1.5rem 0;
  padding: 1rem;
  background: rgba(25, 239, 131, 0.1);
  border-radius: 4px;
}

.territory-info.enemy {
  background: rgba(255, 69, 0, 0.1);
}

.territory-info h3,
.hex-resources h3,
.territory-boost h3 {
  color: var(--color-grey);
  font-size: 0.9em;
  margin-bottom: 0.5rem;
}

.guild-name {
  color: var(--color-light-green);
  font-size: 1.2em;
  font-weight: bold;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.enemy .guild-name {
  color: rgba(255, 69, 0, 0.8);
}

.defense-level {
  color: var(--color-blue);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hex-resources {
  margin: 1.5rem 0;
  padding: 1rem;
  background: rgba(25, 239, 131, 0.1);
  border-radius: 4px;
}

.resource-type {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-blue);
  margin-bottom: 0.5rem;
}

.resource-value {
  color: var(--color-light-green);
  font-size: 1.2em;
  font-weight: bold;
}

.territory-boost {
  margin: 1.5rem 0;
  padding: 1rem;
  background: rgba(25, 239, 131, 0.1);
  border-radius: 4px;
}

.boost-value {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-blue);
  font-size: 1.1em;
}

.hex-actions {
  margin-top: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.no-hex-selected {
  color: var(--color-grey);
  text-align: center;
  padding: 2rem;
  font-style: italic;
}
</style>
