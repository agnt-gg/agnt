/**
 * mobileReceiver: a text in, Annie's answer out, through the real code path
 * with the network faked at its two edges (mobile.agnt.gg and the local API).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let script = [];
vi.mock('./agntServices.js', () => ({
  callService: vi.fn(async (service, path, opts = {}) => {
    calls.push({ service, path, opts });
    const next = script.shift();
    if (next instanceof Error) throw next;
    return next ?? {};
  }),
  hostedInstanceSlug: vi.fn(() => null),
}));
vi.mock('./auth/sessionTokenCache.js', () => ({
  getSessionToken: vi.fn(() => 'session-token'),
  getSessionUserId: vi.fn(() => 'user-1'),
}));

const { MobileReceiver, toTextReply, readFinalAnswer } = await import('./mobileReceiver.js');

const sse = (...events) => new Response(new ReadableStream({
  start(controller) {
    for (const [event, data] of events) controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    controller.close();
  },
}), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

describe('toTextReply', () => {
  it('strips what a phone cannot show, never returns empty', () => {
    expect(toTextReply('Here:\n```js\nx()\n```')).toBe('Here:\n[code is in your AGNT app]');
    expect(toTextReply('see [report](file:///C:/x/report.html)')).toBe('see report (in your AGNT app)');
    expect(toTextReply('<img src="{{IMAGE_REF:abc}}" alt="x">')).toBe('Done. The details are in your AGNT app.');
    expect(toTextReply('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('readFinalAnswer', () => {
  it('prefers final_content, falls back to accumulated deltas', async () => {
    expect(await readFinalAnswer(sse(['content_delta', { accumulated: 'part' }], ['final_content', { content: 'whole' }]))).toBe('whole');
    expect(await readFinalAnswer(sse(['content_delta', { delta: 'a' }], ['content_delta', { delta: 'b' }]))).toBe('ab');
  });
  it('a terminal error with no text is an error', async () => {
    await expect(readFinalAnswer(sse(['error', { error: 'boom' }]))).rejects.toThrow('boom');
  });
});

describe('MobileReceiver.handle', () => {
  beforeEach(() => { calls.length = 0; script = []; });

  const message = { id: 'm-1', text: "what's on today?", conversationId: 'mobile-p1-1', receivedAt: 1 };

  it('runs the text through the local orchestrator as a text turn and replies', async () => {
    const requests = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      requests.push({ url, init });
      if (url.includes('/by-conversation/')) return new Response(JSON.stringify({ id: 'out-1', content: JSON.stringify({ title: 'Text · hi', messages: [{ role: 'assistant', content: 'orphan' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] }) }), { status: 200 });
      if (url.endsWith('/orchestrator/chat')) return sse(['final_content', { content: 'Two meetings: **10am** and 2pm.' }]);
      if (url.endsWith('/content-outputs/save')) return new Response('{}', { status: 200 });
      return new Response('{}', { status: 404 });
    });
    const receiver = new MobileReceiver({ port: 4444, fetchImpl });
    await receiver.handle(message);

    const chat = requests.find((r) => r.url.endsWith('/orchestrator/chat'));
    expect(chat.url).toBe('http://127.0.0.1:4444/api/orchestrator/chat');
    expect(chat.init.headers.Authorization).toBe('Bearer session-token');
    const body = JSON.parse(chat.init.body);
    expect(body).toMatchObject({ conversationId: 'mobile-p1-1', routingMode: 'default', persistDefault: false, textMode: true });
    // History starts on a user turn and ends with this text.
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: "what's on today?" }]);

    expect(calls).toEqual([expect.objectContaining({ service: 'mobile', path: '/messages/m-1/reply', opts: expect.objectContaining({ method: 'POST', body: { text: 'Two meetings: **10am** and 2pm.' } }) })]);
    const saved = JSON.parse(JSON.parse(requests.find((r) => r.url.endsWith('/content-outputs/save')).init.body).content);
    expect(saved.messages.slice(-2).map((m) => m.content)).toEqual(["what's on today?", 'Two meetings: **10am** and 2pm.']);
  });

  it('gives the text back to the queue when Annie fails, and never replies', async () => {
    const fetchImpl = vi.fn(async (url) => (url.endsWith('/orchestrator/chat') ? new Response('nope', { status: 500 }) : new Response('{}', { status: 404 })));
    await new MobileReceiver({ fetchImpl }).handle(message);
    expect(calls.map((c) => c.path)).toEqual(['/messages/m-1/release']);
  });
});
