/**
 * CONTRACT for built-in computer use.
 *
 * The driver is a native binary that may not be installed; these tests run
 * against a FAKE cua-driver (a node script selected via AGNT_CUA_DRIVER_PATH)
 * that replays the measured 0.19.3 envelopes, so the outcome contract is
 * proven without a desktop. Plus the registry-level guarantees: every tool has
 * a valid schema, is registered under computer-*, and refuses to act on the
 * real host without confirm=true or without a driver.
 */

import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import SchemaValidator from '../SchemaValidator.js';
import { readOutcome, resolveDriverPath, parseDriverJson } from '../../services/computerUse/driver.js';

import setup from './utilities/computer-setup.js';
import session from './utilities/computer-session.js';
import windows from './utilities/computer-windows.js';
import observe from './utilities/computer-observe.js';
import input from './actions/computer-input.js';

const TOOLS = { setup, session, windows, observe, input };

/**
 * The fake driver. `cua-driver call <tool> <json>` prints an envelope keyed on
 * the tool name; management commands answer like the real binary does.
 */
const FAKE = String.raw`
const [, , a, b, c] = process.argv;
const tool = a === 'call' ? b : a;
const arg = (() => { try { return JSON.parse(a === 'call' ? c : b); } catch { return {}; } })();
const out = (o) => { process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o)); };
switch (tool) {
  case '--version': out('cua-driver 0.19.3'); break;
  case 'status': out('cua-driver daemon: running (pid 4242)'); break;
  case 'doctor': out('OK: interactive desktop session\nOK: UIA available'); break;
  case 'list_windows': out({ windows: [
    { pid: 100, window_id: 1, title: 'Calculator', app_name: 'Calculator', bounds: { x: 0, y: 0, w: 400, h: 600 }, is_on_screen: true },
    { pid: 200, window_id: 2, title: 'Notepad', app_name: 'Notepad', bounds: { x: 10, y: 10, w: 800, h: 600 }, is_on_screen: false },
  ] }); break;
  case 'get_window_state':
    if (arg.screenshot_out_file) require('fs').writeFileSync(arg.screenshot_out_file, Buffer.alloc(200, 1));
    out({ snapshot_id: 'snap-1', elements: [
      { element_index: 0, element_token: 'tok-seven', role: 'Button', label: 'Seven', enabled: true },
      { element_index: 1, element_token: 'tok-display', role: 'Text', label: 'Display is 0', enabled: true },
    ], tree_markdown: '- Button Seven\n- Text Display is 0', total_element_count: 2 });
    break;
  case 'click':
    if (arg.element_token === 'stale') out({ status: 'refused', refusal: { code: 'stale_element_token', message: 'token superseded' } });
    else if (arg.element_token === 'tok-seven') out({ effect: 'unverifiable', route: 'accessibility', delivery: { mode: 'background' } });
    else out({ effect: 'confirmed', route: 'accessibility', delivery: { mode: 'background' } });
    break;
  case 'type_text':
    if (arg.window_id == null && arg.element_token == null && arg.x == null) out({ effect: 'refused', code: 'ambiguous_window_target', pid: arg.pid });
    else out({ effect: 'unverifiable', route: 'accessibility', delivery: { mode: 'background' }, escalation: { recommended: 'pixel', reason: 'effect_unconfirmed' } });
    break;
  case 'verify_state': out({ status: 'satisfied', stable: true, samples: 1, elapsed_ms: 12, predicates: [{ index: 0, status: 'satisfied', observed_json: { label: 'Display is 7' } }] }); break;
  case 'launch_app': out('Failed to activate packaged app "Nope": Package was not found. (0x80073CF1)'); break;
  case 'start_session': out({ capture_scope: arg.capture_scope, effective_scope: 'window', active: true }); break;
  case 'end_session': out({ active: false }); break;
  case 'hotkey': out({ effect: 'confirmed', route: 'synthetic_events', delivery: { mode: 'background' } }); break;
  default: out({ effect: 'confirmed' });
}
`;

let fakeDir;
let fakeBin;
let previousOverride;

beforeAll(() => {
  fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-fake-cua-'));
  // A JS override runs under this node — Node 22 refuses .cmd shims without a
  // shell, and the driver must never spawn through one.
  fakeBin = path.join(fakeDir, 'fake-cua-driver.cjs');
  fs.writeFileSync(fakeBin, FAKE);
  previousOverride = process.env.AGNT_CUA_DRIVER_PATH;
  process.env.AGNT_CUA_DRIVER_PATH = fakeBin;
});

