import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8');
describe('Library and Teams inherit Chat panel surface',()=>{
 it.each(['./LibraryHome.vue','../views/_components/one/TeamWorkspace.vue'])('%s uses the existing theme panel class and base color',p=>{const text=read(p);expect(text).toMatch(/class="(?:library-home|team-workspace) main-panel"/);expect(text).toMatch(/background:\s*var\(--color-background\)/);expect(text).not.toContain('var(--surface-canvas');});
 it('the shared theme owns wallpaper opacity and blur, not page-specific approximations',()=>{const core=read('../styles/themes/_core.css');expect(core).toContain('body.custom-bg .main-panel');expect(core).toContain('var(--bg-opacity, 0.9)');expect(core).toContain('blur(var(--bg-blur, 0px))');});
});
