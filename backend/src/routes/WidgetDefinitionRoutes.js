import express from 'express';
import WidgetDefinitionService from '../services/WidgetDefinitionService.js';
import { authenticateToken } from './Middleware.js';

const WidgetDefinitionRoutes = express.Router();

// CRUD routes
WidgetDefinitionRoutes.get('/', authenticateToken, (req, res) => WidgetDefinitionService.getAllWidgets(req, res));
WidgetDefinitionRoutes.get('/:widgetId', authenticateToken, (req, res) => WidgetDefinitionService.getWidget(req, res));
WidgetDefinitionRoutes.post('/', authenticateToken, (req, res) => WidgetDefinitionService.createWidget(req, res));
WidgetDefinitionRoutes.put('/:widgetId', authenticateToken, (req, res) => WidgetDefinitionService.updateWidget(req, res));
WidgetDefinitionRoutes.delete('/:widgetId', authenticateToken, (req, res) => WidgetDefinitionService.deleteWidget(req, res));

// Duplicate
WidgetDefinitionRoutes.post('/:widgetId/duplicate', authenticateToken, (req, res) => WidgetDefinitionService.duplicateWidget(req, res));

// Export/Import
WidgetDefinitionRoutes.get('/:widgetId/export', authenticateToken, (req, res) => WidgetDefinitionService.exportWidget(req, res));
WidgetDefinitionRoutes.post('/import', authenticateToken, (req, res) => WidgetDefinitionService.importWidget(req, res));

console.log('Widget Definition Routes Started...');

export default WidgetDefinitionRoutes;
