// fs-watcher-trigger.js
// AGNT trigger tool: watches a file OR directory (auto-detected) for changes
// and fires the workflow on add/change/unlink/addDir/unlinkDir events.

import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import chokidar from 'chokidar';

let instance = null;

const VALID_EVENTS = ['add', 'change', 'unlink', 'addDir', 'unlinkDir'];

function clampNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(num)));
}

function parseEvents(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').split(/[\n,]+/);
  const events = raw
    .map((e) => String(e).trim())
    .filter((e) => VALID_EVENTS.includes(e));
  return events.length ? [...new Set(events)] : ['add', 'change', 'unlink'];
}

function parsePatterns(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function buildPayload(evt, filePath, watchPath, stats) {
  const resolved = path.resolve(filePath);
  return {
    event: evt,
    filePath: resolved,
    fileName: path.basename(resolved),
    directory: path.dirname(resolved),
    extension: evt === 'addDir' || evt === 'unlinkDir' ? '' : path.extname(resolved),
    isDirectory: evt === 'addDir' || evt === 'unlinkDir',
    timestamp: new Date().toISOString(),
    watchPath,
    stats: stats
      ? {
          size: stats.size,
          mtime: stats.mtime ? new Date(stats.mtime).toISOString() : null,
          ctime: stats.ctime ? new Date(stats.ctime).toISOString() : null,
          isFile: typeof stats.isFile === 'function' ? stats.isFile() : null,
          isDirectory: typeof stats.isDirectory === 'function' ? stats.isDirectory() : null,
        }
      : null,
  };
}

class FsWatcherTrigger extends EventEmitter {
  constructor() {
    super();
    this.name = 'fs-watcher-trigger';
    this.watchers = new Map(); // key -> chokidar.FSWatcher
    this.isListening = false;
  }

  async setup(engine, node) {
    const params = node?.parameters || {};
    const watchPath = String(params.watchPath || '').trim();

    if (!watchPath) {
      throw new Error('fs-watcher-trigger: watchPath is required');
    }
    if (!fs.existsSync(watchPath)) {
      throw new Error(`fs-watcher-trigger: path does not exist: ${watchPath}`);
    }

    const stat = fs.statSync(watchPath);
    const isDir = stat.isDirectory();

    const recursive = isDir ? params.recursive !== 'No' : false;
    const events = parseEvents(params.events);
    const debounceMs = clampNumber(params.debounceMs, 300, 0, 10000);
    const ignorePatterns = parsePatterns(params.ignorePatterns);

    // One watcher per workflow+node so multiple workflows can watch different paths
    const key = `${engine?.workflowId || 'wf'}:${node?.id || 'node'}`;

    // If this node already has a watcher (re-setup), close the old one first
    const existing = this.watchers.get(key);
    if (existing) {
      try { await existing.close(); } catch { /* ignore */ }
      this.watchers.delete(key);
    }

    const watcher = chokidar.watch(watchPath, {
      persistent: true,
      ignoreInitial: true,
      depth: recursive ? undefined : 0,
      ignored: ignorePatterns.length ? ignorePatterns : undefined,
      awaitWriteFinish:
        debounceMs > 0
          ? { stabilityThreshold: debounceMs, pollInterval: 100 }
          : false,
    });

    for (const evt of events) {
      watcher.on(evt, (filePath, stats) => {
        try {
          const payload = buildPayload(evt, filePath, watchPath, stats);
          console.log(`[fs-watcher-trigger] ${evt}: ${payload.filePath}`);
          this.emit('trigger', payload);
          engine.processWorkflowTrigger(payload);
        } catch (err) {
          console.error('[fs-watcher-trigger] Error handling event:', err);
        }
      });
    }

    watcher.on('error', (err) => {
      console.error('[fs-watcher-trigger] Watcher error:', err?.message || err);
    });

    this.watchers.set(key, watcher);

    engine.receivers = engine.receivers || {};
    engine.receivers['fs-watcher'] = this;
    this.isListening = true;

    if (params.fireOnStart === 'Yes') {
      setTimeout(() => {
        try {
          const payload = {
            event: 'initial-scan',
            filePath: path.resolve(watchPath),
            fileName: path.basename(watchPath),
            directory: isDir ? path.resolve(watchPath) : path.dirname(path.resolve(watchPath)),
            extension: isDir ? '' : path.extname(watchPath),
            isDirectory: isDir,
            timestamp: new Date().toISOString(),
            watchPath,
            stats: null,
          };
          this.emit('trigger', payload);
          engine.processWorkflowTrigger(payload);
        } catch (err) {
          console.error('[fs-watcher-trigger] fireOnStart error:', err);
        }
      }, 100);
    }

    console.log(
      `[fs-watcher-trigger] Watching ${isDir ? 'directory' : 'file'}: ${watchPath} | recursive=${recursive} | events=${events.join(',')} | debounce=${debounceMs}ms | ignore=${ignorePatterns.length} pattern(s)`
    );
  }

  validate(triggerData) {
    return Boolean(triggerData?.event && triggerData?.filePath);
  }

  async process(inputData) {
    return {
      event: inputData.event,
      filePath: inputData.filePath,
      fileName: inputData.fileName,
      directory: inputData.directory,
      extension: inputData.extension,
      isDirectory: Boolean(inputData.isDirectory),
      timestamp: inputData.timestamp,
      watchPath: inputData.watchPath,
      stats: inputData.stats || null,
    };
  }

  async teardown() {
    console.log(`[fs-watcher-trigger] Tearing down ${this.watchers.size} watcher(s)`);
    for (const [key, watcher] of this.watchers.entries()) {
      try {
        await watcher.close();
        console.log(`[fs-watcher-trigger] Closed watcher: ${key}`);
      } catch (err) {
        console.error(`[fs-watcher-trigger] Error closing watcher ${key}:`, err?.message || err);
      }
    }
    this.watchers.clear();
    this.isListening = false;
    this.removeAllListeners('trigger');
  }
}

function getFsWatcherTrigger() {
  if (!instance) instance = new FsWatcherTrigger();
  return instance;
}

export default getFsWatcherTrigger();
