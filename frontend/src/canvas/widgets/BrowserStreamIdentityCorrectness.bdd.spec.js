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

const snapshot=()=>receive('browser:frame',{instanceId:'i',streamId:'s1',source:'snapshot',data:'VALID'});
describe('Given receipt is not proof of valid pixels',()=>{
 it('When the first live image is malformed and a valid snapshot follows, Then the snapshot paints',async()=>{
  await boot();await authenticate();frame();images[0].onerror();snapshot();
  expect(images).toHaveLength(2);images[1].onload();await flushPromises();
  expect(draw).toHaveBeenCalledTimes(1);expect(wrapper.text()).toMatch(/Snapshot received/);
 });
 it('When a snapshot waits behind a live decode that fails, Then the queued snapshot is preserved',async()=>{
  await boot();await authenticate();frame();snapshot();images[0].onerror();
  expect(images).toHaveLength(2);images[1].onload();expect(draw).toHaveBeenCalledTimes(1);
 });
 it('When live decode times out, Then the queued snapshot can still recover and the late live callback is ignored',async()=>{
  await boot();await authenticate();frame();snapshot();await vi.advanceTimersByTimeAsync(5100);
  expect(images).toHaveLength(2);images[1].onload();images[0].onload();
  expect(draw).toHaveBeenCalledTimes(1);
 });
 it('When oversized decoded live pixels are rejected, Then they do not suppress the valid snapshot',async()=>{
  await boot();await authenticate();frame();images[0].width=2000;images[0].onload();snapshot();
  expect(images).toHaveLength(2);images[1].onload();expect(draw).toHaveBeenCalledTimes(1);
 });
});
describe('Given a shared socket changes authenticated identity',()=>{
 it('When Bob authenticates after Alice painted, Then old pixels and metadata are erased before new subscription completes',async()=>{
  await boot();await authenticate();frame();images[0].onload();await flushPromises();
  fetchImpl=async()=>new Promise(()=>{});
  receive('authenticated',{success:true,userId:'bob'});await flushPromises();
  expect(wrapper.get('canvas').element.width).toBe(0);
  expect(wrapper.vm.currentUrl).toBe('');expect(wrapper.vm.canGoBack).toBe(false);
  expect(wrapper.find('.stream-status').exists()).toBe(true);
  expect(requests.filter(r=>r.opts?.method==='DELETE')).toHaveLength(1);
 });
 it('When Bob authenticates during Alice decode, Then that old callback neither paints nor ACKs',async()=>{
  await boot();await authenticate();frame();
  receive('authenticated',{success:true,userId:'bob'});images[0].onload();await flushPromises();
  expect(draw).not.toHaveBeenCalled();
  expect(env.socket.emit.mock.calls.some(c=>c[0]==='browser:ack')).toBe(false);
  expect(requests.filter(r=>r.opts?.method==='POST')).toHaveLength(2);
  expect(JSON.parse(requests.filter(r=>r.opts?.method==='POST')[1].opts.body).launch).toBe(false);
 });
 it('When Alice reauthenticates as Alice, Then her current subscription is not duplicated',async()=>{
  await boot();await authenticate();frame();images[0].onload();await authenticate();
  expect(requests.filter(r=>r.opts?.method==='POST')).toHaveLength(1);
  expect(requests.filter(r=>r.opts?.method==='DELETE')).toHaveLength(0);
 });
 it('When Alice HTTP completes after Bob authenticates, Then Alice lease is released without watcher registration',async()=>{
  let finish;let posts=0;
  fetchImpl=async(url,opts)=>url.endsWith('/view-capabilities')?response({protocolVersion:2}):opts?.method==='POST' ? (++posts===1 ? new Promise(r=>finish=r) : response({instanceId:'bob-i',viewerId:'bob-v',streamId:'bob-s'})) : response({});
  await boot();await authenticate();receive('authenticated',{success:true,userId:'bob'});await flushPromises();
  finish(response({instanceId:'alice-i',viewerId:'alice-v',streamId:'alice-s'}));await flushPromises();
  expect(requests.some(r=>r.opts?.method==='DELETE'&&r.url.includes('alice-v'))).toBe(true);
  expect(env.socket.emit.mock.calls.some(c=>c[0]==='browser:watching'&&c[1].viewerId==='alice-v')).toBe(false);
 });
 it('When authentication is rejected, Then the underlying old canvas pixels and URL are erased',async()=>{
  await boot();await authenticate();frame();images[0].onload();receive('authenticated',{success:false});await flushPromises();
  expect(wrapper.get('canvas').element.width).toBe(0);expect(wrapper.vm.currentUrl).toBe('');
 });
 it('When a success message has no user identity, Then it cannot acquire a viewer',async()=>{
  await boot();receive('authenticated',{success:true});await flushPromises();
  expect(requests.filter(r=>r.opts?.method==='POST')).toHaveLength(0);
 });
});
