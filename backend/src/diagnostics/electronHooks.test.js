import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Recorder } from './Recorder.js';
import { installElectronCrashHooks, watchWindow } from './electronHooks.js';

let DIR;
let recorder;
let stderrWrite;

/** Every crash line the hooks printed to the terminal, by default sink. */
const printed = () => stderrWrite.mock.calls.map(([chunk]) => String(chunk)).filter((line) => line.startsWith('[crash]'));

function crashFiles() {
  const dir = path.join(DIR, 'crashes');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function readCrash(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, 'crashes', name), 'utf8'));
}

function fakeApp() {
  const app = new EventEmitter();
  app.off = app.removeListener.bind(app);
  app.getPath = (n) => `/fake/${n}`;
  return app;
}

beforeEach(() => {
  DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-hooks-'));
  recorder = new Recorder({ dir: DIR, proc: 'main', bootId: 'boot-x' });
  // The hooks print to the real stderr by default; capture it so the suite
  // stays quiet and the terminal lines themselves can be asserted.
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  recorder.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('electron crash hooks', () => {
  it('starts crashReporter with uploads disabled — nothing leaves the machine', () => {
    const start = vi.fn();
    installElectronCrashHooks(recorder, { app: fakeApp(), crashReporter: { start } });
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][0]).toMatchObject({ uploadToServer: false, submitURL: '' });
  });

  it('still installs when crashReporter throws', () => {
    const app = fakeApp();
    expect(() =>
      installElectronCrashHooks(recorder, {
        app,
        crashReporter: {
          start() {
            throw new Error('not supported');
          },
        },
      })
    ).not.toThrow();
    expect(app.listenerCount('render-process-gone')).toBe(1);
  });

  it('writes a crash record when the renderer dies', () => {
    const app = fakeApp();
    installElectronCrashHooks(recorder, { app, getState: () => ({ activeWorkflows: ['wf-1'] }) });

    app.emit('render-process-gone', {}, { getURL: () => 'app://index.html' }, {
      reason: 'oom',
      exitCode: 133,
    });

    const files = crashFiles();
    expect(files).toHaveLength(1);
    const crash = readCrash(files[0]);
    expect(crash.reason).toBe('render-process-gone');
    expect(crash.state.reason).toBe('oom');
    expect(crash.state.exitCode).toBe(133);
    expect(crash.state.url).toBe('app://index.html');
    expect(crash.state.activeWorkflows).toEqual(['wf-1']);
  });

  it('treats a GPU crash as recoverable, not fatal', () => {
    const app = fakeApp();
    installElectronCrashHooks(recorder, { app });
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 5 });
    expect(crashFiles()).toHaveLength(0); // logged at WARN, no crash record
    recorder.close();
    const file = fs.readdirSync(DIR).find((n) => n.endsWith('.jsonl'));
    const recs = fs.readFileSync(path.join(DIR, file), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    expect(recs.some((r) => r.lvl === 'WARN' && r.msg === 'gpu process crashed')).toBe(true);
  });

  it('ignores a clean utility-process exit', () => {
    const app = fakeApp();
    installElectronCrashHooks(recorder, { app });
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit', exitCode: 0 });
    expect(crashFiles()).toHaveLength(0);
  });

  it('auto-watches every window created, with no per-call-site wiring', () => {
    const app = fakeApp();
    installElectronCrashHooks(recorder, { app, getState: () => ({ route: '/dashboard' }) });

    // Simulates Electron emitting this for createWindow() AND the activate path.
    const win = new EventEmitter();
    app.emit('browser-window-created', {}, win);
    win.emit('unresponsive');

    const crash = readCrash(crashFiles()[0]);
    expect(crash.reason).toBe('unresponsive');
    expect(crash.state.route).toBe('/dashboard');
  });

  it('records a frozen UI, which throws no exception on its own', () => {
    const win = new EventEmitter();
    win.off = win.removeListener.bind(win);
    watchWindow(recorder, win, () => ({ route: '/chat' }));

    win.emit('unresponsive');

    const files = crashFiles();
    expect(files).toHaveLength(1);
    const crash = readCrash(files[0]);
    expect(crash.reason).toBe('unresponsive');
    expect(crash.state.route).toBe('/chat');
  });

  it('detaches every listener on uninstall', () => {
    const app = fakeApp();
    const off = installElectronCrashHooks(recorder, { app });
    expect(app.listenerCount('render-process-gone')).toBe(1);
    expect(app.listenerCount('child-process-gone')).toBe(1);
    expect(app.listenerCount('browser-window-created')).toBe(1);
    off();
    expect(app.listenerCount('render-process-gone')).toBe(0);
    expect(app.listenerCount('child-process-gone')).toBe(0);
    expect(app.listenerCount('browser-window-created')).toBe(0);
  });

  // One death mode per test: each writes one fsync'd crash record, and three
  // in one test outran the 5s timeout on a disk-bound parallel run.
  it.each([
    [
      'renderer',
      (app) => app.emit('render-process-gone', {}, { getURL: () => 'http://127.0.0.1:3333/' }, { reason: 'crashed', exitCode: 1 }),
      /^\[crash\] renderer gone: crashed \(exitCode 1\) at http:\/\/127\.0\.0\.1:3333\//,
    ],
    [
      'child process',
      (app) => app.emit('child-process-gone', {}, { type: 'Utility', reason: 'crashed', exitCode: 2 }),
      /^\[crash\] child process gone: Utility crashed \(exitCode 2\)/,
    ],
    ['frozen window', (_app, win) => win.emit('unresponsive'), /^\[crash\] main window stopped responding/],
  ])('prints one line for a dead %s, naming the crash record', (_mode, kill, expected) => {
    const app = fakeApp();
    installElectronCrashHooks(recorder, { app });
    const win = new EventEmitter();
    app.emit('browser-window-created', {}, win);

    kill(app, win);

    const lines = printed();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(expected);
    const [record] = crashFiles();
    expect(lines[0].endsWith(`\n  crash record: ${path.join(DIR, 'crashes', record)}\n`)).toBe(true);
  });

  it('prints a GPU crash and a recovered window, which write no crash record', () => {
    const app = fakeApp();
    installElectronCrashHooks(recorder, { app });
    const win = new EventEmitter();
    app.emit('browser-window-created', {}, win);

    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 5 });
    win.emit('responsive');

    expect(printed()).toEqual([
      '[crash] child process gone: GPU crashed (exitCode 5) (Chromium restarts the GPU process; rendering may stutter)\n',
      '[crash] main window responsive again\n',
    ]);
  });

  it('prints nothing for a clean utility-process exit', () => {
    const app = fakeApp();
    installElectronCrashHooks(recorder, { app });
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit', exitCode: 0 });
    expect(printed()).toEqual([]);
  });

  it('sends terminal lines to an injected sink instead of stderr', () => {
    const app = fakeApp();
    const print = vi.fn();
    installElectronCrashHooks(recorder, { app, print });
    app.emit('render-process-gone', {}, null, { reason: 'oom', exitCode: 133 });
    expect(print).toHaveBeenCalledOnce();
    expect(print.mock.calls[0][0]).toMatch(/^\[crash\] renderer gone: oom \(exitCode 133\)\n  crash record: /);
    expect(printed()).toEqual([]);
  });

  it('survives a closed stderr while reporting a crash', () => {
    stderrWrite.mockImplementation(() => {
      throw new Error('EPIPE');
    });
    const app = fakeApp();
    installElectronCrashHooks(recorder, { app });
    expect(() => app.emit('render-process-gone', {}, null, { reason: 'crashed', exitCode: 1 })).not.toThrow();
    expect(crashFiles()).toHaveLength(1); // the record still lands
  });

  it('never lets a throwing getState() swallow the crash record', () => {
    const app = fakeApp();
    installElectronCrashHooks(recorder, {
      app,
      getState: () => {
        throw new Error('state blew up');
      },
    });
    app.emit('render-process-gone', {}, null, { reason: 'crashed', exitCode: 1 });
    const crash = readCrash(crashFiles()[0]);
    expect(crash.reason).toBe('render-process-gone');
    expect(crash.state.stateError).toBe('state blew up');
  });
});
