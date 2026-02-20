<template>
  <div class="ui-panel market-panel">
    <!-- Compact Header -->
    <!-- <div class="market-header">
      <div class="balance-display">
        <span class="label">Balance:</span>
        <span class="value">{{ formatTokens(balance) }} Tokens</span>
      </div>
      <div class="header-actions">
        <BaseButton @click="handleAction('refresh')" variant="secondary" size="small">
          <i class="fas fa-sync-alt"></i> Refresh
        </BaseButton>
         <BaseButton @click="handleAction('history')" variant="secondary" size="small">
          <i class="fas fa-history"></i> History
        </BaseButton>
      </div>
    </div> -->

    <!-- Create Auction Toggle & Form -->
    <div class="create-section">
      <BaseButton
        @click="toggleCreateForm"
        full-width
        :variant="showCreateForm ? 'danger' : 'primary'"
      >
        <i :class="showCreateForm ? 'fas fa-times' : 'fas fa-plus'"></i>
        {{ showCreateForm ? "Cancel Creation" : "Create New Auction" }}
      </BaseButton>

      <BaseForm v-if="showCreateForm" class="auction-form market-section" @submit="createAuction">
        <BaseInput
          id="itemName"
          label="Item Name"
          v-model="newAuction.name"
          type="text"
          placeholder="Enter item name"
        />
        <BaseInput
          id="startingPrice"
          label="Starting Price (Tok)"
          v-model="newAuction.startingPrice"
          type="number"
          min="1"
          placeholder="Enter starting price"
        />
        <BaseSelect
          id="duration"
          label="Duration"
          v-model="newAuction.duration"
          :options="durationOptions"
        />
        <BaseTextarea
          id="description"
          label="Description (Optional)"
          v-model="newAuction.description"
          placeholder="Enter item description"
          :rows="3"
        />
        <div class="form-actions">
          <BaseButton
            type="submit"
            :disabled="!isFormValid"
            variant="primary"
            full-width
          >
            <i class="fas fa-gavel"></i> Create Auction
          </BaseButton>
        </div>
      </BaseForm>
    </div>

    <!-- Selected Item - More prominent -->
    <div v-if="selectedItem" class="market-section selected-item-section">
      <h2>Selected Item Details</h2>
      <div class="selected-item-content">
        <div class="item-details">
          <div class="detail-row main-detail">
            <span class="label"><i class="fas fa-cube"></i> Item:</span>
            <span class="value name">{{ selectedItem.name }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-tag"></i> Current Price:</span>
            <span class="value price">{{ formatTokens(selectedItem.currentPrice) }} Tokens</span>
          </div>
          <div class="detail-row">
            <span class="label"
              ><i class="fas fa-hourglass-half"></i> Time Left:</span
            >
            <span class="value">{{ selectedItem.timeLeft }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-user"></i> Seller:</span>
            <span class="value">{{ selectedItem.seller }}</span>
          </div>
          <div class="detail-row">
            <span class="label"><i class="fas fa-users"></i> Bids:</span>
            <span class="value">{{ selectedItem.bidCount }}</span>
          </div>
        </div>
        <div class="bid-section">
          <label for="bidAmountInput">Your Bid (Min: {{ formatTokens(selectedItem.currentPrice + 1) }} Tokens)</label>
          <div class="bid-input">
            <input
              id="bidAmountInput"
              v-model="bidAmount"
              type="number"
              :min="selectedItem.currentPrice + 1"
              placeholder="Enter bid amount"
              class="input"
            />
            <BaseButton
              @click="placeBid"
              variant="primary"
              :disabled="!isValidBid"
              size="large"
            >
              <i class="fas fa-gavel"></i> Place Bid
            </BaseButton>
          </div>
          <div
            v-if="!isValidBid && bidAmount && bidAmount > 0"
            class="bid-error"
          >
            Bid must be higher than current price.
          </div>
          <div v-if="isValidBid && !isSufficientBalance" class="bid-error">
            Insufficient balance.
          </div>
        </div>
      </div>
    </div>
    <!-- Placeholder: Show only if NO item is selected AND the create form is NOT shown -->
    <div
      v-else-if="!selectedItem && !showCreateForm"
      class="market-section placeholder-section"
    >
      <p>
        Select an item from the list on the left to view details and place a
        bid.
      </p>
    </div>
    <!-- Implicit else: Nothing is shown here if selectedItem is null AND showCreateForm is true -->
  </div>
</template>

<script>
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "vuex";
import BaseButton from "../../../shared/BaseButton.vue";
import BaseForm from "../../../shared/BaseForm.vue";
import BaseInput from "../../../shared/BaseInput.vue";
import BaseSelect from "../../../shared/BaseSelect.vue";
import BaseTextarea from "../../../shared/BaseTextarea.vue";

export default {
  name: "MarketPanel",
  components: {
    BaseButton,
    BaseForm,
    BaseInput,
    BaseSelect,
    BaseTextarea,
  },
  props: {
    selectedItem: {
      type: Object,
      default: () => null,
    },
  },
  emits: ["panel-action"],
  setup(props, { emit }) {
    const store = useStore();

    // State
    const balance = ref(0);
    // itemCount is no longer displayed directly, can be removed if not used elsewhere
    // const itemCount = ref(0);
    const bidAmount = ref("");
    const showCreateForm = ref(false);
    const newAuction = ref({
      name: "",
      startingPrice: null,
      duration: "24h",
      description: "",
    });

    // Add options for duration select
    const durationOptions = [
      { value: "1h", label: "1 Hour" },
      { value: "6h", label: "6 Hours" },
      { value: "12h", label: "12 Hours" },
      { value: "24h", label: "24 Hours" },
      { value: "48h", label: "48 Hours" },
      { value: "72h", label: "72 Hours" },
    ];

    // Computed
    const minimumBid = computed(() => {
      return props.selectedItem ? props.selectedItem.currentPrice + 1 : 1;
    });

    const isValidBidAmount = computed(() => {
      if (!bidAmount.value || !props.selectedItem) return false;
      const bidValue = parseInt(bidAmount.value);
      return !isNaN(bidValue) && bidValue >= minimumBid.value;
    });

    const isSufficientBalance = computed(() => {
      if (!bidAmount.value || !isValidBidAmount.value) return true; // Don't show error if bid is invalid anyway
      return parseInt(bidAmount.value) <= balance.value;
    });

    // Combined validation for enabling the bid button
    const isValidBid = computed(() => {
      return isValidBidAmount.value && isSufficientBalance.value;
    });

    const isFormValid = computed(() => {
      const { name, startingPrice, duration } = newAuction.value;
      // Ensure startingPrice is a positive number
      const price = Number(startingPrice);
      return (
        name.trim() !== "" && !isNaN(price) && price > 0 && duration !== ""
      );
    });

    // Methods
    const handleAction = (action) => {
      switch (action) {
        case "refresh":
          emit("panel-action", "refresh-auctions");
          break;
        case "history":
          // Emit clear selection before showing history
          emit("panel-action", "clear-selection");
          emit("panel-action", "show-history");
          break;
        default:
          console.warn("Unhandled MarketPanel action:", action);
      }
    };

    const toggleCreateForm = () => {
      // If opening the form, clear the selected item display
      if (!showCreateForm.value) {
        emit("panel-action", "clear-selection");
      }
      showCreateForm.value = !showCreateForm.value;

      if (!showCreateForm.value) {
        // Reset form when closing
        newAuction.value = {
          name: "",
          startingPrice: null,
          duration: "24h",
          description: "",
        };
      }
    };

    const createAuction = async () => {
      if (!isFormValid.value) return;

      // Emit clear selection *before* emitting create-auction maybe?
      // Or assume Market.vue handles selection state appropriately after creation?
      // Let's keep it simple: clearing selection happens when toggling the form *open*.
      // If creation is successful, the list will refresh anyway.

      emit("panel-action", "create-auction", {
        ...newAuction.value,
        startingPrice: Number(newAuction.value.startingPrice),
      });

      // Reset form and hide it
      // Note: toggleCreateForm is called *after* emitting, so the form closes.
      // If we wanted to keep the form open on error, logic would need adjustment.
      toggleCreateForm();
    };

    const formatTokens = (amount) => {
      if (amount === null || typeof amount === "undefined") {
        return "N/A";
      }
      return new Intl.NumberFormat().format(amount);
    };

    const placeBid = async () => {
      if (!isValidBid.value) return;
      // Clear bid amount immediately for better UX
      const bidValue = parseInt(bidAmount.value);
      bidAmount.value = "";
      emit("panel-action", "place-bid", bidValue);
    };

    // Fetch initial data
    const fetchData = async () => {
      try {
        // Fetch balance and potentially initial item count if needed elsewhere
        balance.value = await store.dispatch("market/getBalance");
        // itemCount.value = await store.dispatch('market/getItemCount'); // Only if needed
      } catch (error) {
        console.error("Failed to load initial market data:", error);
        // Optionally show an error message to the user
      }
    };

    // Lifecycle
    onMounted(fetchData);

    // Watch for external balance changes (e.g., after placing a bid)
    watch(
      () => store.state.market.balance,
      (newBalance) => {
        if (typeof newBalance === "number") {
          balance.value = newBalance;
        }
      }
    );

    // Reset bid amount AND ensure create form is closed when selected item changes
    watch(
      () => props.selectedItem,
      (newItem) => {
        bidAmount.value = "";
        // If a new item is selected, ensure the create form is closed
        if (newItem && showCreateForm.value) {
          showCreateForm.value = false; // Directly close it without toggling logic
          // Reset form fields as well if closing this way
          newAuction.value = {
            name: "",
            startingPrice: null,
            duration: "24h",
            description: "",
          };
        }
      },
      { immediate: true }
    ); // Use immediate to potentially close form on initial load if item selected

    // Watch for actions that might affect balance and refetch
    // (This depends on how state updates are handled after actions)
    // Example: Re-fetch balance after creating an auction if there's a fee
    // watch(() => store.state.market.lastActionTimestamp, fetchData);

    return {
      balance,
      // itemCount, // Removed from template
      bidAmount,
      isValidBid,
      isValidBidAmount, // Keep for error message logic
      isSufficientBalance, // Keep for error message logic
      minimumBid,
      handleAction,
      formatTokens,
      placeBid,
      // selectedItem: computed(() => props.selectedItem), // Prop is already reactive
      // New form-related
      showCreateForm,
      newAuction,
      isFormValid,
      toggleCreateForm,
      createAuction,
      durationOptions,
    };
  },
};
</script>

<style scoped>
/* Add Font Awesome if not already global */
/* @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css'); */

.ui-panel.market-panel {
  display: flex;
  flex-direction: column;
  gap: 16px; /* Reduced gap */
}

/* Compact Header */
.market-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 10px; /* Reduced padding */
  border-bottom: 1px solid rgba(var(--green-rgb), 0.2);
  margin-bottom: 5px; /* Reduced margin */
}

.balance-display .label {
  color: var(--color-grey);
  font-size: 0.9em;
  margin-right: 5px;
}

.balance-display .value {
  color: var(--color-green);
  font-size: 1.1em;
  font-weight: bold;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.header-actions .BaseButton i {
  margin-right: 4px;
}

/* Create Section */
.create-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.create-section .BaseButton i {
  margin-right: 6px;
}

/* Common Section Styling */
.market-section {
  border: 1px solid rgba(var(--green-rgb), 0.2);
  /* border-radius: 8px; */
  padding: 15px;
  /* background-color: rgba(10, 25, 47, 0.3); */
  box-shadow: 0 0 8px rgba(var(--green-rgb), 0.3);
}

.market-section h2 {
  color: var(--color-green);
  font-size: 1.1em;
  margin: 0 0 15px 0;
  border-bottom: 1px solid rgba(var(--green-rgb), 0.1);
  padding-bottom: 8px;
}

/* Auction Form Specifics */
.auction-form {
  display: flex;
  flex-direction: column;
  gap: 12px; /* Slightly reduced gap */
  margin-top: 10px; /* Space below toggle button */
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 5px; /* Reduced gap */
}

.form-field label {
  color: var(--color-grey);
  font-size: 0.85em; /* Smaller label */
}

.form-actions {
  margin-top: 5px; /* Reduced margin */
  width: 100%;
}

/* Selected Item Section */
.selected-item-section {
  /* border-color: var(--color-green); */
  box-shadow: 0 0 8px rgba(var(--green-rgb), 0.3);
}

.selected-item-content {
  display: flex;
  flex-direction: column;
  gap: 18px; /* Increased gap */
}

.item-details {
  display: flex;
  flex-direction: column;
  gap: 10px; /* Increased gap */
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.95em;
}

.detail-row .label {
  color: var(--color-grey);
  display: flex;
  align-items: center;
  gap: 6px;
}
.detail-row .label i {
  width: 14px; /* Ensure icons align nicely */
  text-align: center;
  color: var(--color-light-green);
}

.detail-row .value {
  color: var(--color-light-green);
  text-align: right;
}
.detail-row .value.name {
  font-weight: bold;
  color: var(--color-white);
  font-size: 1.1em;
  text-wrap-mode: nowrap;
}
.detail-row .value.price {
  font-weight: bold;
  color: var(--color-green);
  font-size: 1.05em;
}

.main-detail {
  margin-bottom: 5px; /* Extra space below item name */
}

/* Bid Section */
.bid-section {
  margin-top: 5px; /* Reduced margin */
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed rgba(var(--green-rgb), 0.2);
  padding-top: 15px;
}

.bid-section label {
  color: var(--color-grey);
  font-size: 0.9em;
  margin-bottom: -4px; /* Tighten space below label */
}

.bid-input {
  display: flex;
  gap: 8px;
  align-items: stretch; /* Make button height match input */
}

.bid-input .input {
  flex-grow: 1; /* Input takes available space */
}
.bid-input .BaseButton {
  flex-shrink: 0; /* Prevent button from shrinking */
  padding-left: 15px;
  padding-right: 15px;
}
.bid-input .BaseButton i {
  margin-right: 6px;
}

.input {
  background: rgba(var(--green-rgb), 0.1);
  border: 1px solid rgba(var(--green-rgb), 0.3); /* Slightly stronger border */
  color: var(--color-light-green);
  padding: 10px 12px; /* More padding */
  border-radius: 4px;
  width: 100%;
  font-size: 1em;
}

.input:focus {
  outline: none;
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.15);
}

/* Style number input appearance */
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type="number"] {
  -moz-appearance: textfield;
}

.bid-error {
  color: var(--color-red);
  font-size: 0.9em;
  margin-top: -4px; /* Pull error message up */
}

/* Placeholder when no item selected */
.placeholder-section {
  text-align: center;
  color: var(--color-grey);
  padding: 30px 15px;
  border-style: dashed;
}

textarea.input {
  resize: vertical;
  min-height: 60px; /* Shorter default */
  font-family: inherit;
  font-size: 0.95em;
}

select.input {
  appearance: none;
  background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2319EF83%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
  background-repeat: no-repeat;
  background-position: right 0.7rem top 50%;
  background-size: 0.65rem auto;
  padding-right: 2rem;
}
</style>
