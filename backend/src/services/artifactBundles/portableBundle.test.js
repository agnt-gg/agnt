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
  it('rewrites BOTH observatory links in a non-entry preview and leaves the design untouched', async () => {
    const root = await fixture({ 'site/index.html': '<h1>Design</h1>', 'site/observatory.html': '<canvas></canvas>' });
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
    const source = `<img src="${local}" srcset="${url(root, 'site/pic one.png')} 1x, ${url(root, 'site/pic one.png')} 2x"><video poster="${local}"><source src="${raw}"></video><style>.a{background:url('${url(root, 'site/pic one.png')}')}</style><script>const film='${url(root, 'site/movie.mp4')}';</script>`;
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
    const manifest = await prepare(root, { entryPath: undefined, html: '<iframe src="a.html"></iframe><script>frame.src="b.html"</script>', baseDir: path.join(root, 'site') });
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
  it('leaves remote URLs and data URIs alone, including data srcset and CSS', async () => {
    const source = '<img src="https://example.com/x.png"><img srcset="data:image/png;base64,abcd 1x"><style>x{background:url(data:image/svg+xml,%3Csvg%3E)}</style>';
    const root = await fixture({ 'site/index.html': source });
    const manifest = await prepare(root);
    expect(await text(manifest, 'index.html')).toBe(source);
  });
  it('rejects cross-owner access, tampered paths and changed files', async () => {
    const root = await fixture({ 'site/index.html': 'ok', 'site/video.mp4': 'original' });
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
  it('excludes auto-discovered development reports but includes explicitly linked harness files', async () => {
    const root = await fixture({ 'site/index.html':'<script type="module" src="_runtime.mjs"></script>', 'site/_runtime.mjs':'export const n=1;', 'site/_shoot.mjs':"const url='file:///' + root;", 'site/verification-final/report.json':JSON.stringify({stack:'at file:///C:/private/script.js:1:2'}) });
    const manifest = await prepare(root);
    expect(manifest.files.map(f=>f.path)).toEqual(['index.html','_runtime.mjs']);
    expect(manifest.excluded.map(f=>f.reason)).toContain('development_artifact');
  });
  it('keeps the configured file and byte limits for added dependencies', async () => {
    const root = await fixture({ 'site/index.html': '<img src="../image.png">', 'image.png': 'picture' });
    await expect(prepare(root, { limits:{maxFiles:1,maxFileBytes:1000,maxTotalBytes:1000,maxEntryBytes:1000} })).rejects.toThrow(/limit/);
  });
});
