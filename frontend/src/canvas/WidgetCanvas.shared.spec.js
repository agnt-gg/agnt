import {it,expect,vi,afterEach} from 'vitest';
import {mount} from '@vue/test-utils';
import {createStore} from 'vuex';
import WidgetCanvas from './WidgetCanvas.vue';
vi.mock('./widgetRegistry.js',()=>({getWidget:()=>null}));
afterEach(()=>vi.unstubAllGlobals());
it('edits a controlled shared layout without saving into personal layouts',async()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 const store=createStore({getters:{'widgetLayout/pageLayout':()=>()=>[]}});const dispatch=vi.spyOn(store,'dispatch');
 const layout=[{instanceId:'one',widgetId:'missing',col:0,row:0,cols:4,rows:4}];
 const wrapper=mount(WidgetCanvas,{props:{pageId:'shared',sharedLayout:layout},global:{plugins:[store],stubs:{WidgetFrame:true}}});
 try{wrapper.findComponent({name:'WidgetFrame'}).vm.$emit('drag-end',{instanceId:'one',col:2,row:3});await wrapper.vm.$nextTick();expect(wrapper.emitted('update:sharedLayout')[0][0][0]).toMatchObject({col:2,row:3});expect(layout[0].col).toBe(0);expect(dispatch).not.toHaveBeenCalled();await wrapper.setProps({readOnly:true});wrapper.findComponent({name:'WidgetFrame'}).vm.$emit('close','one');expect(wrapper.emitted('update:sharedLayout')).toHaveLength(1);}finally{wrapper.unmount();}
});
