import express from 'express';
import path from 'path';
import { findImageFile, mimeFromExt } from '../services/ImageStorage.js';
import { authenticateToken } from './Middleware.js';

const ImageRoutes = express.Router();

ImageRoutes.get('/:id', authenticateToken, (req, res) => {
  const filePath = findImageFile(req.params.id);
  if (!filePath) {
    return res.status(404).json({ error: 'Image not found' });
  }
  const ext = path.extname(filePath).slice(1);
  res.setHeader('Content-Type', mimeFromExt(ext));
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(filePath);
});

console.log('Image Routes Started...');

export default ImageRoutes;
