import OpenAI from 'openai';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import AuthManager from '../services/auth/AuthManager.js';

const execFileAsync = promisify(execFile);

class WhisperTranscriber {
  constructor(userId = null) {
    this.openai = null;
    this.userId = userId;
    this.maxFileSize = 24 * 1024 * 1024; // 24MB limit for OpenAI
    this.chunkDuration = 10 * 60; // 10 minutes per chunk in seconds
    this.pricing = {
      whisper: 0.006, // $0.006 per minute
    };
  }

  /**
   * Initialize OpenAI client
   */
  async initializeOpenAI(userId = null) {
    const userIdToUse = userId || this.userId;
    if (!userIdToUse) {
      throw new Error('User ID is required for OpenAI authentication');
    }

    if (!this.openai) {
      try {
        const accessToken = await AuthManager.getValidAccessToken(userIdToUse, 'openai');
        this.openai = new OpenAI({ apiKey: accessToken });
      } catch (authError) {
        console.error('Authentication error:', authError);
        throw new Error('OpenAI authentication failed. Please set up your OpenAI API key.');
      }
    }
    return this.openai;
  }

  /**
   * Get audio duration using ffprobe
   */
  async getAudioDuration(audioPath) {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        audioPath,
      ]);

      const durationSeconds = parseFloat(stdout.trim());
      return durationSeconds / 60; // Return duration in minutes
    } catch (error) {
      console.warn('[Whisper] Error getting audio duration:', error.message);
      // Fallback: estimate based on file size (rough approximation)
      const fileSize = fs.statSync(audioPath).size;
      return fileSize / (1024 * 1024); // Very rough estimate: ~1MB per minute
    }
  }

  /**
   * Split audio file into chunks if it's too large
   */
  async splitAudioFile(audioPath) {
    const fileSize = fs.statSync(audioPath).size;

    if (fileSize <= this.maxFileSize) {
      console.log('[Whisper] Audio file is within size limit, no chunking needed');
      return [audioPath];
    }

    console.log(`[Whisper] Audio file size (${Math.round(fileSize / (1024 * 1024))}MB) exceeds limit, splitting into chunks...`);

    const tempDir = os.tmpdir();
    const uniquePrefix = `whisper_chunk_${Date.now()}`;
    const chunkPrefix = path.join(tempDir, `${uniquePrefix}_chunk_`);
    const audioExtension = path.extname(audioPath);

    const ffmpegArgs = [
      '-i',
      audioPath,
      '-f',
      'segment',
      '-segment_time',
      this.chunkDuration.toString(),
      '-c',
      'copy', // Copy codecs (fast, no re-encoding)
      `${chunkPrefix}%03d${audioExtension}`,
    ];

    try {
      console.log(`[Whisper] Running ffmpeg to split audio: ffmpeg ${ffmpegArgs.join(' ')}`);
      await execFileAsync('ffmpeg', ffmpegArgs);

      // Find created chunks
      const tempFiles = fs.readdirSync(tempDir);
      const audioChunks = tempFiles
        .filter((f) => f.startsWith(path.basename(chunkPrefix)) && f.endsWith(audioExtension))
        .map((f) => path.join(tempDir, f))
        .sort();

      if (audioChunks.length === 0) {
        throw new Error('ffmpeg splitting failed, no chunks found');
      }

      console.log(`[Whisper] Audio split into ${audioChunks.length} chunks`);
      return audioChunks;
    } catch (error) {
      throw new Error(`Audio splitting failed: ${error.message}`);
    }
  }

  /**
   * Transcribe a single audio file or chunk
   */
  async transcribeAudioChunk(audioPath, userId = null) {
    const openai = await this.initializeOpenAI(userId);

    try {
      console.log(`[Whisper] Transcribing audio chunk: ${path.basename(audioPath)}`);

      const transcriptionResponse = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: fs.createReadStream(audioPath),
      });

      return {
        success: true,
        text: transcriptionResponse.text,
        chunkPath: audioPath,
      };
    } catch (error) {
      console.error(`[Whisper] Error transcribing chunk ${audioPath}:`, error.message);
      return {
        success: false,
        text: `[TRANSCRIPTION_ERROR: ${path.basename(audioPath)}]`,
        error: error.message,
        chunkPath: audioPath,
      };
    }
  }

  /**
   * Transcribe audio file with automatic chunking if needed
   */
  async transcribeAudio(audioPath, userId = null) {
    try {
      console.log(`[Whisper] Starting transcription of: ${audioPath}`);

      // Get audio duration for cost calculation
      const durationMinutes = await this.getAudioDuration(audioPath);
      console.log(`[Whisper] Audio duration: ${durationMinutes.toFixed(2)} minutes`);

      // Calculate estimated cost
      const estimatedCost = durationMinutes * this.pricing.whisper;
      console.log(`[Whisper] Estimated transcription cost: $${estimatedCost.toFixed(4)}`);

      // Split audio if necessary
      const audioChunks = await this.splitAudioFile(audioPath);
      console.log(`[Whisper] Processing ${audioChunks.length} audio chunk(s)`);

      // Transcribe each chunk
      let combinedTranscription = '';
      let successfulChunks = 0;
      let failedChunks = 0;

      for (let i = 0; i < audioChunks.length; i++) {
        const chunkPath = audioChunks[i];
        console.log(`[Whisper] Processing chunk ${i + 1}/${audioChunks.length}: ${path.basename(chunkPath)}`);

        const chunkResult = await this.transcribeAudioChunk(chunkPath, userId);

        if (chunkResult.success) {
          combinedTranscription += chunkResult.text + ' ';
          successfulChunks++;
        } else {
          combinedTranscription += chunkResult.text + ' '; // Includes error marker
          failedChunks++;
        }
      }

      // Clean up chunk files if we created them (don't delete original file)
      if (audioChunks.length > 1) {
        console.log(`[Whisper] Cleaning up ${audioChunks.length} temporary chunk files...`);
        audioChunks.forEach((chunkPath) => {
          try {
            fs.unlinkSync(chunkPath);
            console.log(`[Whisper] Deleted chunk: ${path.basename(chunkPath)}`);
          } catch (cleanupError) {
            console.warn(`[Whisper] Error deleting chunk ${chunkPath}:`, cleanupError.message);
          }
        });
      }

      const finalTranscription = combinedTranscription.trim();

      console.log(`[Whisper] Transcription complete:`);
      console.log(`[Whisper] - Successful chunks: ${successfulChunks}`);
      console.log(`[Whisper] - Failed chunks: ${failedChunks}`);
      console.log(`[Whisper] - Final transcription length: ${finalTranscription.length} characters`);

      return {
        success: true,
        content: finalTranscription,
        method: 'OpenAI Whisper',
        durationMinutes: durationMinutes,
        estimatedCost: estimatedCost,
        chunksProcessed: audioChunks.length,
        successfulChunks: successfulChunks,
        failedChunks: failedChunks,
        pricing: {
          pricePerMinute: this.pricing.whisper,
          calculation: `${durationMinutes.toFixed(2)} minutes × $${this.pricing.whisper.toFixed(3)}/minute = $${estimatedCost.toFixed(4)}`,
        },
      };
    } catch (error) {
      console.error('[Whisper] Transcription failed:', error.message);
      throw new Error(`Whisper transcription failed: ${error.message}`);
    }
  }

  /**
   * Clean up temporary audio file
   */
  cleanupAudioFile(audioPath) {
    try {
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
        console.log(`[Whisper] Cleaned up audio file: ${audioPath}`);
      }
    } catch (error) {
      console.warn(`[Whisper] Error cleaning up audio file ${audioPath}:`, error.message);
    }
  }

  /**
   * Estimate transcription cost without actually transcribing
   */
  async estimateCost(audioPath) {
    try {
      const durationMinutes = await this.getAudioDuration(audioPath);
      const estimatedCost = durationMinutes * this.pricing.whisper;

      return {
        durationMinutes: durationMinutes,
        estimatedCost: estimatedCost,
        pricePerMinute: this.pricing.whisper,
      };
    } catch (error) {
      console.warn('[Whisper] Error estimating cost:', error.message);
      return null;
    }
  }
}

export default WhisperTranscriber;
