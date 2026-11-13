import express from 'express';
import { yearInReview } from '../services/wrapped/WrappedService.js';
import { authenticateToken } from './Middleware.js';

/** WrappedRoutes: the year in review behind AGNT One's Wrapped cards. */

const WrappedRoutes = express.Router();
const FIRST_YEAR = 2000;

// GET /api/wrapped/:year
WrappedRoutes.get('/:year', authenticateToken, async (req, res) => {
  const year = Number(req.params.year);
  const current = new Date().getFullYear();
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > current) {
    return res.status(400).json({ error: `year must be a whole number from ${FIRST_YEAR} to ${current}` });
  }
  try {
    res.json({ success: true, ...(await yearInReview(req.user.userId, year)) });
  } catch (err) {
    console.error('[Wrapped] year in review failed:', err);
    res.status(500).json({ error: err.message });
  }
});

export default WrappedRoutes;
