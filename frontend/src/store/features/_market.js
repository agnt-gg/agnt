// Market Vuex Store Module
const state = {
  balance: 1000, // Starting balance
  inventory: [],
  auctionItems: [], // Changed from marketItems
  transactions: [],
  myListings: [] // New state for user's own auction listings
};

const getters = {
  balance: state => state.balance,
  inventory: state => state.inventory,
  auctionItems: state => state.auctionItems,
  transactions: state => state.transactions,
  myListings: state => state.myListings,
  categoriesByType: state => type => {
    // Get unique categories for a given type
    const cats = state.auctionItems.filter(item => item.type === type).map(item => item.category);
    const uniqueCats = [...new Set(cats)];
    return ['All', ...uniqueCats];
  },
  itemsByTypeAndCategory: state => (type, category) => {
    return state.auctionItems.filter(item => item.type === type && (!category || item.category === category));
  }
};

const mutations = {
  SET_BALANCE(state, balance) {
    state.balance = balance;
  },
  SET_INVENTORY(state, inventory) {
    state.inventory = inventory;
  },
  SET_AUCTION_ITEMS(state, items) {
    state.auctionItems = items;
  },
  ADD_TRANSACTION(state, transaction) {
    state.transactions.unshift(transaction);
  },
  UPDATE_BALANCE(state, amount) {
    state.balance += amount;
  },
  UPDATE_AUCTION_ITEM(state, { itemId, updates }) {
    const index = state.auctionItems.findIndex(item => item.id === itemId);
    if (index !== -1) {
      state.auctionItems[index] = { ...state.auctionItems[index], ...updates };
    }
  },
  ADD_LISTING(state, listing) {
    state.myListings.push(listing);
    state.auctionItems.push(listing);
  },
  REMOVE_LISTING(state, listingId) {
    state.myListings = state.myListings.filter(l => l.id !== listingId);
  }
};

