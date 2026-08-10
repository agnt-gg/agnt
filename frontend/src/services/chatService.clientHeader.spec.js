// The chat request must say who is sending it.
//
// The server stamps its `run:started` announcement with this header so the
// sending client can recognise and ignore its own run. If the header silently
// stops being sent, nothing breaks loudly: announcements simply arrive
// unlabelled, every client treats them as someone else's, and the sender
// attaches to its own turn — forking the conversation in its own UI.
//
// That failure is invisible in every other test in this repo, which is exactly
// why it is pinned here, on both request encodings.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));

import { streamChat } from './chatService.js';
import { getClientId } from './clientId.js';

const HEADER = 'X-AGNT-Client-Id';

/** Fail the request straight after fetch, so only the request shape is tested. */
const failFast = () => vi.fn(async () => ({
  ok: false, status: 503, statusText: 'unavailable', text: async () => '',
}));

const send = async (extra = {}) => {
  try {
    await streamChat({
      chatType: 'orchestrator',
      messages: [{ role: 'user', content: 'hi' }],
      onEvent: () => {},
      ...extra,
    });
  } catch {
    /* the 503 is deliberate */
  }
  return global.fetch.mock.calls[0][1];
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 'a-token');
  global.fetch = failFast();
});

describe('identifying the sending client', () => {
  it('sends this client\'s id on a JSON request', async () => {
    expect((await send()).headers[HEADER]).toBe(getClientId());
  });

  it('sends it on a multipart request too', async () => {
    // The multipart branch builds its own body and must NOT set Content-Type;
    // it would be easy to drop the shared headers along with it.
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    const init = await send({ files: [file] });

    expect(init.headers[HEADER]).toBe(getClientId());
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('sends it even when signed out', async () => {
    // Identity here is about echo suppression, not authorisation, so it must
    // not be entangled with the token.
    localStorage.clear();
    expect((await send()).headers[HEADER]).toBe(getClientId());
  });

  it('sends the same id on every request from this client', async () => {
    const first = await send();
    global.fetch = failFast();
    const second = await send();
    expect(second.headers[HEADER]).toBe(first.headers[HEADER]);
  });
});
