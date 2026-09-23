import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
const env = vi.hoisted(() => ({ socket: null }));
vi.mock('@/composables/useRealtimeSync.js', () => ({ getRealtimeSocket: () => env.socket }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: '/api' } }));
import BrowserStreamView from './BrowserStreamView.vue';
let handlers, wrapper, images, draw, requests, fetchImpl;
const receive = (name, body) => { for (const fn of handlers.get(name) || []) fn(body); };
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => 'fixture-token' });
  vi.useFakeTimers(); handlers = new Map(); images = []; requests = []; draw = vi.fn();
  env.socket = { connected: true, on: vi.fn((n,f) => { if (!handlers.has(n)) handlers.set(n,new Set()); handlers.get(n).add(f); }), off: vi.fn((n,f) => handlers.get(n)?.delete(f)), emit: vi.fn((n,p,ack) => { if (n === 'browser:watching') ack?.({ok:true}); }) };
  vi.stubGlobal('Image', class { constructor() { this.width=800; this.height=600; images.push(this); } set src(v) { this.value=v; } });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw });
  fetchImpl = async (url, opts) => url.endsWith('/view-capabilities') ? response({protocolVersion:2}) : opts?.method === 'POST' ? response({ instanceId:'i', viewerId:'v', streamId:'s1', url:'https://example.org' }) : response({});
  vi.stubGlobal('fetch', vi.fn((url,opts) => { requests.push({url,opts}); return fetchImpl(url,opts); }));
});
afterEach(() => { wrapper?.unmount(); wrapper=null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const boot = async () => { wrapper = mount(BrowserStreamView, {props:{launch:false}}); await flushPromises(); };
const authenticate = async () => { receive('authenticated',{success:true,userId:'alice'}); await flushPromises(); };
const frame = () => receive('browser:frame',{ instanceId:'i', streamId:'s1', frameId:9, data:'AAA' });
describe('Given the real live-view component', () => {
  it('When a socket exists but has not authenticated, Then HTTP subscription waits', async () => {
    await boot(); expect(fetch).not.toHaveBeenCalled();
    await authenticate(); expect(requests.filter(r=>r.opts?.method==='POST')).toHaveLength(1);
  });
  it('When registration succeeds without frames, Then the bounded status names missing frames, not missing browser', async () => {
    await boot(); await authenticate(); await vi.advanceTimersByTimeAsync(9000);
    expect(wrapper.text()).toMatch(/no frame|not received|not delivering/i);
    expect(wrapper.text()).not.toMatch(/Waiting for the browser to open/);
  });
  it('When a frame is decoded, Then canvas paint occurs before its ACK', async () => {
    await boot(); await authenticate(); frame();
    expect(env.socket.emit.mock.calls.filter(c=>c[0]==='browser:ack')).toHaveLength(0);
    images[0].onload(); await flushPromises();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(env.socket.emit).toHaveBeenCalledWith('browser:ack',expect.objectContaining({instanceId:'i',frameId:9}));
    expect(wrapper.find('.stream-status').exists()).toBe(false);
  });
  it('When reconnect occurs, Then subscription waits for re-authentication and acquires a new lease', async () => {
    await boot(); await authenticate();
    env.socket.connected=false; receive('disconnect'); env.socket.connected=true; receive('connect'); await flushPromises();
    expect(requests.filter(r=>r.opts?.method==='POST')).toHaveLength(1);
    await authenticate(); expect(requests.filter(r=>r.opts?.method==='POST')).toHaveLength(2);
  });
  it('When unmounted during HTTP, Then the late lease is released without watcher registration', async () => {
    let finish;
    fetchImpl = async (url,opts) => url.endsWith('/view-capabilities') ? response({protocolVersion:2}) : opts?.method==='POST' ? new Promise(r=>{finish=r;}) : response({});
    await boot(); await authenticate(); wrapper.unmount(); wrapper=null;
    finish(response({instanceId:'i',viewerId:'late'})); await flushPromises();
    expect(requests.some(r=>r.opts?.method==='DELETE' && r.url.includes('late'))).toBe(true);
    expect(env.socket.emit.mock.calls.some(c=>c[0]==='browser:watching')).toBe(false);
  });
  it('When decode finishes after disconnect, Then the old image cannot paint or ACK', async () => {
    await boot(); await authenticate(); frame(); env.socket.connected=false; receive('disconnect'); images[0].onload();
    expect(draw).not.toHaveBeenCalled();
    expect(env.socket.emit.mock.calls.some(c=>c[0]==='browser:ack')).toBe(false);
  });
  it('When capture produces a snapshot without a screencast frame ID, Then it paints without a CDP ACK', async () => {
    await boot(); await authenticate(); receive('browser:frame',{instanceId:'i',streamId:'s1',data:'AAA',source:'snapshot',capturedAt:Date.now()}); images[0].onload();
    expect(draw).toHaveBeenCalledTimes(1);
    expect(env.socket.emit.mock.calls.some(c=>c[0]==='browser:ack')).toBe(false);
  });
});
