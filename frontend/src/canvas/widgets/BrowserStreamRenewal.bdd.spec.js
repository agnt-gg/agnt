import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
const env = vi.hoisted(() => ({ socket: null }));
vi.mock('@/composables/useRealtimeSync.js', () => ({ getRealtimeSocket: () => env.socket, ensureRealtimeConnected: () => { env.nudges = (env.nudges || 0) + 1; } }));
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
  it('Given an active view, When renewal is unanswered, Then the old picture is hidden and the view re-subscribes by itself',async()=>{
    await boot(); await authenticate(); frame(); images[0].onload(); await flushPromises();
    await vi.advanceTimersByTimeAsync(21000); await flushPromises();
    expect(env.socket.emit.mock.calls.some(c=>c[0]==='browser:renew')).toBe(true);
    expect(wrapper.find('.stream-status').exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/Retry/);
    await vi.advanceTimersByTimeAsync(1100); await flushPromises();
    // A second lease was requested with no user action.
    expect(requests.filter(r=>r.opts?.method==='POST' && r.url.endsWith('/view'))).toHaveLength(2);
  });
  it('Given no socket ever appears, When time passes, Then it keeps pulling the socket back and never offers a Retry button',async()=>{
    env.socket=null; env.nudges=0; await boot(); await vi.advanceTimersByTimeAsync(16000);
    expect(wrapper.text()).toMatch(/Opening the browser/);
    expect(wrapper.text()).not.toMatch(/Retry|unavailable|timed out/i);
    expect(env.nudges).toBeGreaterThanOrEqual(2);
  });
  it('Given the socket appears late, When it authenticates, Then the view subscribes with no user action',async()=>{
    const late=env.socket; env.socket=null; await boot(); await vi.advanceTimersByTimeAsync(9000);
    env.socket=late; await vi.advanceTimersByTimeAsync(600); await authenticate();
    expect(requests.filter(r=>r.opts?.method==='POST' && r.url.endsWith('/view'))).toHaveLength(1);
  });
});
