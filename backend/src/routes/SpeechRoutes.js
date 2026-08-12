import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { whisperService } from '../services/whisperService.js';
import { requireAuthHeader } from '../utils/authGuard.js';
import { synthesize, listEngines, availableEngines, MAX_TTS_CHARS } from '../services/ttsService.js';
import { createRealtimeCall, REALTIME_VOICES, DEFAULT_VOICE, REALTIME_MODEL } from '../services/realtimeVoiceService.js';
import { hasOpenAiVoiceCredential } from '../services/auth/openAiVoiceCredential.js';

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

/**
 * POST /api/speech/realtime/call
 * SDP exchange for a speech-to-speech voice session.
 *
 * The browser sends its WebRTC offer as raw SDP; we attach the server-authored
 * session config (instructions, the run_agnt tool, voice) and forward it to
 * OpenAI with the account key, returning their answer SDP.
 *
 * This is the "unified interface" rather than ephemeral client secrets, so no
 * OpenAI credential of any kind ever reaches the browser AND the instructions
 * that constrain the model to run_agnt cannot be edited by a modified client.
 *
 * Body parsing is declared ON THIS ROUTE, not globally: SDP is text/plain and a
 * global text parser would change how every other route sees its body.
 */
router.post(
  '/realtime/call',
  requireAuthHeader,
  express.text({ type: ['application/sdp', 'text/plain'], limit: '256kb' }),
  async (req, res) => {
    try {
      const result = await createRealtimeCall({
        sdp: typeof req.body === 'string' ? req.body : '',
        userId: req.user?.id,
        voice: req.query?.voice,
        assistantName: req.query?.name,
        surface: req.query?.surface,
      });

      if (result.ok) {
        res.setHeader('Content-Type', 'application/sdp');
        return res.send(result.sdp);
      }

      // "No credentials" is a normal state, not an error: the client falls back
      // to the cascade pipeline. Anything else is a genuine failure.
      if (result.reason === 'no-credentials') {
        return res.json({ success: false, available: false, reason: result.reason });
      }

      console.error('[speech] realtime call failed:', result.reason, result.detail || '');
      return res
        .status(result.status >= 400 ? result.status : 502)
        .json({ success: false, error: 'Realtime session failed', reason: result.reason });
    } catch (error) {
      console.error('[speech] realtime call threw:', error.message);
      return res.status(502).json({ success: false, error: 'Realtime session failed' });
    }
  }
);

/**
 * GET /api/speech/realtime/status
 * Whether speech-to-speech is usable for THIS user, so the client can offer it
 * (or not) without attempting a connection.
 *
 * This asks the SAME function the SDP exchange asks. It used to ask a different
 * one — whether the OpenAI TTS engine had a platform key — which meant a user
 * signed in with ChatGPT/Codex was told voice was unavailable while the call
 * would in fact have succeeded. A capability probe that can disagree with the
 * capability is worse than no probe at all: it hides working features.
 */
router.get('/realtime/status', requireAuthHeader, async (req, res) => {
  try {
    const available = await hasOpenAiVoiceCredential(req.user?.id);
    res.json({
      success: true,
      available,
      model: REALTIME_MODEL,
      voices: REALTIME_VOICES,
      defaultVoice: DEFAULT_VOICE,
    });
  } catch (error) {
    console.error('[speech] realtime status failed:', error.message);
    res.status(500).json({ success: false, error: 'Failed to read realtime status' });
  }
});

/**
 * POST /api/speech/realtime/timing
 * One structured line per realtime connect, from the client's stopwatch.
 *
 * The handshake is a chain of serial steps (mic, SDP exchange, ICE,
 * session.created) and "voice takes seconds to start" is unactionable without
 * knowing which step ate them. Only the CLIENT can see the whole chain, so it
 * measures (voice/connectTimeline.js); this route exists because the client's
 * console dies with its window and error.log is where this install's history
 * lives.
 *
 * Diagnostics only: it never fails the caller, accepts nothing but short
 * names and numbers, and writes exactly one line.
 */
router.post('/realtime/timing', requireAuthHeader, express.json({ limit: '8kb' }), (req, res) => {
  const marks = Array.isArray(req.body?.marks) ? req.body.marks : [];
  const line = marks
    .filter((m) => m && typeof m.name === 'string' && Number.isFinite(m.stepMs))
    .map((m) => `${m.name.slice(0, 32)}+${Math.round(m.stepMs)}ms`)
    .join(' ');
  const total = Number.isFinite(req.body?.totalMs) ? Math.round(req.body.totalMs) : '?';
  const surface = typeof req.body?.surface === 'string' ? req.body.surface.slice(0, 32) : 'chat';
  console.info(`[speech] realtime connect (${surface}) total=${total}ms ${line}`);
  res.json({ success: true });
});

export default router;
