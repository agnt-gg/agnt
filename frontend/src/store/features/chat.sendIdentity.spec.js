/**
 * Every request that starts a turn must say which client sent it.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The server broadcasts three things about a running turn to every client the
 * user has open — run:started, the user's message, and the streamed answer —
 * and stamps each with the sender's X-AGNT-Client-Id so the sender can
 * recognise and ignore its own. Both client-side guards (adoptAnnouncedRun,
 * handleRealtimeChatEvent) read that stamp, and both treat a MISSING stamp as
 * "someone else's" by design: never showing another device's turn is worse
 * than showing a duplicate (see clientId.js).
 *
 * So a send path that omits the header disarms every guard at once. That is
 * not hypothetical — it shipped. chatService.streamChat sent the header, and
 * the five unified panels that use it were clean; the MAIN chat and the agent
 * chat build their own fetches in this store and sent nothing. The sender's
 * own run:started came back unstamped, adoptAnnouncedRun attached to it, and
 * the SSE replay raced the live stream into one slot: every delta applied
 * twice ("HeyHey Nath Nathan. Whatan. What…"), plus a second empty message
 * with the same id from the replay's assistant_message. First message of
 * every new main-chat conversation, text and voice alike.
 *
 * WHY SOURCE ASSERTIONS
 * ---------------------
 * sendMessage and sendAgentMessage are call sites inside a 3,600-line store
 * that no unit test drives end to end — the same justification as
 * OrchestratorService.mirrorEcho.test.js, and the same precedent as
 * chat.groupChat.spec.js reading this file's source. The receiving-end
 * behaviour is covered by chat.mirrorEcho.spec.js and runResume.spec.js; what
 * cannot be checked there is whether these senders ever identify themselves.
 * chatService.streamChat's header has its own behavioural spec
 * (chatService.clientHeader.spec.js).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import chat from './chat.js';

const src = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), './chat.js'),
  'utf8',
);

describe('the store send paths identify their client', () => {
  it('imports the one client identity', () => {
    expect(src).toMatch(/import \{[^}]*getClientId[^}]*\} from '@\/services\/clientId\.js'/);
  });

  it('stamps the main chat request', () => {
    const fetchIdx = src.indexOf('fetch(`${API_CONFIG.BASE_URL}/orchestrator/chat`');
    expect(fetchIdx).toBeGreaterThan(-1);
    // The stamp must be on THIS request's headers, between their construction
    // and the fetch that sends them.
    const headersIdx = src.lastIndexOf('const headers = {};', fetchIdx);
    expect(headersIdx).toBeGreaterThan(-1);
    expect(src.slice(headersIdx, fetchIdx)).toMatch(/headers\['X-AGNT-Client-Id'\] = getClientId\(\)/);
  });

  it('stamps the agent chat request', () => {
    const fetchIdx = src.indexOf('fetch(`${API_CONFIG.BASE_URL}/agents/${agentId}/chat-stream`');
    expect(fetchIdx).toBeGreaterThan(-1);
    const headersIdx = src.lastIndexOf('const headers = ', fetchIdx);
    expect(headersIdx).toBeGreaterThan(-1);
    expect(src.slice(headersIdx, fetchIdx)).toMatch(/headers\['X-AGNT-Client-Id'\] = getClientId\(\)/);
  });
});

describe('a message id can only be added once (the belt)', () => {
  // The stamp is the fix; this is the damage limit for any future unstamped
  // path. A second add with an id the slot already holds is by definition a
  // replay or an echo — the streamed original, the SSE replay, and the socket
  // mirror all carry the same assistantMessageId. Refusing the repeat cannot
  // lose real content: fresh messages always carry fresh ids.
  const CONV = 'conv-1';

  const makeState = () => {
    const state = { conversations: {}, activeConversationId: CONV, messages: [] };
    chat.mutations.ENSURE_CONVERSATION(state, CONV);
    return state;
  };

  it('refuses a duplicate id instead of minting a twin', () => {
    const state = makeState();
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: CONV,
      message: { id: 'msg-asst-1', role: 'assistant', content: 'Hey Nathan.' },
    });
    // The replay's copy of the same assistant_message event: same id, blank
    // content — exactly the empty twin observed in the saved transcripts.
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: CONV,
      message: { id: 'msg-asst-1', role: 'assistant', content: '' },
    });

    const msgs = state.conversations[CONV].messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Hey Nathan.');
  });

  it('still adds distinct messages', () => {
    const state = makeState();
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: CONV,
      message: { id: 'msg-1', role: 'user', content: 'hello' },
    });
    chat.mutations.SCOPED_ADD_MESSAGE(state, {
      conversationId: CONV,
      message: { id: 'msg-2', role: 'assistant', content: 'hi' },
    });
    expect(state.conversations[CONV].messages).toHaveLength(2);
  });

  it('still accepts messages that carry no id at all', () => {
    // Some system notices are added without ids; absence of identity must not
    // be treated as sameness.
    const state = makeState();
    chat.mutations.SCOPED_ADD_MESSAGE(state, { conversationId: CONV, message: { role: 'system', content: 'a' } });
    chat.mutations.SCOPED_ADD_MESSAGE(state, { conversationId: CONV, message: { role: 'system', content: 'b' } });
    expect(state.conversations[CONV].messages).toHaveLength(2);
  });
});
