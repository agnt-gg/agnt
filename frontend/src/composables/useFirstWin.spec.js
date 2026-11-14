import { describe, it, expect, beforeEach } from 'vitest';
import { computed, effectScope, nextTick, reactive } from 'vue';
import { useFirstWin, watchForFirstWin } from './useFirstWin.js';
import { firstWinKey } from '@/services/firstWin.js';

const step = (name) => ({ id: name, name, args: {}, result: { ok: true } });
const finished = (id, at = Date.now()) => ({ id, role: 'assistant', content: 'Done.', timestamp: at, toolCalls: [step('calendar'), step('docs')] });

let n = 0;
function makeStore({ chats = 0, provider = 'OpenAI-Codex' } = {}) {
  const email = `user${(n += 1)}@example.com`;
  return reactive({
    getters: { 'userAuth/userEmail': email, 'contentOutputs/totalCount': chats },
    state: { aiProvider: { selectedProvider: provider }, chat: { isStreaming: false, messages: [] } },
  });
}

beforeEach(() => localStorage.clear());

describe('useFirstWin', () => {
  it('claims the first finished task once, and shows it on that reply only', () => {
    const store = makeStore();
    const firstWin = useFirstWin(store);
    expect(firstWin.claim(finished('m1'))).toBe(true);
    expect(firstWin.claim(finished('m2'))).toBe(false);
    expect(firstWin.claimOn('m1')).toMatchObject({ messageId: 'm1', firstTask: true, ranOn: { kind: 'plan', label: 'ChatGPT' } });
    expect(firstWin.claimOn('m2')).toBeNull();
    expect(JSON.parse(localStorage.getItem(firstWinKey(store.getters['userAuth/userEmail']))).messageId).toBe('m1');
  });

  it('never claims a reply that did not finish a task', () => {
    const firstWin = useFirstWin(makeStore());
    expect(firstWin.claim({ ...finished('m1'), toolCalls: [step('search')] })).toBe(false);
    expect(firstWin.claim(null)).toBe(false);
    expect(firstWin.state.value.messageId).toBeNull();
  });

  it('calls it a first task only while the account is new', () => {
    const veteran = useFirstWin(makeStore({ chats: 400 }));
    veteran.claim(finished('m1'));
    expect(veteran.claimOn('m1').firstTask).toBe(false);
  });

  it('"Not now" retires the card for good', () => {
    const firstWin = useFirstWin(makeStore());
    firstWin.claim(finished('m1'));
    firstWin.dismiss();
    expect(firstWin.claimOn('m1')).toBeNull();
    expect(firstWin.claim(finished('m2'))).toBe(false);
  });

  it('every message on screen sees the same state', () => {
    const store = makeStore();
    const one = useFirstWin(store);
    const other = useFirstWin(store);
    const shown = computed(() => other.claimOn('m1'));
    expect(shown.value).toBeNull();
    one.claim(finished('m1'));
    expect(shown.value).toMatchObject({ messageId: 'm1' });
    one.dismiss();
    expect(shown.value).toBeNull();
  });

  it('keeps each account to its own claim', () => {
    const maya = useFirstWin(makeStore());
    const sam = useFirstWin(makeStore());
    maya.claim(finished('m1'));
    expect(sam.claimOn('m1')).toBeNull();
    expect(sam.claim(finished('m9'))).toBe(true);
  });
});

describe('watchForFirstWin', () => {
  function watching(store) {
    const scope = effectScope();
    scope.run(() => watchForFirstWin(store, computed(() => store.state.chat.messages)));
    return scope;
  }
  async function turn(store, messages) {
    store.state.chat.isStreaming = true;
    await nextTick();
    store.state.chat.messages = messages;
    store.state.chat.isStreaming = false;
    await nextTick();
  }

  it('claims a finished task when the turn that wrote it ends', async () => {
    const store = makeStore();
    const scope = watching(store);
    await turn(store, [{ id: 'u1', role: 'user', content: 'Prep me' }, finished('m1')]);
    expect(useFirstWin(store).claimOn('m1')).not.toBeNull();
    scope.stop();
  });

  it('ignores the last reply of a conversation that was only opened', async () => {
    const store = makeStore();
    const scope = watching(store);
    await turn(store, [finished('old', Date.now() - 60 * 60 * 1000)]);
    expect(useFirstWin(store).state.value.messageId).toBeNull();
    scope.stop();
  });

  it('ignores a reply with no timestamp it can read', async () => {
    const store = makeStore();
    const scope = watching(store);
    await turn(store, [{ ...finished('m1'), timestamp: undefined }]);
    expect(useFirstWin(store).state.value.messageId).toBeNull();
    scope.stop();
  });

  it('waits for a turn to end before claiming anything', async () => {
    const store = makeStore();
    const scope = watching(store);
    store.state.chat.messages = [finished('m1')];
    store.state.chat.isStreaming = true;
    await nextTick();
    expect(useFirstWin(store).state.value.messageId).toBeNull();
    scope.stop();
  });
});
