<template>
  <div class="news-panel">
    <div class="panel-header">
      <h3 class="panel-title">
        <i class="fas fa-newspaper"></i>
        AGNT News
      </h3>
    </div>

    <!-- News only. The version, update check and release notes are in
         Settings › About (ReleaseNotes.vue). -->
    <div class="news-content">
      <article v-for="item in items" :key="item.id" class="news-item">
        <div class="news-meta">
          <span class="news-date">{{ newsDate(item.date) }}</span>
          <span v-if="item.tag" class="tag">{{ item.tag }}</span>
        </div>
        <h5 class="news-title">{{ item.title }}</h5>
        <p class="news-description">{{ item.body }}</p>
        <button v-if="item.action" type="button" class="news-action" @click="open(item.action)">
          {{ item.action.label }} <i class="fas fa-arrow-right" aria-hidden="true"></i>
        </button>
      </article>
    </div>
  </div>
</template>

<script>
import { useRouter } from 'vue-router';
import { screenRoute } from '@/views/Terminal/screenRoute.js';
import { NEWS_ITEMS, newsDate } from './newsItems.js';

export default {
  name: 'NewsPanel',
  setup() {
    const router = useRouter();
    // Same route every other link uses; Terminal shows whatever the route says.
    const open = (action) => {
      const target = screenRoute(action.screen, action.opts || {});
      if (target) router.push({ path: target.path, query: target.query }).catch(() => {});
    };
    return { items: NEWS_ITEMS, newsDate, open };
  },
};
</script>

<style scoped>
.news-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.panel-header {
  padding: 0 0 16px 0;
  border-bottom: 1px solid var(--terminal-border-color);
  margin-bottom: 16px;
}

.panel-title {
  margin: 0;
  font-size: 1.2em;
  font-weight: 600;
  color: var(--color-text);
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-title i {
  color: var(--color-green);
}

.news-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(127, 129, 147, 0.2) transparent;
  display: flex;
  flex-direction: column;
}

.news-content::-webkit-scrollbar {
  width: 6px;
}

.news-content::-webkit-scrollbar-track {
  background: transparent;
}

.news-content::-webkit-scrollbar-thumb {
  background: var(--color-darker-0);
  border-radius: 3px;
}

/* News items: the card the old release list used, unchanged. */
.news-item {
  border: 1px solid var(--terminal-border-color);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  transition: all 0.2s ease;
}

body.dark .news-item {
  background: var(--color-darker-0);
  border: 1px solid var(--terminal-border-color);
}

.news-item:hover {
  border-color: var(--color-green);
}

.news-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.news-date {
  font-size: 0.75em;
  color: var(--color-light-med-navy);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.news-title {
  font-size: 1em;
  font-weight: 600;
  color: var(--color-text);
  margin: 0 0 8px 0;
}

.news-description {
  font-size: 0.9em;
  color: var(--color-light-med-navy);
  line-height: 1.5;
  margin: 0;
}

.tag {
  font-size: 0.75em;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgba(var(--green-rgb), 0.1);
  color: var(--color-green);
  font-weight: 500;
}

/* The release list's "+ N more" link style. */
.news-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--color-green);
  font: inherit;
  font-size: 0.85em;
  font-weight: 500;
  cursor: pointer;
  padding: 0;
  margin-top: 12px;
}

.news-action:hover {
  text-decoration: underline;
}
</style>