afterAll(() => {
  if (previousOverride === undefined) delete process.env.AGNT_CUA_DRIVER_PATH;
  else process.env.AGNT_CUA_DRIVER_PATH = previousOverride;
  fs.rmSync(fakeDir, { recursive: true, force: true });
});

describe('registration: built in, not a plugin', () => {
  it('every computer-* tool has a static schema that passes the registry validator', () => {
    const validator = new SchemaValidator();
    for (const [name, tool] of Object.entries(TOOLS)) {
      const schema = tool.constructor.schema;
      expect(schema, name).toBeTruthy();
      expect(schema.type).toBe(`computer-${name}`);
      expect(tool.name).toBe(`computer-${name}`);
      const v = validator.validate(schema);
      expect(v.valid, `${name}: ${(v.errors || []).join('; ')}`).toBe(true);
    }
  });

  it('no schema or hint still points at the plugin names', () => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      expect(JSON.stringify(tool.constructor.schema), name).not.toMatch(/cua-(setup|session|windows|observe|input|act)/);
    }
  });

  it('the nested-agent loop (cua-act) is deliberately not ported', async () => {
    await expect(import('./actions/computer-act.js')).rejects.toThrow();
  });
});

describe('the outcome contract (measured 0.19.3 envelopes)', () => {
  it('effect:unverifiable is DELIVERED, not failed', () => {
    const o = readOutcome({ ok: true, stdout: '{"effect":"unverifiable","route":"accessibility","delivery":{"mode":"background"}}' });
    expect(o.ok).toBe(true);
    expect(o.notDelivered).toBe(false);
    expect(o.effect).toBe('unverifiable');
  });

  it('both refusal envelopes are refusals', () => {
    const a = readOutcome({ ok: true, stdout: '{"status":"refused","refusal":{"code":"stale_element_token","message":"x"}}' });
    const b = readOutcome({ ok: true, stdout: '{"effect":"refused","code":"ambiguous_window_target"}' });
    expect(a.refused).toBe(true); expect(a.code).toBe('stale_element_token'); expect(a.ok).toBe(false);
    expect(b.refused).toBe(true); expect(b.code).toBe('ambiguous_window_target');
  });

  it('plain-text failure with exit 0 is a FAILURE, not a phantom success', () => {
    const o = readOutcome({ ok: true, stdout: 'Failed to activate packaged app "X": Package was not found. (0x80073CF1)' });
    expect(o.ok).toBe(false);
    expect(o.plainTextError).toBe(true);
    expect(o.summary).toMatch(/^FAILED/);
  });

  it('exit-zero with empty output is UNKNOWN and therefore failure', () => {
    const o = readOutcome({ ok: true, stdout: '', stderr: '' });
    expect(o.ok).toBe(false);
    expect(o.emptyResponse).toBe(true);
    expect(o.failedHard).toBe(true);
    expect(o.summary).toMatch(/no result/);
  });

  it('an explicit affirmative plain line is fine', () => {
    expect(readOutcome({ ok: true, stdout: '✅ waited 200ms' }).ok).toBe(true);
  });

  it('parseDriverJson tolerates a banner before the JSON', () => {
    expect(parseDriverJson('cua-driver 0.19.3\n{"a":1}')).toEqual({ a: 1 });
  });
});

