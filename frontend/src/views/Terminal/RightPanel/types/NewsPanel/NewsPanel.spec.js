/**
 * The Settings right panel is news only. The version, update check and
 * release notes moved to Settings › About (ReleaseNotes.vue).
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const push = vi.fn(() => Promise.resolve());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

import NewsPanel from './NewsPanel.vue';
import { NEWS_ITEMS, newsDate } from './newsItems.js';
import { SCREEN_ROUTES } from '@/views/Terminal/screenRoute.js';

describe('AGNT News', () => {
  it('shows the news, and nothing about versions or releases', () => {
    globalThis.fetch = vi.fn();
    const w = mount(NewsPanel);
    expect(w.findAll('.news-item')).toHaveLength(NEWS_ITEMS.length);
    expect(w.text()).not.toMatch(/Current Version|Up to date|Latest Updates|Previous Releases|Download/);
    expect(w.find('.version-card').exists()).toBe(false);
    // News needs no network: it must not fetch releases or check for updates.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('has a few items, newest first, each complete', () => {
    expect(NEWS_ITEMS.length).toBeGreaterThanOrEqual(4);
    const dates = NEWS_ITEMS.map((n) => n.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    for (const n of NEWS_ITEMS) {
      expect(n.title && n.body && n.tag, n.id).toBeTruthy();
      expect(newsDate(n.date), n.id).not.toBe('');
      if (n.action) expect(SCREEN_ROUTES[n.action.screen], `${n.id} opens a real screen`).toBeTruthy();
    }
    expect(new Set(NEWS_ITEMS.map((n) => n.id)).size).toBe(NEWS_ITEMS.length);
  });

  it('a news action opens the place it talks about', async () => {
    const w = mount(NewsPanel);
    const index = NEWS_ITEMS.findIndex((n) => n.id === 'mail-webhooks');
    await w.findAll('.news-item')[index].find('.news-action').trigger('click');
    expect(push).toHaveBeenCalledWith({ path: '/plugins', query: { section: 'email-server' } });
  });

  it('dates are calendar days, not shifted by time zone', () => {
    expect(newsDate('2026-10-04')).toBe(new Date(2026, 9, 4).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    expect(newsDate('')).toBe('');
    expect(newsDate('nope')).toBe('');
  });
});
