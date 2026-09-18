import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=p=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8');
describe('Files and chat share document typography',()=>{
 it('loads the same stylesheet from both entry points',()=>{const inspector=read('./ArtifactInspector.vue');const files=read('../../Terminal/CenterPanel/screens/Artifacts/Artifacts.vue');for(const source of [inspector,files])expect(source).toContain("import '@/styles/components/artifactMarkdown.css'");expect(inspector).toContain('class="markdown-preview ce-markdown-preview"');expect(files).not.toContain('.ce-markdown-preview h1,');});
 it('retains the proven heading and paragraph rhythm',()=>{const css=read('../../../styles/components/artifactMarkdown.css');expect(css).toMatch(/\.ce-markdown-preview h6\s*\{[^}]*margin-top: 1em;[^}]*margin-bottom: 0.75em;/);expect(css).toMatch(/\.ce-markdown-preview p\s*\{[^}]*margin-top: 1em;/);});
});
