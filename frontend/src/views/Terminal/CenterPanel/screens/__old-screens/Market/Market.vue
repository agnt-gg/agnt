<template>
  <BaseScreen
    ref="baseScreenRef"
    activeRightPanel="MarketPanel"
    screenId="MarketScreen"
    :showInput="false"
    :terminalLines="terminalLines"
    :panelProps="{ selectedItem }"
    @panel-action="handlePanelAction"
    @screen-change="(screenName) => emit('screen-change', screenName)"
    @base-mounted="initializeScreen"
  >
    <template #default>
      <Popup
        :show="popup.show"
        :message="popup.message"
        :type="popup.type"
        :icon="popup.icon"
        :duration="popup.duration"
        @close="popup.show = false"
      />
      <TerminalHeader title="Global Marketplace" subtitle="List, browse, bid on, and buy items in the global marketplace." />
      <BaseTabControls :tabs="tabs" :active-tab="activeTab" :current-layout="currentLayout" @select-tab="selectTab" @set-layout="setLayout" />

      <div class="market-content-layout">
        <aside class="market-sidebar">
          <div v-if="categories.length" class="category-section">
            <div class="category-section-title">Categories</div>
            <ul class="category-list subcategory-list">
              <template v-for="(entry, idx) in categoriesWithSeparators" :key="entry.cat || 'sep-' + idx">
                <li v-if="entry.separator" class="category-separator"></li>
                <li
                  v-else-if="entry.isAll"
                  class="category-item all-agents"
                  :class="{
                    active: !selectedMainCategory && !selectedCategory,
                  }"
                  @click="selectAllAgents"
                >
                  <span
                    ><i class="fas fa-users"></i> All Agents
                    <span v-if="typeof entry.count === 'number'" class="cat-count">({{ entry.count }})</span></span
                  >
                </li>
                <li
                  v-else-if="entry.isMain"
                  :class="[
                    'category-item',
                    'main-category',
                    {
                      'main-active': selectedMainCategory === getMainCategoryCodeFromLabel(entry.cat),
                    },
                  ]"
                  @click="selectCategory(entry.cat, { select: true })"
                >
                  <span class="accordion-arrow" @click.stop="selectCategory(entry.cat, { select: false })">
                    <i :class="openMainCategories[getMainCategoryCodeFromLabel(entry.cat)] ? 'fas fa-chevron-down' : 'fas fa-chevron-right'"></i>
                  </span>
                  <span
                    >{{ entry.cat }} <span v-if="typeof entry.count === 'number'" class="cat-count">({{ entry.count }})</span></span
                  >
                </li>
                <li
                  v-else
                  :class="[
                    'category-item',
                    {
                      active: selectedCategory === entry.cat,
                      subcategory: entry.parent,
                    },
                  ]"
                  @click="selectCategory(entry.cat)"
                >
                  <span>{{ entry.cat }}</span>
                </li>
              </template>
            </ul>
          </div>
        </aside>
        <main class="market-main-content">
          <!-- Table View -->
          <BaseTable
            v-if="currentLayout === 'table'"
            :items="filteredAuctionItems"
            :columns="tableColumns"
            :selected-id="selectedItem?.id"
            :show-search="true"
            search-placeholder="Search items..."
            :search-keys="['name', 'seller', 'currentPrice', 'startingPrice']"
            :no-results-text="'No items found.'"
            @row-click="selectItem"
            @search="handleSearch"
          >
            <template #currentPrice="{ item }"> {{ formatTokens(item.currentPrice) }} Tokens </template>
            <template #startingPrice="{ item }"> {{ formatTokens(item.startingPrice) }} Tokens </template>
          </BaseTable>

          <!-- Grid View -->
          <BaseCardGrid
            v-else
            :items="filteredAuctionItems"
            :columns="tableColumns"
            :selected-id="selectedItem?.id"
            :show-search="true"
            title-key="name"
            search-placeholder="Search items..."
            :search-keys="['name', 'seller', 'currentPrice', 'startingPrice']"
            :no-results-text="'No items found.'"
            @row-click="selectItem"
            @search="handleSearch"
          />
        </main>
      </div>

      <!-- <div class="terminal-lines-container">
        <div
          v-for="(line, index) in terminalLines"
          :key="index"
          class="terminal-line"
        >
          {{ line }}
        </div>
      </div> -->
    </template>
  </BaseScreen>
