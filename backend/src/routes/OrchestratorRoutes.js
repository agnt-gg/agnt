import express from 'express';
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from './Middleware.js';
import multer from 'multer';

import universalChatHandler from '../services/OrchestratorService.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.get('/health', (req, res) => res.status(200).json({ status: 'OK' }));

// Universal chat handler - all routes stream by default with clean names
router.post('/chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/agent-chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/workflow-chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/tool-chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/goal-chat', authenticateToken, upload.array('files'), universalChatHandler);
router.post('/suggestions', authenticateToken, universalChatHandler);

export default router;
