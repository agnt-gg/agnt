// Full pipeline test: the sentinel-audit node, scan + report + HTML file.
import audit from '../tools/audit.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || join(__dirname, 'vulnapp');
const provider = process.argv[3] || 'none';

console.log('=== SENTINEL AUDIT NODE TEST ===');
console.log('target:', target, '| provider:', provider, '\n');

const out = await audit.execute({ target, depth: 'standard', provider }, {}, {});
console.log('success:', out.success, out.error ? ('| note: ' + out.error) : '');
if (out.summary) {
  console.log(`risk ${out.summary.risk}/100 grade ${out.summary.grade} | findings ${out.summary.total}`);
  console.log('counts:', JSON.stringify(out.summary.counts));
}
console.log('narrativeProvider:', out.narrativeProvider);
console.log('reportPath:', out.reportPath);
console.log('html length:', out.html?.length, 'chars');
console.log('\nfirst 3 findings:');
for (const f of (out.findings || []).slice(0, 3)) {
  console.log(`  [${f.severity}] ${f.title} @ ${f.file}:${f.line} ${f.cwe}`);
}
