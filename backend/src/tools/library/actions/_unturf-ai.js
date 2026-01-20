import BaseAction from '../BaseAction.js';
import axios from 'axios';

class UnturfAI extends BaseAction {
  static schema = {
    title: 'Unturf AI',
    category: 'action',
    type: 'unturf-ai',
    icon: 'magic',
    description: "Interact with Unturf.ai's free LLM (Hermes) and text-to-speech services without needing an API key.",
    parameters: {
      service: {
        type: 'string',
        inputType: 'select',
        options: ['LLM', 'Text-to-Speech'],
        description: 'Choose which Unturf service to use',
        default: 'LLM',
      },
      prompt: {
        type: 'string',
        inputType: 'textarea',
        description: 'Input text or prompt for the AI',
        conditional: {
          field: 'service',
          value: 'LLM',
        },
      },
      model: {
        type: 'string',
        inputType: 'select',
        options: [
          'adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic',
          'NousResearch/Hermes-3-Llama-3.1-8B',
          'hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M',
        ],
        default: 'adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic',
        description: 'The AI model to use (Hermes for general purpose, Qwen for coding)',
        conditional: {
          field: 'service',
          value: 'LLM',
        },
      },
      temperature: {
        type: 'number',
        inputType: 'number',
        description: 'Controls randomness (0.0 to 1.0)',
        default: 0.5,
        conditional: {
          field: 'service',
          value: 'LLM',
        },
      },
      maxTokens: {
        type: 'number',
        inputType: 'number',
        description: 'Maximum tokens to generate',
        default: 150,
        conditional: {
          field: 'service',
          value: 'LLM',
        },
      },
      text: {
        type: 'string',
        inputType: 'textarea',
        description: 'Text to convert to speech',
        conditional: {
          field: 'service',
          value: 'Text-to-Speech',
        },
      },
      voice: {
        type: 'string',
        inputType: 'select',
        options: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
        default: 'alloy',
        description: 'Voice to use for TTS',
        conditional: {
          field: 'service',
          value: 'Text-to-Speech',
        },
      },
      speed: {
        type: 'number',
        inputType: 'number',
        description: 'Speech rate (0.25 to 4.0)',
        default: 1.0,
        conditional: {
          field: 'service',
          value: 'Text-to-Speech',
        },
      },
    },
    outputs: {
      success: {
        type: 'boolean',
        description: 'Whether the request was successful',
      },
      result: {
        type: 'string',
        description: 'Generated text from the LLM',
      },
      audioUrl: {
        type: 'string',
        description: 'URL to the generated audio file',
      },
      error: {
        type: 'string',
        description: 'Error message if the request failed',
      },
    },
  };

  constructor() {
    super('unturf-ai');
    this.hermesBaseUrl = 'https://hermes.ai.unturf.com/v1';
    this.qwenBaseUrl = 'https://qwen.ai.unturf.com/v1';
    this.ttsBaseUrl = 'https://speech.ai.unturf.com/v1';
    this.MAX_RETRIES = 3;
    this.MAX_CHUNK_LENGTH = 100; // Conservative chunk size
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
      console.error('Error in Unturf AI tool:', error);
      return this.formatOutput({
        success: false,
        result: null,
        error: error.message,
      });
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

    return this.formatOutput({
      success: true,
      result: response.data.choices[0].message.content,
      error: null,
    });
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
        console.log(`Retry attempt ${retryCount + 1} for unturf text-to-speech`);
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
    const buffers = await Promise.all(chunks.map((chunk) => this.executeWithRetry({ ...params, text: chunk })));

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
