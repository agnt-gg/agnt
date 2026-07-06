// Direct engine self-test — no AGNT, no LLM. Proves scanners produce file:line findings.
import { scan } from '../core/engine.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(__dirname, 'vulnapp');

console.log('=== SENTINEL ENGINE SELF-TEST ===');
console.log('Target:', target, '\n');

const res = await scan(target, {
  depth: process.argv[3] || 'standard',
  onProgress: (m) => console.log('  ·', m),
});

console.log('\n--- RESULT ---');
console.log('success:', res.success, res.error ? ('error: ' + res.error) : '');
if (res.summary) {
  console.log(`risk: ${res.summary.risk}/100  grade: ${res.summary.grade}  total: ${res.summary.total}`);
  console.log('counts:', JSON.stringify(res.summary.counts));
  console.log('scanners:', JSON.stringify(res.summary.scanners?.map(s => `${s.name}:${s.ran?'ok':'skip'}(${s.count??0})`)));
}
console.log('\n--- FINDINGS (file:line:cwe) ---');
for (const f of (res.findings || []).slice(0, 40)) {
  console.log(`[${f.severity.toUpperCase()}] ${f.title}`);
  console.log(`   ${f.file || '-'}:${f.line || '-'}  ${f.cwe || ''}  (${f.tool}, ${f.provenance})`);
}
console.log(`\nTotal findings: ${res.findings?.length || 0}`);
