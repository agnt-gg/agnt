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
  it('Given a registered widget disappears but its shared socket survives, When 60 seconds pass without renewal, Then its lease is released',async()=>{
    const a=await acquire(); leases.registerViewer({userId:'u',instanceId:'i',viewerId:a.viewerId,socketId:'s'});
    await vi.advanceTimersByTimeAsync(60001);
    expect(fake.stopViewing).toHaveBeenCalledTimes(1);
  });
  it('Given an active lease, When its owning socket renews, Then expiry moves without another stream acquisition',async()=>{
    const a=await acquire(); const request={userId:'u',instanceId:'i',viewerId:a.viewerId,socketId:'s'};
    leases.registerViewer(request); await vi.advanceTimersByTimeAsync(45000);
    expect(leases.renewViewer(request).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(45000); expect(fake.stopViewing).not.toHaveBeenCalled();
    expect(fake.startViewing).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15001); expect(fake.stopViewing).toHaveBeenCalledTimes(1);
  });
  it('Given an active lease, When another socket renews it, Then renewal is refused',async()=>{
    const a=await acquire(); const request={userId:'u',instanceId:'i',viewerId:a.viewerId,socketId:'s'};
    leases.registerViewer(request);
    expect(leases.renewViewer({...request,socketId:'stranger'}).ok).toBe(false);
  });
});
