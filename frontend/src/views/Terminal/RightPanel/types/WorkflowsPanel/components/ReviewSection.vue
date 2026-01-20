<template>
  <div class="review-section">
    <div class="section-header">
      <h3>Reviews & Ratings</h3>
      <div class="overall-rating">
        <div class="stars">
          <i v-for="n in 5" :key="n" :class="n <= Math.round(averageRating) ? 'fas fa-star filled' : 'far fa-star'"></i>
        </div>
        <span class="rating-text">{{ averageRating.toFixed(1) }} ({{ reviews.length }} reviews)</span>
      </div>
    </div>

    <!-- Submit Review Form -->
    <div v-if="!userReview && canReview" class="submit-review-form">
      <h4>Write a Review</h4>
      <div class="rating-input">
        <label>Your Rating:</label>
        <div class="star-rating-input">
          <i
            v-for="n in 5"
            :key="n"
            :class="n <= newReview.rating ? 'fas fa-star' : 'far fa-star'"
            @click="newReview.rating = n"
            @mouseover="hoverRating = n"
            @mouseleave="hoverRating = 0"
          ></i>
        </div>
      </div>
      <input v-model="newReview.title" type="text" placeholder="Review title (optional)" class="review-title-input" />
      <textarea
        v-model="newReview.review_text"
        placeholder="Share your experience with this workflow..."
        class="review-text-input"
        rows="4"
      ></textarea>
      <div class="review-actions">
        <button @click="submitReview" :disabled="!newReview.rating" class="submit-review-btn">
          <i class="fas fa-paper-plane"></i>
          Submit Review
        </button>
      </div>
    </div>

    <!-- User's Existing Review -->
    <div v-else-if="userReview" class="user-review">
      <div class="review-header">
        <h4>Your Review</h4>
        <button @click="deleteUserReview" class="delete-review-btn">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <div class="stars">
        <i v-for="n in 5" :key="n" :class="n <= userReview.rating ? 'fas fa-star filled' : 'far fa-star'"></i>
      </div>
      <p v-if="userReview.title" class="review-title">{{ userReview.title }}</p>
      <p class="review-text">{{ userReview.review_text }}</p>
      <p class="review-date">{{ formatDate(userReview.created_at) }}</p>
    </div>

    <!-- Reviews List -->
    <div class="reviews-list">
      <div v-for="review in otherReviews" :key="review.id" class="review-item">
        <div class="review-header">
          <div class="reviewer-info">
            <span class="reviewer-name">{{ review.user_name || 'Anonymous' }}</span>
            <Tooltip v-if="review.verified_purchase" text="Verified Purchase" width="auto">
              <span class="verified-badge">
                <i class="fas fa-check-circle"></i>
                Verified
              </span>
            </Tooltip>
          </div>
          <div class="stars">
            <i v-for="n in 5" :key="n" :class="n <= review.rating ? 'fas fa-star filled' : 'far fa-star'"></i>
          </div>
        </div>
        <p v-if="review.title" class="review-title">{{ review.title }}</p>
        <p class="review-text">{{ review.review_text }}</p>
        <div class="review-footer">
          <span class="review-date">{{ formatDate(review.created_at) }}</span>
          <div class="review-votes">
            <button @click="voteReview(review.id, 'helpful')" class="vote-btn">
              <i class="fas fa-thumbs-up"></i>
              {{ review.helpful_count || 0 }}
            </button>
            <button @click="voteReview(review.id, 'unhelpful')" class="vote-btn">
              <i class="fas fa-thumbs-down"></i>
              {{ review.unhelpful_count || 0 }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="reviews.length === 0" class="no-reviews">
      <i class="fas fa-comment-slash"></i>
      <p>No reviews yet. Be the first to review this workflow!</p>
    </div>
  </div>
</template>

<script>
import { ref, computed } from 'vue';
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ReviewSection',
  components: {
    Tooltip,
  },
  props: {
    workflowId: {
      type: String,
      required: true,
    },
    reviews: {
      type: Array,
      default: () => [],
    },
    canReview: {
      type: Boolean,
      default: false,
    },
    currentUserId: {
      type: String,
      default: null,
    },
  },
  emits: ['submit-review', 'delete-review', 'vote-review'],
  setup(props, { emit }) {
    const newReview = ref({
      rating: 0,
      title: '',
      review_text: '',
    });
    const hoverRating = ref(0);

    const averageRating = computed(() => {
      if (props.reviews.length === 0) return 0;
      const sum = props.reviews.reduce((acc, review) => acc + review.rating, 0);
      return sum / props.reviews.length;
    });

    const userReview = computed(() => {
      return props.reviews.find((r) => r.user_id === props.currentUserId);
    });

    const otherReviews = computed(() => {
      return props.reviews.filter((r) => r.user_id !== props.currentUserId);
    });

    const submitReview = () => {
      if (!newReview.value.rating) return;

      emit('submit-review', {
        marketplace_workflow_id: props.workflowId,
        rating: newReview.value.rating,
        title: newReview.value.title,
        review_text: newReview.value.review_text,
      });

      // Reset form
      newReview.value = {
        rating: 0,
        title: '',
        review_text: '',
      };
    };

    const deleteUserReview = () => {
      if (userReview.value) {
        emit('delete-review', userReview.value.id);
      }
    };

    const voteReview = (reviewId, voteType) => {
      emit('vote-review', { reviewId, voteType });
    };

    const formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    return {
      newReview,
      hoverRating,
      averageRating,
      userReview,
      otherReviews,
      submitReview,
      deleteUserReview,
      voteReview,
      formatDate,
    };
  },
};
</script>

