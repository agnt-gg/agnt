import {it,expect,vi} from 'vitest';
import {defineComponent,h} from 'vue';
import {mount} from '@vue/test-utils';
const fake=vi.hoisted(()=>({start:vi.fn(async()=>true),stop:vi.fn(),stopPlayback:vi.fn(),setListening:vi.fn()}));
vi.mock('../voice/codexVoiceController.js',()=>({createCodexVoiceController:()=>fake}));
import {useCodexVoice} from './useCodexVoice.js';
import {codexVoiceProfiles as profiles} from '../voice/codexVoiceSettings.js';
it('mounted composable keeps listening/playback/end controls separate and cleans up',async()=>{
 profiles.setScope({userId:'controls-fixture',installation:'http://localhost:3333/api'});vi.clearAllMocks();
 let voice;const submit=vi.fn();const wrapper=mount(defineComponent({setup(){voice=useCodexVoice({submitTurn:submit});return ()=>h('div',[h('button',{onClick:voice.stopPlayback},'Stop playback'),h('button',{onClick:voice.toggleListening},voice.listening.value?'Pause mic':'Resume mic')]);}}));
 expect(await voice.start()).toBe(true);expect(fake.start).toHaveBeenCalledOnce();await wrapper.findAll('button')[0].trigger('click');expect(fake.stopPlayback).toHaveBeenCalledOnce();expect(fake.stop).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();await wrapper.findAll('button')[1].trigger('click');expect(fake.setListening).toHaveBeenLastCalledWith(false);expect(wrapper.text()).toContain('Resume mic');await wrapper.findAll('button')[1].trigger('click');expect(fake.setListening).toHaveBeenLastCalledWith(true);wrapper.unmount();expect(fake.stop).toHaveBeenCalledOnce();profiles.setScope(null);
});
it('blocks unsigned starts and synchronously stops on identity change even with identical settings',async()=>{
 profiles.setScope(null);vi.clearAllMocks();let voice;
 const wrapper=mount(defineComponent({setup(){voice=useCodexVoice({submitTurn:vi.fn()});return ()=>h('div');}}));
 expect(await voice.start()).toBe(false);expect(fake.start).not.toHaveBeenCalled();
 profiles.setScope({userId:'alice',installation:'http://localhost:3333/api'});vi.clearAllMocks();expect(await voice.start()).toBe(true);
 profiles.setScope({userId:'bob',installation:'http://localhost:3333/api'});expect(fake.stop).toHaveBeenCalledOnce();expect(voice.partial.value).toBe('');
 wrapper.unmount();const stops=fake.stop.mock.calls.length;profiles.setScope(null);expect(fake.stop).toHaveBeenCalledTimes(stops);
});