describe('against the fake driver', () => {
  it('resolves the override path', () => {
    expect(resolveDriverPath()).toEqual({ found: true, path: fakeBin, onPath: false });
  });

  it('setup status reports installed + daemon', async () => {
    const r = await setup.execute({ action: 'status' });
    expect(r.success).toBe(true);
    expect(r.installed).toBe(true);
    expect(r.version).toBe('cua-driver 0.19.3');
    expect(r.daemon).toEqual({ running: true });
  });

  it('windows lists, filters, and counts minimized', async () => {
    const r = await windows.execute({});
    expect(r.count).toBe(2);
    expect(r.minimizedCount).toBe(1);
    const f = await windows.execute({ filter: 'calc' });
    expect(f.windows.map((w) => w.title)).toEqual(['Calculator']);
  });

  it('observe returns tokens and a screenshot; treeOnly skips the shot', async () => {
    const r = await observe.execute({ pid: 100, windowId: 1 });
    expect(r.success).toBe(true);
    expect(r.snapshotId).toBe('snap-1');
    expect(r.elements[0].token).toBe('tok-seven');
    expect(r.hasScreenshot).toBe(true);
    expect(r.imageHtml).toMatch(/^<img src="data:image\/png;base64,/);
    const cheap = await observe.execute({ pid: 100, windowId: 1, treeOnly: true });
    expect(cheap.hasScreenshot).toBe(false);
  });

  it('observe mode=verify measures instead of guessing', async () => {
    const r = await observe.execute({ pid: 100, windowId: 1, mode: 'verify', expectLabel: 'Display is 7' });
    expect(r.success).toBe(true);
    expect(r.satisfied).toBe(true);
    expect(r.predicates[0].observed).toEqual({ label: 'Display is 7' });
  });

  it('input refuses without confirm — it is the real host', async () => {
    const r = await input.execute({ action: 'click', pid: 100, elementToken: 'tok-seven' });
    expect(r.success).toBe(false);
    expect(r.dispatched).toBe(false);
    expect(r.error).toMatch(/confirm=true/);
  });

  it('input: success and proven are different questions', async () => {
    const r = await input.execute({ action: 'click', pid: 100, elementToken: 'tok-seven', confirm: true });
    expect(r.success).toBe(true);
    expect(r.proven).toBe(false);
    expect(r.effect).toBe('unverifiable');
    expect(r.hint).toMatch(/verify/);
    const c = await input.execute({ action: 'click', pid: 100, elementToken: 'tok-other', confirm: true });
    expect(c.proven).toBe(true);
  });

  it('input: a stale token is refused with the re-observe hint', async () => {
    const r = await input.execute({ action: 'click', pid: 100, elementToken: 'stale', confirm: true });
    expect(r.success).toBe(false);
    expect(r.refused).toBe(true);
    expect(r.code).toBe('stale_element_token');
    expect(r.hint).toMatch(/fresh computer-observe snapshot/);
  });

  it('input: ambiguous window is refused rather than guessed, and the hint names windowId', async () => {
    const r = await input.execute({ action: 'type', pid: 100, text: 'hi', confirm: true });
    expect(r.refused).toBe(true);
    expect(r.code).toBe('ambiguous_window_target');
    expect(r.hint).toMatch(/windowId/);
  });

  it('input: the driver escalation becomes the next move (pixel write)', async () => {
    const r = await input.execute({ action: 'type', pid: 100, windowId: 1, text: 'hi', confirm: true });
    expect(r.success).toBe(true);
    expect(r.escalation).toBe('pixel');
    expect(r.hint).toMatch(/act by pixel/i);
  });

  it('input: plain-text launch failure is reported as failure', async () => {
    const r = await input.execute({ action: 'launch_app', text: 'Nope', confirm: true });
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/FAILED: Failed to activate/);
  });

  it('input: elementIndex without snapshotId fails closed before touching the driver', async () => {
    const r = await input.execute({ action: 'click', pid: 100, elementIndex: 0, confirm: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/snapshotId/);
  });

  it('session start/end round-trips', async () => {
    const s = await session.execute({ action: 'start', session: 'test-run' });
    expect(s.success).toBe(true);
    expect(s.captureScope).toBe('auto');
    const e = await session.execute({ action: 'end', session: 'test-run' });
    expect(e.success).toBe(true);
    expect(e.active).toBe(false);
  });

  it('session escalate is confirm-gated because it is permanent', async () => {
    const r = await session.execute({ action: 'escalate', session: 'test-run' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/PERMANENT/);
  });
});

describe('without a driver', () => {
  it('every tool says how to install instead of throwing', async () => {
    const saved = process.env.AGNT_CUA_DRIVER_PATH;
    process.env.AGNT_CUA_DRIVER_PATH = path.join(fakeDir, 'does-not-exist.exe');
    try {
      for (const tool of [windows, observe, session]) {
        // eslint-disable-next-line no-await-in-loop
        const r = await tool.execute({ pid: 1, windowId: 1, session: 'x' });
        expect(r.success).toBe(false);
        expect(r.installed).toBe(false);
        expect(r.error).toMatch(/computer-setup/);
      }
      const r = await input.execute({ action: 'click', pid: 1, elementToken: 't', confirm: true });
      expect(r.installed).toBe(false);
    } finally {
      process.env.AGNT_CUA_DRIVER_PATH = saved;
    }
  });
});
