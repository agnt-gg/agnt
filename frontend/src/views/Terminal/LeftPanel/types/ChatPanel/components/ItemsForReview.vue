<template>
  <div class="dashboard-section items-for-review">
    <h3 class="section-title">ITEMS FOR REVIEW</h3>

    <div class="review-list">
      <div
        v-for="item in itemsForReview"
        :key="item.id"
        class="review-item-card"
        :class="`status-${item.status.toLowerCase()}`"
        @click="reviewItem(item)"
      >
        <div class="review-item-icon">
          <span v-if="item.status === 'Urgent'">⚠️</span>
          <span v-else-if="item.status === 'Pending'">⏳</span>
          <span v-else>ℹ️</span>
        </div>
        <div class="review-item-info">
          <span class="review-item-title">{{ item.title }}</span>
          <span class="review-item-description">{{ item.description }}</span>
        </div>
        <button class="review-item-action">Review</button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from "vue";

export default {
  name: "ItemsForReview",
  emits: ["review-item"],
  setup(props, { emit }) {
    const itemsForReview = ref([
      {
        id: 3,
        title: "Draft Review: Q3 Marketing Summary",
        description:
          "AI Agent Scribe has drafted the Q3 marketing summary. Please review for accuracy.",
        status: "Pending",
        type: "review",
      },
    ]);

    const reviewItem = (item) => {
      emit("review-item", {
        itemId: item.id,
        itemType: item.type,
      });
      console.log("Reviewing item:", item);
    };

    return {
      itemsForReview,
      reviewItem,
    };
  },
};
</script>

<style scoped>
.dashboard-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 0.75em;
  font-weight: 500;
  color: var(--color-duller-navy);
  letter-spacing: 0.2em;
  margin-bottom: 16px;
  font-family: system-ui, -apple-system, sans-serif;
}

.review-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.review-item-card {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 16px;
  background: rgba(127, 129, 147, 0.05);
  border: 1px solid var(--color-duller-navy);
  border-radius: 8px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.review-item-card:hover {
  background: rgba(127, 129, 147, 0.08);
  border-color: var(--color-med-navy);
  transform: translateY(-1px);
}

.review-item-icon {
  font-size: 1.4em;
}

.review-item-card.status-urgent .review-item-icon {
  color: var(--color-red);
}

.review-item-card.status-pending .review-item-icon {
  color: var(--color-yellow);
}

.review-item-info {
  display: flex;
  flex-direction: column;
}

.review-item-title {
  font-size: 0.9em;
  color: var(--color-light-med-navy);
  font-weight: 500;
}

.review-item-description {
  font-size: 0.8em;
  color: var(--color-med-navy);
  margin-top: 2px;
}

.review-item-action {
  background: var(--color-green);
  color: var(--color-dark-navy);
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.8em;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.review-item-action:hover {
  opacity: 0.5;
}
</style> 