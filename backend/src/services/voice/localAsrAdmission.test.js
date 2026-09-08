import { it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createLocalAsrHandler } from './localAsrHandler.js';
function request(id) {
 const req = Readable.from([Buffer.alloc(640)]); req.user = { id: 'unit-user' }; req.headers = { 'x-asr-utterance-id': id, 'content-type': 'audio/pcm' }; req.query = {}; req.complete = true;
 const res = new EventEmitter(); res.setHeader = () => {}; res.status = vi.fn(() => res); res.json = vi.fn(); res.destroyed = false;
 return {req,res};
}
it('reserves ownership during async resolution and releases after unavailable', async () => {
 let resolve; const binding = vi.fn(() => new Promise(r => { resolve = r; }));
 const handler = createLocalAsrHandler({ resolveBinding: binding, timeoutMs: 500 });
 const a = request('a'), b = request('b'); const pending = handler(a.req,a.res);
 await handler(b.req,b.res); expect(b.res.status).toHaveBeenCalledWith(429); expect(binding).toHaveBeenCalledTimes(1);
 resolve(null); await pending; expect(a.res.status).toHaveBeenCalledWith(503);
});
it.each(['timeout','disconnect'])('late admission after %s cannot open a socket', async mode => {
 let resolve; const openSocket = vi.fn();
 const handler = createLocalAsrHandler({ resolveBinding: () => new Promise(r => { resolve = r; }), timeoutMs: 20 });
 const a = request(mode); const pending = handler(a.req,a.res);
 if (mode === 'disconnect') a.res.emit('close');
 await pending;
 expect(a.res.status).toHaveBeenCalledWith(mode === 'timeout' ? 504 : 502);
 resolve({id:'local-asr-candidate',sampleRate:16000,openSocket}); await Promise.resolve();
 expect(openSocket).not.toHaveBeenCalled();
});
