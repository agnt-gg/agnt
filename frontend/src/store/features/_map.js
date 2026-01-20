// Map Vuex Store Module
const state = {
  hexGrid: [],
  selectedHex: null,
  playerGuildId: null, // Will be set from player module
};

const getters = {
  allHexes: state => state.hexGrid,
  selectedHex: state => state.selectedHex,
  guildTerritories: state => state.hexGrid.filter(hex => hex.type === 'guild'),
  unclaimedTerritories: state => state.hexGrid.filter(hex => hex.type === 'unclaimed'),
};

const mutations = {
  SET_HEX_GRID(state, grid) {
    state.hexGrid = grid;
  },
  SET_SELECTED_HEX(state, hex) {
    state.selectedHex = hex;
  },
  UPDATE_HEX(state, { id, updates }) {
    const hex = state.hexGrid.find(h => h.id === id);
    if (hex) {
      Object.assign(hex, updates);
    }
  },
  SET_PLAYER_GUILD_ID(state, guildId) {
    state.playerGuildId = guildId;
  }
};

const actions = {
  initializeMap({ commit }) {
    const guilds = [
      { id: 'guild1', name: 'The Loopers' },
      { id: 'guild2', name: 'Crystal Alliance' },
      { id: 'guild3', name: 'Shadow Covenant' }
    ];

    // Set player's guild ID (temporary until we have proper player state)
    commit('SET_PLAYER_GUILD_ID', 'guild1');

    // Define territory boosts
    const territoryBoosts = [
      { type: 'xp', name: 'XP Boost', effect: '+5% XP Gain', value: 5 },
      { type: 'xp', name: 'Major XP Boost', effect: '+10% XP Gain', value: 10 },
      { type: 'token', name: 'Token Generation', effect: '+3% Token Speed', value: 3 },
      { type: 'token', name: 'Enhanced Tokens', effect: '+7% Token Speed', value: 7 },
      { type: 'tools', name: 'Tool Mastery', effect: '+5% Tool Upgrade Speed', value: 5 },
      { type: 'tools', name: 'Master Crafting', effect: '+8% Tool Upgrade Speed', value: 8 },
      { type: 'mining', name: 'Mining Efficiency', effect: '+5% Mining Speed', value: 5 },
      { type: 'research', name: 'Research Boost', effect: '+5% Research Speed', value: 5 },
      { type: 'defense', name: 'Fortification', effect: '+10% Defense Strength', value: 10 },
      { type: 'attack', name: 'Combat Training', effect: '+5% Attack Power', value: 5 }
    ];
    
    const grid = [];
    const radius = 4; // Larger map for more territory variety
    
    // Helper to get distance from center
    const getDistance = (q, r) => {
      const s = -q - r; // Calculate third coordinate
      return Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
    };

    // Helper to get adjacent hex coordinates
    const getAdjacentHexes = (q, r) => {
      return [
        [q+1, r], [q+1, r-1], [q, r-1],
        [q-1, r], [q-1, r+1], [q, r+1]
      ];
    };
    
    // First pass: Create all hexes
    for (let q = -radius; q <= radius; q++) {
      const r1 = Math.max(-radius, -q - radius);
      const r2 = Math.min(radius, -q + radius);
      
      for (let r = r1; r <= r2; r++) {
        const distance = getDistance(q, r);
        let hex = {
          id: `${q},${r}`,
          q,
          r,
          resources: Math.random() > 0.7 ? Math.floor(Math.random() * 100) : 0
        };

        // Assign territory boost
        const boost = territoryBoosts[Math.floor(Math.random() * territoryBoosts.length)];
        hex.boost = boost.effect;
        hex.boostType = boost.type;
        hex.boostValue = boost.value;

        // Determine territory type based on distance and probability
        if (distance >= radius - 1) {
          // Outer ring is locked
          hex.type = 'locked';
          hex.lockReason = 'Requires Map Expansion';
        } else if (distance === 0) {
          // Center is always unclaimed and rich in resources
          hex.type = 'unclaimed';
          hex.resources = Math.floor(Math.random() * 100) + 50; // Guaranteed resources
          const centerBoost = territoryBoosts.find(b => b.type === 'token');
          hex.boost = centerBoost.effect;
          hex.boostType = centerBoost.type;
          hex.boostValue = centerBoost.value;
        } else {
          // Distribution for other territories
          const rand = Math.random();
          if (distance === radius - 2) {
            // Second to outer ring has more locked territories
            if (rand < 0.7) {
              hex.type = 'locked';
              hex.lockReason = 'Requires Advanced Technology';
            } else {
              hex.type = 'unclaimed';
            }
          } else {
            // Inner territories
            if (rand < 0.4) {
              hex.type = 'guild';
              const guild = guilds[Math.floor(Math.random() * guilds.length)];
              hex.guildId = guild.id;
              hex.guildName = guild.name;
              hex.defenseLevel = Math.floor(Math.random() * 3) + 1; // 1-3 defense level
            } else if (rand < 0.7) {
              hex.type = 'unclaimed';
            } else {
              hex.type = 'locked';
              hex.lockReason = rand < 0.85 ? 'Requires Guild Level 2' : 'Requires Special Key';
            }
          }
        }

        // Assign token cost for unclaimed territories
        if (hex.type === 'unclaimed') {
          // Example: cost increases with distance from center
          hex.tokenCost = 1000 + distance * 500 + Math.floor(Math.random() * 500);
        }

        // Special resource territories
        if (hex.type !== 'locked' && hex.resources > 0) {
          hex.resourceType = ['crystals', 'metals', 'energy'][Math.floor(Math.random() * 3)];
          // Match boost to resource type
          switch (hex.resourceType) {
            case 'crystals':
              hex.boost = territoryBoosts.find(b => b.type === 'research').effect;
              hex.boostType = 'research';
              break;
            case 'metals':
              hex.boost = territoryBoosts.find(b => b.type === 'tools').effect;
              hex.boostType = 'tools';
              break;
            case 'energy':
              hex.boost = territoryBoosts.find(b => b.type === 'mining').effect;
              hex.boostType = 'mining';
              break;
          }
        }

        grid.push(hex);
      }
    }

    // Second pass: Ensure no isolated territories
    grid.forEach(hex => {
      if (hex.type === 'guild') {
        const adjacent = getAdjacentHexes(hex.q, hex.r);
        const hasAdjacentPath = adjacent.some(([q, r]) => {
          const adjHex = grid.find(h => h.q === q && h.r === r);
          return adjHex && (adjHex.type === 'unclaimed' || adjHex.type === 'guild');
        });

        // If no adjacent path, make one adjacent hex unclaimed
        if (!hasAdjacentPath) {
          const randomAdj = adjacent[Math.floor(Math.random() * adjacent.length)];
          const isolatedHex = grid.find(h => h.q === randomAdj[0] && h.r === randomAdj[1]);
          if (isolatedHex && isolatedHex.type === 'locked') {
            isolatedHex.type = 'unclaimed';
            delete isolatedHex.lockReason;
          }
        }
      }
    });

    // Third pass: Add strategic resource clusters
    const resourceClusters = Math.floor(Math.random() * 3) + 2; // 2-4 clusters
    for (let i = 0; i < resourceClusters; i++) {
      const centerHex = grid[Math.floor(Math.random() * grid.length)];
      if (centerHex.type !== 'locked') {
        centerHex.resources = Math.floor(Math.random() * 50) + 50;
        centerHex.resourceType = ['crystals', 'metals', 'energy'][Math.floor(Math.random() * 3)];
        
        // Add resources to adjacent hexes
        const adjacent = getAdjacentHexes(centerHex.q, centerHex.r);
        adjacent.forEach(([q, r]) => {
          const adjHex = grid.find(h => h.q === q && h.r === r);
          if (adjHex && adjHex.type !== 'locked') {
            adjHex.resources = Math.floor(Math.random() * 30) + 20;
            adjHex.resourceType = centerHex.resourceType;
          }
        });
      }
    }
    
    commit('SET_HEX_GRID', grid);
  },

  selectHex({ commit }, hex) {
    commit('SET_SELECTED_HEX', hex);
  },

  async claimTerritory({ commit, state }, hexId) {
    if (!state.playerGuildId) return;
    
    const hex = state.hexGrid.find(h => h.id === hexId);
    if (!hex || hex.type !== 'unclaimed') return;
    
    commit('UPDATE_HEX', {
      id: hexId,
      updates: {
        type: 'guild',
        guildId: state.playerGuildId,
        guildName: 'The Loopers', // This will be updated when we have guild info
        defenseLevel: 1
      }
    });

    // Note: Territory boost will be applied when we have guild functionality
  },

  fortifyTerritory({ commit, state }, hexId) {
    const hex = state.hexGrid.find(h => h.id === hexId);
    if (!hex || hex.type !== 'guild' || hex.guildId !== state.playerGuildId) return;
    
    const newDefenseLevel = Math.min((hex.defenseLevel || 0) + 1, 5);
    commit('UPDATE_HEX', {
      id: hexId,
      updates: { defenseLevel: newDefenseLevel }
    });
  },

  async attackTerritory({ commit }, hexId) {
    const hex = state.hexGrid.find(h => h.id === hexId);
    if (!hex || hex.type !== 'guild') return;

    // Set territory as contested
    commit('UPDATE_HEX', {
      id: hexId,
      updates: { type: 'contested' }
    });

    // TODO: Implement battle mechanics
    // For now, just reduce defense level
    const newDefenseLevel = Math.max((hex.defenseLevel || 1) - 1, 0);
    
    // If defense reaches 0, territory becomes unclaimed
    if (newDefenseLevel === 0) {
      commit('UPDATE_HEX', {
        id: hexId,
        updates: {
          type: 'unclaimed',
          guildId: null,
          guildName: null,
          defenseLevel: null
        }
      });
    } else {
      commit('UPDATE_HEX', {
        id: hexId,
        updates: {
          type: 'guild',
          defenseLevel: newDefenseLevel
        }
      });
    }
  },

  harvestResources({ commit, state }, hexId) {
    const hex = state.hexGrid.find(h => h.id === hexId);
    if (!hex || !hex.resources || (hex.guildId && hex.guildId !== state.playerGuildId)) return;

    commit('UPDATE_HEX', {
      id: hexId,
      updates: { resources: 0 }
    });

    // TODO: Add resources to guild/player inventory
    return hex.resources;
  }
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
};