</template>

<script>
import { ref, computed, onMounted, onUnmounted, nextTick, inject } from 'vue';
import { useStore } from 'vuex';
import BaseScreen from '../../components/LeftPanel/BaseScreen.vue';
import Popup from '../../components/shared/Popup.vue';
import TerminalHeader from '../../components/shared/TerminalHeader.vue';
import BaseTabControls from '../../components/shared/BaseTabControls.vue';
import BaseTable from '../../components/shared/BaseTable.vue';
import BaseCardGrid from '../../components/shared/BaseCardGrid/BaseCardGrid.vue';

export default {
  name: 'Market',
  components: {
    BaseScreen,
    Popup,
    TerminalHeader,
    BaseTabControls,
    BaseTable,
    BaseCardGrid,
  },
  emits: ['screen-change'],
  setup(props, { emit }) {
    const store = useStore();
    const playSound = inject('playSound', () => {});
    const baseScreenRef = ref(null);
    const terminalLines = ref([]);
    const auctionItems = ref([]);
    const selectedItem = ref(null);
    const activeTab = ref('agents'); // Default tab
    const selectedCategory = ref(null); // NEW: selected category for the type
    const currentLayout = ref('grid');
    const popup = ref({
      show: false,
      message: '',
      type: 'success',
      icon: 'fas fa-check-circle',
      duration: 2500,
    });
    const searchQuery = ref('');

    const tabs = [
      { id: 'agents', name: 'Agents', icon: 'fas fa-robot' },
      { id: 'workflows', name: 'Workflows', icon: 'fas fa-project-diagram' },
      { id: 'tools', name: 'Tools', icon: 'fas fa-tools' },
      { id: 'resources', name: 'Resources', icon: 'fas fa-cube' },
      { id: 'upgrades', name: 'Upgrades', icon: 'fas fa-arrow-up' },
    ];

    // Table Columns Definition
    const tableColumns = [
      { key: 'name', label: 'Item', width: '2fr' },
      {
        key: 'currentPrice',
        label: 'Current Price',
        width: '1fr',
        formatter: (v) => `${formatTokens(v)} Tokens`,
      },
      {
        key: 'startingPrice',
        label: 'Starting Price',
        width: '1fr',
        formatter: (v) => `${formatTokens(v)} Tokens`,
      },
      { key: 'timeLeft', label: 'Time Left', width: '1fr' },
      { key: 'seller', label: 'Seller', width: '1fr' },
      { key: 'bidCount', label: 'Bids', width: '0.5fr' },
      // Tools property is used by Card component but not shown as column in table view
      { key: 'tools', label: 'Tools', width: '0fr', visible: false },
    ];

    // Get categories for the current type
    const categories = computed(() => store.getters['market/categoriesByType'](activeTab.value));

    // Main agent categories and their subcategories (in order)
    const mainAgentCategories = [
      { code: '000', label: '000 Foundations' },
      { code: '100', label: '100 Data & Knowledge' },
      { code: '200', label: '200 Software Engineering' },
      { code: '300', label: '300 Content & Media' },
      { code: '400', label: '400 Business & Finance' },
      { code: '500', label: '500 Customer & Ops' },
      { code: '600', label: '600 Sales & Marketing' },
      { code: '700', label: '700 Design & UX' },
      { code: '800', label: '800 Productivity' },
      { code: '900', label: '900 Domain Specialists' },
    ];

    // Helper: get prefix from category string
    function getCategoryPrefix(cat) {
      return cat.split(' ')[0].split('.')[0];
    }
    function isSubcategory(cat) {
      return cat.match(/^\d{3}\.\d/);
    }
    function getMainCategoryCodeFromLabel(label) {
      return label.split(' ')[0];
    }

    // Track if a main category is selected
    const selectedMainCategory = ref(null); // e.g., '100'
    // Track which main categories are open (accordion state)
    const openMainCategories = ref({}); // { '100': true, ... }

    // Select All Agents
    const selectAllAgents = () => {
      selectedMainCategory.value = null;
      selectedCategory.value = null;
      selectedItem.value = null;
      openMainCategories.value = {}; // Close all main categories
      terminalLines.value = [`[Auction House] Viewing all agents (no category filter)`];
      playSound('typewriterKeyPress');
      scrollToBottom();
    };

    // Modified selectCategory for accordion
    const selectCategory = (cat, entry) => {
      // If agents tab and main category clicked (accordion toggle)
      if (activeTab.value === 'agents' && mainAgentCategories.some((m) => m.label === cat)) {
        const code = getMainCategoryCodeFromLabel(cat);
        // Single-open: close all others, toggle this one
        const currentlyOpen = !!openMainCategories.value[code];
        openMainCategories.value = {};
        if (!currentlyOpen) {
          openMainCategories.value[code] = true;
        }
        // If selecting (not just toggling), filter
        if (entry && entry.select) {
          selectedMainCategory.value = code;
          selectedCategory.value = cat;
          selectedItem.value = null;
          terminalLines.value = [`[Auction House] Viewing ${activeTab.value} - ${cat} (All subcategories)`];
          playSound('typewriterKeyPress');
          scrollToBottom();
        }
        return;
      }
      // Otherwise, normal behavior
      selectedMainCategory.value = null;
      selectedCategory.value = cat;
      selectedItem.value = null;
      terminalLines.value = [`[Auction House] Viewing ${activeTab.value} - ${cat}`];
      playSound('typewriterKeyPress');
      scrollToBottom();
    };

    // Modified filteredAuctionItems
    const filteredAuctionItems = computed(() => {
      // All Agents selected
      if (activeTab.value === 'agents' && !selectedMainCategory.value && !selectedCategory.value) {
        return store.state.market.auctionItems.filter((item) => item.type === 'agents');
      }
      let items = store.getters['market/itemsByTypeAndCategory'](activeTab.value, selectedCategory.value === 'All' ? null : selectedCategory.value);
      // If agents tab and a main category is selected, show all items in that main and its subcats
      if (activeTab.value === 'agents' && selectedMainCategory.value) {
        items = store.state.market.auctionItems.filter((item) => {
          return item.type === 'agents' && item.category && item.category.startsWith(selectedMainCategory.value);
        });
      }
      if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        items = items.filter((item) =>
          [item.name, item.seller, String(item.currentPrice), String(item.startingPrice)].some((val) => val && String(val).toLowerCase().includes(q))
        );
      }
      return items;
    });

    // Computed: categories with separators and subcategories (for agents tab, now with accordion)
    const categoriesWithSeparators = computed(() => {
      if (activeTab.value !== 'agents') {
        // For non-agents, just show as before
        return categories.value.map((cat) => ({ cat, separator: false }));
      }
      // Build a map of subcategories for each main
      const allCats = categories.value;
      let result = [];
      // Count agents in each main category
      const agentCounts = {};
      let allAgentsCount = 0;
      mainAgentCategories.forEach((main) => {
        const count = (store.state.market.auctionItems || []).filter(
          (item) => item.type === 'agents' && item.category && item.category.startsWith(main.code)
        ).length;
        agentCounts[main.code] = count;
        allAgentsCount += count;
      });
      // Add All Agents at the top, with count
      result.push({
        cat: 'All Agents',
        isAll: true,
        separator: false,
        count: allAgentsCount,
      });
      // Render main categories in the order of mainAgentCategories
      mainAgentCategories.forEach((main, idx) => {
        if (idx > 0) result.push({ separator: true });
        // Main category entry, with count
        result.push({
          cat: main.label,
          isMain: true,
          separator: false,
          code: main.code,
          count: agentCounts[main.code],
        });
        // Subcategories (only if open), sorted alphabetically for consistency
        const subs = allCats
          .filter((cat) => {
            return isSubcategory(cat) && cat.startsWith(main.code + '.');
          })
          .sort();
        if (openMainCategories.value[main.code]) {
          subs.forEach((sub) => {
            result.push({
              cat: sub,
              isMain: false,
              separator: false,
              parent: main.code,
            });
          });
        }
      });
      return result;
    });

    const scrollToBottom = () => baseScreenRef.value?.scrollToBottom();

    const formatTokens = (amount) => {
      return new Intl.NumberFormat().format(amount);
    };

    const setLayout = (layout) => {
      currentLayout.value = layout;
    };

    const selectItem = (item) => {
      selectedItem.value = item;
      terminalLines.value = [`Selected item: ${item.name}`];
      terminalLines.value.push(`Current price: ${formatTokens(item.currentPrice)} Tokens`);
      terminalLines.value.push(`Time remaining: ${item.timeLeft}`);
      scrollToBottom();
    };

    const selectTab = (tabId) => {
      activeTab.value = tabId;
      selectedCategory.value = null; // Reset category when changing type
      selectedItem.value = null;
      terminalLines.value = [`[Auction House] Viewing ${tabId} marketplace`];
      scrollToBottom();
    };

    const refreshAuctions = async () => {
      terminalLines.value = ['[Auction House] Refreshing auction data...'];
      try {
        const items = await store.dispatch('market/getAuctionListings');
        auctionItems.value = items;
        terminalLines.value.push('[Auction House] Auction list updated.');
      } catch (error) {
        terminalLines.value.push(`[Auction House] Error refreshing auctions: ${error.message}`);
        console.error('Error fetching auctions:', error);
      }
      await nextTick();
      scrollToBottom();
    };

    const displayTransactions = async () => {
      terminalLines.value = ['[Auction House] Fetching transaction history...'];
      try {
        const transactions = store.getters['market/transactions'];

        if (!Array.isArray(transactions)) {
          console.error('Error: market/transactions getter did not return an array.', transactions);
          terminalLines.value.push('[Auction House] Error retrieving transaction history data.');
          await nextTick();
          scrollToBottom();
          return;
        }

        if (transactions.length === 0) {
          terminalLines.value.push('[Auction House] No transaction history found.');
        } else {
          terminalLines.value.push(
            '[Auction House] Transaction History:',
            ...transactions.map((tx) => {
              const date = new Date(tx.timestamp).toLocaleString();
              switch (tx.type) {
                case 'bid_placed':
                  return `- Bid ${formatTokens(tx.amount)} Tokens on item '${tx.itemName || tx.itemId}' (${date})`;
                case 'auction_created':
                  return `- Created auction '${tx.itemName || tx.itemId}' starting at ${formatTokens(tx.price)} Tokens (${date})`;
                case 'auction_won':
                  return `- Won auction '${tx.itemName || tx.itemId}' for ${formatTokens(tx.amount)} Tokens (${date})`;
                case 'auction_sold':
                  return `- Sold item '${tx.itemName || tx.itemId}' for ${formatTokens(tx.amount)} Tokens (${date})`;
                default:
                  return `- Event: ${tx.type}, Details: ${JSON.stringify(tx.details || tx)} (${date})`;
              }
            })
          );
        }
      } catch (error) {
        terminalLines.value.push(`[Auction House] Error processing history: ${error.message}`);
        console.error('Error processing transaction history:', error);
      }
      await nextTick();
      scrollToBottom();
    };

    const handlePanelAction = async (action, payload) => {
      console.log('Market: Handling panel action:', action, payload);
      switch (action) {
        case 'clear-selection':
          selectedItem.value = null;
          break;
        case 'refresh-auctions':
          selectedItem.value = null;
          await refreshAuctions();
          break;
        case 'create-auction':
          terminalLines.value = ['[Auction House] Creating auction...'];
          selectedItem.value = null;
          try {
            const { name, startingPrice, duration, description } = payload;
            await store.dispatch('market/createAuction', {
              name,
              startingPrice,
              duration,
              description,
            });
            terminalLines.value.push(
              `[Auction House] Successfully created auction for ${name}`,
              `Starting price: ${formatTokens(startingPrice)} Tokens`,
              `Duration: ${duration}`
            );
            await refreshAuctions();
          } catch (error) {
            terminalLines.value.push(`[Auction House] Error creating auction: ${error.message}`);
            console.error('Error creating auction:', error);
          }
          await nextTick();
          scrollToBottom();
          break;
        case 'show-history':
          displayTransactions();
          break;
        case 'place-bid':
          if (payload && selectedItem.value) {
            terminalLines.value = [`[Auction House] Placing bid on ${selectedItem.value.name}...`];
            try {
              const itemId = selectedItem.value.id;
              await store.dispatch('market/placeBid', {
                itemId,
                bidAmount: payload,
              });
              selectedItem.value.currentPrice = payload;
              selectedItem.value.bidCount++;
              const itemIndex = auctionItems.value.findIndex((item) => item.id === itemId);
              if (itemIndex !== -1) {
                auctionItems.value[itemIndex] = { ...selectedItem.value };
              }
              terminalLines.value.push(`[Auction House] Successfully placed bid of ${formatTokens(payload)} Tokens on ${selectedItem.value.name}`);
              // Show popup notification
              popup.value = {
                show: true,
                message: `Bid placed on ${selectedItem.value.name}!`,
                type: 'success',
                icon: 'fas fa-gavel',
                duration: 2500,
              };
            } catch (error) {
              terminalLines.value.push(`[Auction House] Error placing bid: ${error.message}`);
              console.error('Error placing bid:', error);
              // Show error popup
              popup.value = {
                show: true,
                message: `Error placing bid: ${error.message}`,
                type: 'error',
                icon: 'fas fa-times-circle',
                duration: 3500,
              };
            }
          } else {
            terminalLines.value.push(`[Auction House] Cannot place bid: No item selected or invalid bid amount.`);
          }
          await nextTick();
          scrollToBottom();
          break;
        default:
          console.warn('Unhandled panel action in Market.vue:', action);
      }
    };

    const initializeScreen = async () => {
      selectedItem.value = null;
      terminalLines.value = ['Welcome to the Auction House!', '-----------------------------------', 'Loading auction data...'];

      await refreshAuctions();
      try {
        // Get balance from userStats module
        const balance = store.state.userStats.tokens;
        terminalLines.value.push('-----------------------------------', `Your current balance: ${formatTokens(balance)} Tokens`);
      } catch (error) {
        terminalLines.value.push(`[Auction House] Error fetching balance: ${error.message}`);
        console.error('Error fetching balance:', error);
      }

      await nextTick();
      scrollToBottom();
    };

    const handleSearch = (query) => {
      searchQuery.value = query;
    };

    onMounted(() => {
      console.log('Market Screen Mounted');
      document.body.setAttribute('data-page', 'terminal-market');
    });

    onUnmounted(() => {
      console.log('Market Screen Unmounted');
      selectedItem.value = null;
    });

    return {
      baseScreenRef,
      terminalLines,
      auctionItems,
      selectedItem,
      handlePanelAction,
      selectItem,
      formatTokens,
      emit,
      initializeScreen,
      tabs,
      activeTab,
      selectTab,
      filteredAuctionItems,
      popup,
      currentLayout,
      setLayout,
      tableColumns,
      handleSearch,
      searchQuery,
      categories,
      selectedCategory,
      selectCategory,
      categoriesWithSeparators,
      selectedMainCategory,
      openMainCategories,
      selectAllAgents,
      getMainCategoryCodeFromLabel,
    };
  },
};
</script>

