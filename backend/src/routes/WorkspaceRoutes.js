import express from 'express';
import WorkspaceService from '../services/WorkspaceService.js';
import { authenticateToken } from './Middleware.js';

const WorkspaceRoutes = express.Router();

WorkspaceRoutes.get('/', authenticateToken, (req, res) => WorkspaceService.getWorkspaces(req, res));
WorkspaceRoutes.put('/', authenticateToken, (req, res) => WorkspaceService.putWorkspaces(req, res));
WorkspaceRoutes.delete('/:id', authenticateToken, (req, res) => WorkspaceService.deleteWorkspace(req, res));

console.log('Workspace Routes Started...');

export default WorkspaceRoutes;
