import { describe, expect, it, vi } from 'vitest';
import { createConnectionRuntime, readEventStream } from './connectionRuntime.js';

function setup(fetchImpl) {
  return createConnectionRuntime({
    profiles: [{ id: 'test-api', baseUrl: 'https://api.example.test/v1/', auth: { type: 'api-key' } }],
    fetchImpl,
    credentialStore: { read: async () => ({ accessToken: 'owned-test-key', ownedByAgnt: true }), write: async () => {}, remove: async () => {} },
  });
}
function stream(text, { oneByte = false, complete = true } = {}) {
  const bytes = new TextEncoder().encode(text); let offset = 0;
  const cancelled = vi.fn();
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (offset < bytes.length) { const end = oneByte ? offset + 1 : bytes.length; controller.enqueue(bytes.slice(offset, end)); offset = end; }
      else if (complete) controller.close();
    },
    cancel: cancelled,
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  return { response, cancelled };
}
async function collect(response, options) { const out = []; for await (const event of readEventStream(response, options)) out.push(event); return out; }

describe('credential-bound requests', () => {
  it('uses caller payload unchanged and adds only Bearer authorization', async () => {
    const response = new Response('ok'); const fetchImpl = vi.fn(async () => response);
    const runtime = setup(fetchImpl); const abort = new AbortController(); const body = '{"input":"hello"}';
    expect(await runtime.request('test-api', 'responses?mode=test', { method: 'POST', body, headers: { 'content-type': 'application/json' }, signal: abort.signal })).toBe(response);
    const [url, options] = fetchImpl.mock.calls[0]; expect(url).toBe('https://api.example.test/v1/responses?mode=test');
    expect(options.body).toBe(body); expect(Object.fromEntries(options.headers)).toEqual({ authorization: 'Bearer owned-test-key', 'content-type': 'application/json' });
    expect(options.redirect).toBe('manual'); abort.abort(); expect(options.signal.aborted).toBe(true);
  });
  it.each(['https://attacker.example.test/', '//attacker.example.test/', 'https://api.example.test:444/path'])('refuses cross-origin URL %s without fetching', async url => {
    const fetchImpl = vi.fn(); await expect(setup(fetchImpl).request('test-api', url)).rejects.toThrow('credential_destination_refused'); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['Authorization', 'authorization', 'AUTHORIZATION'])('refuses caller override through %s', async key => {
    const fetchImpl = vi.fn(); await expect(setup(fetchImpl).request('test-api', 'responses', { headers: { [key]: 'injected' } })).rejects.toThrow('authorization_override_refused'); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('refuses redirects and cancels the response rather than forwarding credentials', async () => {
    const cancelled = vi.fn(); const response = new Response(new ReadableStream({ cancel: cancelled }), { status: 302, headers: { location: 'https://attacker.example.test/' } });
    const fetchImpl = vi.fn(async () => response);
    await expect(setup(fetchImpl).request('test-api', 'responses')).rejects.toMatchObject({ code: 'redirect_refused', status: 302 });
    expect(fetchImpl).toHaveBeenCalledTimes(1); expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it('returns non-redirect HTTP errors without retrying or switching connections', async () => {
    const response = new Response('rate limited', { status: 429 }); const fetchImpl = vi.fn(async () => response);
    expect(await setup(fetchImpl).request('test-api', 'responses')).toBe(response); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('redacts network errors and distinguishes a caller abort', async () => {
    const fetchImpl = vi.fn(async () => { throw Error('request with owned-test-key failed'); });
    await expect(setup(fetchImpl).request('test-api', 'responses')).rejects.toThrow('connection_unavailable');
    const signal = AbortSignal.abort(); await expect(setup(fetchImpl).request('test-api', 'responses', { signal })).rejects.toThrow('request_aborted');
  });
});

describe('bounded generic server-sent events', () => {
  it.each(['\n', '\r\n', '\r'])('handles one-byte UTF-8 chunks with line separator %j', async nl => {
    const text = ['id: event-1', 'event: delta', 'data: héllo 🎈', 'data: next', 'retry: 1234', '', 'data: tail', '', ''].join(nl);
    expect(await collect(stream(text, { oneByte: true }).response)).toEqual([
      { event: 'delta', data: 'héllo 🎈\nnext', id: 'event-1', retry: 1234 },
      { event: 'message', data: 'tail', id: 'event-1' },
    ]);
  });
  it('leaves upstream error and DONE payloads intact for an adapter to interpret', async () => {
    const text = 'event: error\ndata: {"error":{"type":"overloaded"}}\n\ndata: [DONE]\n\n';
    expect(await collect(stream(text).response)).toEqual([
      { event: 'error', data: '{"error":{"type":"overloaded"}}', id: '' },
      { event: 'message', data: '[DONE]', id: '' },
    ]);
  });
  it('ignores comments/unknown fields and discards an incomplete event at EOF', async () => {
    expect(await collect(stream(': keepalive\nunknown: field\n\ndata: unfinished\n').response)).toEqual([]);
  });
  it('handles empty data, colonless data, invalid IDs and invalid retry fields', async () => {
    const result = await collect(stream('id: good\ndata:\n\nid: bad\0id\nretry: nope\ndata\n\n').response);
    expect(result).toEqual([{ event: 'message', data: '', id: 'good' }, { event: 'message', data: '', id: 'good' }]);
  });
  it('drops a leading UTF-8 BOM without losing the first field', async () => {
    expect(await collect(stream('\uFEFFdata: content\n\n', { oneByte: true }).response)).toEqual([{ event: 'message', data: 'content', id: '' }]);
  });
  it('bounds unterminated frames by bytes and releases the reader on failure', async () => {
    const { response, cancelled } = stream('data: ' + 'é'.repeat(100), { oneByte: true, complete: false });
    await expect(collect(response, { maxFrameBytes: 20 })).rejects.toThrow('event_frame_too_large');
    expect(cancelled).toHaveBeenCalledTimes(1); expect(response.body.locked).toBe(false);
  });
  it('does not mistake several small events in one chunk for one oversized frame', async () => {
    expect(await collect(stream('data: a\n\n'.repeat(30)).response, { maxFrameBytes: 12 })).toHaveLength(30);
  });
  it('cancels the underlying stream on an early consumer exit', async () => {
    const { response, cancelled } = stream('data: first\n\ndata: second\n\n', { complete: false });
    for await (const event of readEventStream(response)) { expect(event.data).toBe('first'); break; }
    expect(cancelled).toHaveBeenCalledTimes(1); expect(response.body.locked).toBe(false);
  });
  it('releases an exhausted stream without cancelling it', async () => {
    const { response, cancelled } = stream('data: last\n\n'); await collect(response);
    expect(response.body.locked).toBe(false); expect(cancelled).not.toHaveBeenCalled();
  });
  it('rejects failed HTTP responses and non-event streams', async () => {
    await expect(collect(new Response('bad', { status: 503 }))).rejects.toMatchObject({ code: 'upstream_http_error', status: 503 });
    await expect(collect(new Response('json'))).rejects.toThrow('invalid_event_stream');
    await expect(collect(stream('data: hi\n\n').response, { maxFrameBytes: 0 })).rejects.toThrow('invalid_runtime_limit');
  });
});
