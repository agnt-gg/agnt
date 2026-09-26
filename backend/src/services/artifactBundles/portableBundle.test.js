import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { preparePortableBundle, readPreparedFile, clearPreparedBundles } from './portableBundle.js';

const roots = [];
async function fixture(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-portable-')); roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content);
  }
  return root;
}
const url = (root, name) => pathToFileURL(path.join(root, name)).href;
const prepare = (workspaceRoot, extra = {}) => preparePortableBundle({ workspaceRoot, entryPath: 'site/index.html', ownerId: 'owner', ...extra });
async function text(manifest, filePath) { return (await readPreparedFile(manifest.preparationId, filePath, 'owner')).toString('utf8'); }
afterEach(async () => { clearPreparedBundles(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('portable sharing', () => {
  it('preserves generated download suffixes and extension metadata without treating them as files', async () => {
    const source = `<script src="app.js"></script><script>function download(id) { a.download='agnt-resonance-'+id+'.svg'; } const extensions=['.png','.html','.json','.woff2','.mp4']; const asset='curve.svg'; fetch('config.json');</script><div data-extension=".svg"></div>`;
    const root = await fixture({ 'site/index.html': source, 'site/curve.svg': '<svg></svg>', 'site/config.json': '{"extension":".svg"}', 'site/app.js': "const suffix='.svg';" });
    const manifest = await prepare(root);
    expect(await text(manifest, 'index.html')).toBe(source.replace("'curve.svg'", "'./curve.svg'").replace('src="app.js"', 'src="./app.js"').replace("'config.json'", "'./config.json'"));
    expect(await text(manifest, 'config.json')).toBe('{"extension":".svg"}');
    expect(await text(manifest, 'app.js')).toBe("const suffix='.svg';");
    expect(manifest.files.some(file => file.path === '.svg')).toBe(false);
  });
  it('still rejects extension-only hidden files when explicitly referenced by HTML or CSS', async () => {
    for (const source of ['<img src=".svg">', '<style>body{background:url(.png)}</style>']) {
      const root = await fixture({ 'site/index.html': source });
      await expect(prepare(root)).rejects.toThrow('hidden_path');
    }
  });
  it('rewrites BOTH observatory links in a non-entry preview and leaves the design untouched', async () => {
    const root = await fixture({ 'site/index.html': '<h1>Design</h1><a href="preview.html">preview</a>', 'site/observatory.html': '<canvas></canvas>' });
    const source = `<iframe src="${url(root, 'site/observatory.html')}"></iframe><a href="${url(root, 'site/observatory.html')}">open</a>`;
    await fs.writeFile(path.join(root, 'site/preview.html'), source);
    const manifest = await prepare(root);
    expect(await text(manifest, 'preview.html')).toBe('<iframe src="./observatory.html"></iframe><a href="./observatory.html">open</a>');
    expect(await fs.readFile(path.join(root, 'site/preview.html'), 'utf8')).toBe(source);
    const direct = await prepare(root, { entryPath: 'site/preview.html' });
    expect(await text(direct, 'preview.html')).not.toContain('file:///');
  });
  it('gathers external HTML recursively, preserves cycles, CSS fonts, encoded spaces, query and fragment', async () => {
    const root = await fixture({
      'site/index.html': '<iframe src="../shared/panel.html#view"></iframe>',
      'shared/panel.html': '<link rel="stylesheet" href="theme.css"><iframe src="../site/index.html"></iframe>',
      'shared/theme.css': '@import "more.css";@font-face{src:url("fonts/type%20one.woff2?v=3#font")}',
      'shared/more.css': 'body{color:green}', 'shared/fonts/type one.woff2': Buffer.from([1,2,3]),
    });
    const manifest = await prepare(root);
    const panel = manifest.files.find(f => f.path.endsWith('/panel.html'));
    const css = manifest.files.find(f => f.path.endsWith('/theme.css'));
    expect(panel).toBeDefined(); expect(css).toBeDefined();
    expect(await text(manifest, 'index.html')).toContain(`${panel.path}#view`);
    expect(await text(manifest, panel.path)).toContain('../../index.html');
    expect(await text(manifest, css.path)).toContain('type%20one.woff2?v=3#font');
    expect(manifest.files.filter(f => f.path.endsWith('index.html'))).toHaveLength(1);
    expect(manifest.files.some(f => f.path.endsWith('/more.css'))).toBe(true);
  });
  it('handles local API URLs, inline CSS, srcset, poster, source, static script strings and JSON', async () => {
    const root = await fixture({ 'site/index.html': '', 'site/pic one.png': 'image', 'site/movie.mp4': 'video' });
    const local = `http://localhost:3333/api/local-file/${path.join(root, 'site/pic one.png').replace(/\\/g, '/')}`;
    const raw = '/api/filesystem/raw?path=site%2Fmovie.mp4';
    const source = `<img src="${local}" srcset="${url(root, 'site/pic one.png')} 1x, ${url(root, 'site/pic one.png')} 2x"><video poster="${local}"><source src="${raw}"></video><style>.a{background:url('${url(root, 'site/pic one.png')}')}</style><script>const film='${url(root, 'site/movie.mp4')}'; const model='model.gltf';</script>`;
    await fs.writeFile(path.join(root, 'site/index.html'), source);
    await fs.writeFile(path.join(root, 'site/model.gltf'), JSON.stringify({ buffers:[{uri:url(root, 'site/movie.mp4')}] }));
    const manifest = await prepare(root);
    const html = await text(manifest, 'index.html');
    expect(html).not.toMatch(/file:\/|\/api\/(local-file|filesystem)/);
    expect(html).toContain('./pic%20one.png 1x, ./pic%20one.png 2x');
    expect(html).toContain("const film='./movie.mp4'");
    expect(await text(manifest, 'model.gltf')).toContain('./movie.mp4');
  });
  it('prepares chat HTML without a paired tool write and resolves its iframe dependency', async () => {
    const root = await fixture({ 'shared/observatory.html': '<canvas>botanical</canvas>', 'site/index.html': 'unused' });
    const manifest = await prepare(root, { entryPath: undefined, html: `<iframe src="${url(root, 'shared/observatory.html')}"></iframe>` });
    expect(await text(manifest, manifest.entryPath)).not.toContain('file:///');
    expect(manifest.files.some(f => f.path.endsWith('observatory.html'))).toBe(true);
  });
  it('uses the chat base directory for sibling tabs and does not overwrite an existing index', async () => {
    const root = await fixture({ 'site/index.html': 'original', 'site/a.html': 'A', 'site/b.html': 'B' });
    const manifest = await prepare(root, { entryPath: undefined, html: '<a href="index.html">home</a><iframe src="a.html"></iframe><script>frame.src="b.html"</script>', baseDir: path.join(root, 'site') });
    expect(manifest.entryPath).not.toBe('index.html');
    expect(manifest.files.map(f => f.path)).toEqual(expect.arrayContaining(['index.html','a.html','b.html']));
    expect(await text(manifest, manifest.entryPath)).toContain('./a.html');
  });
  it('accepts an explicitly selected entry outside the workspace', async () => {
    const root = await fixture({ 'workspace/keep.txt': 'keep', 'plugin/index.html': '<img src="pic.png">', 'plugin/pic.png': 'pic' });
    const manifest = await prepare(path.join(root, 'workspace'), { entryPath: path.join(root, 'plugin/index.html') });
    expect(await text(manifest, 'index.html')).toContain('./pic.png');
    expect(manifest.files.map(f => f.path)).toContain('pic.png');
  });
  it('normalizes editor overrides BEFORE hashing and discovers their newly referenced files', async () => {
    const root = await fixture({ 'site/index.html': 'old', 'shared/new.mp4': 'movie' });
    const manifest = await prepare(root, { overrides:[{path:'index.html',content:`<video src="${url(root, 'shared/new.mp4')}"></video>`}] });
    const bytes = await readPreparedFile(manifest.preparationId, 'index.html', 'owner');
    const entry = manifest.files.find(f => f.path === 'index.html');
    expect(bytes.toString()).not.toContain('file:///');
    expect(entry.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
    expect(entry.size).toBe(bytes.length);
    expect(manifest.files.some(f => f.path.endsWith('/new.mp4'))).toBe(true);
  });
  it('reports missing local dependencies at preflight, naming the referring file', async () => {
    const root = await fixture({ 'site/index.html': '<video src="../missing.mp4"></video>' });
    await expect(prepare(root)).rejects.toThrow(/index.html.*missing.mp4/);
  });
  it('never imports secret-like files or symlink escapes', async () => {
    const root = await fixture({ 'site/index.html': '<iframe src="../.env"></iframe>', '.env': 'secret' });
    await expect(prepare(root)).rejects.toThrow(/excluded|secret/);
  });
  it('rejects a leaf symlink even when ancestor directories are themselves symlinks (macOS /var)', async () => {
    // os.tmpdir() is under /var → /private/var on macOS. Ancestor canonicalization
    // must NOT let a leaf symlink through; only the leaf is rejected as "symlink".
    const root = await fixture({ 'site/index.html': 'ok', 'site/real.png': 'pic' });
    await fs.symlink(path.join(root, 'site/real.png'), path.join(root, 'site/link.png'));
    await fs.writeFile(path.join(root, 'site/index.html'), '<img src="link.png">');
    await expect(prepare(root)).rejects.toThrow(/not a regular, non-symlink file/);
  });
  it('rejects a symlink entryPath before ancestor canonicalization can resolve it', async () => {
    // Regression for the Copilot finding on #106: realpath(entry) before lstat
    // let a leaf symlink entry pass as its regular target.
    const root = await fixture({ 'site/real.html': '<h1>real</h1>' });
    await fs.symlink(path.join(root, 'site/real.html'), path.join(root, 'site/index.html'));
    await expect(prepare(root)).rejects.toThrow(/not a regular, non-symlink file/);
  });
  it('leaves remote URLs and data URIs alone, including data srcset and CSS', async () => {
    const source = '<img src="https://example.com/x.png"><img srcset="data:image/png;base64,abcd 1x"><style>x{background:url(data:image/svg+xml,%3Csvg%3E)}</style>';
    const root = await fixture({ 'site/index.html': source });
    const manifest = await prepare(root);
    expect(await text(manifest, 'index.html')).toBe(source);
  });
  it('rejects cross-owner access, tampered paths and changed files', async () => {
    const root = await fixture({ 'site/index.html': '<video src="video.mp4"></video>', 'site/video.mp4': 'original' });
    const manifest = await prepare(root);
    await expect(readPreparedFile(manifest.preparationId, 'video.mp4', 'other')).rejects.toThrow(/expired|owner|preparation/i);
    await expect(readPreparedFile(manifest.preparationId, '../index.html', 'owner')).rejects.toThrow(/declared|Unsafe/);
    await fs.writeFile(path.join(root, 'site/video.mp4'), 'changed');
    await expect(readPreparedFile(manifest.preparationId, 'video.mp4', 'owner')).rejects.toThrow(/changed/);
  });
  it('removes a preview-injected local API base and resolves its sibling iframe', async () => {
    const root = await fixture({ 'site/index.html': '<canvas></canvas>' });
    const base = `http://localhost:3333/api/local-file/${path.join(root,'site').replace(/\\/g,'/')}/`;
    const manifest = await prepare(root, {entryPath:undefined,html:`<base href="${base}"><iframe src="index.html"></iframe>`});
    const html = await text(manifest,manifest.entryPath);
    expect(html).not.toContain('<base');
    expect(html).not.toContain('/api/');
    expect(manifest.files.some(f=>f.path.endsWith('/index.html'))).toBe(true);
  });
  it('excludes development reports from an included folder but keeps explicitly linked harness files', async () => {
    const root = await fixture({ 'site/index.html':'<script type="module" src="_runtime.mjs"></script>', 'site/_runtime.mjs':'export const n=1;', 'site/_shoot.mjs':"const url='file:///' + root;", 'site/verification-final/report.json':JSON.stringify({stack:'at file:///C:/private/script.js:1:2'}) });
    const referenced = await prepare(root);
    expect(referenced.files.map(f=>f.path)).toEqual(['index.html','_runtime.mjs']);
    const opted = await prepare(root, { includeDirs:['site'] });
    expect(opted.files.map(f=>f.path).sort()).toEqual(['_runtime.mjs','index.html']);
    expect(opted.excluded.map(f=>f.reason)).toContain('development_artifact');
    expect(opted.sources['_runtime.mjs'].reason).toBe('referenced by index.html');
  });
  it('publishes only what the entry references, never the rest of its folder', async () => {
    const root = await fixture({
      'site/index.html': '<img src="pic.png">', 'site/pic.png': 'pic',
      'site/draft.html': '<p>unfinished</p>', 'site/notes.txt': 'private', 'site/render/frame-001.png': Buffer.alloc(4096),
    });
    const manifest = await prepare(root, { limits:{ maxFiles:10, maxFileBytes:10000, maxTotalBytes:1000, maxEntryBytes:1000 } });
    expect(manifest.files.map(f => f.path)).toEqual(['index.html','pic.png']);
    expect(manifest.sources['index.html'].reason).toBe('the entry');
    expect(manifest.sources['pic.png']).toMatchObject({ kind:'reference', from:'index.html', reason:'referenced by index.html' });
    expect(manifest.warnings).toEqual([]);
  });
  it('does not sweep the chat base directory for a code block', async () => {
    const root = await fixture({ 'site/index.html':'old', 'site/big.bin': Buffer.alloc(2048), 'site/other.png':'x' });
    const manifest = await prepare(root, { entryPath:undefined, html:'<p>standalone</p>', baseDir:path.join(root,'site'), limits:{ maxFiles:2, maxFileBytes:10000, maxTotalBytes:500, maxEntryBytes:1000 } });
    expect(manifest.files.map(f => f.path)).toEqual(['__agnt_share__.html']);
  });
  it('matches runtime-built names as patterns inside exactly one folder', async () => {
    const script = "const frame = `frames/${String(i).padStart(3,'0')}.png`; const level = 'levels/level_' + n + '.json'; a.download = 'export-' + id + '.svg';";
    const root = await fixture({
      'site/index.html': `<script>${script}</script>`,
      'site/frames/000.png':'a', 'site/frames/001.png':'b', 'site/frames/notes.txt':'no', 'site/frames/deeper/002.png':'no', 'site/frames/.hidden.png':'no',
      'site/levels/level_1.json':'{}', 'site/levels/level_2.json':'{}', 'site/levels/other.json':'no', 'site/unrelated.png':'no',
    });
    const manifest = await prepare(root);
    expect(manifest.files.map(f => f.path).sort()).toEqual(['frames/000.png','frames/001.png','index.html','levels/level_1.json','levels/level_2.json']);
    expect(manifest.sources['frames/000.png']).toMatchObject({ kind:'pattern', pattern:'frames/*.png', from:'index.html' });
    expect(manifest.sources['levels/level_2.json'].reason).toBe('matched by levels/level_*.json in index.html');
    expect(await text(manifest, 'index.html')).toBe(`<script>${script}</script>`);   // runtime strings are left as written
  });
  it('captures a runtime-built image inside template markup and the fonts its stylesheet names', async () => {
    const root = await fixture({
      'magazine/index.html': '<link rel="stylesheet" href="style.css"><script>book.innerHTML=`<img src="assets/threshold/${page}.jpg"><img src="assets/cover.png">`</script>',
      'magazine/assets/threshold/04.jpg': Buffer.from([1,2,3]), 'magazine/assets/cover.png':'c', 'magazine/assets/fonts/League.woff2': Buffer.from([4,5]),
      'magazine/assets/unused/big.mov':'x', 'magazine/style.css': '@font-face{src:url(assets/fonts/League.woff2)}',
    });
    const manifest = await prepare(root, { entryPath:'magazine/index.html' });
    expect(manifest.files.map(f => f.path).sort()).toEqual(['assets/cover.png','assets/fonts/League.woff2','assets/threshold/04.jpg','index.html','style.css']);
  });
  it('warns about loads with computed paths, suggests the folder, and captures it only when opted in', async () => {
    const root = await fixture({ 'site/index.html':'<script>const url = pick(); fetch(url); img.src = frames[i];</script>', 'site/data/x.json':'{}', 'site/data/y.json':'{}' });
    const manifest = await prepare(root);
    expect(manifest.files.map(f => f.path)).toEqual(['index.html']);
    expect(manifest.warnings).toHaveLength(1);
    expect(manifest.warnings[0]).toMatchObject({ kind:'runtime_load', file:'index.html', folder:'site' });
    expect(manifest.warnings[0].detail).toMatch(/^2 loads with a computed path/);
    const opted = await prepare(root, { includeDirs:['site/data'] });
    expect(opted.files.map(f => f.path).sort()).toEqual(['data/x.json','data/y.json','index.html']);
    expect(opted.sources['data/x.json'].reason).toBe('in included folder site/data');
    expect(opted.includeDirs).toEqual(['site/data']);
    expect(opted.preparationSource.includeDirs).toEqual(['site/data']);
  });
  it('does not warn for literal loads, data URLs or object URLs, even through a variable', async () => {
    const inline = "fetch('config.json'); img.src = canvas.toDataURL(); v.src = URL.createObjectURL(blob); if (a.src == b) {}";
    // minified self-contained worker: the blob URL is held in a variable first
    const worker = 'const r=URL.createObjectURL(new Blob([s],{type:"text/javascript"}));const w=new Worker(r);let $d=c.toDataURL();img.src=$d;';
    const root = await fixture({ 'site/index.html':`<script>${inline}</script><script>${worker}</script>`, 'site/config.json':'{}' });
    const manifest = await prepare(root);
    expect(manifest.warnings).toEqual([]);
  });
  it('still warns when a variable holds a computed file path', async () => {
    const root = await fixture({ 'site/index.html':'<script>const r = base + name; const w = new Worker(r); const blob = URL.createObjectURL(x);</script>' });
    const manifest = await prepare(root);
    expect(manifest.warnings.map(w => w.detail)).toEqual(['1 load with a computed path, e.g. new Worker(r']);
  });
  it('names what pushed the bundle over its limit', async () => {
    // entry 43 bytes + 30 + 30 = 103 > 100: the second frame trips the limit
    const root = await fixture({ 'site/index.html':'<script>const f=`frames/${i}.png`;</script>', 'site/frames/1.png':Buffer.alloc(30), 'site/frames/2.png':Buffer.alloc(30) });
    await expect(prepare(root, { limits:{ maxFiles:10, maxFileBytes:1000, maxTotalBytes:100, maxEntryBytes:1000 } }))
      .rejects.toThrow('Bundle exceeds the 100 byte total limit: 60 bytes in 2 files matched by frames/*.png in index.html; 43 bytes in 1 file for the entry');
  });
  it('applies editor content to referenced files and ignores dirty tabs nothing references', async () => {
    const root = await fixture({ 'site/index.html':'<script src="app.js"></script>', 'site/app.js':"const old='x';", 'site/pic.png':'pic', 'site/unrelated.html':'u' });
    const manifest = await prepare(root, { overrides:[{ path:'app.js', content:"const art='pic.png';" }, { path:'unrelated.html', content:'edited' }] });
    expect(manifest.files.map(f => f.path)).toEqual(['index.html','app.js','pic.png']);
    expect(await text(manifest, 'app.js')).toBe("const art='./pic.png';");
  });
  it('follows srcdoc documents and url() inside script strings', async () => {
    const root = await fixture({ 'site/index.html':'<iframe srcdoc="<img src=&quot;pic.png&quot;>"></iframe><script>el.style.backgroundImage = "url(\'bg.png\')";</script>', 'site/pic.png':'p', 'site/bg.png':'b' });
    const manifest = await prepare(root);
    expect(manifest.files.map(f => f.path).sort()).toEqual(['bg.png','index.html','pic.png']);
    const html = await text(manifest, 'index.html');
    expect(html).toContain('srcdoc="<img src=&quot;./pic.png&quot;>"');
    expect(html).toContain('url(\\"./bg.png\\")');
  });
  it('refuses filesystem roots, hidden folders and malformed includeDirs', async () => {
    const root = await fixture({ 'site/index.html':'ok', '.private/x.txt':'secret' });
    await expect(prepare(root, { includeDirs:[path.parse(root).root] })).rejects.toThrow(/filesystem root/);
    await expect(prepare(root, { includeDirs:['.private'] })).rejects.toThrow(/excluded/);
    await expect(prepare(root, { includeDirs:'site' })).rejects.toThrow(/includeDirs/);
  });
  it('keeps the configured file and byte limits for added dependencies', async () => {
    const root = await fixture({ 'site/index.html': '<img src="../image.png">', 'image.png': 'picture' });
    await expect(prepare(root, { limits:{maxFiles:1,maxFileBytes:1000,maxTotalBytes:1000,maxEntryBytes:1000} })).rejects.toThrow(/limit/);
  });
});

// Real directory aliases: junctions on Windows, directory symlinks on POSIX.
const linkDirectory = (target, alias) => fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
describe('portable directory aliases', () => {
  it('accepts a benign aliased workspace and deduplicates dependencies', async () => {
    const root = await fixture({ 'actual/site/index.html': '<img src="../shared/pic.png"><img src="../../alias/shared/pic.png">', 'actual/shared/pic.png': 'image' });
    await linkDirectory(path.join(root, 'actual'), path.join(root, 'alias'));
    const manifest = await prepare(path.join(root, 'alias'));
    expect(manifest.files.filter(file => file.path.endsWith('/pic.png'))).toHaveLength(1);
  });
  it('rejects an ordinary dependency reached through an excluded directory alias', async () => {
    const root = await fixture({ 'site/index.html': '<img src="public/picture.png">', '.private/picture.png': 'synthetic private fixture' });
    await linkDirectory(path.join(root, '.private'), path.join(root, 'site/public'));
    await expect(prepare(root)).rejects.toThrow(/excluded|hidden/);
  });
  it('rejects an excluded spelling even when its destination is public', async () => {
    const root = await fixture({ 'site/index.html': '<iframe src="../.alias/report.html"></iframe>', 'public/report.html': 'fixture' });
    await linkDirectory(path.join(root, 'public'), path.join(root, '.alias'));
    await expect(prepare(root)).rejects.toThrow(/excluded|hidden/);
  });
  it.runIf(process.platform === 'darwin')('accepts real macOS /var and /private/var spellings', async () => {
    const root = await fs.mkdtemp('/var/tmp/agnt-portable-mac-'); roots.push(root);
    await fs.mkdir(path.join(root, 'site'));
    await fs.writeFile(path.join(root, 'site/index.html'), '<h1>Mac fixture</h1>');
    expect(await fs.realpath(root)).toBe(root.replace(/^\/var\//, '/private/var/'));
    const manifest = await prepare(root);
    expect(await text(manifest, 'index.html')).toContain('Mac fixture');
  });
});
