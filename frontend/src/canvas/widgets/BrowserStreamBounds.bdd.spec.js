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
describe('Given bounded observation recovery',()=>{
 it('When a scaled screenshot receives a center click, Then input uses original viewport coordinates',async()=>{
  await boot();await authenticate();receive('browser:frame',{instanceId:'i',streamId:'s1',source:'snapshot',data:'IMG',metadata:{deviceWidth:1600,deviceHeight:1200}});images[0].onload();
  const canvas=wrapper.get('canvas');vi.spyOn(canvas.element,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:800,height:600});
  await canvas.trigger('mousedown',{clientX:400,clientY:300,button:0});
  expect(env.socket.emit).toHaveBeenCalledWith('browser:input',expect.objectContaining({params:expect.objectContaining({x:800,y:600})}));
 });
 it('When live pixels precede a late bootstrap snapshot, Then the snapshot never replaces them',async()=>{
  await boot();await authenticate();frame();images[0].onload();
  receive('browser:frame',{instanceId:'i',streamId:'s1',source:'snapshot',data:'OLD'});
  expect(images).toHaveLength(1);
 });
 it('When decode is slow and newer frames arrive, Then only the newest pending frame is decoded next',async()=>{
  await boot();await authenticate();frame();
  receive('browser:frame',{instanceId:'i',streamId:'s1',frameId:10,data:'SECOND'});
  receive('browser:frame',{instanceId:'i',streamId:'s1',frameId:11,data:'NEWEST'});
  expect(images).toHaveLength(1);images[0].onload();
  expect(images).toHaveLength(2);expect(images[1].value).toContain('NEWEST');
 });
 it('When decoding never completes, Then the image is retired within five seconds and retry is available',async()=>{
  await boot();await authenticate();frame();await vi.advanceTimersByTimeAsync(5100);
  expect(wrapper.text()).toMatch(/decod.*timed out/i);images[0].onload();expect(draw).not.toHaveBeenCalled();
 });
 it('When a document hides then returns, Then its lease is released and observation resumes without launch or browser actions',async()=>{
  await boot();await authenticate();
  vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');document.dispatchEvent(new Event('visibilitychange'));await flushPromises();
  expect(requests.filter(r=>r.opts?.method==='DELETE')).toHaveLength(1);
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');document.dispatchEvent(new Event('visibilitychange'));await flushPromises();
  expect(requests.filter(r=>r.opts?.method==='POST')).toHaveLength(2);
  expect(JSON.parse(requests.filter(r=>r.opts?.method==='POST')[1].opts.body).launch).toBe(false);
  expect(requests.some(r=>r.url.endsWith('/control') && r.opts?.method==='POST')).toBe(false);
 });
 it('When the server lacks the protocol, Then no viewer is acquired',async()=>{
  fetchImpl=async()=>response({},404);await boot();await authenticate();
  expect(requests.filter(r=>r.opts?.method==='POST')).toHaveLength(0);
  expect(wrapper.text()).toMatch(/protocol|update/i);
 });
});
