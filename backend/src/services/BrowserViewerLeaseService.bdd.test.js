import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const fake = vi.hoisted(() => ({ ownsStream: vi.fn(() => true), startViewing: vi.fn(), stopViewing: vi.fn(), captureViewerFrame: vi.fn() }));
vi.mock('./BrowserScreencastService.js', () => fake);
const leases = await import('./BrowserViewerLeaseService.js');
beforeEach(() => {
  vi.useFakeTimers();
  fake.startViewing.mockReset().mockResolvedValue({ ok: true, viewers: 1 });
  fake.stopViewing.mockReset().mockReturnValue({ ok: true });
  fake.captureViewerFrame.mockReset().mockResolvedValue({ instanceId: 'i', data: 'fresh', capturedAt: 123, source: 'snapshot' });
});
afterEach(() => { leases._releaseAll(); vi.useRealTimers(); });
const acquire = () => leases.acquireViewer({ userId: 'u', instanceId: 'i', cdpUrl: 'ws://local' });
describe('Given independently owned viewer leases', () => {
  it('When two viewers share a socket, Then disconnect releases both exactly once', async () => {
    const a = await acquire(); const b = await acquire();
    expect(a.viewerId).not.toBe(b.viewerId);
    expect(leases.registerViewer({ userId: 'u', instanceId: 'i', viewerId: a.viewerId, socketId: 's' }).ok).toBe(true);
    leases.registerViewer({ userId: 'u', instanceId: 'i', viewerId: b.viewerId, socketId: 's' });
    leases.releaseSocketViewers('s'); leases.releaseSocketViewers('s');
    leases.releaseViewer({ userId: 'u', instanceId: 'i', viewerId: a.viewerId });
    expect(fake.stopViewing).toHaveBeenCalledTimes(2);
  });
  it('When HTTP succeeds but no socket registers, Then the pending lease expires', async () => {
    await acquire(); await vi.advanceTimersByTimeAsync(15000);
    expect(fake.stopViewing).toHaveBeenCalledTimes(1);
  });
  it('When another user guesses a lease, Then registration and release are refused', async () => {
    const a = await acquire();
    expect(leases.registerViewer({ userId: 'other', instanceId: 'i', viewerId: a.viewerId, socketId: 's' }).ok).toBe(false);
    expect(leases.releaseViewer({ userId: 'other', instanceId: 'i', viewerId: a.viewerId }).ok).toBe(false);
    expect(fake.stopViewing).not.toHaveBeenCalled();
  });
  it('When another socket tries to steal a registered lease, Then it is refused', async () => {
    const a = await acquire();
    leases.registerViewer({ userId: 'u', instanceId: 'i', viewerId: a.viewerId, socketId: 's' });
    expect(leases.registerViewer({ userId: 'u', instanceId: 'i', viewerId: a.viewerId, socketId: 's2' }).ok).toBe(false);
  });
  it('When starts overlap, Then only one underlying start is in flight per instance', async () => {
    let finish;
    fake.startViewing.mockImplementationOnce(() => new Promise(r => { finish = r; }));
    const a = acquire(); const b = acquire();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.startViewing).toHaveBeenCalledTimes(1);
    finish({ ok: true }); await Promise.all([a,b]);
    expect(fake.startViewing).toHaveBeenCalledTimes(2);
  });
});
