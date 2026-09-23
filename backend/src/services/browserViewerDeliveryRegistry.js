// Image recipients are lease-scoped, never the whole authenticated user room.
const viewers = new Map();
export function addFrameViewer(viewerId, entry) { viewers.set(viewerId, entry); }
export function removeFrameViewer(viewerId) {
  const entry = viewers.get(viewerId);
  viewers.delete(viewerId);
  entry?.cancel?.();
}
export function frameViewerSockets(userId, instanceId, streamId) {
  return [...new Set([...viewers.values()].filter(v => v.userId === userId && v.instanceId === instanceId && v.streamId === streamId).map(v => v.socketId))];
}
