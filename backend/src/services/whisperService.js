import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure transformers.js cache directory to a writable location
// This is required for Electron ASAR builds where node_modules is read-only
const cacheDir = process.env.USER_DATA_PATH
  ? path.join(process.env.USER_DATA_PATH, 'transformers-cache')
  : path.join(os.homedir(), '.cache', 'transformers');

// Ensure cache directory exists
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// Set the cache directory for transformers.js
env.cacheDir = cacheDir;
env.localModelPath = cacheDir;

// Disable local model check to always use cache directory
env.allowLocalModels = true;

// Disable multi-threading to avoid Worker blob URL issues in Node.js/Electron
// The onnxruntime-web library tries to use Web Workers with blob URLs,
// which Node.js doesn't support. Running single-threaded avoids this.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

console.log('Transformers.js cache directory:', cacheDir);
console.log('ONNX WASM threads disabled for Node.js compatibility');

class WhisperService {
  constructor() {
    this.transcriber = null;
    this.isInitialized = false;
    this.isInitializing = false;
  }

  /**
   * Initialize Whisper transcriber
   * Uses Transformers.js - pure JavaScript, works on ALL platforms
   */
  async initialize() {
    if (this.isInitialized) {
      return true;
    }

    if (this.isInitializing) {
      // Wait for initialization to complete
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.isInitialized) {
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 500);
      });
    }

    try {
      this.isInitializing = true;

      console.log('Initializing Whisper transcriber (Transformers.js)...');
      console.log('This will download the model on first use (~100MB)');

      // Create transcriber pipeline
      // Using tiny.en model for speed - can upgrade to base.en for better accuracy
      this.transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en');

      this.isInitialized = true;
      this.isInitializing = false;

      console.log('Whisper service initialized successfully!');
      return true;
    } catch (error) {
      console.error('Error initializing Whisper:', error);
      this.isInitializing = false;
      throw error;
    }
  }

  /**
   * Decode audio file to raw PCM using ffmpeg
   * @param {string} audioFilePath - Path to the audio file
   * @returns {Promise<Float32Array>} - Audio data as Float32Array
   */
  async decodeAudio(audioFilePath) {
    const outputPath = audioFilePath.replace(/\.\w+$/, '.wav');

    try {
      // Get ffmpeg path from environment or use system ffmpeg
      const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

      // Convert to 16kHz mono WAV using ffmpeg
      const command = `"${ffmpegPath}" -i "${audioFilePath}" -ar 16000 -ac 1 -f wav "${outputPath}" -y`;

      console.log('Converting audio with ffmpeg...');
      await execAsync(command);

      // Read the WAV file
      const wavBuffer = fs.readFileSync(outputPath);

      // Parse WAV file (skip 44-byte header, read 16-bit PCM data)
      const samples = new Int16Array(wavBuffer.buffer, wavBuffer.byteOffset + 44, (wavBuffer.length - 44) / 2);

      // Convert to Float32Array normalized to [-1, 1]
      const float32Data = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        float32Data[i] = samples[i] / 32768.0;
      }

      // Clean up temporary WAV file
      fs.unlinkSync(outputPath);

      return float32Data;
    } catch (error) {
      // Clean up on error
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      throw error;
    }
  }

  /**
   * Transcribe audio file to text
   * @param {string} audioFilePath - Path to the audio file
   * @returns {Promise<string>} - Transcribed text
   */
  async transcribe(audioFilePath) {
    try {
      // Ensure Whisper is initialized
      await this.initialize();

      console.log('Transcribing audio file:', audioFilePath);

      // Decode audio to Float32Array at 16kHz
      const audioData = await this.decodeAudio(audioFilePath);

      console.log('Audio decoded, starting transcription...');

      // Transcribe using Transformers.js
      const result = await this.transcriber(audioData);

      console.log('Transcription complete:', result.text);

      return result.text || '';
    } catch (error) {
      console.error('Error transcribing audio:', error);
      throw error;
    }
  }

  /**
   * Check if Whisper is ready to use
   */
  isReady() {
    return this.isInitialized;
  }

  /**
   * Get initialization status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      initializing: this.isInitializing,
      model: 'Xenova/whisper-tiny.en',
    };
  }
}

// Export singleton instance
export const whisperService = new WhisperService();
