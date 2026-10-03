import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MobileDirectory from './MobileDirectory.vue';
import { settingsDirectory, appsDirectory } from './sectionDirectories.js';
const settings=settingsDirectory.flatMap(g=>g.items);
describe('shared desktop/mobile section directories',()=>{
 it('keeps all nineteen Settings sections plus subordinate screens',()=>{const sections=settings.filter(i=>!i.screen);expect(new Set(sections.map(s=>s.id)).size).toBe(19);expect(sections.map(s=>s.id)).toContain('usage');expect(settings.filter(i=>i.screen).map(i=>i.screen)).toEqual(['AutonomyScreen','ExperimentsScreen']);});
 it('preserves the actual Apps navigation IDs without a redundant Vault',()=>{expect(appsDirectory[0].items.map(i=>i.id)).toEqual(['providers','oauth','email-server','mcp-servers','webhooks']);});
 it('emits the source definition rather than inventing routes',async()=>{const w=mount(MobileDirectory,{props:{title:'Settings',groups:settingsDirectory}});await w.findAll('.m-directory-item').find(e=>e.text().includes('Improvements')).trigger('click');expect(w.emitted('select')[0][0].screen).toBe('ExperimentsScreen');});
 it('filters grouped items and shows a useful empty state',async()=>{const w=mount(MobileDirectory,{props:{title:'Apps',groups:appsDirectory}});await w.find('input').setValue('MCP');expect(w.findAll('.m-directory-item')).toHaveLength(1);await w.find('input').setValue('nothing');expect(w.find('.m-directory-empty').exists()).toBe(true);});
});
