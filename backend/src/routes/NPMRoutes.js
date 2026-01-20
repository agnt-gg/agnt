import express from 'express';
import NPMService from '../services/NPMService.js';
import { authenticateToken } from './Middleware.js';

const NPMRoutes = express.Router();

// All routes require authentication
NPMRoutes.get('/search', authenticateToken, NPMService.searchMCPServers.bind(NPMService));
NPMRoutes.get('/popular', authenticateToken, NPMService.getPopularServers.bind(NPMService));
NPMRoutes.get('/package/:packageName', authenticateToken, NPMService.getPackageDetails.bind(NPMService));
NPMRoutes.post('/test', authenticateToken, NPMService.testPackage.bind(NPMService));

console.log('NPM Routes Started...');

export default NPMRoutes;
