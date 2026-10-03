import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
vi.mock('@/services/fileSystemService.js',()=>({getTree:vi.fn()}));
// Filesystem behaviour is isolated here; the real shelf/store integration is
// covered by MarketplaceShelf.spec and the signed-in browser tests.
vi.mock('@/views/Terminal/_components/MarketplaceShelf.vue', () => ({ default: { template: '<div />' } }));
import { getTree } from '@/services/fileSystemService.js';
import MobileFileBrowser from './MobileFileBrowser.vue';
const items=[{name:'report.md',path:'report.md',type:'file'},{name:'Sources',path:'Sources',type:'directory'}];
describe('mobile files use the real filesystem service contract',()=>{
 beforeEach(()=>{vi.resetAllMocks();getTree.mockResolvedValue({items});});
 it('loads the existing workspace tree and opens the selected path',async()=>{const w=mount(MobileFileBrowser);await flushPromises();expect(getTree).toHaveBeenCalledWith('');const file=w.findAll('.m-file').find(e=>e.text().includes('report.md'));await file.trigger('click');expect(w.emitted('open')[0]).toEqual(['report.md']);});
 it('navigates folders instead of treating folders as file previews',async()=>{const w=mount(MobileFileBrowser);await flushPromises();getTree.mockResolvedValueOnce({items:[]});await w.findAll('.m-file')[0].trigger('click');await flushPromises();expect(getTree).toHaveBeenLastCalledWith('Sources');expect(w.emitted('open')).toBeUndefined();expect(w.find('.m-folder-back').exists()).toBe(true);});
 it('searches without replacing the underlying tree',async()=>{const w=mount(MobileFileBrowser);await flushPromises();await w.find('input').setValue('report');expect(w.findAll('.m-file')).toHaveLength(1);await w.find('input').setValue('');expect(w.findAll('.m-file')).toHaveLength(2);});
 it('surfaces a read failure and retries explicitly',async()=>{getTree.mockRejectedValueOnce(new Error('Host unavailable'));const w=mount(MobileFileBrowser);await flushPromises();expect(w.find('[role=alert]').text()).toContain('Host unavailable');await w.find('[role=alert] button').trigger('click');await flushPromises();expect(w.findAll('.m-file')).toHaveLength(2);});
});
