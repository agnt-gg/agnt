import {describe,it,expect,vi,afterEach} from 'vitest';
import {mount,flushPromises} from '@vue/test-utils';
import ImageSettings from './ImageSettings.vue';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
const base={schemaVersion:1,revision:0,selectedConnectionId:null,options:{},authorizations:{}};
const connections=[{id:'openai',provider:'openai',connected:true,label:'OpenAI Images API',models:['gpt-image-2'],billing:'API usage — billed separately',requiresConsent:false},{id:'gemini',provider:'gemini',connected:true,label:'Gemini',models:['gemini-image'],billing:'API usage',requiresConsent:false}];
let w;afterEach(()=>{w?.unmount();vi.unstubAllGlobals();localStorage.clear();});
function start(){vi.stubGlobal('fetch',vi.fn(async(url,opts)=>({ok:true,json:async()=>opts.method==='GET'?{settings:base,connections}:{settings:{...base,revision:1}}})));w=mount(ImageSettings);}
describe('Feature: shared independent image settings UI',()=>{
 it('Given disconnected subscription consent, Then revoke remains available',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({settings:{...base,selectedConnectionId:'codex',authorizations:{codex:{allowed:true}}},connections:[{id:'codex',provider:'openai-codex',connected:false,requiresConsent:true,label:'Codex'}]})})));w=mount(ImageSettings);await flushPromises();expect(w.get('[data-test="image-consent-revoke"]').element.disabled).toBe(false);await w.get('[data-test="image-consent-revoke"]').trigger('click');expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({expectedRevision:0,consent:{connectionId:'codex',allow:false}});});
 it('Given pending save, Then provider edits are disabled',async()=>{start();await flushPromises();w.findComponent(CustomSelect).vm.$emit('update:modelValue','openai');await flushPromises();fetch.mockImplementationOnce(()=>new Promise(()=>{}));await w.get('[data-test="image-settings-save"]').trigger('click');expect(w.findComponent(CustomSelect).props('disabled')).toBe(true);});
 it('Given no default, Then load without saving or picking a paid provider',async()=>{start();await flushPromises();expect(fetch).toHaveBeenCalledOnce();expect(w.get('[data-test="image-settings-save"]').element.disabled).toBe(true);});
 it('Given API selected, When saving Fast, Then send only image settings and billing disclosure',async()=>{start();await flushPromises();w.findAllComponents(CustomSelect)[0].vm.$emit('update:modelValue','openai');await flushPromises();w.findAllComponents(CustomSelect)[1].vm.$emit('update:modelValue','latest-fast');await flushPromises();await w.get('[data-test="image-settings-save"]').trigger('click');await flushPromises();expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({expectedRevision:0,selectedConnectionId:'openai',options:{connectionId:'openai',value:{model:'latest-fast'}}});expect(w.text()).toContain('billed separately');expect(w.text()).toContain('Saved');});
 it('Given another image provider, Then the model dropdown receives proper option records',async()=>{start();await flushPromises();w.findAllComponents(CustomSelect)[0].vm.$emit('update:modelValue','gemini');await flushPromises();expect(w.findAllComponents(CustomSelect)[1].props('options')).toEqual([{label:'gemini-image',value:'gemini-image'}]);});
 it('Given revision conflict, Then do not claim success',async()=>{start();await flushPromises();w.findAllComponents(CustomSelect)[0].vm.$emit('update:modelValue','openai');await flushPromises();fetch.mockImplementationOnce(async()=>({ok:false,status:409,json:async()=>({error:'conflict'})}));await w.get('[data-test="image-settings-save"]').trigger('click');await flushPromises();expect(w.get('[role="alert"]').text()).toContain('Reload');expect(w.find('[role="status"]').exists()).toBe(false);});
});
describe('Feature: compact image control in the composer',()=>{
 it('Given the composer, Then images is one icon named by its provider, and the panel opens only on click',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({settings:{...base,selectedConnectionId:'openai'},connections})})));
  w=mount(ImageSettings,{props:{compact:true}});await flushPromises();
  const toggle=w.get('button.image-settings-toggle');
  expect(toggle.attributes('aria-label')).toBe('Images: OpenAI Images API');
  expect(toggle.find('i.fa-image').exists()).toBe(true);
  expect(toggle.text()).toBe('');
  expect(w.find('.image-settings-panel').exists()).toBe(false);
  await toggle.trigger('click');
  expect(w.find('.image-settings-panel.popover').exists()).toBe(true);
  await w.get('button.image-settings-toggle').trigger('click');
  expect(w.find('.image-settings-panel').exists()).toBe(false);
 });
 it('Given nothing configured, Then the icon says so instead of naming a provider',async()=>{
  start();w.unmount();w=mount(ImageSettings,{props:{compact:true}});await flushPromises();
  expect(w.get('button.image-settings-toggle').attributes('aria-label')).toBe('Images: not set up');
 });
});
