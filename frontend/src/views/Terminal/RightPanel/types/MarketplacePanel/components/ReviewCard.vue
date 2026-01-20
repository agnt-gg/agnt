<template>
  <div class="review-card">
    <div class="review-header">
      <div class="review-author-section">
        <div class="author-avatar">
          {{ getInitials(review.user_name) }}
        </div>
        <div class="author-info">
          <div class="author-name">{{ review.user_name || 'Anonymous' }}</div>
          <div class="review-meta">
            <div class="star-rating">
              <i v-for="star in 5" :key="star" :class="star <= review.rating ? 'fas fa-star filled' : 'far fa-star'"></i>
            </div>
            <span class="review-date">{{ formatDate(review.created_at) }}</span>
            <span v-if="review.verified_purchase" class="verified-badge">
              <i class="fas fa-check-circle"></i>
              Verified Install
            </span>
          </div>
        </div>
      </div>
      <div v-if="canEdit" class="review-actions">
        <Tooltip text="Edit Review" width="auto">
          <button class="action-btn edit" @click="$emit('edit', review)">
            <i class="fas fa-edit"></i>
          </button>
        </Tooltip>
        <Tooltip text="Delete Review" width="auto">
          <button class="action-btn delete" @click="$emit('delete', review)">
            <i class="fas fa-trash"></i>
          </button>
        </Tooltip>
      </div>
    </div>

    <div v-if="review.title" class="review-title">{{ review.title }}</div>

    <div class="review-text">{{ review.review_text }}</div>

    <!-- Review Images -->
    <div v-if="review.images && review.images.length > 0" class="review-images">
      <img
        v-for="(image, index) in review.images"
        :key="index"
        :src="image"
        :alt="`Review image ${index + 1}`"
        class="review-image"
        @click="openImageModal(image)"
      />
    </div>

    <!-- Voting Section -->
    <!-- <div class="review-footer">
      <div class="review-helpful">
        <span class="helpful-label">Was this helpful?</span>
        <div class="vote-buttons">
          <button
            class="vote-btn"
            :class="{ active: userVote === 'helpful' }"
            @click="$emit('vote', { reviewId: review.id, voteType: 'helpful' })"
            :disabled="!canVote"
          >
            <i class="fas fa-thumbs-up"></i>
            <span>{{ review.helpful_count || 0 }}</span>
          </button>
          <button
            class="vote-btn"
            :class="{ active: userVote === 'unhelpful' }"
            @click="$emit('vote', { reviewId: review.id, voteType: 'unhelpful' })"
            :disabled="!canVote"
          >
            <i class="fas fa-thumbs-down"></i>
            <span>{{ review.unhelpful_count || 0 }}</span>
          </button>
        </div>
      </div>
    </div> -->
  </div>
</template>

<script>
import Tooltip from '@/views/Terminal/_components/Tooltip.vue';

export default {
  name: 'ReviewCard',
  components: { Tooltip },
  props: {
    review: {
      type: Object,
      required: true,
    },
    userVote: {
      type: String,
      default: null, // 'helpful', 'unhelpful', or null
    },
    canEdit: {
      type: Boolean,
      default: false,
    },
    canVote: {
      type: Boolean,
      default: true,
    },
  },
  emits: ['vote', 'edit', 'delete'],
  methods: {
    getInitials(name) {
      if (!name) return 'A';
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    },
    formatDate(dateString) {
      if (!dateString) return '';
      const date = new Date(dateString);
      const now = new Date();
      const diffTime = Math.abs(now - date);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays} days ago`;
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
      return date.toLocaleDateString();
    },
    openImageModal(image) {
      // TODO: Implement image modal/lightbox
      window.open(image, '_blank');
    },
  },
};
</script>

<style scoped>
.review-card {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.review-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.review-author-section {
  display: flex;
  gap: 12px;
  flex: 1;
}

.author-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-green), rgba(25, 239, 131, 0.7));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-darker-3);
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.author-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.author-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.review-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.star-rating {
  display: flex;
  gap: 2px;
}

.star-rating i {
  font-size: 12px;
  color: var(--color-text-muted);
}

.star-rating i.filled {
  color: var(--color-yellow);
}

.review-date {
  font-size: 11px;
  color: var(--color-text-muted);
}

.verified-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--color-green);
  background: rgba(25, 239, 131, 0.1);
  padding: 2px 8px;
  border-radius: 12px;
}

.verified-badge i {
  font-size: 10px;
}

.review-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.action-btn:hover {
  background: rgba(25, 239, 131, 0.1);
  border-color: rgba(25, 239, 131, 0.3);
  color: var(--color-text);
}

.action-btn.delete:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.action-btn i {
  font-size: 11px;
}

.review-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text);
  line-height: 1.4;
}

.review-text {
  font-size: 13px;
  color: var(--color-text-muted);
  line-height: 1.6;
  white-space: pre-wrap;
}

.review-images {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.review-image {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--terminal-border-color);
  cursor: pointer;
  transition: all 0.2s ease;
}

.review-image:hover {
  transform: scale(1.05);
  border-color: rgba(25, 239, 131, 0.5);
}

.review-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 12px;
  border-top: 1px solid var(--terminal-border-color);
}

.review-helpful {
  display: flex;
  align-items: center;
  gap: 12px;
}

.helpful-label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.vote-buttons {
  display: flex;
  gap: 6px;
}

.vote-btn {
  background: transparent;
  border: 1px solid var(--terminal-border-color);
  color: var(--color-text-muted);
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.vote-btn:hover:not(:disabled) {
  background: rgba(25, 239, 131, 0.1);
  border-color: rgba(25, 239, 131, 0.3);
  color: var(--color-text);
}

.vote-btn.active {
  background: rgba(25, 239, 131, 0.15);
  border-color: rgba(25, 239, 131, 0.5);
  color: var(--color-green);
}

.vote-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.vote-btn i {
  font-size: 11px;
}

.vote-btn span {
  font-weight: 600;
}
</style>
