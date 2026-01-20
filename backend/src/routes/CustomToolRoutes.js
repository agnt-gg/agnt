import express from 'express';
import CustomToolService from '../services/ToolService.js';
import { authenticateToken } from './Middleware.js';

// Set up new route
const CustomToolRoutes = express.Router();

// Define routes
CustomToolRoutes.get('/health', CustomToolService.healthCheck);
CustomToolRoutes.get('/', authenticateToken, CustomToolService.getAllCustomTools);
CustomToolRoutes.post('/save', authenticateToken, CustomToolService.saveOrUpdateCustomTool);
CustomToolRoutes.get('/:id', authenticateToken, CustomToolService.getCustomTool);
CustomToolRoutes.put('/:id', authenticateToken, CustomToolService.saveOrUpdateCustomTool);
CustomToolRoutes.delete('/:id', authenticateToken, CustomToolService.deleteCustomTool);

console.log(`Custom Tool Routes Started...`);

export default CustomToolRoutes;
