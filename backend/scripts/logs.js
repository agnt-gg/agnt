#!/usr/bin/env node
/**
 * Diagnostics CLI.
 *
 *   npm run logs                                  last 1h, INFO and above
 *   npm run logs -- --since 15m --level error
 *   npm run logs -- --boot last --proc workflow
 *   npm run logs -- --workflow 5c29225f-... --grep poll
 *   npm run logs -- --crashes
 *   npm run logs -- --crash 0            full ring of the newest crash
 *   npm run logs -- --sweep [--apply]    retention report (dry by default)
 *   npm run logs -- --json               machine-readable
 */
import PathManager from '../src/utils/PathManager.js';
import { readRecords, readCrashes } from '../src/diagnostics/read.js';
import { sweep } from '../src/diagnostics/retention.js';

const argv = process.argv.slice(2);
const flag = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const has = (name) => argv.includes(`--${name}`);

const DIR = flag('dir') === undefined || flag('dir') === true ? PathManager.getPath('diagnostics') : flag('dir');

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
const LEVEL_COLOR = { FATAL: C.red, ERROR: C.red, WARN: C.yellow, INFO: C.cyan, DEBUG: C.dim, TRACE: C.dim };

function fmt(rec) {
  const paint = LEVEL_COLOR[rec.lvl] || ((s) => s);
  const time = (rec.t || '').slice(11, 23);
  const where = [rec.proc, rec.src].filter(Boolean).join('/');
  const ctx = rec.ctx
    ? C.dim(
        ` {${Object.entries(rec.ctx)
          .map(([k, v]) => `${k}=${String(v).slice(0, 8)}`)
          .join(' ')}}`
      )
    : '';
  const err = rec.err ? C.red(` ${rec.err.code || rec.err.name}: ${rec.err.msg}`) : '';
  const rep = rec.repeat ? C.yellow(` (x${rec.repeat.n})`) : '';
  const data = rec.data ? C.dim(` ${JSON.stringify(rec.data).slice(0, 160)}`) : '';
  return `${C.dim(time)} ${paint(rec.lvl.padEnd(5))} ${C.bold(where.padEnd(22))} ${rec.msg}${rep}${err}${ctx}${data}`;
}

if (has('sweep')) {
  const report = sweep(DIR, { dryRun: !has('apply') });
  console.log(JSON.stringify(report, null, 2));
  console.log(has('apply') ? C.green('\nApplied.') : C.yellow('\nDry run — pass --apply to execute.'));
  process.exit(0);
}

if (has('crashes') || flag('crash') !== undefined) {
  const idx = flag('crash');
  const full = idx !== undefined && idx !== true;
  const list = readCrashes(DIR, { limit: 25, full });
  if (!list.length) {
    console.log(C.green('No crash records. '), C.dim(DIR));
    process.exit(0);
  }
  if (full) {
    const rec = list[Number(idx)] || list[0];
    console.log(C.bold(`${rec.t}  ${rec.proc}  ${C.red(rec.reason)}`));
    console.log(C.dim(JSON.stringify({ sys: rec.sys, state: rec.state, err: rec.err }, null, 2)));
    console.log(C.bold(`\n--- flight recorder (${rec.ring?.length || 0} records) ---`));
    for (const r of rec.ring || []) console.log(fmt(r));
  } else {
    list.forEach((rec, i) => {
      console.log(
        `${String(i).padStart(2)}  ${rec.t}  ${C.bold((rec.proc || '?').padEnd(9))}  ${C.red(rec.reason)}  ` +
          `${C.dim(`ring=${rec.ringSize} rss=${rec.sys?.memMB?.rss}MB`)}  ${rec.err?.msg || ''}`
      );
    });
    console.log(C.dim(`\n${list.length} crash record(s). --crash N for the full flight recorder.`));
  }
  process.exit(0);
}

const ctx = {};
for (const key of ['workflow', 'conversation', 'execution', 'node', 'user']) {
  const v = flag(key);
  if (v && v !== true) ctx[`${key}Id`] = v;
}

const result = readRecords({
  dir: DIR,
  since: flag('since', '1h'),
  until: flag('until'),
  level: flag('level'),
  proc: flag('proc'),
  src: flag('src'),
  boot: flag('boot'),
  grep: flag('grep'),
  ctx: Object.keys(ctx).length ? ctx : undefined,
  limit: Number(flag('limit', 500)),
});

if (has('json')) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (!result.records.length) {
  console.log(C.dim(`No records. dir=${DIR} scanned=${result.summary.scanned} files=${result.summary.files}`));
  console.log(C.dim('Diagnostics may not be installed yet — see AGNT-DIAGNOSTICS-DESIGN.md.'));
  process.exit(0);
}

for (const rec of result.records) console.log(fmt(rec));

const s = result.summary;
console.log(
  C.dim(
    `\n${s.returned}/${s.matched} of ${s.scanned} scanned · ${s.files} file(s) · boot ${s.boot?.slice(0, 8) || 'n/a'}\n` +
      `levels ${JSON.stringify(s.byLevel)}\ntop ${JSON.stringify(s.topSources)}`
  )
);
