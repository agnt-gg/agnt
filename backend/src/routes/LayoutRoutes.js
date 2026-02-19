import express from 'express';
import LayoutService from '../services/LayoutService.js';
import { authenticateToken } from './Middleware.js';

const LayoutRoutes = express.Router();

LayoutRoutes.get('/', authenticateToken, (req, res) => LayoutService.getAllLayouts(req, res));
LayoutRoutes.post('/', authenticateToken, (req, res) => LayoutService.createLayout(req, res));
LayoutRoutes.put('/:pageId', authenticateToken, (req, res) => LayoutService.updateLayout(req, res));
LayoutRoutes.delete('/:pageId', authenticateToken, (req, res) => LayoutService.deleteLayout(req, res));
LayoutRoutes.post('/reset/:pageId', authenticateToken, (req, res) => LayoutService.resetLayout(req, res));

console.log('Layout Routes Started...');

export default LayoutRoutes;
