#!/usr/bin/env node
/**
 * The one command in front of the pipeline.
 *
 *   npm run pipeline -- add "<anything>"        dump a thought; nothing required
 *   npm run pipeline -- list [--status s]       what is where
 *   npm run pipeline -- show <id>               one ticket, scored
 *   npm run pipeline -- set <id> <status>       move a ticket (approve, reject…)
 *   npm run pipeline -- hot                     the chokepoint files, measured
 *   npm run pipeline -- expand <id>             grow a footprint from history
 *   npm run pipeline -- pack                    approved tickets → waves
 *   npm run pipeline -- evidence <slug> [--ticket id]
 *   npm run pipeline -- land <slug> [--ticket id] [--dry]
 *
 * This is the deterministic half. The cognition — enriching a dump into a
 * plan, doing the work, reviewing it — is agents, and the two human gates are
 * a conversation. Nothing here reaches into the product.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { primaryRoot } from '../worktree.mjs';
import { buildModel, expandFootprint, hotFiles, readCommitFiles, touchRateOf } from './cochange.mjs';
import { buildBundle } from './evidence.mjs';
import { land } from './merge-train.mjs';
import { conflictGraph, packWaves } from './wave-pack.mjs';
import { addTicket, defaultTicketsDir, loadTickets, saveTicket, scoreTicket, setStatus } from './tickets.mjs';

const flag = (args, name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

function model(root) {
  return buildModel(readCommitFiles(root));
}

function findTicket(dir, id) {
  const t = loadTickets(dir).find((x) => x.id === id);
  if (!t) throw new Error(`no ticket ${id} in ${dir}`);
  return t;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const root = primaryRoot();
  const dir = flag(rest, '--tickets') ?? defaultTicketsDir();
  const out = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));

  switch (cmd) {
    case 'add': {
      const raw = rest.filter((a) => !a.startsWith('--')).join(' ');
      const t = addTicket(dir, raw);
      out(`${t.id}  inbox  ${path.relative(process.cwd(), t.file)}`);
      return;
    }
    case 'list': {
      const status = flag(rest, '--status');
      const rate = touchRateOf(model(root));
      const rows = loadTickets(dir)
        .filter((t) => !status || t.status === status)
        .map((t) => ({ ...t, score: scoreTicket(t, rate) }))
        .sort((a, b) => b.score - a.score);
      if (!rows.length) return out(`no tickets in ${dir}`);
      for (const t of rows) {
        out(`${t.id}  ${String(t.status).padEnd(9)} ${t.score.toFixed(2).padStart(6)}  ${(t.footprint ?? []).length} files  ${t.body.split('\n')[0].slice(0, 70)}`);
      }
      return;
    }
    case 'show': {
      const t = findTicket(dir, rest[0]);
      out({ ...t, score: scoreTicket(t, touchRateOf(model(root))) });
      return;
    }
    case 'set': {
      const t = findTicket(dir, rest[0]);
      setStatus(t, rest[1]);
      out(`${t.id} → ${rest[1]}`);
      return;
    }
    case 'hot': {
      for (const h of hotFiles(model(root))) out(`${(h.rate * 100).toFixed(1).padStart(5)}%  ${h.file}`);
      return;
    }
    case 'expand': {
      const t = findTicket(dir, rest[0]);
      const r = expandFootprint(t.footprint ?? [], model(root));
      if (!rest.includes('--dry')) saveTicket({ ...t, footprint: r.footprint });
      out(r);
      return;
    }
    case 'pack': {
      const m = model(root);
      const rate = touchRateOf(m);
      const approved = loadTickets(dir)
        .filter((t) => t.status === 'approved')
        .map((t) => ({ ...t, score: scoreTicket(t, rate) }));
      const landed = new Set(loadTickets(dir).filter((t) => t.status === 'landed').map((t) => t.id));
      const chokepoints = new Set(hotFiles(m).map((h) => h.file));
      const { waves, deferred } = packWaves(approved, { chokepoints, landed, maxWave: Number(flag(rest, '--max') ?? Infinity) });
      out({
        waves: waves.map((w, i) => ({ wave: i + 1, tickets: w.map((t) => ({ id: t.id, score: Number(t.score.toFixed(2)), files: (t.footprint ?? []).length })) })),
        deferred,
        edges: conflictGraph(approved),
      });
      return;
    }
    case 'evidence': {
      const ticket = flag(rest, '--ticket') ? findTicket(dir, flag(rest, '--ticket')) : {};
      const hot = new Set(hotFiles(model(root)).map((h) => h.file));
      out(buildBundle(root, path.join(root, '.worktrees', rest[0]), { ticket, hot }));
      return;
    }
    case 'land': {
      const id = flag(rest, '--ticket');
      const ticket = id ? findTicket(dir, id) : null;
      if (rest.includes('--dry')) {
        out(buildBundle(root, path.join(root, '.worktrees', rest[0]), { ticket: ticket ?? {} }));
        return;
      }
      const r = land(root, rest[0], { footprint: ticket?.footprint ?? null, log: console.log });
      if (ticket) {
        if (r.status === 'landed') setStatus(ticket, 'landed', { sha: r.sha });
        else if (r.status === 'bounced') setStatus(ticket, 'bounced', { bounces: (ticket.bounces ?? 0) + 1, lastBounce: `${r.step}: ${r.detail.split('\n')[0].slice(0, 200)}` });
      }
      out(r);
      if (r.status !== 'landed') process.exitCode = 1;
      return;
    }
    default:
      console.error('usage: pipeline <add|list|show|set|hot|expand|pack|evidence|land> …');
      process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`pipeline: ${err.message}`);
    process.exitCode = 1;
  }
}
