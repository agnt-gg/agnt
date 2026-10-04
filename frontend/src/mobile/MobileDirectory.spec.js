import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MobileDirectory from './MobileDirectory.vue';
import { settingsDirectory, appsDirectory } from './sectionDirectories.js';
const settings=settingsDirectory.flatMap(g=>g.items);
describe('shared desktop/mobile section directories',()=>{
 it('keeps all eighteen Settings sections plus subordinate screens',()=>{const sections=settings.filter(i=>!i.screen);expect(new Set(sections.map(s=>s.id)).size).toBe(18);expect(sections.map(s=>s.id)).not.toContain('notifications');expect(sections.map(s=>s.id)).toContain('usage');expect(settings.filter(i=>i.screen).map(i=>i.screen)).toEqual(['LearningScreen']);});
 it('preserves the actual Apps navigation IDs without a redundant Vault, and no AI models',()=>{expect(appsDirectory.map(g=>g.items.map(i=>i.id))).toEqual([['apps','plugins','mcp-servers'],['oauth','email-server','webhooks']]);expect(appsDirectory[0].items.find(i=>i.id==='plugins').screen).toBe('PluginsScreen');expect(appsDirectory.flatMap(g=>g.items).some(i=>i.id==='providers'||i.id==='api-keys')).toBe(false);});
 it('emits the source definition rather than inventing routes',async()=>{const w=mount(MobileDirectory,{props:{title:'Settings',groups:settingsDirectory}});await w.findAll('.m-directory-item').find(e=>e.text().includes('Learning')).trigger('click');expect(w.emitted('select')[0][0].screen).toBe('LearningScreen');});
 it('filters grouped items and shows a useful empty state',async()=>{const w=mount(MobileDirectory,{props:{title:'Apps',groups:appsDirectory}});await w.find('input').setValue('MCP');expect(w.findAll('.m-directory-item')).toHaveLength(1);await w.find('input').setValue('nothing');expect(w.find('.m-directory-empty').exists()).toBe(true);});
});
