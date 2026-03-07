import express from 'express';
import WidgetDefinitionService from '../services/WidgetDefinitionService.js';
import { authenticateToken } from './Middleware.js';

const WidgetDefinitionRoutes = express.Router();

// Thumbnail capture (server-side via Puppeteer) — must be before /:widgetId routes
WidgetDefinitionRoutes.post('/capture-thumbnail', authenticateToken, (req, res) => WidgetDefinitionService.captureThumbnail(req, res));

// Import (also before /:widgetId)
WidgetDefinitionRoutes.post('/import', authenticateToken, (req, res) => WidgetDefinitionService.importWidget(req, res));

// CRUD routes
WidgetDefinitionRoutes.get('/', authenticateToken, (req, res) => WidgetDefinitionService.getAllWidgets(req, res));
WidgetDefinitionRoutes.get('/:widgetId', authenticateToken, (req, res) => WidgetDefinitionService.getWidget(req, res));
WidgetDefinitionRoutes.post('/', authenticateToken, (req, res) => WidgetDefinitionService.createWidget(req, res));
WidgetDefinitionRoutes.put('/:widgetId', authenticateToken, (req, res) => WidgetDefinitionService.updateWidget(req, res));
WidgetDefinitionRoutes.delete('/:widgetId', authenticateToken, (req, res) => WidgetDefinitionService.deleteWidget(req, res));

// Duplicate
WidgetDefinitionRoutes.post('/:widgetId/duplicate', authenticateToken, (req, res) => WidgetDefinitionService.duplicateWidget(req, res));

// Export
WidgetDefinitionRoutes.get('/:widgetId/export', authenticateToken, (req, res) => WidgetDefinitionService.exportWidget(req, res));

console.log('Widget Definition Routes Started...');

export default WidgetDefinitionRoutes;
