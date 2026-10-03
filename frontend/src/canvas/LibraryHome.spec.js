import {describe,it,expect} from 'vitest';
import {mount} from '@vue/test-utils';
import LibraryHome from './LibraryHome.vue';
describe('Library home',()=>{
 it('exposes the actual asset collections without needing global search',async()=>{const w=mount(LibraryHome);for(const label of ['Agents','Workflows','Tools','Skills','Files','Plugins','Market','Shared assets'])expect(w.text()).toContain(label);await w.findAll('button').find(b=>b.text().includes('Workflows')).trigger('click');expect(w.emitted('navigate')[0]).toEqual(['WorkflowsScreen',{}]);w.unmount()});
 it('searches collections and opens shared library',async()=>{const w=mount(LibraryHome);await w.find('input').setValue('shared');expect(w.findAll('button')).toHaveLength(1);await w.find('button').trigger('click');expect(w.emitted('teams')).toHaveLength(1);w.unmount()});
});
