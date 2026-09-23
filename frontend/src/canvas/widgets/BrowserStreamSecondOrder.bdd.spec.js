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
  it('Given a replacement stream, When an old frame arrives, Then it neither paints nor ACKs', async()=>{
    await boot(); await authenticate();
    receive('browser:frame',{instanceId:'i',streamId:'retired',frameId:9,data:'OLD'});
    for(const image of images) image.onload();
    expect(draw).not.toHaveBeenCalled();
    expect(env.socket.emit.mock.calls.some(c=>c[0]==='browser:ack')).toBe(false);
  });
  it('Given a replacement stream, When an old stop arrives, Then the current lease remains', async()=>{
    await boot(); await authenticate();
    receive('browser:stopped',{instanceId:'i',streamId:'retired'}); await flushPromises();
    expect(requests.filter(r=>r.opts?.method==='POST')).toHaveLength(1);
    expect(requests.filter(r=>r.opts?.method==='DELETE')).toHaveLength(0);
  });
  it('Given a snapshot bootstrap, When it paints, Then the UI identifies it as a snapshot rather than verified live capture', async()=>{
    await boot(); await authenticate();
    receive('browser:frame',{instanceId:'i',streamId:'s1',data:'AAA',source:'snapshot',capturedAt:Date.now()});
    images[0].onload(); await flushPromises();
    expect(wrapper.text()).toMatch(/snapshot/i);
  });
  it('Given a previously painted frame, When the next decode fails, Then its error remains visible', async()=>{
    await boot(); await authenticate(); frame(); images[0].onload(); await flushPromises();
    frame(); images[1].onerror(); await flushPromises();
    expect(wrapper.text()).toMatch(/could not be decoded/i);
  });
  it('Given a command in flight, When disconnect precedes its response, Then the response cannot change the new view', async()=>{
    await boot(); await authenticate(); let finish;
    fetchImpl=async(url,opts)=> url.endsWith('/control') ? new Promise(r=>{finish=r;}) : response({});
    const command=wrapper.vm.navigate('https://requested.example');
    env.socket.connected=false; receive('disconnect');
    finish(response({url:'https://old-result.example'})); await command; await flushPromises();
    expect(wrapper.vm.currentUrl).not.toBe('https://old-result.example');
  });

});
