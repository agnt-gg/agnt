/**
 * The first-win card's state, shared by every message on screen, and the
 * moment it is claimed: when a turn in the main chat ends (services/firstWin.js).
 */
import { computed, ref, watch } from 'vue';
import { readFacts } from '@/composables/useJourney.js';
import { FIRST_TASK_CHATS, isFinishedTask, loadFirstWin, ranOnFor, saveFirstWin } from '@/services/firstWin.js';

// One state per account. A plain Map is read inside computeds; `version` is
// their change signal, so reading an account for the first time is not a
// reactive write.
const states = new Map();
const version = ref(0);

// Turns can stream for minutes; a reply written up to this long before the
// turn was seen to start (the first event can land first) still belongs to it.
const TURN_START_SLACK_MS = 5000;

const accountOf = (store) => store?.getters?.['userAuth/userEmail'] || store?.state?.userAuth?.user?.id || null;

function read(account) {
  const key = account || '';
  if (!states.has(key)) states.set(key, loadFirstWin(account));
  return states.get(key);
}

function write(account, next) {
  states.set(account || '', saveFirstWin(account, next));
  version.value += 1;
}

export function useFirstWin(store) {
  const state = computed(() => {
    void version.value;
    return read(accountOf(store));
  });

  /** The claim to show on this message, or null. */
  const claimOn = (messageId) => {
    const current = state.value;
    if (current.dismissed || current.messageId === null) return null;
    return current.messageId === String(messageId ?? '') ? current : null;
  };

  /** Records `message` as the account's first finished task. Once per account; true when it did. */
  function claim(message) {
    const account = accountOf(store);
    const current = read(account);
    if (current.messageId || current.dismissed || !isFinishedTask(message)) return false;
    write(account, {
      ...current,
      messageId: String(message.id),
      firstTask: readFacts(store).chats <= FIRST_TASK_CHATS,
      ranOn: ranOnFor(store?.state?.aiProvider?.selectedProvider),
    });
    return true;
  }

  /** "Not now": the card is gone for this account, for good. */
  function dismiss() {
    const account = accountOf(store);
    write(account, { ...read(account), dismissed: true });
  }

  return { state, claimOn, claim, dismiss };
}

const writtenAt = (message) => new Date(message?.timestamp).getTime();

/**
 * Claims the first finished task as turns end in this chat. Only a reply
 * written during the turn that just ended counts: opening another
 * conversation can end "streaming" too, and its last reply is not a new win.
 */
export function watchForFirstWin(store, messages) {
  const firstWin = useFirstWin(store);
  let turnStartedAt = null;
  return watch(
    () => !!store?.state?.chat?.isStreaming,
    (streaming) => {
      if (streaming) {
        turnStartedAt = Date.now();
        return;
      }
      if (turnStartedAt === null) return;
      const since = turnStartedAt - TURN_START_SLACK_MS;
      turnStartedAt = null;
      const reply = [...(messages.value || [])].reverse().find((message) => message?.role === 'assistant');
      if (reply && writtenAt(reply) >= since) firstWin.claim(reply);
    },
  );
}
