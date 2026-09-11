import { gzipSync } from 'node:zlib';
export const unique = xs => [...new Set(xs)].sort();
export function safePath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || p.includes('\\') || p.includes(':') || p.split('/').some(x => x === '..' || x === '.' || !x)) throw Error(`Unsafe path: ${p}`);
  return p;
}
export const incremental = (required, loaded) => unique(required).filter(p => !new Set(loaded).has(p));
export function classify(manifest, entryKey) {
  if (!Object.hasOwn(manifest, entryKey)) throw Error(`Unknown entry: ${entryKey}`);
  const get = k => { if (!Object.hasOwn(manifest, k)) throw Error(`Missing import: ${k}`); return manifest[k]; };
  function closure(root) {
    const seen = new Set();
    function visit(k) { if (seen.has(k)) return; seen.add(k); for (const i of get(k).imports || []) visit(i); }
    visit(root); return [...seen];
  }
  const files = keys => unique(keys.flatMap(k => { const n = get(k); return [n.file, ...(n.css || []), ...(n.assets || [])].map(safePath); }));
  const initial = files(closure(entryKey));
  const visited = new Set(), targets = new Set();
  function discover(k) {
    if (visited.has(k)) return; visited.add(k); const n = get(k);
    for (const d of n.dynamicImports || []) { targets.add(d); discover(d); }
    for (const i of n.imports || []) discover(i);
  }
  discover(entryKey);
  const lazy = Object.fromEntries([...targets].sort().map(k => [k, incremental(files(closure(k)), initial)]));
  const counts = {};
  for (const group of Object.values(lazy)) for (const p of group) counts[p] = (counts[p] || 0) + 1;
  return { initial, lazy, sharedLazy: Object.keys(counts).filter(p => counts[p] > 1).sort() };
}
export function account(paths, files) {
  let rawBytes = 0, gzipBytes = 0; const names = unique(paths);
  for (const p of names) {
    safePath(p); if (!Object.hasOwn(files, p) || !Buffer.isBuffer(files[p])) throw Error(`Missing file: ${p}`);
    rawBytes += files[p].length; gzipBytes += gzipSync(files[p], { level: 9 }).length;
  }
  return { rawBytes, gzipBytes, fileCount: names.length };
}
const requiredMetadata = 'checkoutRoot npm rollup platform arch graphSemantics assetPolicy gzip node zlib vite mode configHash lockHash scenario browserCache buildCache'.split(' ');
export function enforce(candidate, baseline, budgets) {
  if (!baseline) throw Error('Missing baseline');
  if (candidate.passed === false || baseline.passed === false) throw Error('Cannot compare failed reports');
  if (candidate.metadata?.schemaVersion !== 2 || baseline.metadata?.schemaVersion !== 2) throw Error('Incompatible metadata: schemaVersion (rebuild legacy reports with schema 2)');
  for (const k of requiredMetadata) {
    const c = candidate.metadata?.[k], b = baseline.metadata?.[k];
    if (typeof c !== 'string' || !c.trim() || typeof b !== 'string' || !b.trim() || c !== b) throw Error(`Incompatible metadata: ${k} (use fresh paired builds with matching identity; do not relabel reports)`);
  }
  if (!budgets || !Object.keys(budgets).length) throw Error('Missing budgets');
  const diagnostics = {};
  for (const [k, b] of Object.entries(budgets)) {
    for (const v of [b.absolute, b.relative]) if (!Number.isFinite(v) || v < 0) throw Error(`Invalid budget allowance: ${k}`);
    const c = candidate.metrics?.[k], a = baseline.metrics?.[k];
    for (const v of [c, a]) if (!Number.isFinite(v) || v < 0) throw Error(`Invalid metric: ${k}`);
    const limit = a + b.absolute + a * b.relative;
    diagnostics[k] = { candidate: c, baseline: a, limit, pass: c <= limit };
  }
  return { pass: Object.values(diagnostics).every(d => d.pass), diagnostics };
}
