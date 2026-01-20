import express from 'express';
import { authenticateToken } from './Middleware.js';
import AiService from '../services/AiService.js';
import multer from 'multer';

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const StreamRoutes = express.Router();

StreamRoutes.get('/health', AiService.healthCheck);
StreamRoutes.post('/start-tool-forge-stream', authenticateToken, upload.array('files'), AiService.startToolForgeStream);
StreamRoutes.post('/cancel-tool-forge-stream', authenticateToken, AiService.cancelToolForgeStream);
StreamRoutes.post('/start-chat-stream', authenticateToken, upload.array('files'), AiService.startChatStream);
StreamRoutes.post('/cancel-chat-stream', authenticateToken, AiService.cancelChatStream);
StreamRoutes.post('/generate-tool', authenticateToken, AiService.generateTool);
StreamRoutes.post('/generate-workflow', authenticateToken, AiService.generateWorkflow);
StreamRoutes.post('/generate-agent', authenticateToken, AiService.generateAgent);

console.log(`Stream Routes Started...`);

export default StreamRoutes;
