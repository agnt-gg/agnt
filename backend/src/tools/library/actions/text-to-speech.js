import BaseAction from '../BaseAction.js';
import OpenAI from 'openai';
import AuthManager from '../../../services/auth/AuthManager.js';

class TextToSpeech extends BaseAction {
  static schema = {
    title: 'Text to Speech',
    category: 'utility',
    type: 'text-to-speech',
    icon: 'speaker',
    description: "Converts text to speech using OpenAI's TTS API.",
    authRequired: 'apiKey',
    authProvider: 'openai',
    parameters: {
      text: {
        type: 'string',
        inputType: 'textarea',
        description: 'The text to convert to speech (max 4096 characters)',
      },
      voice: {
        type: 'string',
        inputType: 'select',
        options: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
        description: 'The voice to use for the speech',
        default: 'alloy',
      },
      speed: {
        type: 'number',
        inputType: 'number',
        description: 'The speed of the generated audio (0.25 to 4.0)',
        default: 1,
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the action was successful',
      },
      result: {
        type: 'object',
        description: 'The result of the action, varies based on the action performed',
      },
      error: {
        type: 'string',
        description: 'Error message if the action failed',
      },
    },
  };

  constructor() {
    super('text-to-speech');
    this.MAX_CHUNK_LENGTH = 100; // Conservative chunk size
    this.MAX_RETRIES = 3;
  }

  // Split text into smaller chunks at sentence boundaries
  splitIntoChunks(text) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length <= this.MAX_CHUNK_LENGTH) {
        currentChunk += sentence;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
  }

  async executeWithRetry(openai, params, retryCount = 0) {
    try {
      const response = await openai.audio.speech.create({
        model: 'tts-1',
        input: params.text,
        voice: params.voice,
        speed: parseFloat(params.speed),
      });

      const buffer = Buffer.from(await response.arrayBuffer());
      return buffer;
    } catch (error) {
      if (retryCount < this.MAX_RETRIES) {
        console.log(`Retry attempt ${retryCount + 1} for text-to-speech`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.executeWithRetry(openai, params, retryCount + 1);
      }
      throw error;
    }
  }

  async execute(params, inputData, workflowEngine) {
    try {
      this.validateParams(params);

      const accessToken = await AuthManager.getValidAccessToken(workflowEngine.userId, 'openai');
      if (!accessToken) {
        throw new Error('No valid access token found. Please reconnect to OpenAI.');
      }

      const openai = new OpenAI({ apiKey: accessToken });

      // If text is short enough, process it directly
      if (params.text.length <= this.MAX_CHUNK_LENGTH) {
        const buffer = await this.executeWithRetry(openai, params);
        return this.formatOutput({
          success: true,
          result: {
            audioContent: buffer.toString('base64'),
            contentType: 'audio/mpeg',
          },
          error: null,
        });
      }

      // For longer text, split into chunks and process separately
      const chunks = this.splitIntoChunks(params.text);
      const buffers = await Promise.all(chunks.map((chunk) => this.executeWithRetry(openai, { ...params, text: chunk })));

      // Concatenate all buffers
      const combinedBuffer = Buffer.concat(buffers);

      return this.formatOutput({
        success: true,
        result: {
          audioContent: combinedBuffer.toString('base64'),
          contentType: 'audio/mpeg',
        },
        error: null,
      });
    } catch (error) {
      console.error('Error executing Text to Speech:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
    }
  }

  validateParams(params) {
    if (!params.text || params.text.length > 4096) {
      throw new Error('Text is required and must be 4096 characters or less');
    }
    if (!params.voice || !['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(params.voice)) {
      throw new Error('Invalid voice selected');
    }
    if (params.speed && (params.speed < 0.25 || params.speed > 4.0)) {
      throw new Error('Speed must be between 0.25 and 4.0');
    }
  }
}

export default new TextToSpeech();
