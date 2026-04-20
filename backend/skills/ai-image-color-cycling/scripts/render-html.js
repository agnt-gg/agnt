#!/usr/bin/env node
/**
 * render-html.js — fill the cycler template with quantized data + chosen ranges.
 *
 * Usage:
 *   node render-html.js \
 *     --data /tmp/cycle-data.json \
 *     --template assets/cycler-template.html \
 *     --cycles '[{"lo":14,"hi":63,"rate":6,"dir":1}]' \
 *     --title "My Scene" \
 *     --out /tmp/cycling.html
 */

const fs = require('fs');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
}
const DATA_PATH = args.data;
const TEMPLATE_PATH = args.template;
const CYCLES_JSON = args.cycles || '[]';
const TITLE = args.title || 'Color Cycling Scene';
const OUT = args.out || '/tmp/cycling.html';

if (!DATA_PATH || !TEMPLATE_PATH) {
  console.error('Missing --data or --template');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
const cycles = JSON.parse(CYCLES_JSON);

if (!Array.isArray(cycles) || cycles.length === 0) {
  console.warn('Warning: no --cycles passed; nothing will animate.');
}

// Wrap the long base64 strings into 78-char lines with JS string concatenation
function wrapB64(s, width = 78) {
  const parts = [];
  for (let i = 0; i < s.length; i += width) parts.push(s.slice(i, i + width));
  return parts.map((p) => `"${p}"`).join('\n+');
}

const html = template
  .replace(/__W__/g, String(data.width))
  .replace(/__H__/g, String(data.height))
  .replace(/__TITLE__/g, TITLE.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])))
  .replace(/"__INDEXED_B64__"/g, wrapB64(data.indexedB64))
  .replace(/"__PALETTE_B64__"/g, wrapB64(data.paletteB64))
  .replace(/"__CYCLES__"/g, JSON.stringify(cycles));

fs.writeFileSync(OUT, html);
console.log(`✓ Wrote ${OUT} (${html.length} bytes, ${html.split('\n').length} lines)`);
