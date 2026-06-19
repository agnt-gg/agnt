import express from 'express';
import ScheduleModel from '../models/ScheduleModel.js';
import SchedulerService from '../services/scheduler/SchedulerService.js';
import { isValidCron, nextFireTime } from '../services/scheduler/cronParser.js';
import { authenticateToken } from './Middleware.js';

const ScheduleRoutes = express.Router();

// GET /api/schedules
ScheduleRoutes.get('/', authenticateToken, async (req, res) => {
  try {
    const schedules = await ScheduleModel.findByUserId(req.user.userId);
    res.json({ success: true, schedules });
  } catch (err) {
    console.error('[Schedule Route] List error:', err);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

// GET /api/schedules/target/:targetType/:targetId
ScheduleRoutes.get('/target/:targetType/:targetId', authenticateToken, async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    const schedules = await ScheduleModel.findByTarget(targetType, targetId);
    res.json({ success: true, schedules });
  } catch (err) {
    console.error('[Schedule Route] By-target error:', err);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

// POST /api/schedules/preview — preview firings without persisting
ScheduleRoutes.post('/preview', authenticateToken, (req, res) => {
  try {
    const { cron, timezone, count } = req.body || {};
    if (!cron) return res.status(400).json({ error: 'cron is required' });
    if (!isValidCron(cron)) return res.status(400).json({ error: 'Invalid cron expression' });
    const previews = SchedulerService.preview(cron, Math.min(parseInt(count) || 5, 25), timezone || 'UTC');
    res.json({ success: true, previews });
  } catch (err) {
    console.error('[Schedule Route] Preview error:', err);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/schedules
ScheduleRoutes.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { targetType, targetId, cron, timezone, enabled, onMissed } = req.body || {};
    if (!targetType || !targetId || !cron) {
      return res.status(400).json({ error: 'targetType, targetId, and cron are required' });
    }
    if (!isValidCron(cron)) return res.status(400).json({ error: 'Invalid cron expression' });

    const tz = timezone || 'UTC';
    const nextRun = nextFireTime(cron, new Date(), tz);
    const id = await ScheduleModel.create({
      userId, targetType, targetId, cron, timezone: tz, nextRun,
      enabled: enabled !== false,
      onMissed: onMissed || 'fire_once',
    });
    const schedule = await ScheduleModel.findOne(id);
    res.status(201).json({ success: true, schedule });
  } catch (err) {
    console.error('[Schedule Route] Create error:', err);
    res.status(500).json({ error: 'Failed to create schedule', details: err.message });
  }
});

// PATCH /api/schedules/:id
ScheduleRoutes.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const existing = await ScheduleModel.findOne(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Schedule not found' });
    if (existing.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });

    const { cron, timezone, enabled, onMissed } = req.body || {};

    if (typeof enabled === 'boolean') {
      await ScheduleModel.setEnabled(req.params.id, enabled);
    }
    if (cron || timezone || onMissed) {
      if (cron && !isValidCron(cron)) return res.status(400).json({ error: 'Invalid cron expression' });
      const tz = timezone || existing.timezone || 'UTC';
      const effectiveCron = cron || existing.cron;
      const nextRun = nextFireTime(effectiveCron, new Date(), tz);
      await ScheduleModel.updateCron(req.params.id, { cron, timezone, nextRun, onMissed });
    }

    const schedule = await ScheduleModel.findOne(req.params.id);
    res.json({ success: true, schedule });
  } catch (err) {
    console.error('[Schedule Route] Update error:', err);
    res.status(500).json({ error: 'Failed to update schedule', details: err.message });
  }
});

// POST /api/schedules/:id/fire-now
ScheduleRoutes.post('/:id/fire-now', authenticateToken, async (req, res) => {
  try {
    const existing = await ScheduleModel.findOne(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Schedule not found' });
    if (existing.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    const result = await SchedulerService.fireNow(req.params.id);
    res.json({ success: true, result });
  } catch (err) {
    console.error('[Schedule Route] Fire-now error:', err);
    res.status(500).json({ error: 'Failed to fire schedule', details: err.message });
  }
});

// GET /api/schedules/:id/runs
ScheduleRoutes.get('/:id/runs', authenticateToken, async (req, res) => {
  try {
    const existing = await ScheduleModel.findOne(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Schedule not found' });
    if (existing.user_id !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    const limit = Math.min(parseInt(req.query.limit) || 50, 500);
    const runs = await ScheduleModel.findRunHistory(req.params.id, limit);
    res.json({ success: true, runs });
  } catch (err) {
    console.error('[Schedule Route] Run history error:', err);
    res.status(500).json({ error: 'Failed to fetch run history' });
  }
});

// DELETE /api/schedules/:id
ScheduleRoutes.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const changes = await ScheduleModel.delete(req.params.id, userId);
    res.json({ success: true, deleted: changes > 0 });
  } catch (err) {
    console.error('[Schedule Route] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

console.log('Schedule Routes Started...');

export default ScheduleRoutes;
