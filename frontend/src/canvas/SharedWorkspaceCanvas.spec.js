import {it,expect,vi} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import SharedWorkspaceCanvas from './SharedWorkspaceCanvas.vue';
const canvas={name:'WidgetCanvas',props:['sharedLayout','readOnly'],template:'<div />'};
it('persists revisions, refuses stale writes and reloads authoritative layout',async()=>{
 const workspace={id:'w',name:'Shared',revision:1,canvas_json:'[]'};
 const request=vi.fn().mockResolvedValueOnce({...workspace,revision:2,canvas_json:'[{"instanceId":"one"}]'}).mockRejectedValueOnce(Error('Workspace changed. Reload before saving.')).mockResolvedValueOnce([{...workspace,revision:3,canvas_json:'[]'}]);
 const wrapper=mount(SharedWorkspaceCanvas,{props:{workspace,teamId:'t',request},global:{stubs:{WidgetCanvas:canvas}}});
 try{const child=wrapper.findComponent(canvas);child.vm.$emit('update:sharedLayout',[{instanceId:'one'}]);await flushPromises();expect(JSON.parse(request.mock.calls[0][1].body).expectedRevision).toBe(1);expect(child.props('sharedLayout')).toEqual([{instanceId:'one'}]);child.vm.$emit('update:sharedLayout',[]);await flushPromises();expect(wrapper.find('[role=alert]').text()).toContain('Workspace changed');expect(child.props('readOnly')).toBe(true);expect(child.props('sharedLayout')).toHaveLength(1);await wrapper.findAll('button').find(b=>b.text()==='Reload').trigger('click');await flushPromises();expect(child.props('readOnly')).toBe(false);expect(child.props('sharedLayout')).toEqual([]);}finally{wrapper.unmount();}
});
