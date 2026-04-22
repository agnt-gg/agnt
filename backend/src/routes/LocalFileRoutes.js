import express from 'express';
import fs from 'fs';
import path from 'path';

const LocalFileRoutes = express.Router();

const MIME = {
  // video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  // audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  // image
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  // docs
  '.pdf': 'application/pdf',
  // web — required for iframe rendering of local HTML
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  // fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// Serve an arbitrary local file by absolute path, with HTTP Range support
// so <video> seeking works. Designed for LLM-generated <img>/<video>/<iframe>
// srcs that point at files on disk (e.g. rendered projects under
// %APPDATA%/AGNT/projects/... or ~/.agnt/projects/...).
//
// Two URL shapes are supported:
//   1) PATH-based:  /api/local-file/C:/Users/.../file.html   ← preferred
//      (path-based URLs are essential for iframes: relative URLs inside the
//       served HTML resolve against this base, so ../videos/foo.mp4 works.)
//   2) QUERY-based: /api/local-file?path=C:/Users/.../file.html  ← legacy
//
const serveLocalFile = (req, res) => {
  try {
    // Prefer path-based (anything after the mount point); fall back to ?path=
    const rawFromUrl = req.path && req.path !== '/' ? decodeURIComponent(req.path.replace(/^\//, '')) : '';
    let raw = rawFromUrl || req.query.path;
    if (!raw || typeof raw !== 'string') {
      return res.status(400).json({ error: 'Missing path' });
    }

    // URL concatenation strips the leading slash from unix paths; re-add it
    // when the path isn't already absolute and doesn't look like a Windows
    // drive-letter path (e.g. "C:/Users/...").
    if (!path.isAbsolute(raw) && !/^[a-zA-Z]:[\\/]/.test(raw)) {
      raw = '/' + raw;
    }

    const resolved = path.resolve(raw);
    if (!path.isAbsolute(resolved)) {
      return res.status(400).json({ error: 'Path must be absolute' });
    }

    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'Not a file' });
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);

    if (range) {
      const m = /bytes=(\d+)-(\d+)?/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : fileSize - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.status(416).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(resolved, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(fileSize));
    fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    console.error('[local-file] error serving', req.path || req.query.path, err);
    res.status(500).json({ error: 'Failed to serve file' });
  }
};

// Legacy query-string form: /api/local-file?path=...
LocalFileRoutes.get('/', serveLocalFile);
// Path-based form: /api/local-file/<full-path>
// express 5 / path-to-regexp v6 uses {*splat} or /{*all} for wildcards.
// Use a regex to match anything for broad compatibility.
LocalFileRoutes.get(/.*/, serveLocalFile);

console.log('Local File Routes Started...');

export default LocalFileRoutes;
