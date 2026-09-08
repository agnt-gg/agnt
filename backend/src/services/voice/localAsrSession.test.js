import { it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createLocalAsrSession } from './localAsrSession.js';
const sessions = [];
afterEach(() => { for (const s of sessions.splice(0)) s.cancel(); });
class Socket extends EventEmitter {
  readyState = 1; sent = []; closed = false; hold = false;
  send(data, callback) { this.sent.push(data); if (this.hold) this.release = callback; else callback(); }
  close() { this.closed = true; this.emit('close'); }
  terminate() { this.close(); }
  message(data) { this.emit('message', Buffer.from(JSON.stringify(data)), false); }
}
async function setup(options = {}) {
  const socket = new Socket();
  const s = createLocalAsrSession({ openSocket: () => socket, utteranceId: 'test-utterance', timeoutMs: 100, ...options });
  sessions.push(s); socket.message({ type: 'ready' }); await s.ready;
  return { socket, s };
}
it('replaces partials, never commits soft/missing-finalize; closes before hard final is returned', async () => {
  const partial = vi.fn(); const { socket, s } = await setup({ onPartial: partial });
  await s.sendAudio(Buffer.alloc(320));
  socket.message({ type: 'transcript', text: 'Move the file', is_final: false });
  socket.message({ type: 'transcript', text: 'Move the file only', is_final: false });
  const p = s.finalize(); let settled = false; p.then(() => { settled = true; });
  await Promise.resolve();
  for (const extra of [{ finalize: false }, {}]) socket.message({ type: 'transcript', text: 'Move the file', is_final: true, ...extra });
  await Promise.resolve(); expect(settled).toBe(false);
  expect(partial.mock.calls.map(c => c[0])).toEqual(['Move the file', 'Move the file only']);
  socket.message({ type: 'transcript', text: 'Move the file only after making a backup.', is_final: true, finalize: true });
  expect(await p).toMatchObject({ ok: true, transcript: 'Move the file only after making a backup.', utteranceId: 'test-utterance', kind: 'local-asr-hard-final' });
  expect(socket.closed).toBe(true); expect(socket.listenerCount('message')).toBe(0);
  expect(socket.sent.at(-1)).toBe('{"type":"reset","finalize":true}');
});
it('orders the hard reset after in-flight audio, rejects overlap without an unbounded queue', async () => {
  const { socket, s } = await setup(); socket.hold = true;
  const sending = s.sendAudio(Buffer.alloc(320));
  expect(await s.sendAudio(Buffer.alloc(320))).toMatchObject({ ok: false, reason: 'busy' });
  const final = s.finalize(); expect(socket.sent).toHaveLength(1);
  socket.message({ type: 'transcript', text: 'No, do', is_final: false });
  expect(await s.sendAudio(Buffer.alloc(320))).toMatchObject({ ok: false, reason: 'not-listening' });
  socket.hold = false; socket.release(); await sending; await Promise.resolve();
  expect(socket.sent).toHaveLength(2);
  socket.message({ type: 'transcript', text: 'No, do not do it.', is_final: true, finalize: true });
  expect((await final).transcript).toBe('No, do not do it.');
});
it('times out without partial substitution; late hard-final cannot resurrect session', async () => {
  const { socket, s } = await setup({ timeoutMs: 15 });
  await s.sendAudio(Buffer.alloc(2)); socket.message({ type: 'transcript', text: 'Yes', is_final: false });
  const p = s.finalize(); expect(await p).toMatchObject({ ok: false, reason: 'timeout' });
  socket.message({ type: 'transcript', text: 'Yes', is_final: true, finalize: true });
  expect(await s.finalize()).toMatchObject({ ok: false, reason: 'timeout' }); expect(socket.closed).toBe(true);
});
it.each(['close', 'error'])('fails closed on transport %s without leaking exception contents', async event => {
  const { socket, s } = await setup(); await s.sendAudio(Buffer.alloc(2)); const p = s.finalize();
  socket.emit(event, new Error('PRIVATE')); const r = await p;
  expect(r.ok).toBe(false); expect(JSON.stringify(r)).not.toContain('PRIVATE');
});
it.each([Buffer.alloc(1), Buffer.alloc(32002), 'audio'])('rejects malformed/oversized input and closes', async input => {
  const { socket, s } = await setup(); expect(await s.sendAudio(input)).toMatchObject({ ok: false, reason: 'invalid-audio' }); expect(socket.closed).toBe(true);
});
it('rejects unsolicited hard finals before reset and finalization without audio', async () => {
  const { socket, s } = await setup();
  socket.message({ type: 'transcript', text: 'phantom', is_final: true, finalize: true });
  expect(await s.finalize()).toMatchObject({ ok: false, reason: 'unexpected-final' });
  const { s: empty } = await setup(); expect(await empty.finalize()).toMatchObject({ ok: false, reason: 'zero-audio' });
});
it('one reader per socket; duplicate final and identical fresh utterances have distinct lifecycles', async () => {
  for (const id of ['a', 'b']) {
    const { socket, s } = await setup({ utteranceId: id }); expect(socket.listenerCount('message')).toBe(1);
    await s.sendAudio(Buffer.alloc(2)); const p = s.finalize(); await Promise.resolve();
    socket.message({ type: 'transcript', text: 'No', is_final: true, finalize: true });
    socket.message({ type: 'transcript', text: 'Yes', is_final: true, finalize: true });
    expect(await p).toMatchObject({ transcript: 'No', utteranceId: id });
  }
});
it('bounds never-ready and never-settling sends and releases callers on cancellation', async () => {
  const socket = new Socket();
  const waiting = createLocalAsrSession({ openSocket: () => socket, utteranceId: 'waiting', timeoutMs: 10 }); sessions.push(waiting);
  expect(await waiting.ready).toMatchObject({ ok: false, reason: 'timeout' }); expect(socket.closed).toBe(true);
  const { socket: held, s } = await setup(); held.hold = true;
  const pending = s.sendAudio(Buffer.alloc(320)); s.cancel();
  expect(await pending).toMatchObject({ ok: false, reason: 'cancelled' }); expect(held.closed).toBe(true);
});
it('cancellation closes the transport, not an already accepted Annie task', async () => {
  const { socket, s } = await setup(); await s.sendAudio(Buffer.alloc(2)); const p = s.finalize(); s.cancel();
  expect(await p).toMatchObject({ ok: false, reason: 'cancelled' }); expect(socket.closed).toBe(true);
});
