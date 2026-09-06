import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import MobileCollection from './MobileCollection.vue';
const record={id:'a1',name:'Research assistant',description:'Verify primary sources.',status:'ACTIVE'};
describe('mobile collection is a presentation of the source controller',()=>{
 it('renders the supplied record and emits that exact object',async()=>{const w=mount(MobileCollection,{props:{title:'Agents',countLabel:'agents',items:[record]}});await w.find('.m-record-open').trigger('click');expect(w.emitted('select')[0][0]).toEqual(record);expect(w.text()).toContain('Verify primary sources.');});
 it('does not bubble record activation into desktop click-away handlers',async()=>{let clicks=0;const w=mount(defineComponent({components:{MobileCollection},setup:()=>({record,click:()=>clicks++}),template:'<div @click="click"><MobileCollection :items="[record]" /></div>'}));await w.find('.m-record-open').trigger('click');expect(clicks).toBe(0);});
 it('supports both existing tab shapes without translating their IDs',async()=>{const w=mount(MobileCollection,{props:{tabs:[{id:'active',name:'Active'},{value:'pending',label:'Pending'}],active:'active'}});await w.findAll('[role=tab]')[1].trigger('click');expect(w.emitted('tab')[0]).toEqual(['pending']);expect(w.find('[role=tab]').attributes('aria-selected')).toBe('true');});
 it('emits query updates instead of copying or filtering source state',async()=>{const w=mount(MobileCollection,{props:{search:'retained'}});await w.find('input').setValue('Research');expect(w.emitted('update:search')[0]).toEqual(['Research']);});
 it('keeps source-specific record actions in slots',async()=>{let duplicate;const w=mount(MobileCollection,{props:{items:[record]},slots:{item:({item})=>`Selected: ${item.id}`}});expect(w.find('.m-record-actions').text()).toBe('Selected: a1');});
 it('provides distinct loading, empty and filtered-empty states',async()=>{const w=mount(MobileCollection,{props:{loading:true,countLabel:'agents'}});expect(w.find('[role=status]').text()).toContain('Loading');await w.setProps({loading:false,search:'absent'});expect(w.text()).toContain('No matches');await w.find('.m-empty button').trigger('click');expect(w.emitted('update:search')[0]).toEqual(['']);});
 it('retains local details/filter expansion when records change',async()=>{const w=mount(MobileCollection,{props:{items:[record]},slots:{actions:'Sort controls'}});w.find('details').element.open=true;await w.setProps({items:[{...record,name:'Changed'}]});expect(w.find('details').element.open).toBe(true);});
 it('escapes record text instead of injecting markup',()=>{const w=mount(MobileCollection,{props:{items:[{id:'x',name:'<img src=x onerror=alert(1)>'}]}});expect(w.find('.m-record-copy img').exists()).toBe(false);expect(w.text()).toContain('<img src=x');});
});