<style scoped>
.terminal-line {
  /* line-height: 1.3; */
  /* margin: 4px 0; */
  /* white-space: pre-wrap; */
  word-break: break-word;
  color: var(--color-grey);
}

.auction-table {
  width: calc(100% - 2px);
  border: 1px solid rgba(25, 239, 131, 0.4);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  margin-bottom: 16px;
}

.table-header {
  display: grid;
  grid-template-columns: minmax(150px, 2fr) repeat(4, minmax(80px, 1fr)) minmax(50px, 0.5fr);
  background: rgba(25, 239, 131, 0.1);
  padding: 10px 8px;
  font-weight: 400;
  color: var(--color-green);
  border-bottom: 1px solid rgba(25, 239, 131, 0.4);
}

.table-body {
  max-height: calc(100vh - 350px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--color-green) var(--color-dark-navy);
}
.table-body::-webkit-scrollbar {
  width: 6px;
}
.table-body::-webkit-scrollbar-track {
  background: rgba(25, 239, 131, 0.05);
}
.table-body::-webkit-scrollbar-thumb {
  background-color: var(--color-green);
  border-radius: 3px;
}

.table-row {
  display: grid;
  grid-template-columns: minmax(150px, 2fr) repeat(4, minmax(80px, 1fr)) minmax(50px, 0.5fr);
  padding: 10px 8px;
  border-top: 1px solid rgba(25, 239, 131, 0.2);
  cursor: pointer;
  transition: background-color 0.2s;
  color: var(--color-light-green);
}

