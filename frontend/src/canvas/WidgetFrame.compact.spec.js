import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref, nextTick } from 'vue';
import WidgetFrame from './WidgetFrame.vue';
import { registerWidget, unregisterWidget } from './widgetRegistry.js';

describe('compact widget presentation protects desktop geometry', () => {
 it('expand, focus, collapse and resize attempts do not emit layout writes', async () => {
  registerWidget('compact-test',{name:'Fixture',isScreenWidget:false});
  const mobile=ref(true),widget={instanceId:'w1',widgetId:'compact-test',col:3,row:2,cols:5,rows:4,visible:true,collapsed:true,zIndex:4};
  const original=JSON.stringify(widget);
  const w=mount(WidgetFrame,{props:{widget,cellWidth:80,cellHeight:70,isCustomPage:true},global:{provide:{isMobile:mobile},stubs:{Tooltip:{template:'<span><slot/></span>'}}},slots:{default:'<input value="retained draft" />'}});
  const input=w.find('input').element;
  await w.find('[aria-label="Expand widget"]').trigger('click');expect(w.classes()).toContain('compact-expanded');expect(w.classes()).not.toContain('is-collapsed');
  w.vm.bringToFront();w.vm.onDragStart({clientX:20,clientY:20});w.vm.onResizeStart({clientX:20,clientY:20});
  for(const event of ['bring-to-front','drag-start','drag-end','resize-start','resize-end'])expect(w.emitted(event)).toBeUndefined();
  expect(JSON.stringify(widget)).toBe(original);
  mobile.value=false;await nextTick();expect(w.find('input').element).toBe(input);expect(w.vm.frameStyle.width).toBeDefined();expect(w.classes()).toContain('is-collapsed');
  w.unmount();unregisterWidget('compact-test');
 });
});