<style scoped>
.review-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--terminal-border-color);
}

.section-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.overall-rating {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stars {
  display: flex;
  gap: 2px;
}

.stars i {
  font-size: 12px;
  color: var(--color-text-muted);
}

.stars i.filled {
  color: var(--color-yellow);
}

.rating-text {
  font-size: 12px;
  color: var(--color-text-muted);
}

/* Submit Review Form */
.submit-review-form {
  background: rgba(25, 239, 131, 0.05);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 12px;
}

.submit-review-form h4 {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 12px 0;
}

.rating-input {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.rating-input label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.star-rating-input {
  display: flex;
  gap: 4px;
}

.star-rating-input i {
  font-size: 16px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.2s ease;
}

.star-rating-input i.fas {
  color: var(--color-yellow);
}

.star-rating-input i:hover {
  transform: scale(1.2);
}

.review-title-input,
.review-text-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 6px;
  color: var(--color-text);
  font-size: 12px;
  margin-bottom: 8px;
  font-family: inherit;
}

.review-text-input {
  resize: vertical;
  min-height: 80px;
}

.review-title-input:focus,
.review-text-input:focus {
  outline: none;
  border-color: var(--color-green);
}

.review-actions {
  display: flex;
  justify-content: flex-end;
}

.submit-review-btn {
  padding: 8px 16px;
  background: var(--color-green);
  border: 1px solid var(--color-green);
  color: var(--color-darker-0);
  font-weight: 600;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
}

.submit-review-btn:hover:not(:disabled) {
  background: rgba(25, 239, 131, 0.9);
  transform: translateY(-1px);
}

.submit-review-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* User Review */
.user-review {
  background: rgba(25, 239, 131, 0.08);
  border: 1px solid rgba(25, 239, 131, 0.3);
  border-radius: 8px;
  padding: 12px;
}

.review-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.review-header h4 {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-green);
  margin: 0;
}

.delete-review-btn {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-red);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.2s ease;
}

.delete-review-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: var(--color-red);
}

/* Reviews List */
.reviews-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.review-item {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 12px;
}

.reviewer-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.reviewer-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text);
}

.verified-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--color-green);
  background: rgba(25, 239, 131, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}

.verified-badge i {
  font-size: 9px;
}

.review-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  margin: 8px 0 4px 0;
}

.review-text {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
  margin: 4px 0;
}

.review-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--terminal-border-color);
}

.review-date {
  font-size: 11px;
  color: var(--color-text-muted);
  opacity: 0.7;
}

.review-votes {
  display: flex;
  gap: 8px;
}

.vote-btn {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 4px;
}

.vote-btn:hover {
  background: rgba(25, 239, 131, 0.1);
  border-color: var(--color-green);
  color: var(--color-green);
}

.vote-btn i {
  font-size: 10px;
}

/* No Reviews */
.no-reviews {
  text-align: center;
  padding: 32px 16px;
  color: var(--color-text-muted);
  opacity: 0.6;
}

.no-reviews i {
  font-size: 32px;
  margin-bottom: 12px;
  opacity: 0.4;
}

.no-reviews p {
  font-size: 12px;
  margin: 0;
}
</style>
