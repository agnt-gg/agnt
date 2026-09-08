import { describe, it, expect, vi } from 'vitest';
import { reactive } from 'vue';
import * as profiles from './codexVoiceSettings.js';
import { createCodexVoiceController } from './codexVoiceController.js';
const defaults = { engine: 'legacy', provider: 'openai-codex', voice: 'cove' };
function storage() { const data = new Map(); return { data, getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) }; }
const scope = (userId='alice', installation='http://localhost:3333/api') => ({ userId, installation });
describe('voice profiles are bounded, user and installation scoped', () => {
 it('production singleton refuses unscoped persistence rather than writing browser-global settings', () => {
  const s=storage();vi.stubGlobal('localStorage',s);profiles.codexVoiceProfiles?.setScope(null);
  Object.assign(profiles.codexVoiceSettings,{engine:'codex',provider:'openai-codex-2',voice:'vale'});
  try { expect(profiles.saveCodexVoiceSettings()).toBe(false); expect(s.data.size).toBe(0); }
  finally {Object.assign(profiles.codexVoiceSettings,defaults);vi.unstubAllGlobals();}
 });
 it('never adopts ownerless legacy profile', () => {
  const s=storage(); s.setItem('agnt.voice.profile.v1', JSON.stringify({engine:'codex',provider:'openai-codex-2',voice:'vale'}));
  const p=profiles.createCodexVoiceProfiles({storage:s}); p.setScope(scope()); expect({...p.settings}).toEqual(defaults); expect(s.data.has('agnt.voice.profile.v1')).toBe(true);
 });
 it('isolates users, installations and logout, retaining explicit choices only for their owner', () => {
  const s=storage(),p=profiles.createCodexVoiceProfiles({storage:s});
  p.setScope(scope()); Object.assign(p.settings,{engine:'codex',provider:'openai-codex-2',voice:'vale'}); expect(p.save()).toBe(true);
  p.setScope(scope('bob')); expect({...p.settings}).toEqual(defaults);
  p.setScope(scope('alice','http://localhost:4444/api')); expect({...p.settings}).toEqual(defaults);
  p.setScope(scope()); expect({...p.settings}).toEqual({engine:'codex',provider:'openai-codex-2',voice:'vale'});
  p.setScope(null); expect({...p.settings}).toEqual(defaults); expect(p.save()).toBe(false);
 });
 it.each([{engine:'other'}, {provider:'openai'}, {voice:'not-a-voice'}, {voice:'cove'.repeat(500)}])('rejects malformed values without persisting or changing destination: %j', bad => {
  const s=storage(),p=profiles.createCodexVoiceProfiles({storage:s}); p.setScope(scope()); Object.assign(p.settings,bad); expect(p.save()).toBe(false); expect(s.data.size).toBe(0);
 });
 it('reload validates every field and strips extras', () => {
  const s=storage(),p=profiles.createCodexVoiceProfiles({storage:s}); p.setScope(scope()); p.save(); const key=[...s.data.keys()][0];
  s.setItem(key,JSON.stringify({...defaults,voice:'invalid',token:'must-not-load'}));p.setScope(null);p.setScope(scope());expect({...p.settings}).toEqual(defaults);
  s.setItem(key,JSON.stringify({...defaults,engine:'codex',extra:'drop'}));p.setScope(null);p.setScope(scope());expect({...p.settings}).toEqual({...defaults,engine:'codex'});
 });
 it('scope changes notify synchronously even for identical profile values, but same identity does not reset edits', () => {
  const p=profiles.createCodexVoiceProfiles({storage:storage()}),stop=vi.fn();p.onScopeChange(stop);p.setScope(scope());expect(stop).toHaveBeenCalledTimes(1);p.settings.voice='vale';p.setScope(scope());expect(stop).toHaveBeenCalledTimes(1);expect(p.settings.voice).toBe('vale');p.setScope(scope('bob'));expect(stop).toHaveBeenCalledTimes(2);
 });
 it('storage denial is nonfatal, unsigned/unbounded scopes cannot save', () => {
  const p=profiles.createCodexVoiceProfiles({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}}});p.setScope(scope());expect(p.save()).toBe(false);expect({...p.settings}).toEqual(defaults);
  for(const bad of [null,scope(''),scope('a'.repeat(300)),scope('alice','https://u:p@example.com/api'),scope('alice','https://example.com/api?token=x')]){expect(p.setScope(bad)).toBe(false);expect(p.save()).toBe(false);}
 });
 it('binds to verified Vuex identity, not a cached user during revocation, and releases watch on disposal', () => {
  const p=profiles.createCodexVoiceProfiles({storage:storage()}),state=reactive({userAuth:{user:{id:'alice'},sessionState:'valid'}});
  const dispose=profiles.bindCodexVoiceIdentity({state},'http://localhost:3333/api',p);p.settings.engine='codex';p.save();
  state.userAuth.sessionState='invalid';expect(p.identity.ready).toBe(false);expect(p.settings.engine).toBe('legacy');
  state.userAuth.sessionState='valid';expect(p.settings.engine).toBe('codex');state.userAuth.user={id:'bob'};expect(p.settings.engine).toBe('legacy');dispose();expect(p.identity.ready).toBe(false);
 });
});
describe('controller rejects invalid audio config before permission or provider use',()=>{
 it.each([{provider:'openai',voice:'cove'},{provider:'openai-codex-2',voice:'bad'}])('%j',async config=>{
  const getUserMedia=vi.fn(),fetchImpl=vi.fn(),onError=vi.fn();const c=createCodexVoiceController({submitTurn:vi.fn(),Peer:class {close(){}},getUserMedia,fetchImpl,onError});
  expect(await c.start(config)).toBe(false);expect(getUserMedia).not.toHaveBeenCalled();expect(fetchImpl).not.toHaveBeenCalled();expect(onError).toHaveBeenCalledWith('voice_invalid_settings');
 });
});