.table-row:first-child {
  border-top: none;
}

.table-row.selected {
  background: rgba(25, 239, 131, 0.15);
  border-left: 3px solid var(--color-green);
  padding-left: 5px;
}

.table-row:not(.selected):hover {
  background: rgba(25, 239, 131, 0.08);
}

[class^='col-'] {
  padding: 0 8px;
  display: flex;
  align-items: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-price,
.col-start {
  justify-content: flex-end;
}
.col-bids {
  justify-content: center;
}

.terminal-lines-container {
  flex-grow: 1;
  overflow-y: auto;
  padding-top: 10px;
  border-top: 1px dashed rgba(25, 239, 131, 0.2);
  scrollbar-width: thin;
  scrollbar-color: var(--color-green) var(--color-dark-navy);
}
.terminal-lines-container::-webkit-scrollbar {
  width: 6px;
}
.terminal-lines-container::-webkit-scrollbar-track {
  background: rgba(25, 239, 131, 0.05);
}
.terminal-lines-container::-webkit-scrollbar-thumb {
  background-color: var(--color-green);
  border-radius: 3px;
}

input.hidden-input {
  display: none !important;
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
  text-shadow: 0 0 5px rgba(25, 239, 131, 0.4);
}
.font-bold {
  font-weight: bold;
}
.text-xl {
  font-size: 1.25rem;
}

.market-content-layout {
  display: flex;
  flex-direction: row;
  width: 100%;
  height: calc(100% - 64px);
  overflow: hidden;
}

.market-sidebar {
  width: 240px;
  padding: 8px;
  padding-left: 0;
  padding-right: 16px;
  background-color: transparent;
  border-right: 1px solid rgba(25, 239, 131, 0.2);
  font-size: smaller;
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: calc(100% - 16px);
  z-index: 2;
  overflow: scroll;
  scrollbar-width: none;
}

.category-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
  align-content: flex-start;
  justify-content: flex-start;
  align-items: stretch;
  gap: 4px;
}

