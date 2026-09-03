/**
 * LIVE gate: the verbs against a REAL Chromium, launched hidden the same way
 * the tool launches one (browserFallbackSurface), driving a fixture page
 * served from this process. Skips when no Chromium is installed.
 *
 * The fake-server tests prove the protocol shape. This proves the shape is
 * the one Chromium actually speaks: dialog events arrive, target=_blank makes
 * a real second target, <select> changes fire, console/network events flow,
 * and the AX tree has the roles we ref.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  ensureFallbackSurface, closeFallbackSurfaceGracefully, installedBrowsers,
} from '../tools/library/actions/browserFallbackSurface.js';
import { performBrowserAction, _resetDrivers } from './browserActDriver.js';

const FIXTURE = `<!doctype html><html><head><title>Fixture</title></head><body>
<h1>Fixture page</h1>
<button id="alert" onclick="alert('hello from page')">Alert me</button>
<button id="confirm" onclick="document.getElementById('out').textContent = confirm('sure?') ? 'yes' : 'no'">Confirm me</button>
<a id="blank" href="/second" target="_blank">Open second</a>
<a id="same" href="/second">Go second</a>
<label>Country <select id="country" onchange="document.getElementById('out').textContent='picked:'+this.value">
  <option value="us">United States</option><option value="ca">Canada</option><option value="mx">Mexico</option>
</select></label>
<input id="q" aria-label="Search" value="old">
<div id="hover" onmouseenter="document.getElementById('out').textContent='hovered'">hover zone</div>
<button id="later" onclick="setTimeout(()=>{const p=document.createElement('p');p.id='appeared';p.textContent='Appeared later';document.body.appendChild(p)},400)">Show later</button>
<button id="boom" onclick="console.error('boom happened'); fetch('/missing'); setTimeout(()=>{throw new Error('async fail')},10)">Boom</button>
<p id="out">none</p>
<script>console.log('fixture ready')</script>
</body></html>`;

const SECOND = '<!doctype html><html><head><title>Second</title></head><body><h1>Second page</h1><button id="b2">Back home</button></body></html>';

let server;
let base;
let cdpUrl;
const haveBrowser = installedBrowsers().length > 0;

beforeAll(async () => {
  if (!haveBrowser) return;
  server = http.createServer((req, res) => {
    if (req.url === '/second') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(SECOND); }
    if (req.url === '/missing') { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(FIXTURE);
  });
  await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  cdpUrl = await ensureFallbackSurface({ hidden: true, log: () => {} });
}, 60000);

afterAll(async () => {
  _resetDrivers();
  // Graceful, not taskkill: a killed profile is marked crashed and the NEXT
  // launch hangs its first page commands on the restore path. Measured here.
  await closeFallbackSurfaceGracefully();
  if (server) await new Promise((r) => { server.close(r); });
}, 20000);

const act = (action, params = {}) => performBrowserAction('live-user', cdpUrl, action, params);
const inner = (fenced) => fenced.split('\n').slice(1, -1).join('\n');

describe.skipIf(!haveBrowser)('real Chromium', () => {
  it('navigate returns a snapshot with refs for the fixture controls', async () => {
    const r = await act('navigate', { url: `${base}/` });
    expect(r.title).toBe('Fixture');
    const s = inner(r.snapshot);
    expect(s).toMatch(/@e\d+ button "Alert me"/);
    expect(s).toMatch(/@e\d+ link "Open second"/);
    expect(s).toMatch(/@e\d+ combobox "Country"/);
    expect(s).toMatch(/@e\d+ textbox "Search" value="old"/);
    expect(r.stats.refs).toBeGreaterThanOrEqual(7);
  }, 20000);

  it('a real alert() arrives as an event and is cleared by dialog', async () => {
    await act('navigate', { url: `${base}/` });
    const r = await act('click', { selector: '#alert' });
    expect(r.blockedByDialog).toMatchObject({ type: 'alert', message: 'hello from page' });
    await expect(act('read')).rejects.toThrow(/alert dialog/);
    const d = await act('dialog', { accept: true });
    expect(d.dialog.handled).toBe('accepted');
    const t = await act('read', { selector: '#out' });
    expect(inner(t.text)).toBe('none');
  }, 20000);

  it('confirm() dismissed vs accepted is visible to the page', async () => {
    await act('navigate', { url: `${base}/` });
    await act('click', { selector: '#confirm' });
    await act('dialog', { accept: false });
    expect(inner((await act('read', { selector: '#out' })).text)).toBe('no');
    await act('click', { selector: '#confirm' });
    await act('dialog', { accept: true });
    expect(inner((await act('read', { selector: '#out' })).text)).toBe('yes');
  }, 20000);

  it('target=_blank creates a real tab; focus drives it; close returns', async () => {
    await act('navigate', { url: `${base}/` });
    const r = await act('click', { selector: '#blank' });
    expect(r.newTab).toBeTruthy();
    expect(r.url).toBe(`${base}/`);
    const f = await act('focus', { tabId: r.newTab.id });
    expect(f.title).toBe('Second');
    expect(inner(f.snapshot)).toMatch(/@e1 button "Back home"/);
    const c = await act('close', { tabId: r.newTab.id });
    expect(c.title).toBe('Fixture');
    expect(c.tabs).toHaveLength(1);
  }, 30000);

  it('a same-tab link returns the new page inline, and back returns the old one inline', async () => {
    await act('navigate', { url: `${base}/` });
    const r = await act('click', { selector: '#same' });
    expect(r.navigated).toBe(true);
    expect(r.title).toBe('Second');
    expect(inner(r.snapshot)).toMatch(/@e1 button "Back home"/);
    const b = await act('back');
    expect(b.navigated).toBe(true);
    expect(b.title).toBe('Fixture');
  }, 20000);

  it('select fires change; hover fires mouseenter; type replaces', async () => {
    await act('navigate', { url: `${base}/` });
    const s = await act('select', { selector: '#country', value: 'Canada' });
    expect(s.selected).toEqual({ value: 'ca', label: 'Canada' });
    expect(inner((await act('read', { selector: '#out' })).text)).toBe('picked:ca');

    await act('hover', { selector: '#hover' });
    expect(inner((await act('read', { selector: '#out' })).text)).toBe('hovered');

    await act('type', { selector: '#q', text: 'new value' });
    const snap = await act('snapshot', { query: 'search' });
    expect(inner(snap.snapshot)).toMatch(/textbox "Search" value="new value"/);
  }, 20000);

  it('wait resolves when the element appears, not before', async () => {
    await act('navigate', { url: `${base}/` });
    await act('click', { selector: '#later' });
    const w = await act('wait', { selector: '#appeared', timeoutMs: 5000 });
    expect(w.satisfied).toBe(true);
    expect(w.waited).toBeGreaterThanOrEqual(200);
    const s = await act('snapshot', { query: 'appeared' });
    expect(inner(s.snapshot)).toContain('Appeared later');
  }, 20000);

  it('console / errors / requests see what the page did', async () => {
    await act('navigate', { url: `${base}/` });
    await act('click', { selector: '#boom' });
    await act('wait', { ms: 300 });
    const c = await act('console');
    expect(inner(c.console)).toContain('[log] fixture ready');
    expect(inner(c.console)).toContain('[error] boom happened');
    const e = await act('errors');
    expect(inner(e.errors)).toMatch(/async fail/);
    const r = await act('requests', { filter: 'failed' });
    expect(inner(r.requests)).toMatch(/GET 404 .*\/missing/);
  }, 20000);

  it('press chords reach the page (Control+a then typing replaces all)', async () => {
    await act('navigate', { url: `${base}/` });
    await act('click', { selector: '#q' });
    await act('press', { key: 'End' });
    await act('press', { key: 'Control+a' });
    await act('press', { key: 'x' });
    const snap = await act('snapshot', { query: 'search' });
    expect(inner(snap.snapshot)).toMatch(/textbox "Search" value="x"/);
  }, 20000);
});