const actions = {
  // Get current balance
  async getBalance({ state }) {
    return state.balance;
  },

  // Get number of items in the auction
  async getItemCount({ state }) {
    return state.auctionItems.length;
  },

  // Place bid on an item
  async placeBid({ commit, state }, { itemId, bidAmount }) {
    if (state.balance < bidAmount) {
      throw new Error('Insufficient funds');
    }

    const item = state.auctionItems.find(i => i.id === itemId);
    if (!item) {
      throw new Error('Item not found');
    }

    if (bidAmount <= item.currentPrice) {
      throw new Error('Bid must be higher than current price');
    }

    // Update the auction item
    commit('UPDATE_AUCTION_ITEM', {
      itemId,
      updates: {
        currentPrice: bidAmount,
        bidCount: item.bidCount + 1
      }
    });

    // Update balance and add transaction
    commit('UPDATE_BALANCE', -bidAmount);
    commit('ADD_TRANSACTION', {
      type: 'bid',
      itemId,
      amount: bidAmount,
      timestamp: new Date().toISOString()
    });

    return true;
  },

  // Create auction listing
  async createAuction({ commit }, { name, startingPrice, duration, type, category }) {
    if (!name || !startingPrice || !duration || !type || !category) {
      throw new Error('Missing required auction parameters');
    }

    if (startingPrice <= 0) {
      throw new Error('Starting price must be greater than 0');
    }

    const newAuction = {
      id: Date.now(),
      name,
      type,
      category,
      currentPrice: startingPrice,
      startingPrice,
      timeLeft: duration,
      seller: "You",
      bidCount: 0,
      createdAt: new Date().toISOString()
    };
    
    commit('ADD_LISTING', newAuction);
    commit('ADD_TRANSACTION', {
      type: 'create_auction',
      itemId: newAuction.id,
      price: startingPrice,
      timestamp: new Date().toISOString()
    });

    return newAuction;
  },

  // Modified getAuctionListings to include types and categories
  async getAuctionListings({ state, commit }) {
    if (state.auctionItems.length === 0) {
      // Mock data with types and categories
      const mockListings = [
        { 
          id: 1, 
          name: "Mining Bot",
          type: 'agents',
          category: '100.1 Acquisition',
          currentPrice: 500,
          startingPrice: 400,
          timeLeft: "2h 30m",
          seller: "RoboTech",
          bidCount: 5,
          tools: ["database", "api", "code"]
        },
        { 
          id: 2, 
          name: "Resource Collector",
          type: 'agents',
          category: '500.2 Ops Automation',
          currentPrice: 750,
          startingPrice: 600,
          timeLeft: "1h 15m",
          seller: "AITraders",
          bidCount: 3,
          tools: ["chat", "database", "connect"]
        },
        { 
          id: 3, 
          name: "Auto-Mining Workflow",
          type: 'workflows',
          category: 'Automation',
          currentPrice: 300,
          startingPrice: 200,
          timeLeft: "45m",
          seller: "WorkflowPro",
          bidCount: 8,
          tools: ["params", "flow-2", "output"]
        },
        { 
          id: 4, 
          name: "Advanced Scanner",
          type: 'tools',
          category: 'Analysis',
          currentPrice: 200,
          startingPrice: 150,
          timeLeft: "3h",
          seller: "ToolMaster",
          bidCount: 2,
          tools: ["table", "api"]
        },
        { 
          id: 5, 
          name: "Quantum Storage",
          type: 'resources',
          category: 'Storage',
          currentPrice: 1000,
          startingPrice: 800,
          timeLeft: "5h",
          seller: "QuantumTech",
          bidCount: 10,
          tools: ["database"]
        },
        { 
          id: 6, 
          name: "Speed Boost",
          type: 'upgrades',
          category: 'Productivity',
          currentPrice: 150,
          startingPrice: 100,
          timeLeft: "1h",
          seller: "UpgradeKing",
          bidCount: 4,
          tools: ["timer", "output"]
        },
        { 
          id: 7, 
          name: "Exploration Drone",
          type: 'agents',
          category: '900 Domain Specialists',
          currentPrice: 850,
          startingPrice: 700,
          timeLeft: "4h 45m",
          seller: "DroneWorks",
          bidCount: 7,
          tools: ["code", "api", "connect"]
        },
        { 
          id: 8, 
          name: "Defense Sentry",
          type: 'agents',
          category: '900.2 Legal',
          currentPrice: 1200,
          startingPrice: 1000,
          timeLeft: "6h 20m",
          seller: "SecuritySystems",
          bidCount: 12,
          tools: ["chat", "flow-2", "text"]
        },
        { 
          id: 9, 
          name: "Repair Bot",
          type: 'agents',
          category: '200.2 Testing',
          currentPrice: 650,
          startingPrice: 500,
          timeLeft: "3h 10m",
          seller: "FixItCorp",
          bidCount: 4,
          tools: ["code", "output", "connect"]
        },
        { 
          id: 10, 
          name: "Transport Drone",
          type: 'agents',
          category: '800.1 Scheduling',
          currentPrice: 550,
          startingPrice: 450,
          timeLeft: "2h 50m",
          seller: "LogisticsPro",
          bidCount: 6,
          tools: ["clock", "output"]
        },
        { 
          id: 11, 
          name: "Mineral Analyzer",
          type: 'tools',
          category: 'Analysis',
          currentPrice: 320,
          startingPrice: 250,
          timeLeft: "5h 15m",
          seller: "ScienceTech",
          bidCount: 3,
          tools: ["database", "table"]
        },
        { 
          id: 12, 
          name: "Energy Drill",
          type: 'tools',
          category: 'Automation',
          currentPrice: 480,
          startingPrice: 350,
          timeLeft: "1h 45m",
          seller: "DeepCore",
          bidCount: 9,
          tools: ["code", "api"]
        },
        { 
          id: 13, 
          name: "Resource Radar",
          type: 'tools',
          category: 'Monitoring',
          currentPrice: 280,
          startingPrice: 200,
          timeLeft: "4h 30m",
          seller: "ScannerInc",
          bidCount: 5,
          tools: ["database", "output"]
        },
        { 
          id: 14, 
          name: "Terrain Mapper",
          type: 'tools',
          category: 'Analysis',
          currentPrice: 380,
          startingPrice: 300,
          timeLeft: "3h 20m",
          seller: "MapMasters",
          bidCount: 4,
          tools: ["table", "database"]
        },
        { 
          id: 15, 
          name: "Automated Refining",
          type: 'workflows',
          category: 'Automation',
          currentPrice: 420,
          startingPrice: 350,
          timeLeft: "2h 10m",
          seller: "AutomationTech",
          bidCount: 6,
          tools: ["flow-2", "api", "output"]
        },
        { 
          id: 16, 
          name: "Resource Transport Chain",
          type: 'workflows',
          category: 'Integration',
          currentPrice: 380,
          startingPrice: 300,
          timeLeft: "1h 50m",
          seller: "LogisticsFlow",
          bidCount: 4,
          tools: ["flow-3", "connect"]
        },
        { 
          id: 17, 
          name: "Energy Optimization",
          type: 'workflows',
          category: 'Data Processing',
          currentPrice: 520,
          startingPrice: 400,
          timeLeft: "5h 30m",
          seller: "EfficientWorks",
          bidCount: 8,
          tools: ["flow-2", "database", "output"]
        },
        { 
          id: 18, 
          name: "Base Defense Protocol",
          type: 'workflows',
          category: 'Monitoring',
          currentPrice: 450,
          startingPrice: 350,
          timeLeft: "3h 45m",
          seller: "DefenseLogic",
          bidCount: 5,
          tools: ["flow-3", "timer", "output"]
        },
        { 
          id: 19, 
          name: "Titanium Alloy",
          type: 'resources',
          category: 'Materials',
          currentPrice: 850,
          startingPrice: 700,
          timeLeft: "4h 20m",
          seller: "MetalWorks",
          bidCount: 9,
          tools: ["database"]
        },
        { 
          id: 20, 
          name: "Fusion Cells",
          type: 'resources',
          category: 'Energy',
          currentPrice: 1200,
          startingPrice: 950,
          timeLeft: "6h 15m",
          seller: "EnergyTech",
          bidCount: 11,
          tools: ["fire", "timer"]
        },
        { 
          id: 21, 
          name: "Efficiency Module",
          type: 'upgrades',
          category: 'Productivity',
          currentPrice: 320,
          startingPrice: 250,
          timeLeft: "3h 30m",
          seller: "UpgradeTech",
          bidCount: 7,
          tools: ["timer", "output"]
        },
        { 
          id: 22, 
          name: "Capacity Enhancer",
          type: 'upgrades',
          category: 'Productivity',
          currentPrice: 280,
          startingPrice: 220,
          timeLeft: "2h 40m",
          seller: "EnhanceCorp",
          bidCount: 6,
          tools: ["database", "grab"]
        },
        { 
          id: 23, 
          name: "Foundation Architect",
          type: 'agents',
          category: '000 Foundations',
          currentPrice: 620,
          startingPrice: 500,
          timeLeft: "2h 10m",
          seller: "BaseMakers",
          bidCount: 3,
          tools: ["code", "output", "api"]
        },
        { 
          id: 24, 
          name: "Meta Learning AI",
          type: 'agents',
          category: '000.2 Meta Learning',
          currentPrice: 900,
          startingPrice: 700,
          timeLeft: "3h 40m",
          seller: "MetaGenius",
          bidCount: 5,
          tools: ["chat", "agent", "claude"]
        },
        { 
          id: 25, 
          name: "Knowledge Curator",
          type: 'agents',
          category: '100 Data & Knowledge',
          currentPrice: 480,
          startingPrice: 350,
          timeLeft: "1h 20m",
          seller: "InfoKeepers",
          bidCount: 2,
          tools: ["database", "text", "document"]
        },
        { 
          id: 26, 
          name: "Analytics Pro Bot",
          type: 'agents',
          category: '100.2 Analytics',
          currentPrice: 700,
          startingPrice: 550,
          timeLeft: "2h 55m",
          seller: "InsightfulAI",
          bidCount: 4,
          tools: ["database", "text", "document"]
        },
        { 
          id: 27, 
          name: "Code Generator",
          type: 'agents',
          category: '200.1 Code Generation',
          currentPrice: 800,
          startingPrice: 650,
          timeLeft: "3h 5m",
          seller: "AutoCoder",
          bidCount: 6,
          tools: ["code", "output", "connect"]
        },
        { 
          id: 28, 
          name: "Test Engineer Bot",
          type: 'agents',
          category: '200.2 Testing',
          currentPrice: 600,
          startingPrice: 450,
          timeLeft: "2h 25m",
          seller: "TestMasters",
          bidCount: 3,
          tools: ["code", "output", "connect"]
        },
        { 
          id: 29, 
          name: "Content Writer AI",
          type: 'agents',
          category: '300.1 Writing',
          currentPrice: 400,
          startingPrice: 300,
          timeLeft: "1h 50m",
          seller: "WriteBots",
          bidCount: 2,
          tools: ["text", "document", "output"]
        },
        { 
          id: 30, 
          name: "Media Producer Bot",
          type: 'agents',
          category: '300.2 Audio / Video',
          currentPrice: 950,
          startingPrice: 800,
          timeLeft: "4h 10m",
          seller: "MediaWorks",
          bidCount: 5,
          tools: ["video", "audio", "output"]
        },
        { 
          id: 31, 
          name: "Accountant Bot",
          type: 'agents',
          category: '400.1 Accounting',
          currentPrice: 720,
          startingPrice: 600,
          timeLeft: "2h 35m",
          seller: "LedgerLogic",
          bidCount: 4,
          tools: ["database", "text", "document"]
        },
        { 
          id: 32, 
          name: "Business Analyst AI",
          type: 'agents',
          category: '400.2 Analysis',
          currentPrice: 850,
          startingPrice: 700,
          timeLeft: "3h 15m",
          seller: "BizInsights",
          bidCount: 3,
          tools: ["database", "text", "document"]
        },
        { 
          id: 33, 
          name: "Help Desk Assistant",
          type: 'agents',
          category: '500.1 Help Desk',
          currentPrice: 500,
          startingPrice: 400,
          timeLeft: "1h 45m",
          seller: "SupportBots",
          bidCount: 2,
          tools: ["chat", "text", "output"]
        },
        { 
          id: 34, 
          name: "Lead Generator Bot",
          type: 'agents',
          category: '600.1 Lead Gen',
          currentPrice: 780,
          startingPrice: 650,
          timeLeft: "2h 55m",
          seller: "LeadMakers",
          bidCount: 4,
          tools: ["text", "output", "connect"]
        },
        { 
          id: 35, 
          name: "Campaign Manager AI",
          type: 'agents',
          category: '600.2 Campaigns',
          currentPrice: 900,
          startingPrice: 750,
          timeLeft: "3h 30m",
          seller: "CampaignPros",
          bidCount: 5,
          tools: ["text", "output", "connect"]
        },
        { 
          id: 36, 
          name: "Graphic Designer Bot",
          type: 'agents',
          category: '700.1 Graphic Design',
          currentPrice: 670,
          startingPrice: 550,
          timeLeft: "2h 20m",
          seller: "DesignBots",
          bidCount: 3,
          tools: ["text", "output", "connect"]
        },
        { 
          id: 37, 
          name: "UX Reviewer AI",
          type: 'agents',
          category: '700.2 UX Review',
          currentPrice: 720,
          startingPrice: 600,
          timeLeft: "2h 40m",
          seller: "UXExperts",
          bidCount: 2,
          tools: ["text", "output", "connect"]
        },
        { 
          id: 38, 
          name: "Task Manager Bot",
          type: 'agents',
          category: '800.2 Task Management',
          currentPrice: 540,
          startingPrice: 420,
          timeLeft: "1h 30m",
          seller: "ProductivityPlus",
          bidCount: 3,
          tools: ["text", "output", "connect"]
        },
        { 
          id: 39, 
          name: "Healthcare Specialist AI",
          type: 'agents',
          category: '900.1 Healthcare',
          currentPrice: 1100,
          startingPrice: 900,
          timeLeft: "4h 50m",
          seller: "HealthBots",
          bidCount: 6,
          tools: ["text", "output", "connect"]
        },
        { 
          id: 40, 
          name: "Legal Advisor Bot",
          type: 'agents',
          category: '900.2 Legal',
          currentPrice: 1300,
          startingPrice: 1100,
          timeLeft: "5h 10m",
          seller: "LawAI",
          bidCount: 7,
          tools: ["text", "output", "connect"]
        },
        { 
          id: 41, 
          name: "Generalist Agent",
          type: 'agents',
          category: '000.1 General Purpose',
          currentPrice: 600,
          startingPrice: 500,
          timeLeft: "2h 15m",
          seller: "GenAI",
          bidCount: 4,
          tools: ["text", "output", "connect"]
        }
      ];
      commit('SET_AUCTION_ITEMS', mockListings);
    }
    return state.auctionItems;
  }
};

export default {
  namespaced: true,
  state,
  getters,
  mutations,
  actions
};
