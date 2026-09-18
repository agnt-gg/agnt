import { afterEach, describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import WorkspaceSwitcher from './WorkspaceSwitcher.vue';
const wrappers=[];
afterEach(()=>{wrappers.splice(0).forEach(w=>w.unmount());document.body.innerHTML='';});
function setup(props={}){const w=mount(WorkspaceSwitcher,{attachTo:document.body,props:{teams:[{id:'team-1',name:'Engineering'}],...props},global:{directives:{tooltip:{}}}});wrappers.push(w);return w;}
describe('WorkspaceSwitcher',()=>{
 it('derives the visible current name from identity, not a separate stale label',async()=>{const w=setup();expect(w.find('.selected-label').text()).toBe('Personal');await w.setProps({modelValue:'team-1'});expect(w.find('.selected-label').text()).toBe('Engineering');expect(w.attributes('class')).toContain('workspace-switcher');});
 it('opens the compact picker without triggering the outside-click close',async()=>{const w=setup({compact:true});await w.find('.workspace-icon').trigger('click');await flushPromises();expect(document.querySelectorAll('[role=option]')).toHaveLength(2);expect(document.querySelector('.options-container').style.width).toBe('240px');const option=[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.includes('Engineering'));option.click();await flushPromises();expect(w.emitted('select').at(-1)).toEqual(['team-1']);await new Promise(resolve=>setTimeout(resolve,60));await flushPromises();expect(document.querySelector('[role=option]')).toBeNull();});
 it('announces scope in the compact button and shows retry on load failure',async()=>{const w=setup({modelValue:'team-1',compact:true});expect(w.find('.workspace-icon').attributes('aria-label')).toContain('Engineering');await w.setProps({compact:false,error:'Cannot load teams.'});expect(w.find('[role=status]').text()).toContain('Cannot load teams.');await w.find('[role=status] button').trigger('click');expect(w.emitted('refresh')).toHaveLength(1)});
});
