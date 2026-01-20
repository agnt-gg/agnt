import axios from 'axios';

/**
 * Unturf AI Plugin Tool
 *
 * Free LLM (Hermes/Qwen) and text-to-speech services without API keys.
 */
class UnturfAI {
  constructor() {
    this.name = 'unturf-ai';
    this.hermesBaseUrl = 'https://hermes.ai.unturf.com/v1';
    this.qwenBaseUrl = 'https://qwen.ai.unturf.com/v1';
    this.ttsBaseUrl = 'https://speech.ai.unturf.com/v1';
    this.MAX_RETRIES = 3;
    this.MAX_CHUNK_LENGTH = 100;
  }

  // Determine which endpoint to use based on the model
  getLLMEndpoint(model) {
    if (model.includes('Qwen')) {
      return this.qwenBaseUrl;
    }
    return this.hermesBaseUrl;
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

  async execute(params, inputData, workflowEngine) {
    console.log('[UnturfAIPlugin] Executing with params:', JSON.stringify(params, null, 2));

    try {
      this.validateParams(params);

      if (params.service === 'LLM') {
        return await this.handleLLM(params, workflowEngine);
      } else if (params.service === 'Text-to-Speech') {
        return await this.handleTTS(params, workflowEngine);
      } else {
        throw new Error('Invalid service specified');
      }
    } catch (error) {
      console.error('[UnturfAIPlugin] Error:', error);
      return {
        success: false,
        result: null,
        error: error.message,
      };
    }
  }

  async handleLLM(params, workflowEngine) {
    const messages = [{ role: 'user', content: params.prompt }];
    const endpoint = this.getLLMEndpoint(params.model);

    const response = await axios.post(
      `${endpoint}/chat/completions`,
      {
        model: params.model,
        messages: messages,
        temperature: parseFloat(params.temperature),
        max_tokens: parseInt(params.maxTokens),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer dummy-api-key', // Unturf accepts any value
        },
      }
    );

    return {
      success: true,
      result: response.data.choices[0].message.content,
      error: null,
    };
  }

  async executeWithRetry(params, retryCount = 0) {
    try {
      const response = await axios({
        method: 'post',
        url: `${this.ttsBaseUrl}/audio/speech`,
        data: {
          model: 'tts-1',
          voice: params.voice,
          speed: parseFloat(params.speed),
          input: params.text,
        },
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer YOLO', // Unturf accepts any value
        },
        responseType: 'arraybuffer',
      });

      return Buffer.from(response.data);
    } catch (error) {
      if (retryCount < this.MAX_RETRIES) {
        console.log(`[UnturfAIPlugin] Retry attempt ${retryCount + 1} for TTS`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.executeWithRetry(params, retryCount + 1);
      }
      throw error;
    }
  }

  async handleTTS(params, workflowEngine) {
    // If text is short enough, process it directly
    if (params.text.length <= this.MAX_CHUNK_LENGTH) {
      const buffer = await this.executeWithRetry(params);
      return {
        success: true,
        result: {
          audioContent: buffer.toString('base64'),
          contentType: 'audio/mpeg',
        },
        error: null,
      };
    }

    // For longer text, split into chunks and process separately
    const chunks = this.splitIntoChunks(params.text);
    const buffers = await Promise.all(chunks.map((chunk) => this.executeWithRetry({ ...params, text: chunk })));

    // Concatenate all buffers
    const combinedBuffer = Buffer.concat(buffers);

    return {
      success: true,
      result: {
        audioContent: combinedBuffer.toString('base64'),
        contentType: 'audio/mpeg',
      },
      error: null,
    };
  }

  validateParams(params) {
    if (!params.service) {
      throw new Error('Service parameter is required');
    }

    if (params.service === 'LLM') {
      if (!params.prompt) {
        throw new Error('Prompt is required for LLM service');
      }
    } else if (params.service === 'Text-to-Speech') {
      if (!params.text || params.text.length > 4096) {
        throw new Error('Text is required and must be 4096 characters or less');
      }
      if (!params.voice || !['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(params.voice)) {
        throw new Error('Invalid voice selected');
      }
      if (params.speed && (params.speed < 0.25 || params.speed > 4.0)) {
        throw new Error('Speed must be between 0.25 and 4.0');
      }
    } else {
      throw new Error('Invalid service specified: must be LLM or Text-to-Speech');
    }
  }
}

export default new UnturfAI();
