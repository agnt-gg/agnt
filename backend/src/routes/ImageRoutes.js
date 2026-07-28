import express from 'express';
import path from 'path';
import { findImageFile, mimeFromExt } from '../services/ImageStorage.js';
import { requireAuthMedia } from '../utils/authGuard.js';

const ImageRoutes = express.Router();

// requireAuthMedia, NOT authenticateToken: MessageItem resolves
// {{IMAGE_REF:id}} to this URL and puts it straight into an <img src> whenever
// the in-memory base64 cache is empty — which is every page reload. A browser
// cannot attach an Authorization header to that load, so the header-only guard
// meant every generated image in a restored conversation rendered broken.
// See utils/mediaRoutes.js.
ImageRoutes.get('/:id', requireAuthMedia, (req, res) => {
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
