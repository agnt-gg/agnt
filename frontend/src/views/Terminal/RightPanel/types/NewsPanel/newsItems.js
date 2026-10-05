/**
 * AGNT News: what changed lately, in a sentence or two each.
 *
 * Every item names something that actually shipped. Newest first. `action`
 * (optional) opens the place it talks about; `screen`/`opts` are the same
 * navigation every other link in the app uses (screenRoute).
 *
 * Release notes, the version and the update check are NOT news: they live in
 * Settings › About (ReleaseNotes.vue).
 */
export const NEWS_ITEMS = Object.freeze([
  {
    id: 'focused-create',
    date: '2026-10-04',
    tag: 'Focused',
    title: 'Build without leaving Focused',
    body: 'New agent, workflow, tool, skill and widget now open their editor right in Focused. Name it, save it, and it is ready to use.',
  },
  {
    id: 'text-annie',
    date: '2026-10-03',
    tag: 'Mobile',
    title: 'Text Annie from your phone',
    body: 'Send Annie photos, voice notes and files by text. Scan the code once and your phone is linked.',
    action: { label: 'Set up Remote Access', screen: 'SettingsScreen', opts: { section: 'phone-access' } },
  },
  {
    id: 'learning',
    date: '2026-10-03',
    tag: 'Learning',
    title: 'Improvements you can measure',
    body: 'Learning groups recurring failures, proposes a fix, and runs it as a 7-day trial with a before and after. You decide what stays.',
    action: { label: 'Open Learning', screen: 'LearningScreen' },
  },
  {
    id: 'local-search',
    date: '2026-10-03',
    tag: 'Search',
    title: 'Web search runs on your machine first',
    body: 'Searches start locally and only fall back to the cloud when they need to, so they are faster and use less of your allowance.',
  },
  {
    id: 'failover',
    date: '2026-10-02',
    tag: 'Models',
    title: 'Smarter model failover',
    body: 'AGNT checks which providers are healthy, keeps a conversation on one model, and switches only when it has to, now including workflows and the forges.',
    action: { label: 'AI Models', screen: 'SettingsScreen', opts: { section: 'providers' } },
  },
  {
    id: 'mail-webhooks',
    date: '2026-09-30',
    tag: 'Plugins',
    title: 'Mail and Webhooks on every paid plan',
    body: 'Give your agents their own inbox and trigger them from any service with a webhook, included with AGNT Pro.',
    action: { label: 'Open Email Inbox', screen: 'ConnectorsScreen', opts: { section: 'email-server' } },
  },
]);

/** "Oct 4" — dates are calendar days, so they are read as local, not UTC. */
export function newsDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
