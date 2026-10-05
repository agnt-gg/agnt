import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import FocusedScheduled from './FocusedScheduled.vue';
import UpgradePrompt from '@/components/UpgradePrompt.vue';
function setup(plan, props={}) {
  const store=createStore({modules:{userAuth:{namespaced:true,state:()=>({plan}),getters:{planType:s=>s.plan},actions:{fetchSubscription:vi.fn()}},schedules:{namespaced:true,getters:{allSchedules:()=>[]},actions:{fetchSchedules:vi.fn()}},goals:{namespaced:true,getters:{allGoals:()=>[]},actions:{fetchGoals:vi.fn()}}}});
  const dispatch=vi.spyOn(store,'dispatch');
  const wrapper=mount(FocusedScheduled,{props,global:{plugins:[store],provide:{focusedNav:{go:vi.fn(),toast:vi.fn()}},stubs:{FocusedRoutine:true,UpgradeModal:{props:['open'],template:'<div v-if="open" data-testid="upgrade-checkout" />'}}}});
  return{store,dispatch,wrapper};
}
describe('Paid scheduling and upgrade entry',()=>{
 it.each([{}, {item:'existing'}, {isNew:true}])('free accounts see Upgrade, never schedule controls, even on deep links %j',async props=>{
  const{wrapper,dispatch}=setup('free',props);await flushPromises();
  expect(wrapper.text()).toContain('Scheduled goals are included with paid plans');
  expect(wrapper.findComponent({name:'FocusedRoutine'}).exists()).toBe(false);
  expect(dispatch.mock.calls.some(([name])=>name.startsWith('schedules/'))).toBe(false);
  await wrapper.find('.upgrade-offer-button').trigger('click');
  expect(wrapper.find('[data-testid="upgrade-checkout"]').exists()).toBe(true);wrapper.unmount();
 });
 it('paid members get their schedules without an upgrade pitch',async()=>{
  const{wrapper,dispatch}=setup('personal');await flushPromises();
  expect(wrapper.find('.upgrade-offer').exists()).toBe(false);
  expect(dispatch).toHaveBeenCalledWith('schedules/fetchSchedules');wrapper.unmount();
 });
 it('reacts to an upgrade and downgrade without a page reload',async()=>{
  const{wrapper,store}=setup('free');await flushPromises();store.state.userAuth.plan='business';await flushPromises();
  expect(wrapper.find('.upgrade-offer').exists()).toBe(false);store.state.userAuth.plan='free';await flushPromises();expect(wrapper.find('.upgrade-offer').exists()).toBe(true);wrapper.unmount();
 });
});
