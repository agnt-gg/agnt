/**
 * Real-browser harness for MarketplaceShelf.
 *
 * jsdom performs no layout and applies no CSS, so the component specs cannot see
 * overflow, ragged rows, contrast, or a scoped style that never landed. This
 * mounts the REAL component with the REAL theme stylesheets and a stub store, so
 * a headless Chrome pass can measure what a user would actually see.
 *
 * Not shipped: excluded from the app build, exists only for verification.
 */
import { createApp, h, ref } from 'vue';
import { createStore } from 'vuex';
import MarketplaceShelf from '../src/views/Terminal/_components/MarketplaceShelf.vue';
import '../src/styles/main.css';

const day = (n) => new Date(Date.now() - n * 86400000).toISOString();

const ITEMS = [
  { id: 'a1', asset_type: 'agent', title: 'Koder Kai', tagline: 'Expert software engineer. Plans and architects before writing a line, then ships and verifies.', category: 'Technology & Development', publisher_pseudonym: 'AcuteBeigeDolphin', price: 0, downloads: 50, rating: 5, rating_count: 1, published_at: day(190) },
  { id: 'a2', asset_type: 'agent', title: 'Social Media Manager', tagline: 'A creative and data-driven agent that schedules posts, analyses engagement and drafts the next week.', category: 'Sales & Marketing', publisher_pseudonym: 'Nathan Wilbanks', price: 0, downloads: 50, rating: 0, rating_count: 0, published_at: day(259) },
  { id: 'a3', asset_type: 'agent', title: 'Data Analysis Agent', tagline: 'Analyzes large datasets and produces visual reports.', category: 'Data & Analytics', publisher_pseudonym: 'Nathan Wilbanks', price: 0, downloads: 38, rating: 0, rating_count: 0, published_at: day(259) },
  { id: 'a4', asset_type: 'agent', title: 'Customer Support Agent', tagline: 'Answers from your own docs, escalates what it cannot answer, never invents a policy.', category: 'Sales & Marketing', publisher_pseudonym: 'Nathan Wilbanks', price: 0, downloads: 5, rating: 0, rating_count: 0, published_at: day(259) },
  { id: 'a5', asset_type: 'agent', title: 'Research Assistant', tagline: 'Searches, scrapes and cites. Returns a source-attributed brief rather than a confident guess.', category: 'Data & Analytics', publisher_pseudonym: 'Culy', price: 0, downloads: 3, rating: 0, rating_count: 0, published_at: day(190) },
  { id: 'a6', asset_type: 'agent', title: 'Content Strategist', tagline: 'Turns one idea into a month of scheduled, on-brand posts.', category: 'Sales & Marketing', publisher_pseudonym: 'Sparky', price: 12.5, downloads: 1, rating: 0, rating_count: 0, published_at: day(8) },
  { id: 'w1', asset_type: 'workflow', title: 'Daily AI News Research and Email', tagline: 'Get a daily email summary of the latest AI news.', category: 'Data & Analytics', publisher_pseudonym: 'Nathan Wilbanks', price: 0, downloads: 32, rating_count: 0, published_at: day(259) },
  { id: 'w2', asset_type: 'workflow', title: 'Bitcoin Price Alert Workflow', tagline: 'Simple Bitcoin price checker email alert system.', category: 'Business & Finance', publisher_pseudonym: 'Nathan Wilbanks', price: 0, downloads: 21, rating_count: 0, published_at: day(259) },
  { id: 'w3', asset_type: 'workflow', title: 'Ethereum Price Monitor', tagline: 'Simple Ethereum price checker email alert system.', category: 'Business & Finance', publisher_pseudonym: 'Nathan Wilbanks', price: 0, downloads: 15, rating_count: 0, published_at: day(259) },
  { id: 't1', asset_type: 'tool', title: 'URL Fetcher', tagline: 'JS tool designed to act as a custom API caller. GET, POST, headers, auth.', category: 'Technology & Development', publisher_pseudonym: 'Nathan Wilbanks', price: 0, downloads: 27, rating_count: 0, published_at: day(259) },
  { id: 't2', asset_type: 'tool', title: 'Blog Post Generator', tagline: 'AI type tool designed to generate blog posts.', category: 'Content & Media', publisher_pseudonym: 'Nathan Wilbanks', price: 0, downloads: 17, rating_count: 0, published_at: day(259) },
];

const q = new URLSearchParams(location.search);
const assetType = q.get('type') || 'agent';
const variant = q.get('variant') || 'full';
const status = q.get('status') || 'ready';
const query = q.get('q') || '';
document.body.className = q.get('theme') || 'dark';

const store = createStore({
  modules: {
    marketplace: {
      namespaced: true,
      state: { shelfItems: status === 'ready' ? ITEMS : [], shelfStatus: status },
      getters: {
        shelfItems: (s) => s.shelfItems,
        shelfStatus: (s) => s.shelfStatus,
        shelfItemsByType: (s) => (t) => s.shelfItems.filter((i) => i.asset_type === t),
      },
      actions: { fetchShelfItems: () => Promise.resolve() },
    },
  },
});

createApp({
  setup() {
    const available = ref(null);
    return () =>
      h('div', [
        h(MarketplaceShelf, {
          assetType,
          variant,
          query,
          createLabel: 'Create ' + assetType[0].toUpperCase() + assetType.slice(1),
          onAvailability: (v) => (available.value = v),
        }),
        h('div', { id: 'harness-availability', style: 'display:none' }, String(available.value)),
      ]);
  },
})
  .use(store)
  .mount('#app');
