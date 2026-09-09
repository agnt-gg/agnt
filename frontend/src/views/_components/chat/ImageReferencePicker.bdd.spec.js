import { describe,it,expect,vi,afterEach } from 'vitest';
import { mount,flushPromises } from '@vue/test-utils';
const state=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('@/services/imageReferencePicker.js',()=>({collectImageReferences:messages=>messages.map(m=>({imageId:m.id,label:m.id})),loadImageReference:state.load}));
import Picker from './ImageReferencePicker.vue';
let wrapper;
afterEach(()=>{wrapper?.unmount();wrapper=null;vi.clearAllMocks();});
function render(){wrapper=mount(Picker,{props:{messages:[{id:'img-gen-a'}],collection:{scopeKey:'conv-a',messages:[{id:'img-gen-a'}]},scopeKey:'conv-a'}});}
describe('Feature: explicit reference selection never sends a message',()=>{
 it('Given mismatched message scope, Then no stale choice is offered',async()=>{render();await wrapper.setProps({scopeKey:'conv-b'});expect(wrapper.find('[data-test="reference-open"]').exists()).toBe(false);});
 it('Given opening, Then no unbounded thumbnail URL is rendered',async()=>{render();await wrapper.get('[data-test="reference-open"]').trigger('click');expect(wrapper.find('img').exists()).toBe(false);});
 it('Given saved images, When opened, Then offer a choice without loading or sending',async()=>{
  render();await wrapper.get('[data-test="reference-open"]').trigger('click');expect(wrapper.find('[data-test="reference-img-gen-a"]').exists()).toBe(true);expect(state.load).not.toHaveBeenCalled();expect(wrapper.emitted('attach-files')).toBeUndefined();
 });
 it('When selecting one result, Then emit one File only and never submit',async()=>{
  const file=new File(['fixture'],'reference.png',{type:'image/png'});state.load.mockResolvedValue(file);render();await wrapper.get('[data-test="reference-open"]').trigger('click');await wrapper.get('[data-test="reference-img-gen-a"]').trigger('click');await flushPromises();
  expect(wrapper.emitted('attach-files')).toEqual([[[file], 'conv-a']]);expect(wrapper.emitted('submit')).toBeUndefined();expect(state.load).toHaveBeenCalledOnce();
 });
 it.each(['scope','close','unmount'])('Given pending load, When %s changes, Then abort and discard late resolution',async action=>{
  let resolve;state.load.mockImplementation(()=>new Promise(r=>resolve=r));render();await wrapper.get('[data-test="reference-open"]').trigger('click');await wrapper.get('[data-test="reference-img-gen-a"]').trigger('click');const signal=state.load.mock.calls[0][1].signal;const old=wrapper;
  if(action==='scope')await wrapper.setProps({scopeKey:'conv-b'});else if(action==='close')await wrapper.get('[data-test="reference-close"]').trigger('click');else {wrapper.unmount();wrapper=null;}
  expect(signal.aborted).toBe(true);resolve(new File(['fixture'],'ref.png'));await flushPromises();expect(old.emitted('attach-files')).toBeUndefined();
 });
 it('Given a failed load, Then report it and allow another selection without retrying automatically',async()=>{
  state.load.mockRejectedValue(new Error('missing'));render();await wrapper.get('[data-test="reference-open"]').trigger('click');await wrapper.get('[data-test="reference-img-gen-a"]').trigger('click');await flushPromises();expect(wrapper.get('[role="alert"]').text()).toContain('missing');expect(state.load).toHaveBeenCalledOnce();
 });
});
