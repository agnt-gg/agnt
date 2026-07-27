import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Recorder } from './Recorder.js';
import { installElectronCrashHooks, watchWindow } from './electronHooks.js';

let DIR;
let recorder;

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
