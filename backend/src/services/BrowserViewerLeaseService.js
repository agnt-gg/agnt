import { removeFrameViewer } from './browserViewerDeliveryRegistry.js';
import { randomUUID } from 'node:crypto';
import { startViewing, stopViewing, ownsStream } from './BrowserScreencastService.js';

// HTTP acquisition and socket registration are not atomic. Unregistered leases
// expire; registered leases belong to one socket. Both cleanup paths are
// idempotent, including late HTTP responses after a widget has unmounted.
const leases = new Map();
const starts = new Map();
const reservations = new Map();
const PENDING_MS = 15000;
const REGISTERED_MS = 60000;
function armExpiry(lease, ms) {
  clearTimeout(lease.timer);
  lease.timer = setTimeout(() => releaseViewer(lease), ms);
  lease.timer.unref?.();
}

export async function acquireViewer({ userId, instanceId, cdpUrl }) {
  const active = [...leases.values()].filter(l => l.userId === userId).length;
  if (active + (reservations.get(userId) || 0) >= 16 || leases.size + [...reservations.values()].reduce((a,b)=>a+b,0) >= 128) throw new Error('viewer capacity reached');
  reservations.set(userId, (reservations.get(userId) || 0) + 1);
  try {
  const previous = starts.get(instanceId) || Promise.resolve();
  const start = previous.catch(() => {}).then(() => startViewing({ userId, instanceId, cdpUrl }));
  starts.set(instanceId, start);
  let result;
  try { result = await start; }
  finally { if (starts.get(instanceId) === start) starts.delete(instanceId); }
  const viewerId = randomUUID();
  const lease = { userId, instanceId, viewerId, streamId: result.streamId, socketId: null, timer: null };
  leases.set(viewerId, lease);
  armExpiry(lease, PENDING_MS);
  return { ...result, viewerId, protocolVersion: 2 };
  } finally {
    const left = reservations.get(userId) - 1;
    if (left) reservations.set(userId, left); else reservations.delete(userId);
  }
}

function owned({ userId, instanceId, viewerId }) {
  const lease = leases.get(viewerId);
  return lease && lease.userId === userId && lease.instanceId === instanceId ? lease : null;
}

export function registerViewer({ userId, instanceId, viewerId, socketId }) {
  const lease = owned({ userId, instanceId, viewerId });
  if (!lease || !ownsStream(userId, instanceId, lease.streamId) || !socketId || (lease.socketId && lease.socketId !== socketId)) {
    return { ok: false, error: 'viewer lease is unavailable' };
  }
  if (lease.socketId === socketId) return { ok: true, alreadyRegistered: true };
  lease.socketId = socketId;
  armExpiry(lease, REGISTERED_MS);
  return { ok: true };
}

export function ownsSocketViewer({ userId, instanceId, viewerId, socketId }) {
  const lease = owned({ userId, instanceId, viewerId });
  return Boolean(lease && lease.socketId === socketId && ownsStream(userId, instanceId, lease.streamId));
}

export function viewerStreamId(request) {
  return ownsSocketViewer(request) ? owned(request).streamId : null;
}

export function renewViewer(request) {
  if (!ownsSocketViewer(request)) return { ok: false, error: 'viewer lease is unavailable' };
  armExpiry(owned(request), REGISTERED_MS);
  return { ok: true };
}

export function releaseViewer({ userId, instanceId, viewerId }) {
  const lease = owned({ userId, instanceId, viewerId });
  if (!lease) return { ok: false, error: 'viewer lease is unavailable' };
  leases.delete(viewerId);
  removeFrameViewer(viewerId);
  clearTimeout(lease.timer);
  stopViewing(instanceId, lease.streamId);
  return { ok: true };
}

export function releaseSocketViewers(socketId) {
  for (const lease of leases.values()) {
    if (lease.socketId === socketId) releaseViewer(lease);
  }
}

export function _releaseAll() {
  for (const lease of leases.values()) releaseViewer(lease);
}
