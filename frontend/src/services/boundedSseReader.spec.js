import { describe, it, expect, vi } from 'vitest';
import { createBoundedSseReader } from './boundedSseReader.js';
const bytes = s => new TextEncoder().encode(s);
function fixture(chunks, options) {
  const reader = { read: vi.fn(async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true }), cancel: vi.fn(), releaseLock: vi.fn() };
  return { reader, framed: createBoundedSseReader(reader, options) };
}
describe('bounded JSON SSE transport', () => {
  it('decodes byte-split UTF8 and CRLF; ignores heartbeats', async () => {
    const f = fixture([...bytes(': ping\r\n\r\nevent: final_content\r\ndata: {"content":"Grüße"}\r\n\r\n')].map(x => Uint8Array.of(x)));
    const events = []; let result;
    do { result = await f.framed.read(); events.push(...result.events); } while (!result.done);
    expect(events).toEqual([{ name: 'final_content', data: { content: 'Grüße' } }]);
    expect(f.reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(f.reader.cancel).not.toHaveBeenCalled();
  });
  it.each(['event: error\ndata: {"error":"lost"', 'event: done\ndata: {}', ' ', 'event: done\ndata: {}\n'])('rejects incomplete EOF %s', async tail => {
    const f = fixture([bytes(tail)]); await f.framed.read();
    await expect(f.framed.read()).rejects.toThrow('sse_incomplete_eof');
    expect(f.reader.cancel).toHaveBeenCalledTimes(1); expect(f.reader.releaseLock).toHaveBeenCalledTimes(1);
  });
  it.each(['event: done\ndata: {oops}\n\n', 'event: done\n\n', 'event: done\ndata: []\n\n', 'garbage\n\n'])('rejects malformed frame %s', async text => {
    const f = fixture([bytes(text)]); await expect(f.framed.read()).rejects.toThrow();
    expect(f.reader.releaseLock).toHaveBeenCalledTimes(1);
  });
  it('delivers accepted frames before a malformed frame in the same chunk', async () => {
    const f = fixture([bytes('event: agent_execution_started\ndata: {"executionId":"e"}\n\nevent: done\ndata: nope\n\n')]);
    expect((await f.framed.read()).events).toEqual([{name:'agent_execution_started',data:{executionId:'e'}}]);
    await expect(f.framed.read()).rejects.toThrow(); expect(f.reader.read).toHaveBeenCalledTimes(1);
  });
  it('bounds a stalled read even when transport cancellation never resolves', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture([], {readTimeoutMs:10}); f.reader.read.mockReturnValue(new Promise(() => {})); f.reader.cancel.mockReturnValue(new Promise(() => {}));
      const p = expect(f.framed.read()).rejects.toThrow('sse_read_timeout');
      await vi.advanceTimersByTimeAsync(11); await p;
      expect(f.reader.cancel).toHaveBeenCalledTimes(1); expect(f.reader.releaseLock).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('bounds pending frames', async () => { const f = fixture([bytes('x'.repeat(33))], { maxFrameChars: 32 }); await expect(f.framed.read()).rejects.toThrow('sse_frame_limit'); });
  it('bounds total stream', async () => { const f = fixture([bytes(': ping\n\n'.repeat(5))], { maxStreamChars: 10 }); await expect(f.framed.read()).rejects.toThrow('sse_stream_limit'); });
  it('rejects incomplete UTF8 on EOF', async () => { const f = fixture([Uint8Array.of(0xc3)]); await f.framed.read(); await expect(f.framed.read()).rejects.toThrow(); expect(f.reader.releaseLock).toHaveBeenCalledTimes(1); });
  it('cleans up on thrown read', async () => { const f = fixture([]); f.reader.read.mockRejectedValue(new Error('disconnect')); await expect(f.framed.read()).rejects.toThrow('disconnect'); expect(f.reader.cancel).toHaveBeenCalledTimes(1); expect(f.reader.releaseLock).toHaveBeenCalledTimes(1); });
});
