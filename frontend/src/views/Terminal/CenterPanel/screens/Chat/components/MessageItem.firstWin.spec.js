/**
 * MessageItem — the first-win card belongs to the one reply that claimed it
 * (composables/useFirstWin.js), and "Not now" removes it everywhere.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { nextTick } from 'vue';

vi.mock('@/../user.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
  IMAP_EMAIL_DOMAIN: '',
  AI_PROVIDERS_CONFIG: {},
  DEPLOYMENT_CONFIG: {},
  default: {},
}));
vi.mock('@/assets/images/annie-avatar.png', () => ({ default: 'avatar.png' }));
vi.mock('highlight.js/styles/atom-one-dark.css', () => ({}));
vi.mock('@/services/fileSystemService.js', () => ({ getSettings: vi.fn(async () => ({})) }));
// The card loads for real (it is a lazy chunk, and Vue probes the module it
// gets back); its links and its account read have their own specs.
vi.mock('@/views/_components/feature/GiveBackLinks.vue', () => ({
  default: { name: 'GiveBackLinks', props: { compact: Boolean }, template: '<div class="give-back-stub"><slot /></div>' },
}));
vi.mock('@/services/agntFlash.js', async (original) => ({ ...(await original()), fetchFlashAccount: vi.fn(async () => null) }));

import MessageItem from './MessageItem.vue';
import { firstWinKey } from '@/services/firstWin.js';

const store = createStore({
  state: {
    agents: { agents: [] },
    chat: { activeConversationId: null, conversations: {} },
    userAuth: { token: 'test-token' },
  },
});
const step = (name) => ({ id: name, name, args: {}, result: { ok: true } });
const mounted = [];

function mountMessage(message) {
  const wrapper = mount(MessageItem, {
    props: { message: { content: 'Done.', toolCalls: [step('calendar'), step('docs')], ...message }, status: null, imageCache: new Map() },
    attachTo: document.body,
    global: { plugins: [store], stubs: { ProviderSetup: true, GoalProgressWidget: true, Tooltip: true, Teleport: true } },
  });
  mounted.push(wrapper);
  return wrapper;
}

async function waitFor(condition, { attempts = 40 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    await nextTick();
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

beforeAll(() => {
  // A signed-out store has no account name, so the claim is kept unscoped.
  localStorage.setItem(firstWinKey(null), JSON.stringify({ messageId: 'm1', firstTask: true, ranOn: { kind: 'plan', label: 'ChatGPT' }, dismissed: false }));
});
afterEach(() => {
  while (mounted.length) mounted.pop().unmount();
});

describe('MessageItem: the first-win card', () => {
  it('shows under the reply that claimed it, and nowhere else', async () => {
    const claimed = mountMessage({ id: 'm1', role: 'assistant' });
    const other = mountMessage({ id: 'm2', role: 'assistant' });
    const own = mountMessage({ id: 'm1', role: 'user' });
    expect(await waitFor(() => claimed.find('[data-testid="first-win"]').exists())).toBe(true);
    expect(claimed.find('.first-win-line').text()).toBe('First task, done. It ran on your ChatGPT plan, at no extra charge.');
    expect(other.find('[data-testid="first-win"]').exists()).toBe(false);
    expect(own.find('[data-testid="first-win"]').exists()).toBe(false);
  });

  it('"Not now" removes it, and it stays gone', async () => {
    const claimed = mountMessage({ id: 'm1', role: 'assistant' });
    expect(await waitFor(() => claimed.find('[data-testid="first-win"]').exists())).toBe(true);
    await claimed.find('[data-action="first-win-later"]').trigger('click');
    await nextTick();
    expect(claimed.find('[data-testid="first-win"]').exists()).toBe(false);
    expect(JSON.parse(localStorage.getItem(firstWinKey(null))).dismissed).toBe(true);
    const again = mountMessage({ id: 'm1', role: 'assistant' });
    await waitFor(() => false, { attempts: 6 });
    expect(again.find('[data-testid="first-win"]').exists()).toBe(false);
  });
});
