import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { whisperService } from '../services/whisperService.js';

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
router.post('/transcribe', upload.single('audio'), async (req, res) => {
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
router.post('/initialize', async (req, res) => {
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

export default router;
