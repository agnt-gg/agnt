/**
 * Settings → Backup & Restore and Reset — /api/data/*
 *
 *   POST   /restore            upload a backup (raw body), get back what it contains
 *   POST   /restore/:id/start  restore the chosen categories, in the background
 *   GET    /restore/:id        progress, then the result
 *   DELETE /restore/:id        forget the upload
 *   GET    /reset              what each reset option would remove, for the caller
 *   POST   /reset              { groups: [...], confirm: 'RESET' }
 *
 * Restores and resets run on their OWN sqlite connection to the same database: their batched
 * transactions can then never capture, or be rolled back with, the application's writes.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { authenticateToken } from './Middleware.js';
import { dbPath } from '../models/database/index.js';
import UserModel from '../models/UserModel.js';
import pathManager from '../utils/PathManager.js';
import { inspectBackup, restoreBackup } from '../services/DataImportService.js';
import { normalizeResetRequest, summarizeReset, resetData } from '../services/DataResetService.js';
import WorkflowProcessBridge from '../workflow/WorkflowProcessBridge.js';

const MAX_UPLOAD_BYTES = 50 * 1024 ** 3; // a real multi-year backup with run history can reach tens of GB
const JOB_TTL_MS = 6 * 60 * 60 * 1000;
const ID = /^[A-Za-z0-9_-]{16,64}$/;

/** Restore jobs by id. One process, one user's uploads; files live under the data dir, never the OS temp. */
const jobs = new Map();
const uploadDir = () => {
  const dir = path.join(pathManager.getDataDir(), 'restores');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const userOf = req => req.user?.userId || req.user?.id;
const publicJob = job => ({ id: job.id, status: job.status, summary: job.summary, progress: job.progress, result: job.result, error: job.error });

function removeJob(job) {
  jobs.delete(job.id);
  fs.promises.rm(job.filePath, { force: true }).catch(err => console.warn('[DataRoutes] could not remove upload:', err.message));
}
function pruneJobs(now = Date.now()) {
  for (const job of jobs.values()) if (job.status !== 'running' && now - job.createdAt > JOB_TTL_MS) removeJob(job);
}
/** Only the user who uploaded a file can see or use it. Anyone else gets "not found". */
function jobFor(req) {
  const job = ID.test(req.params.id) ? jobs.get(req.params.id) : null;
  return job && job.userId === userOf(req) ? job : null;
}

export function openJobDatabase(file = dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, err => (err ? reject(err) : resolve(db)));
  });
}
const closeDb = db => new Promise(resolve => db.close(() => resolve()));

export function createDataRouter({ authenticate = authenticateToken, openDb = openJobDatabase, stopWorkflow = WorkflowProcessBridge.deactivateWorkflow.bind(WorkflowProcessBridge) } = {}) {
  const router = express.Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!userOf(req)) return res.status(401).json({ success: false, error: 'Sign in required' });
    next();
  });
  const fail = (res, err, fallback) => {
    if (!err.status) console.error('[DataRoutes]', fallback, err);
    res.status(err.status || 500).json({ success: false, error: err.status ? err.message : fallback });
  };

  // Upload: streamed straight to disk, never buffered; counted, capped, and inspected before anything is written.
  router.post('/restore', async (req, res) => {
    pruneJobs();
    const id = crypto.randomBytes(16).toString('hex');
    const filePath = path.join(uploadDir(), `${id}.backup`);
    let bytes = 0;
    try {
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(filePath);
        req.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > MAX_UPLOAD_BYTES) { req.unpipe(out); out.destroy(); reject(Object.assign(new Error('That file is larger than any AGNT backup could be.'), { status: 413 })); req.resume(); }
        });
        req.on('aborted', () => reject(Object.assign(new Error('The upload was interrupted.'), { status: 400 })));
        out.on('error', reject);
        out.on('finish', resolve);
        req.pipe(out);
      });
      if (bytes === 0) throw Object.assign(new Error('Choose a backup file to restore.'), { status: 400 });
      const summary = await inspectBackup(filePath);
      const job = { id, userId: userOf(req), filePath, createdAt: Date.now(), status: 'ready', summary, progress: null, result: null, error: null };
      jobs.set(id, job);
      res.json({ success: true, ...publicJob(job) });
    } catch (err) {
      fs.promises.rm(filePath, { force: true }).catch(() => {});
      fail(res, err, 'Could not read that file');
    }
  });

  router.post('/restore/:id/start', express.json(), async (req, res) => {
    const job = jobFor(req);
    if (!job) return res.status(404).json({ success: false, error: 'That upload has expired. Choose the file again.' });
    if (job.status === 'running') return res.status(409).json({ success: false, error: 'This backup is already being restored.' });
    const available = new Set(job.summary.categories.filter(c => c.restorable).map(c => c.id));
    const categories = Array.isArray(req.body?.categories) ? req.body.categories.filter(id => available.has(id)) : [];
    if (!categories.length) return res.status(400).json({ success: false, error: 'Choose at least one thing to restore.' });
    job.status = 'running'; job.error = null; job.result = null;
    job.progress = { bytes: 0, totalBytes: job.summary.bytes };
    res.json({ success: true, ...publicJob(job) });
    let db;
    try {
      db = await openDb();
      job.result = await restoreBackup({ filePath: job.filePath, userId: job.userId, categories, db, onProgress: bytes => { job.progress = { bytes, totalBytes: job.summary.bytes }; } });
      job.status = 'done';
    } catch (err) {
      console.error('[DataRoutes] restore failed:', err);
      job.status = 'failed';
      job.error = err.status ? err.message : 'The restore stopped partway. Everything restored before that is kept; running it again adds only what is missing.';
    } finally {
      if (db) await closeDb(db);
      // Stats keep a watermark over execution history; a restore changes that history.
      UserModel.invalidateNodeStats();
      job.progress = { bytes: job.summary.bytes, totalBytes: job.summary.bytes };
    }
  });

  router.get('/restore/:id', (req, res) => {
    const job = jobFor(req);
    if (!job) return res.status(404).json({ success: false, error: 'That upload has expired.' });
    res.json({ success: true, ...publicJob(job) });
  });

  router.delete('/restore/:id', (req, res) => {
    const job = jobFor(req);
    if (!job) return res.status(404).json({ success: false, error: 'That upload has expired.' });
    if (job.status === 'running') return res.status(409).json({ success: false, error: 'Wait for the restore to finish.' });
    removeJob(job);
    res.json({ success: true });
  });

  router.get('/reset', async (req, res) => {
    let db;
    try {
      db = await openDb();
      res.json({ success: true, groups: await summarizeReset(db, userOf(req)) });
    } catch (err) {
      fail(res, err, 'Could not check what would be reset');
    } finally {
      if (db) await closeDb(db);
    }
  });

  router.post('/reset', express.json(), async (req, res) => {
    let db;
    try {
      const groups = normalizeResetRequest(req.body || {});
      const userId = userOf(req);
      db = await openDb();
      const result = await resetData({ db, userId, groups, stopWorkflow: id => stopWorkflow(id, userId) });
      res.json({ success: true, ...result });
    } catch (err) {
      fail(res, err, 'The reset stopped partway. Anything already removed stays removed; run it again to finish.');
    } finally {
      if (db) await closeDb(db);
      // Even a reset that stopped partway removed rows the cached stats still count.
      UserModel.invalidateNodeStats();
    }
  });

  return router;
}

export default createDataRouter;
