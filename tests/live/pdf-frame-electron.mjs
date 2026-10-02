/**
 * PDF PREVIEWS ACTUALLY PAINT — under the app's own Electron.
 *
 *   set "ELECTRON_RUN_AS_NODE=" & node tests/live/pdf-frame-electron.mjs
 *
 * The bug this guards: every PDF preview rendered a blank white box because
 * its iframe was sandboxed, and Chromium will not start its PDF viewer in a
 * sandboxed frame. Nothing caught it: jsdom cannot paint a PDF, and
 * Playwright's headless Chromium (the e2e runner) has no PDF viewer at all —
 * it leaves the frame empty whether or not the code is correct. The only
 * faithful test is the real engine, so this drives the Electron binary the app
 * ships with, using the main window's webPreferences (main.js).
 *
 * It renders, side by side:
 *   - the iframe attributes read out of PdfFrame.vue itself, so the check
 *     follows the component instead of a hand-copied tag;
 *   - a `sandbox=""` control, which MUST stay blank. That proves the detector
 *     can tell a painted page from an empty frame — a probe that only ever
 *     reports "rendered" proves nothing.
 *
 * Needs a display (on Linux CI wrap in xvfb-run), so it is a live check, not
 * part of the vitest gates. Exits 0 on pass, 1 on fail, 2 on harness error.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPONENT = path.join(ROOT, 'frontend/src/views/_components/common/PdfFrame.vue');

/** Static attributes of the component's <iframe> (bindings and listeners dropped). */
export function staticIframeAttributes(vueSource) {
  const template = vueSource.match(/<template>([\s\S]*?)<\/template>/);
  const tag = template && template[1].match(/<iframe\b([^>]*)>/i);
  if (!tag) throw new Error('PdfFrame.vue has no <iframe> in its template');
  const attributes = [];
  for (const match of tag[1].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) {
    const [, name, value] = match;
    if (/^(:|@|v-)/.test(name)) continue;
    attributes.push(value === undefined ? name : `${name}="${value}"`);
  }
  return attributes.join(' ');
}

const electronMain = String.raw`
const { app, BrowserWindow } = require('electron');
const http = require('http');
const [frames, width, height, gap] = JSON.parse(process.env.PDF_CHECK_SPEC);

function redPagePdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R >>'];
  const stream = '1 0 0 rg 0 0 600 800 re f';
  objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  let body = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
  const xref = body.length;
  body += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  body += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(body, 'latin1');
}

const pdf = redPagePdf();
const page = '<!doctype html><body style="margin:0;background:#000;display:flex;gap:' + gap + 'px">' +
  frames.map((f) => '<iframe ' + f.attributes + ' src="/doc.pdf" style="border:0;width:' + width + 'px;height:' + height + 'px;background:#fff"></iframe>').join('') + '</body>';
const server = http.createServer((req, res) => {
  if (req.url === '/doc.pdf') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end(pdf); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page);
});
const fail = (message) => { console.log('PDF_CHECK_ERROR ' + message); app.exit(2); };
setTimeout(() => fail('timed out'), 30000);

app.whenReady().then(() => server.listen(0, '127.0.0.1', async () => {
  try {
    // Mirrors the main window in main.js. No 'plugins' flag: it is not set there either.
    const win = new BrowserWindow({ width: frames.length * (width + gap), height, show: false, useContentSize: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: true } });
    await win.loadURL('http://127.0.0.1:' + server.address().port + '/');
    // The viewer paints asynchronously; poll rather than guess a fixed delay.
    let painted = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, 500));
      const image = await win.webContents.capturePage();
      const scale = image.getSize().width / (frames.length * (width + gap));
      const bitmap = image.toBitmap(); const rowBytes = image.getSize().width * 4;
      painted = frames.map((f, index) => {
        const left = Math.round(index * (width + gap) * scale);
        let red = 0, total = 0;
        for (let y = 0; y < Math.round(height * scale); y += 4) for (let x = left; x < left + Math.round(width * scale); x += 4) {
          const i = y * rowBytes + x * 4; total++;
          if (bitmap[i + 2] > 200 && bitmap[i + 1] < 60 && bitmap[i] < 60) red++; // BGRA
        }
        return { name: f.name, redPercent: Math.round(1000 * red / total) / 10 };
      });
      if (painted[0].redPercent > 50) break;
    }
    console.log('PDF_CHECK_RESULT ' + JSON.stringify({ electron: process.versions.electron, frames: painted }));
    server.close(); app.exit(0);
  } catch (error) { fail(error.stack || String(error)); }
}));
`;

function run() {
  const component = staticIframeAttributes(fs.readFileSync(COMPONENT, 'utf8'));
  const frames = [
    { name: 'PdfFrame.vue', attributes: component, mustPaint: true },
    { name: 'sandbox="" control', attributes: 'sandbox=""', mustPaint: false },
  ];
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-pdf-check-'));
  try {
    fs.writeFileSync(path.join(workDir, 'main.cjs'), electronMain);
    const electronBinary = createRequire(path.join(ROOT, 'package.json'))('electron');
    const env = { ...process.env, PDF_CHECK_SPEC: JSON.stringify([frames, 300, 400, 20]) };
    delete env.ELECTRON_RUN_AS_NODE; // otherwise the binary runs as plain Node and has no 'app'
    const child = spawnSync(electronBinary, [path.join(workDir, 'main.cjs')], { env, encoding: 'utf8', timeout: 45000 });
    const output = `${child.stdout || ''}${child.stderr || ''}`;
    const line = output.split(/\r?\n/).find((l) => l.startsWith('PDF_CHECK_RESULT '));
    if (!line) {
      console.error('Harness error — Electron produced no result.', child.error?.message || '', '\n', output.slice(-2000));
      return 2;
    }
    const result = JSON.parse(line.slice('PDF_CHECK_RESULT '.length));
    let ok = true;
    result.frames.forEach((frame, index) => {
      const expected = frames[index].mustPaint;
      const paintedPage = frame.redPercent > 50;
      const pass = paintedPage === expected;
      ok &&= pass;
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${frame.name.padEnd(20)} red=${String(frame.redPercent).padStart(5)}%  expected ${expected ? 'painted' : 'blank'}`);
    });
    console.log(`Electron ${result.electron}; PdfFrame attributes: ${component || '(none)'}`);
    if (!ok && result.frames[1].redPercent > 50) console.log('The sandboxed control painted: Chromium changed its rule — re-evaluate PdfFrame.vue.');
    return ok ? 0 : 1;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(run());
