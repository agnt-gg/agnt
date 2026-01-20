import express from 'express';
import MCPService from '../services/MCPService.js';
import { authenticateToken } from './Middleware.js';

const MCPRoutes = express.Router();

// All routes require authentication - bind methods to preserve 'this' context
MCPRoutes.get('/servers', authenticateToken, MCPService.getServers.bind(MCPService));
MCPRoutes.post('/servers', authenticateToken, MCPService.addServer.bind(MCPService));
MCPRoutes.put('/servers/:name', authenticateToken, MCPService.updateServer.bind(MCPService));
MCPRoutes.delete('/servers/:name', authenticateToken, MCPService.deleteServer.bind(MCPService));
MCPRoutes.get('/servers/:name/capabilities', authenticateToken, MCPService.getServerCapabilities.bind(MCPService));
MCPRoutes.post('/servers/:name/test', authenticateToken, MCPService.testConnection.bind(MCPService));

console.log('MCP Routes Started...');

export default MCPRoutes;
