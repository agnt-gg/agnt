import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import Settings from './CodexVoiceSettings.vue';
import CustomSelect from '../views/_components/common/CustomSelect.vue';
const account2 = wrapper => wrapper.findAllComponents(CustomSelect)[1].props('options').find(option => option.value === 'openai-codex-2');
import { codexVoiceProfiles as p } from '../voice/codexVoiceSettings.js';
const scope = userId => ({userId,installation:'http://localhost:3333/api'});
const catalog = (provider,registered) => new Response(JSON.stringify({provider,registered,voices:['cove','vale'],fallback:'none',entitlement:'unverified'}));
let wrapper;
beforeEach(()=>{p.setScope(null);p.setScope(scope('alice'));p.settings.engine='codex';});
afterEach(()=>{wrapper?.unmount();wrapper=null;p.setScope(null);vi.useRealTimers();vi.unstubAllGlobals();});
describe('mounted voice settings registration and identity races',()=>{
 it('checks both exact accounts; unavailable account2 is disabled without fallback or mutation',async()=>{
  const fetch=vi.fn(async url=>{const provider=new URL(url,'http://localhost').searchParams.get('provider');return catalog(provider,provider==='openai-codex');});vi.stubGlobal('fetch',fetch);
  p.settings.provider='openai-codex-2';wrapper=mount(Settings);await flushPromises();
  expect(fetch).toHaveBeenCalledTimes(2);const option=account2(wrapper);expect(option.disabled).toBe(true);expect(p.settings.provider).toBe('openai-codex-2');expect(wrapper.text()).toContain('not registered');
  expect(fetch.mock.calls.every(([url])=>url.includes('/capabilities?provider='))).toBe(true);
 });
 it('late old identity reply cannot mark new account registered',async()=>{
  const pending=[];vi.stubGlobal('fetch',vi.fn((url,options)=>new Promise(resolve=>pending.push({url,options,resolve}))));
  wrapper=mount(Settings);await nextTick();expect(pending).toHaveLength(2);
  p.setScope(scope('bob'));p.settings.engine='codex';await nextTick();expect(pending[0].options.signal.aborted).toBe(true);
  for(const request of pending.slice(0,2)) request.resolve(catalog(new URL(request.url,'http://localhost').searchParams.get('provider'),true));await flushPromises();
  expect(wrapper.text()).not.toContain('Provider registered.');expect(account2(wrapper).disabled).toBe(true);
 });
 it('contradictory provider reply is unavailable, not registration proof',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>catalog('wrong-provider',true)));wrapper=mount(Settings);await flushPromises();expect(wrapper.text()).not.toContain('Provider registered.');expect(wrapper.text()).toContain('failed');
 });
 it('logout disables settings and aborts outstanding requests',async()=>{
  const signals=[];vi.stubGlobal('fetch',vi.fn((url,options)=>{signals.push(options.signal);return new Promise(()=>{});}));wrapper=mount(Settings);await nextTick();p.setScope(null);await nextTick();expect(signals.every(s=>s.aborted)).toBe(true);expect(wrapper.findComponent(CustomSelect).props('disabled')).toBe(true);expect(wrapper.text()).toContain('Sign in');
 });
 it('oversized metadata fails closed',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(8193))));wrapper=mount(Settings);await flushPromises();expect(wrapper.text()).toContain('failed');expect(account2(wrapper).disabled).toBe(true);
 });
 it('timeout aborts both requests and unmount leaves no deadline timer',async()=>{
  vi.useFakeTimers();const signals=[];vi.stubGlobal('fetch',vi.fn((url,options)=>{signals.push(options.signal);return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));}));
  wrapper=mount(Settings);await nextTick();expect(vi.getTimerCount()).toBe(1);await vi.advanceTimersByTimeAsync(5000);expect(signals.every(s=>s.aborted)).toBe(true);expect(wrapper.text()).toContain('failed');wrapper.unmount();wrapper=null;expect(vi.getTimerCount()).toBe(0);
 });
 it('unmount aborts outstanding catalog requests',async()=>{
  const signals=[];vi.stubGlobal('fetch',vi.fn((url,options)=>{signals.push(options.signal);return new Promise(()=>{});}));wrapper=mount(Settings);await nextTick();wrapper.unmount();wrapper=null;expect(signals).toHaveLength(2);expect(signals.every(s=>s.aborted)).toBe(true);
 });
});
