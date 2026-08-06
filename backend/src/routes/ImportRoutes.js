/**
 * Bring a user's existing AI agent setup into AGNT — /api/import/*
 *
 * Detection is read-only and runs during onboarding, so it must answer fast
 * and must never fail the page. Import writes, so it is a POST and recomputes
 * everything detection told the client rather than trusting the payload back.
 */

import express from 'express';
import HarnessScanner from '../services/import/HarnessScanner.js';
import HarnessImporter from '../services/import/HarnessImporter.js';
import { authenticateToken } from './Middleware.js';

const ImportRoutes = express.Router();

/**
 * Onboarding shows this step only if this call says there is something to
 * show, so a scan that hangs would hang the wizard. The budget is deliberately
 * shorter than a user's patience: past it we answer "nothing found", which
 * costs a user with a slow disk one skipped step and costs everyone else
 * nothing. Settings offers the same import later, so the door stays open.
 */
const DETECT_TIMEOUT_MS = 2500;

const EMPTY = { sources: [], totals: { sources: 0, skillsSeen: 0, skillsImportable: 0, personas: 0, memories: 0 } };

ImportRoutes.get('/detect', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  try {
    const result = await Promise.race([
      HarnessScanner.detect({ userId }),
      new Promise((resolve) => setTimeout(() => resolve({ ...EMPTY, timedOut: true }), DETECT_TIMEOUT_MS)),
    ]);
    res.json(result);
  } catch (error) {
    // Detection failing is not the user's problem and not a reason to show
    // them an error during onboarding: an empty result renders no step.
    console.error('[ImportRoutes] detect failed:', error.message);
    res.json({ ...EMPTY, error: 'detect-failed' });
  }
});

ImportRoutes.post('/run', authenticateToken, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Authentication required' });

  const { skills = [], personas = [], memories = [] } = req.body || {};
  if (![skills, personas, memories].every(Array.isArray)) {
    return res.status(400).json({ error: 'skills, personas and memories must be arrays' });
  }
  if (skills.length === 0 && personas.length === 0 && memories.length === 0) {
    return res.status(400).json({ error: 'Nothing selected to import' });
  }

  try {
    const result = await HarnessImporter.run({ skills, personas, memories }, userId);
    res.json(result);
  } catch (error) {
    console.error('[ImportRoutes] run failed:', error.message);
    res.status(500).json({ error: error.message || 'Import failed' });
  }
});

console.log('Import Routes Started...');

export default ImportRoutes;
