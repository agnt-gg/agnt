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

const { MobileReceiver, toTextReply, readFinalAnswer, fileThreadStore, takeReaction } = await import('./mobileReceiver.js');

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
  it('marks attached files, and may be empty when files carry the answer', () => {
    const attached = [{ token: 'file:///C:/x/chart.png' }];
    expect(toTextReply('[chart](file:///C:/x/chart.png) and file:///C:/x/other.pdf', { attached })).toBe('chart (attached) and (in your AGNT app)');
    expect(toTextReply('Done: file:///C:/x/chart.png.', { attached })).toBe('Done: (attached).');
    expect(toTextReply('{{IMAGE_REF:abc}}', { attached: [{ token: '{{IMAGE_REF:abc}}' }] })).toBe('');
  });
});

describe('takeReaction', () => {
  it('reads an opening [react: ...] as one of the six tapbacks and removes it', () => {
    expect(takeReaction('[react: 👍]')).toEqual({ reaction: '👍', text: '' });
    expect(takeReaction('  [React:❤] Done, sent at 2pm.')).toEqual({ reaction: '❤️', text: 'Done, sent at 2pm.' });
    expect(takeReaction('[react: like]\nScheduled.')).toEqual({ reaction: '👍', text: 'Scheduled.' });
    expect(takeReaction('[react: ‼]')).toEqual({ reaction: '‼️', text: '' });
  });
  it('drops anything else, and ignores a marker that does not open the reply', () => {
    expect(takeReaction('[react: 🎉] Party time')).toEqual({ reaction: null, text: 'Party time' });
    expect(takeReaction('Sure [react: 👍]')).toEqual({ reaction: null, text: 'Sure [react: 👍]' });
    expect(takeReaction('plain answer')).toEqual({ reaction: null, text: 'plain answer' });
    expect(takeReaction(null)).toEqual({ reaction: null, text: '' });
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
  const MAIN = { id: 'out-main', conversation_id: 'conv-main' };
  const LOG = [
    { role: 'system', content: 'old system prompt' },
    { role: 'user', content: 'typed on the desktop' },
    { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 't1', content: '{"ok":true}' },
    { role: 'assistant', content: 'Found it.' },
  ];
  const memoryThreads = (seed = {}) => {
    const data = { ...seed };
    return { data, get: async (id) => data[id] ?? null, set: async (id, n) => { data[id] = n; } };
  };

  /** The local backend: the Main chat, its log, the orchestrator, nothing else. */
  function localApi({ log = LOG, answer = 'Two meetings: **10am** and 2pm.', extra = () => null } = {}) {
    const requests = [];
    let main = MAIN;
    const fetchImpl = vi.fn(async (url, init = {}) => {
      requests.push({ url, init });
      const special = extra(url, init);
      if (special) return special;
      if (url.endsWith('/content-outputs/main-chat')) return new Response(JSON.stringify({ main, subChats: [] }));
      if (url.endsWith('/content-outputs/main-chat/clear')) {
        main = { id: MAIN.id, conversation_id: 'conv-main-fresh' };
        return new Response(JSON.stringify({ main }));
      }
      if (url.includes('/orchestrator/conversations/')) {
        return log && url.endsWith('/conv-main')
          ? new Response(JSON.stringify({ success: true, conversation: { messages: log } }))
          : new Response('{}', { status: 404 });
      }
      if (url.endsWith('/orchestrator/chat')) return sse(['final_content', { content: answer }]);
      return new Response('{}', { status: 404 });
    });
    return { fetchImpl, requests };
  }
  const receiverWith = (api, options = {}) => new MobileReceiver({
    port: 4444, fetchImpl: api.fetchImpl, runStatus: () => ({ active: false }), threads: memoryThreads(), busyPollMs: 1, ...options,
  });

  it('a text is a turn in the Main chat, on its full history, and the receiver saves nothing itself', async () => {
    const api = localApi();
    await receiverWith(api).handle(message);

    const chat = api.requests.find((r) => r.url.endsWith('/orchestrator/chat'));
    expect(chat.url).toBe('http://127.0.0.1:4444/api/orchestrator/chat');
    expect(chat.init.headers.Authorization).toBe('Bearer session-token');
    const body = JSON.parse(chat.init.body);
    expect(body).toMatchObject({ conversationId: 'conv-main', routingMode: 'default', persistDefault: false, textMode: true });
    // The provider log exactly as the last turn left it (tool rounds included),
    // minus its system prompt, then this text.
    expect(body.messages).toEqual([...LOG.slice(1), { role: 'user', content: "what's on today?" }]);

    expect(calls).toEqual([expect.objectContaining({ service: 'mobile', path: '/messages/m-1/reply', opts: expect.objectContaining({ method: 'POST', body: { text: 'Two meetings: **10am** and 2pm.', media: [] } }) })]);
    // The orchestrator's turn-end mirror writes the transcript. A rebuilt copy
    // from here could only be shorter than the real Main chat.
    expect(api.requests.some((r) => r.url.includes('/content-outputs/save'))).toBe(false);
    expect(api.requests.some((r) => r.url.includes('/by-conversation/'))).toBe(false);
  });

  it('a tapback alone is the whole reply: no text, no "Done" filler', async () => {
    await receiverWith(localApi({ answer: '[react: 👍]' })).handle(message);
    expect(calls).toEqual([expect.objectContaining({ path: '/messages/m-1/reply', opts: expect.objectContaining({ body: { text: '', media: [], reaction: '👍' } }) })]);
  });

  it('a tapback with words sends both; an unknown emoji is dropped, not sent', async () => {
    await receiverWith(localApi({ answer: '[react: ❤️] Sent it to grandma.' })).handle(message);
    expect(calls[0].opts.body).toEqual({ text: 'Sent it to grandma.', media: [], reaction: '❤️' });
    calls.length = 0;
    await receiverWith(localApi({ answer: '[react: 🎉] Sent.' })).handle(message);
    expect(calls[0].opts.body).toEqual({ text: 'Sent.', media: [] });
  });

  it('a service from before reactions gets the emoji as the text instead of a stuck reply', async () => {
    script = [Object.assign(new Error('empty_reply'), { code: 'empty_reply' })];
    await receiverWith(localApi({ answer: '[react: 👍]' })).handle(message);
    expect(calls.map((c) => [c.path, c.opts.body])).toEqual([
      ['/messages/m-1/reply', { text: '', media: [], reaction: '👍' }],
      ['/messages/m-1/reply', { text: '👍', media: [] }],
    ]);
  });

  it('a Main chat with no turns yet starts with an empty history', async () => {
    const api = localApi({ log: null });
    await receiverWith(api).handle(message);
    const body = JSON.parse(api.requests.find((r) => r.url.endsWith('/orchestrator/chat')).init.body);
    expect(body.messages).toEqual([{ role: 'user', content: "what's on today?" }]);
  });

  it('waits out a turn typed on the desktop in the Main chat, then answers', async () => {
    const api = localApi();
    let checks = 0;
    const runStatus = vi.fn((conversationId) => {
      expect(conversationId).toBe('conv-main');
      checks += 1;
      return { active: checks < 3 };
    });
    await receiverWith(api, { runStatus }).handle(message);
    expect(checks).toBe(3);
    expect(calls.map((c) => c.path)).toEqual(['/messages/m-1/reply']);
  });

  it('a Main chat busy for too long gives the text back instead of answering beside it', async () => {
    const api = localApi();
    await receiverWith(api, { runStatus: () => ({ active: true }), busyWaitMs: 5 }).handle(message);
    expect(api.requests.some((r) => r.url.endsWith('/orchestrator/chat'))).toBe(false);
    expect(calls.map((c) => c.path)).toEqual(['/messages/m-1/release']);
  });

  it('NEW clears the Main chat before the next text; the first text from a phone only records its thread', async () => {
    const threads = memoryThreads();
    const api = localApi();
    const receiver = receiverWith(api, { threads });
    const clears = () => api.requests.filter((r) => r.url.endsWith('/main-chat/clear')).length;

    await receiver.handle(message); // thread 1, first sight: recorded, not cleared
    expect(threads.data).toEqual({ p1: 1 });
    expect(clears()).toBe(0);

    await receiver.handle({ ...message, id: 'm-2' }); // same thread: no clear
    expect(clears()).toBe(0);

    await receiver.handle({ ...message, id: 'm-3', conversationId: 'mobile-p1-2' }); // texted NEW
    expect(clears()).toBe(1);
    expect(threads.data).toEqual({ p1: 2 });
    const body = JSON.parse(api.requests.filter((r) => r.url.endsWith('/orchestrator/chat')).at(-1).init.body);
    expect(body.conversationId).toBe('conv-main-fresh');
    expect(body.messages).toEqual([{ role: 'user', content: "what's on today?" }]);
  });

  it('a photo goes to Annie as an upload; the chart she makes comes back attached', async () => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const { pathToFileURL } = await import('url');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-rx-'));
    const chart = path.join(dir, 'chart.png');
    await fs.writeFile(chart, 'PNGDATA');
    const api = localApi({
      answer: `Here is the trend: [chart](${pathToFileURL(chart).href})`,
      extra: (url) => {
        if (url === 'https://files.test/photo') return new Response(Buffer.from('JPEGBYTES'));
        if (url === 'https://files.test/put-1') return new Response('', { status: 201 });
        return null;
      },
    });
    script = [{ mediaId: 'media-out-1', uploadUrl: 'https://files.test/put-1' }];
    const media = [{ id: 'mi-1', name: 'IMG_1.jpg', mime: 'image/jpeg', bytes: 9, url: 'https://files.test/photo' }];
    await receiverWith(api).handle({ ...message, text: '', media });

    const chat = api.requests.find((r) => r.url.endsWith('/orchestrator/chat'));
    expect(chat.init.body).toBeInstanceOf(FormData);
    expect(chat.init.headers['Content-Type']).toBeUndefined(); // multipart sets its own boundary
    const upload = chat.init.body.get('files');
    expect(upload.name).toBe('IMG_1.jpg');
    expect(Buffer.from(await upload.arrayBuffer()).toString()).toBe('JPEGBYTES');
    expect(JSON.parse(chat.init.body.get('messages')).at(-1)).toEqual({ role: 'user', content: '(sent an attachment)' });
    expect(chat.init.body.get('conversationId')).toBe('conv-main');
    expect(chat.init.body.get('textMode')).toBe('true');

    expect(calls.map((c) => c.path)).toEqual(['/messages/m-1/media', '/messages/m-1/reply']);
    expect(calls[0].opts.body).toEqual({ name: 'chart.png', mime: 'image/png', bytes: 7 });
    expect(calls[1].opts.body).toEqual({ text: 'Here is the trend: chart (attached)', media: ['media-out-1'] });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('gives the text back to the queue when Annie fails, and never replies', async () => {
    const api = localApi({ extra: (url) => (url.endsWith('/orchestrator/chat') ? new Response('nope', { status: 500 }) : null) });
    await receiverWith(api).handle(message);
    expect(calls.map((c) => c.path)).toEqual(['/messages/m-1/release']);
  });

  it('gives the text back when the Main chat cannot be reached', async () => {
    const api = localApi({ extra: (url) => (url.endsWith('/content-outputs/main-chat') ? new Response('{}', { status: 500 }) : null) });
    await receiverWith(api).handle(message);
    expect(api.requests.some((r) => r.url.endsWith('/orchestrator/chat'))).toBe(false);
    expect(calls.map((c) => c.path)).toEqual(['/messages/m-1/release']);
  });
});

describe('fileThreadStore', () => {
  it("remembers each phone's thread across instances; a missing file reads as nothing seen", async () => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-threads-'));
    const file = path.join(dir, 'mobile-threads.json');
    const first = fileThreadStore(file);
    expect(await first.get('p1')).toBeNull();
    await first.set('p1', 3);
    expect(await fileThreadStore(file).get('p1')).toBe(3);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