.category-section-title {
  margin-bottom: 2px;
}

.category-item {
  padding: 8px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.category-item:hover {
  background-color: rgba(25, 239, 131, 0.1);
}

.category-item.active {
  background-color: rgba(25, 239, 131, 0.15);
  color: #ffffff !important;
}

.category-icon {
  margin-right: 8px;
}

.market-main-content {
  flex: 1;
  padding: 16px;
  padding-right: 0;
  padding-top: 0;
  height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
}

.category-separator {
  display: none;
  border-top: 1.5px solid var(--color-green);
  margin: 8px 0 4px 0;
  height: 0;
  list-style: none;
}

.main-category {
  font-weight: bold;
  color: var(--color-green);
  background: rgba(25, 239, 131, 0.07);
}
.main-active {
  background: rgba(25, 239, 131, 0.18) !important;
  color: #ffffff !important;
}

.all-agents {
  font-weight: bold;
  color: var(--color-green);
  background: rgba(25, 239, 131, 0.13);
  border-radius: 4px;
  margin-bottom: 4px;
}
.accordion-arrow {
  display: inline-block;
  width: 18px;
  text-align: center;
  margin-right: 4px;
  cursor: pointer;
  color: var(--color-green);
}
.subcategory {
  padding-left: 24px;
  font-style: italic;
  color: var(--color-light-green);
}

.cat-count {
  color: var(--color-light-green);
  font-weight: normal;
  margin-left: 4px;
  font-size: 0.95em;
}
</style>
