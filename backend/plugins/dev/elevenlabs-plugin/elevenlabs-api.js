import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * ElevenLabs API Plugin Tool
 *
 * Multi-action plugin supporting:
 *  - TEXT_TO_SPEECH  : Generate MP3 voiceovers from text
 *  - SPEECH_TO_TEXT  : Transcribe audio files (with diarization + word-level timings)
 *  - LIST_VOICES     : Browse available voices
 *  - GET_VOICE       : Get details for a specific voice
 *
 * Auth: ElevenLabs API key injected as params.__auth.token by PluginManager.
 * Uses ElevenLabs' 'xi-api-key' header (not Bearer).
 */
class ElevenLabsAPI {
  constructor() {
    this.name = 'elevenlabs-api';
    this.API_BASE = 'https://api.elevenlabs.io/v1';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[ElevenLabsPlugin] Executing ElevenLabs API:', params.action);

    try {
      const apiKey = params.__auth?.token;
      if (!apiKey) {
        throw new Error('Not connected to ElevenLabs. Connect in Settings → Connections.');
      }

      switch (params.action) {
        case 'TEXT_TO_SPEECH':
          return await this.textToSpeech(params, apiKey, workflowEngine);
        case 'SPEECH_TO_TEXT':
          return await this.speechToText(params, apiKey);
        case 'LIST_VOICES':
          return await this.listVoices(params, apiKey);
        case 'GET_VOICE':
          return await this.getVoice(params, apiKey);
        default:
          throw new Error(`Unsupported action: ${params.action}`);
      }
    } catch (error) {
      console.error('[ElevenLabsPlugin] Error:', error.message);
      return {
        success: false,
        error:
          error.response?.data?.detail?.message ||
          error.response?.data?.detail ||
          error.message,
      };
    }
  }

  // ─── TEXT_TO_SPEECH ──────────────────────────────────────────────
  async textToSpeech(params, apiKey, workflowEngine) {
    if (!params.text) {
      throw new Error('`text` is required for TEXT_TO_SPEECH');
    }

    const voiceId = params.voiceId || 'EXAVITQu4vr4xnSDxMaL';
    const modelId = params.modelId || 'eleven_multilingual_v2';
    const outputFormat = params.outputFormat || 'mp3_44100_128';

    const response = await axios.post(
      `${this.API_BASE}/text-to-speech/${voiceId}`,
      {
        text: params.text,
        model_id: modelId,
        voice_settings: {
          stability: Number(params.stability ?? 0.5),
          similarity_boost: Number(params.similarityBoost ?? 0.75),
          style: Number(params.style ?? 0),
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        params: { output_format: outputFormat },
        responseType: 'arraybuffer',
      }
    );

    // Persist audio to user data directory
    const userDataPath = process.env.USER_DATA_PATH || process.cwd();
    const outDir = path.join(
      userDataPath,
      'plugin-data',
      'elevenlabs',
      String(workflowEngine?.userId ?? 'default')
    );
    await fs.mkdir(outDir, { recursive: true });

    const ext = outputFormat.startsWith('mp3')
      ? 'mp3'
      : outputFormat.startsWith('opus')
      ? 'opus'
      : 'wav';
    const filename = params.filename || `tts_${randomUUID().slice(0, 8)}.${ext}`;
    const filePath = path.join(outDir, filename);
    const buf = Buffer.from(response.data);
    await fs.writeFile(filePath, buf);

    console.log(`[ElevenLabsPlugin] Saved ${filePath} (${buf.length} bytes)`);

    return {
      success: true,
      filePath,
      filename,
      sizeBytes: buf.length,
      modelUsed: modelId,
      voiceId,
      charactersUsed: params.text.length,
      error: null,
    };
  }

  // ─── SPEECH_TO_TEXT ──────────────────────────────────────────────
  async speechToText(params, apiKey) {
    const form = new FormData();
    form.append('model_id', params.transcriptModel || 'scribe_v1');

    if (params.languageCode) {
      form.append('language_code', params.languageCode);
    }
    if (params.diarize === 'Yes') {
      form.append('diarize', 'true');
    }

    if (params.audioFilePath) {
      form.append('file', createReadStream(params.audioFilePath));
    } else if (params.audioUrl) {
      form.append('cloud_storage_url', params.audioUrl);
    } else {
      throw new Error('Either `audioUrl` or `audioFilePath` is required for SPEECH_TO_TEXT');
    }

    const response = await axios.post(
      `${this.API_BASE}/speech-to-text`,
      form,
      {
        headers: {
          'xi-api-key': apiKey,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
      }
    );

    return {
      success: true,
      transcript: response.data.text,
      words: response.data.words || [],
      language: response.data.language_code,
      modelUsed: params.transcriptModel || 'scribe_v1',
      error: null,
    };
  }

  // ─── LIST_VOICES ─────────────────────────────────────────────────
  async listVoices(params, apiKey) {
    const response = await axios.get(`${this.API_BASE}/voices`, {
      headers: { 'xi-api-key': apiKey },
    });

    let voices = response.data.voices || [];
    if (params.voiceCategory && params.voiceCategory !== 'all') {
      voices = voices.filter((v) => v.category === params.voiceCategory);
    }

    return {
      success: true,
      voices: voices.map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        category: v.category,
        labels: v.labels,
        preview_url: v.preview_url,
        description: v.description,
      })),
      error: null,
    };
  }

  // ─── GET_VOICE ───────────────────────────────────────────────────
  async getVoice(params, apiKey) {
    if (!params.voiceId) {
      throw new Error('`voiceId` is required for GET_VOICE');
    }
    const response = await axios.get(
      `${this.API_BASE}/voices/${params.voiceId}`,
      { headers: { 'xi-api-key': apiKey } }
    );
    return {
      success: true,
      voice: response.data,
      error: null,
    };
  }
}

export default new ElevenLabsAPI();
