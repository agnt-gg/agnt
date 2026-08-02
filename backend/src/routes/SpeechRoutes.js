import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { whisperService } from '../services/whisperService.js';
import { requireAuthHeader } from '../utils/authGuard.js';
import { synthesize, listEngines, availableEngines, MAX_TTS_CHARS } from '../services/ttsService.js';

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(os.tmpdir(), 'agnt-speech');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'audio-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files
    const allowedMimes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/ogg', 'audio/x-m4a'];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(webm|wav|mp3|ogg|m4a)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});

/**
 * POST /api/speech/transcribe
 * Transcribe audio file to text using Whisper
 */
router.post('/transcribe', requireAuthHeader, upload.single('audio'), async (req, res) => {
  let audioFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    audioFilePath = req.file.path;
    console.log('Received audio file for transcription:', audioFilePath);

    // Transcribe the audio
    const transcript = await whisperService.transcribe(audioFilePath);

    // Clean up the temporary file
    if (fs.existsSync(audioFilePath)) {
      fs.unlinkSync(audioFilePath);
    }

    res.json({
      success: true,
      transcript: transcript.trim(),
    });
  } catch (error) {
    console.error('Error transcribing audio:', error);

    // Clean up the temporary file on error
    if (audioFilePath && fs.existsSync(audioFilePath)) {
      try {
        fs.unlinkSync(audioFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      error: 'Failed to transcribe audio',
      message: error.message,
    });
  }
});

/**
 * GET /api/speech/status
 * Get Whisper service status
 */
router.get('/status', (req, res) => {
  try {
    const status = whisperService.getStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('Error getting Whisper status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
    });
  }
});

/**
 * POST /api/speech/initialize
 * Initialize Whisper service (download model if needed)
 */
router.post('/initialize', requireAuthHeader, async (req, res) => {
  try {
    await whisperService.initialize();
    res.json({
      success: true,
      message: 'Whisper service initialized successfully',
    });
  } catch (error) {
    console.error('Error initializing Whisper:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize Whisper',
      message: error.message,
    });
  }
});

/**
 * POST /api/speech/synthesize
 * Text to speech via a provider the user has already connected.
 *
 * Returns raw audio on success. When no provider is configured it returns 200
 * with `{ available: false }` rather than an error status: "no key" is a normal
 * state — the client falls back to the browser's own synthesiser — and dressing
 * it up as a 4xx/5xx would put a red herring in the logs of a working install
 * and invite the client to retry something that will never succeed.
 */
router.post('/synthesize', requireAuthHeader, async (req, res) => {
  try {
    const { text, engine, voice, model, speed } = req.body || {};

    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ success: false, error: 'text is required' });
    }
    if (text.length > MAX_TTS_CHARS) {
      return res
        .status(413)
        .json({ success: false, error: `text exceeds ${MAX_TTS_CHARS} characters` });
    }

    const result = await synthesize({
      text,
      engine: engine || 'openai',
      voice,
      model,
      speed,
      userId: req.user?.id,
    });

    if (!result.available) {
      return res.json({ success: false, available: false, reason: result.reason });
    }

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.audio.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-TTS-Engine', result.engine);
    return res.send(result.audio);
  } catch (error) {
    console.error('[speech] synthesize failed:', error.message);
    return res.status(502).json({
      success: false,
      error: 'Speech synthesis failed',
      message: error.message,
    });
  }
});

/**
 * GET /api/speech/voices
 * Which TTS engines exist, and which are usable for THIS user right now.
 * The client uses `available` to decide whether to offer provider TTS at all.
 */
router.get('/voices', requireAuthHeader, async (req, res) => {
  try {
    const available = await availableEngines(req.user?.id);
    res.json({ success: true, engines: listEngines(), available });
  } catch (error) {
    console.error('[speech] listing voices failed:', error.message);
    res.status(500).json({ success: false, error: 'Failed to list voices' });
  }
});

export default router;
