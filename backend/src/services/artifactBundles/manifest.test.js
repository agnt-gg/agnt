import { afterEach, describe, expect, it } from 'vitest';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildArtifactManifest, normalizeBundlePath, resolveManifestFile, shouldExclude } from './manifest.js';

const roots = [];
async function fixture(files) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-bundle-')); roots.push(root);
  for (const [name, content] of Object.entries(files)) { const target = path.join(root, name); await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.writeFile(target, content); }
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true }))); });

describe('artifact bundle manifest', () => {
  it('captures every runtime-created asset without parsing JavaScript', async () => {
    const root = await fixture({
      'magazine/index.html': '<script>book.innerHTML=`<img src="assets/threshold/${page}.jpg">`</script>',
      'magazine/assets/threshold/04.jpg': Buffer.from([1,2,3]),
      'magazine/assets/fonts/League.woff2': Buffer.from([4,5]),
      'magazine/style.css': '@font-face{src:url(assets/fonts/League.woff2)}',
    });
    const result = await buildArtifactManifest({ workspaceRoot: root, entryPath: 'magazine/index.html' });
    expect(result.rootPath).toBe('magazine');
    expect(result.files.map((file) => file.path)).toEqual(['assets','index.html','style.css'].flatMap((x) => x === 'assets' ? ['assets/fonts/League.woff2','assets/threshold/04.jpg'] : [x]));
    expect(result.files.find((file) => file.path.endsWith('.jpg')).mime).toBe('image/jpeg');
  });
  it('is deterministic and excludes secrets, dependencies and archives', async () => {
    const root = await fixture({ 'app/index.html':'ok','app/.env':'SECRET=x','app/node_modules/x.js':'x','app/out.zip':'x','app/a.js':'a' });
    const one = await buildArtifactManifest({ workspaceRoot: root, entryPath:'app/index.html' });
    const two = await buildArtifactManifest({ workspaceRoot: root, entryPath:'app/index.html' });
    expect(one.manifestHash).toBe(two.manifestHash);
    expect(one.files.map((x) => x.path)).toEqual(['a.js','index.html']);
    expect(one.excluded.map((x) => x.path).sort()).toEqual(['.env','node_modules','out.zip']);
  });
  it('rejects traversal and absolute paths', () => {
    expect(() => normalizeBundlePath('../secret')).toThrow(/Unsafe/);
    expect(() => normalizeBundlePath('C:/secret')).toThrow(/Unsafe/);
    expect(() => resolveManifestFile('C:/workspace','site','../secret')).toThrow(/Unsafe/);
  });
  it('supports a selected ancestor root and keeps a nested entry path', async () => {
    const root = await fixture({ 'project/site/index.html':'ok', 'project/shared/font.woff2':'font' });
    const result = await buildArtifactManifest({ workspaceRoot:root, entryPath:'project/site/index.html', rootPath:'project' });
    expect(result.rootPath).toBe('project');
    expect(result.entryPath).toBe('site/index.html');
    expect(result.files.map((file) => file.path)).toEqual(['shared/font.woff2','site/index.html']);
    await expect(buildArtifactManifest({ workspaceRoot:root, entryPath:'project/site/index.html', rootPath:'other' })).rejects.toThrow(/escapes/);
  });
  it('recognizes credential-like names', () => {
    expect(shouldExclude('assets/client.pem')).toBe('secret_like_name');
    expect(shouldExclude('assets/image.png')).toBeNull();
  });
});
