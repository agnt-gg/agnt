/**
 * Tickets: one Markdown file each, frontmatter on top, the raw dump below.
 *
 * They live OUTSIDE the product repo — default
 * %APPDATA%/AGNT/projects/pipeline/tickets, override with AGNT_PIPELINE_DIR.
 * Ticket churn inside the repo would be its own chokepoint, and a user's
 * install has no business carrying our backlog.
 *
 * The frontmatter is a deliberately small YAML subset (scalars and string
 * lists) so that no dependency is needed to read or write it, and so a ticket
 * stays editable in any text editor. `footprint` is the load-bearing field:
 * the list of repo-relative paths the work is allowed to touch. Approving a
 * plan approves its footprint; the merge train audits against it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STATUSES = ['inbox', 'enriched', 'approved', 'in-flight', 'review', 'landed', 'bounced', 'rejected'];

export function defaultTicketsDir() {
  if (process.env.AGNT_PIPELINE_DIR) return process.env.AGNT_PIPELINE_DIR;
  const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(appData, 'AGNT', 'projects', 'pipeline', 'tickets');
}

/* ───────────── frontmatter ───────────── */

function scalar(raw) {
  const v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === '[]') return [];
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^".*"$/.test(v)) return JSON.parse(v);
  if (/^\[.*\]$/.test(v)) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return v;
}

export function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s?(.*)$/);
    if (item && listKey) {
      meta[listKey].push(scalar(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (!kv) throw new Error(`frontmatter: cannot parse "${line}"`);
    const [, key, value] = kv;
    if (value.trim() === '') {
      meta[key] = [];
      listKey = key;
    } else {
      meta[key] = scalar(value);
      listKey = null;
    }
  }
  return { meta, body: m[2] };
}

function emit(v) {
  if (v === null || v === undefined) return '~';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  // Quote anything the parser would otherwise reinterpret.
  if (s === '' || /^[\[\]"~]|[:#]|^\s|\s$|^(true|false|null)$|^-?\d+(\.\d+)?$/.test(s)) return JSON.stringify(s);
  return s;
}

export function serializeFrontmatter(meta, body = '') {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) lines.push(`${k}: []`);
      else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${emit(item)}`);
      }
    } else lines.push(`${k}: ${emit(v)}`);
  }
  lines.push('---');
  return `${lines.join('\n')}\n${body.replace(/^\r?\n/, '')}`;
}

/* ───────────── store ───────────── */

const ID = /^T-(\d{4,})$/;

export function loadTickets(dir = defaultTicketsDir()) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue;
    const file = path.join(dir, name);
    const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const id = meta.id ?? path.basename(name, '.md');
    out.push({ ...meta, id, body, file });
  }
  return out;
}

export function nextId(dir) {
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const m = path.basename(name, '.md').match(ID);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `T-${String(max + 1).padStart(4, '0')}`;
}

export function saveTicket(ticket) {
  const { file, body, ...meta } = ticket;
  if (!file) throw new Error(`ticket ${meta.id} has no file`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeFrontmatter(meta, body ?? ''));
  return ticket;
}

/** The whole intake contract: text in, file out, nothing required. */
export function addTicket(dir, raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error('an empty dump is not a ticket');
  fs.mkdirSync(dir, { recursive: true });
  const id = nextId(dir);
  const ticket = {
    id,
    status: 'inbox',
    created: new Date().toISOString().slice(0, 10),
    bounces: 0,
    body: `${text}\n`,
    file: path.join(dir, `${id}.md`),
  };
  return saveTicket(ticket);
}

export function setStatus(ticket, status, extra = {}) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}"`);
  return saveTicket({ ...ticket, ...extra, status });
}

/* ───────────── scoring ───────────── */

/**
 * value ÷ (effort × contention), where contention grows with how hot the
 * files in the footprint are. A ticket that wants a chokepoint costs more
 * than its effort estimate says, because it blocks other tickets from the
 * same wave — that opportunity cost belongs in the score. Risk is NOT here;
 * risk is a gate (see evidence.classifyTier), not a discount.
 */
export function scoreTicket(t, touchRate = () => 0) {
  const value = Number(t.value ?? 1);
  const effort = Math.max(Number(t.effort ?? 1), 0.5);
  const confidence = Number(t.confidence ?? 0.5);
  const unblocks = Number(t.unblocks ?? 0);
  const contention = 1 + (t.footprint ?? []).reduce((s, f) => s + touchRate(f) * 10, 0);
  return (value * confidence + unblocks) / (effort * contention);
}
