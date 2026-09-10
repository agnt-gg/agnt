import { randomUUID } from 'node:crypto';
import { addFrameViewer } from './browserViewerDeliveryRegistry.js';
import { registerViewer, viewerStreamId, renewViewer, releaseViewer, releaseSocketViewers, ownsSocketViewer } from './BrowserViewerLeaseService.js';
import { acknowledgeFrame, captureViewerFrame, ownsStream } from './BrowserScreencastService.js';

export function attachBrowserViewerSocket(socket) {
  const deliveries = new Map();
  socket.on('browser:painted', ({instanceId, viewerId, streamId, bootstrapId} = {}) => {
    const state = deliveries.get(viewerId);
    const request = {userId:socket.userId, socketId:socket.id, instanceId, viewerId};
    if (state && state.streamId === streamId && (!bootstrapId || bootstrapId === state.bootstrapId) && ownsSocketViewer(request)) state.cancel();
  });
  socket.on('browser:unwatching', ({instanceId, viewerId} = {}) => {
    const request = {userId:socket.userId, socketId:socket.id, instanceId, viewerId};
    if (ownsSocketViewer(request)) releaseViewer(request);
  });
  socket.on('browser:renew', ({ instanceId, viewerId } = {}, ack) => {
    if (!socket.userId || !socket.connected) return ack?.({ ok: false });
    ack?.(renewViewer({ userId: socket.userId, instanceId, viewerId, socketId: socket.id }));
  });
  socket.on('browser:ack', ({ instanceId, frameId, streamId } = {}) => {
    if (socket.userId && streamId && ownsStream(socket.userId, instanceId, streamId)) acknowledgeFrame(instanceId, frameId, streamId);
  });
  socket.on('browser:watching', async ({ instanceId, viewerId } = {}, ack) => {
    const request = { userId: socket.userId, instanceId, viewerId, socketId: socket.id };
    if (!socket.userId || !socket.connected) return ack?.({ ok: false, error: 'unauthenticated' });
    const result = registerViewer(request);
    ack?.(result);
    if (!result.ok || result.alreadyRegistered) return;
    const streamId = viewerStreamId(request);
    const state = {streamId, bootstrapId:randomUUID(), frame:null, timer:null, done:false, started:Date.now(), attempts:0};
    state.cancel = () => {
      state.done = true; clearTimeout(state.timer); clearTimeout(state.deadline); state.frame = null;
      deliveries.delete(viewerId);
    };
    deliveries.set(viewerId, state);
    addFrameViewer(viewerId, {...request, streamId, cancel:state.cancel});
    const valid = () => !state.done && socket.connected && socket.userId === request.userId && ownsSocketViewer(request);
    state.deadline = setTimeout(() => {
      if (valid()) { state.cancel(); socket.emit('browser:frame-unavailable', {instanceId, viewerId}); }
    }, 6000);
    state.deadline.unref?.();
    const attempt = async () => {
      if (!valid()) { state.cancel(); return; }
      if (Date.now()-state.started >= 6000 || state.attempts >= 8) {
        state.cancel(); socket.emit('browser:frame-unavailable', {instanceId, viewerId}); return;
      }
      try {
        if (!state.frame) state.frame = await captureViewerFrame(request);
        if (!valid()) { state.cancel(); return; }
        state.attempts++;
        if (socket.conn?.transport?.writable !== false) {
          (socket.volatile || socket).emit('browser:frame', {...state.frame, viewerId, bootstrapId:state.bootstrapId});
        }
      } catch {
        if (!valid()) { state.cancel(); return; }
      }
      // Repeated images retain the original capturedAt timestamp and snapshot
      // label. They are delivery retries, never claimed as new captures.
      if (valid()) { state.timer=setTimeout(attempt,750); state.timer.unref?.(); }
    };
    await attempt();
  });
  socket.on('disconnect', () => releaseSocketViewers(socket.id));
}

export function revokeBrowserViewerIdentity(socket) {
  releaseSocketViewers(socket.id);
  if (socket.userId) socket.leave('user:' + socket.userId);
  socket.userId = null;
  socket.identityVerified = false;
}
