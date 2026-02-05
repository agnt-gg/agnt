import BaseAction from '../BaseAction.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai/index.mjs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import AuthManager from '../../../services/auth/AuthManager.js';
import CodexAuthManager from '../../../services/auth/CodexAuthManager.js';
import ClaudeCodeAuthManager from '../../../services/auth/ClaudeCodeAuthManager.js';

const PROVIDER_CONFIG = {
  deepseek: {
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/',
    defaultModel: 'gemini-1.5-flash',
    supportsVision: true,
    supportsImageGen: true,
    supportsImageEdit: true,
    imageModels: ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'nano-banana-pro-preview'],
  },
  grokai: {
    baseURL: 'https://api.x.ai/v1/',
    defaultModel: 'grok-beta',
    supportsVision: true,
    supportsImageGen: true,
    supportsImageEdit: false,
    imageModels: ['grok-2-image'],
  },
  groq: {
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'mixtral-8x7b-32768',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  local: {
    baseURL: 'http://127.0.0.1:1234/v1',
    defaultModel: 'llama-3.2-1b-instruct',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  togetherai: {
    baseURL: 'https://api.together.xyz/v1',
    defaultModel: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  openai: {
    baseURL: undefined,
    defaultModel: 'gpt-4o-mini',
    supportsVision: true,
    supportsImageGen: true,
    supportsImageEdit: true,
    imageModels: ['dall-e-2', 'dall-e-3', 'gpt-image-1'],
  },
  'openai-codex': {
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    supportsVision: true,
    supportsImageGen: true,
    supportsImageEdit: true,
    imageModels: ['dall-e-3'],
  },
  'openai-codex-cli': {
    baseURL: 'codex-cli://local',
    defaultModel: 'gpt-5-codex',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  anthropic: {
    baseURL: undefined,
    defaultModel: 'claude-3-5-sonnet-20240620',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  'claude-code': {
    baseURL: undefined,
    defaultModel: 'claude-sonnet-4-5-20250929',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  cerebras: {
    baseURL: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    supportsVision: false,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-3.5-turbo',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  kimi: {
    baseURL: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.5',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  minimax: {
    baseURL: 'https://api.minimax.io/v1',
    defaultModel: 'MiniMax-M2.1',
    supportsVision: false,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  zai: {
    baseURL: 'https://api.z.ai/api/paas/v4',
    defaultModel: 'GLM-4.7',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
  // Fallback if provider is missing or doesn't match any key above
  default: {
    baseURL: undefined,
    defaultModel: 'gpt-4o-mini',
    supportsVision: true,
    supportsImageGen: false,
    supportsImageEdit: false,
  },
};

class GenerateWithAiLlm extends BaseAction {
  static schema = {
    title: 'AI LLM Call',
    category: 'action',
    type: 'generate-with-ai-llm',
    icon: 'magic',
    description:
      'This action node uses AI models for text generation, vision analysis, and image generation. Supports multiple providers including OpenAI, Anthropic, Gemini, and Grok.',
    parameters: {
      mode: {
        type: 'string',
        inputType: 'select',
        inputSize: 'full',
        options: ['Text Generation', 'Vision (Image → Text)', 'Image Generation'],
        default: 'Text Generation',
        description: 'Choose the operation mode: generate text, analyze images, or create images',
      },
      provider: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        default: 'OpenAI',
        description: 'The AI provider to use',
      },
      model: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        default: 'gpt-4o-mini',
        description: 'The specific model to use',
      },
      // === TEXT GENERATION MODE ===
      prompt: {
        type: 'string',
        inputType: 'textarea',
        description: 'The input prompt or text for the LLM',
        conditional: {
          field: 'mode',
          value: 'Text Generation',
        },
      },
      // === VISION MODE ===
      visionPrompt: {
        type: 'string',
        inputType: 'textarea',
        description: 'Question or instruction about the image(s)',
        conditional: {
          field: 'mode',
          value: 'Vision (Image → Text)',
        },
      },
      visionImage: {
        type: 'string',
        inputType: 'textarea',
        description: 'Image data in base64 format (data:image/[type];base64,[data])',
        conditional: {
          field: 'mode',
          value: 'Vision (Image → Text)',
        },
      },
      // === IMAGE GENERATION MODE ===
      imagePrompt: {
        type: 'string',
        inputType: 'textarea',
        description: 'Describe the image you want to generate',
        conditional: {
          field: 'mode',
          value: 'Image Generation',
        },
      },
      imageOperation: {
        type: 'string',
        inputType: 'select',
        options: ['Generate', 'Edit', 'Variation'],
        default: 'Generate',
        description: 'Type of image operation (OpenAI only supports Edit/Variation)',
        conditional: {
          field: 'mode',
          value: 'Image Generation',
        },
      },
      referenceImage: {
        type: 'string',
        inputType: 'textarea',
        description: 'Base64 image for editing or creating variations',
        conditional: {
          field: 'imageOperation',
          value: ['Edit', 'Variation'],
        },
      },
      // === IMAGE GENERATION OPTIONS ===
      numberOfImages: {
        type: 'number',
        inputType: 'number',
        default: 1,
        description: 'Number of images to generate (1-10, OpenAI/Grok only)',
        conditional: {
          field: 'mode',
          value: 'Image Generation',
        },
      },
      imageSize: {
        type: 'string',
        inputType: 'select',
        options: ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'],
        default: '1024x1024',
        description: 'Image size (OpenAI only)',
        conditional: {
          field: 'provider',
          value: 'OpenAI',
        },
      },
      imageQuality: {
        type: 'string',
        inputType: 'select',
        options: ['standard', 'hd'],
        default: 'standard',
        description: 'Image quality (OpenAI DALL-E 3 only)',
        conditional: {
          field: 'provider',
          value: 'OpenAI',
        },
      },
      imageStyle: {
        type: 'string',
        inputType: 'select',
        options: ['vivid', 'natural'],
        default: 'vivid',
        description: 'Image style (OpenAI DALL-E 3 only)',
        conditional: {
          field: 'provider',
          value: 'OpenAI',
        },
      },
      aspectRatio: {
        type: 'string',
        inputType: 'select',
        options: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
        default: '1:1',
        description: 'Aspect ratio (Gemini only)',
        conditional: {
          field: 'provider',
          value: 'Gemini',
        },
      },
      imageResolution: {
        type: 'string',
        inputType: 'select',
        options: ['1K', '2K', '4K'],
        default: '1K',
        description: 'Image resolution (Gemini Pro only)',
        conditional: {
          field: 'provider',
          value: 'Gemini',
        },
      },
      useGoogleSearch: {
        type: 'string',
        inputType: 'checkbox',
        options: ['true'],
        default: 'false',
        description: 'Ground generation with real-time Google Search data (Gemini only)',
        conditional: {
          field: 'provider',
          value: 'Gemini',
        },
      },
      responseFormat: {
        type: 'string',
        inputType: 'select',
        options: ['url', 'b64_json'],
        default: 'b64_json',
        description: 'Response format: URL or base64 JSON (OpenAI/Grok only)',
        conditional: {
          field: 'mode',
          value: 'Image Generation',
        },
      },
      // === SHARED OPTIONS ===
      maxTokens: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        description: 'The maximum number of tokens to generate',
        conditional: {
          field: 'mode',
          value: ['Text Generation', 'Vision (Image → Text)'],
        },
      },
      temperature: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        description: 'Controls randomness in the output (0.0 to 1.0)',
        conditional: {
          field: 'mode',
          value: ['Text Generation', 'Vision (Image → Text)'],
        },
      },
      parseJson: {
        type: 'string',
        inputType: 'checkbox',
        options: ['true'],
        description: 'Parse the generated text as JSON',
        default: 'false',
        conditional: {
          field: 'mode',
          value: ['Text Generation', 'Vision (Image → Text)'],
        },
      },
    },
    outputs: {
      // Text outputs
      generatedText: {
        type: 'string',
        description: 'The text generated by the LLM',
      },
      tokenCount: {
        type: 'integer',
        description: 'The number of tokens in the generated text',
      },
      // Image outputs
      generatedImages: {
        type: 'array',
        description: 'Array of generated images (URLs or base64 data)',
      },
      firstImage: {
        type: 'string',
        description: 'The first generated image (convenience field for single image access)',
      },
      revisedPrompt: {
        type: 'string',
        description: 'Auto-enhanced prompt (Grok only)',
      },
      imageMetadata: {
        type: 'object',
        description: 'Image generation metadata (size, format, etc.)',
      },
      groundingMetadata: {
        type: 'object',
        description: 'Google Search grounding data (Gemini only)',
      },
      error: {
        type: 'string',
        description: 'Error message if the operation failed',
      },
    },
  };

  constructor() {
    super('generateWithAiLlm');
    this.authManager = AuthManager;
  }

  async execute(params, inputData, workflowEngine) {
    this.validateParams(params);

    try {
      const userId = workflowEngine.userId;
      let accessTokenOrApiKey = null;

      // Normalize provider name to lowercase for auth lookups
      const normalizedProvider = params.provider.toLowerCase();

      // Get API key/token for non-local providers
      if (normalizedProvider !== 'local') {
        try {
          // Special providers use local auth managers instead of remote service
          if (normalizedProvider === 'claude-code') {
            accessTokenOrApiKey = await ClaudeCodeAuthManager.getAccessToken();
            if (!accessTokenOrApiKey) {
              throw new Error('Claude Code is not connected. Use setup-token or paste a token to connect.');
            }
          } else if (normalizedProvider === 'openai-codex' || normalizedProvider === 'openai-codex-cli') {
            const codexStatus = await CodexAuthManager.checkApiUsable();
            if (!codexStatus.available) {
              throw new Error('OpenAI Codex is not connected. Use device login to connect.');
            }
            accessTokenOrApiKey = CodexAuthManager.getAccessToken();
            if (!accessTokenOrApiKey) {
              throw new Error('OpenAI Codex token not found after login.');
            }
          } else {
            // All other providers use the remote auth service
            accessTokenOrApiKey = await this.authManager.getValidAccessToken(userId, normalizedProvider);
          }
        } catch (authError) {
          console.error('Authentication error:', authError);
          throw new Error(`Authentication required for ${params.provider}. Please set up API key or authenticate.`);
        }
      }

      // Add API key to params
      const paramsWithAuth = { ...params, apiKey: accessTokenOrApiKey };

      // Route based on mode
      const mode = params.mode || 'Text Generation';
      let response;

      switch (mode) {
        case 'Text Generation':
          response = await this.handleTextGeneration(paramsWithAuth);
          break;
        case 'Vision (Image → Text)':
          response = await this.handleVision(paramsWithAuth);
          break;
        case 'Image Generation':
          response = await this.handleImageGeneration(paramsWithAuth);
          break;
        default:
          throw new Error(`Unsupported mode: ${mode}`);
      }

      return this.formatOutput(response);
    } catch (error) {
      console.error('Error in AI operation:', error);
      return this.formatOutput({
        generatedText: '',
        tokenCount: 0,
        generatedImages: [],
        error: error.message || 'Unknown error occurred',
      });
    }
  }

  async handleTextGeneration(params) {
    const prompt = params.prompt || params.instructions;
    let fullPrompt = prompt;

    if (params.parseJson === true) {
      fullPrompt = `${prompt}\n\n[IMPORTANT JSON AND CODE FORMATTING INSTRUCTIONS - IF RETURNING JSON OR CODE]:
1. Use double quotes for all string values, including keys.
2. ALWAYS format text and code well formatted with slash n (\\n) newlines as expected in ALL FIELDS.
3. BUT DO NOT use "'\\n' +" to split lines. "+" CONCATENATION WILL BREAK THE SYSTEM!!!!`;
    }

    const provider = params.provider.toLowerCase();
    let response;

    switch (provider) {
      case 'anthropic':
      case 'claude-code':
        response = await this.generateWithAnthropic({ ...params, prompt: fullPrompt });
        break;
      case 'cerebras':
      case 'deepseek':
      case 'gemini':
      case 'grokai':
      case 'groq':
      case 'kimi':
      case 'local':
      case 'minimax':
      case 'openai':
      case 'openai-codex':
      case 'openai-codex-cli':
      case 'openrouter':
      case 'togetherai':
      case 'zai':
        response = await this.generateWithOpenAiLike({ ...params, prompt: fullPrompt });
        break;
      default:
        throw new Error(`Unsupported provider: ${params.provider}`);
    }

    return {
      generatedText: response.generatedText,
      tokenCount: response.tokenCount,
      error: null,
    };
  }

  async handleVision(params) {
    const prompt = params.visionPrompt;
    const image = params.visionImage;

    if (!prompt) {
      throw new Error('Vision prompt is required for vision mode');
    }
    if (!image) {
      throw new Error('Vision image is required for vision mode');
    }

    const provider = params.provider.toLowerCase();
    let response;

    switch (provider) {
      case 'anthropic':
      case 'claude-code':
        response = await this.generateWithAnthropic({ ...params, prompt, image });
        break;
      case 'deepseek':
      case 'gemini':
      case 'grokai':
      case 'groq':
      case 'kimi':
      case 'local':
      case 'minimax':
      case 'openai':
      case 'openai-codex':
      case 'openai-codex-cli':
      case 'openrouter':
      case 'togetherai':
      case 'zai':
        response = await this.generateWithOpenAiLike({ ...params, prompt, image });
        break;
      default:
        throw new Error(`Unsupported provider for vision: ${params.provider}`);
    }

    return {
      generatedText: response.generatedText,
      tokenCount: response.tokenCount,
      error: null,
    };
  }

  async handleImageGeneration(params) {
    const provider = params.provider.toLowerCase();
    const providerInfo = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.default;

    if (!providerInfo.supportsImageGen) {
      throw new Error(`Provider ${params.provider} does not support image generation. Supported providers: OpenAI, Gemini, Grok`);
    }

    let response;

    switch (provider) {
      case 'openai':
        response = await this.generateImageWithOpenAI(params);
        break;
      case 'gemini':
        response = await this.generateImageWithGemini(params);
        break;
      case 'grokai':
        response = await this.generateImageWithGrok(params);
        break;
      default:
        throw new Error(`Image generation not implemented for provider: ${params.provider}`);
    }

    const images = response.generatedImages || [];

    return {
      generatedText: '',
      tokenCount: 0,
      generatedImages: images,
      firstImage: images.length > 0 ? images[0] : null,
      revisedPrompt: response.revisedPrompt || null,
      imageMetadata: response.imageMetadata || null,
      groundingMetadata: response.groundingMetadata || null,
      error: null,
    };
  }

  async generateWithAnthropic(params) {
    // Claude Code uses OAuth Bearer token, regular Anthropic uses x-api-key
    const provider = params.provider.toLowerCase();
    let anthropic;

    if (provider === 'claude-code') {
      // Claude Code: OAuth with special headers
      anthropic = new Anthropic({
        apiKey: null,
        authToken: params.apiKey, // This is actually the OAuth token
        defaultHeaders: {
          'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14,prompt-caching-2024-07-31',
          'user-agent': 'claude-cli/2.1.2 (external, cli)',
          'x-app': 'cli',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
    } else {
      // Regular Anthropic: standard API key
      anthropic = new Anthropic({ apiKey: params.apiKey });
    }
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: params.prompt,
          },
        ],
      },
    ];

    const imageData = this.processImageData(params);
    if (imageData) {
      messages[0].content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageData.mimeType,
          data: imageData.base64Data,
        },
      });
    }

    // Build system parameter: Claude Code OAuth requires identity prompt
    let systemParam;
    if (provider === 'claude-code') {
      systemParam = [
        {
          type: 'text',
          text: "You are Claude Code, Anthropic's official CLI for Claude.",
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    const response = await anthropic.messages.create({
      model: params.model || 'claude-3-5-sonnet-20240620',
      max_tokens: Number(params.maxTokens) || 4096,
      temperature: Number(params.temperature) || 0,
      messages,
      ...(systemParam && { system: systemParam }),
    });

    return {
      generatedText: response.content[0].text,
      tokenCount: response.usage.output_tokens,
    };
  }

  async generateWithOpenAiLike(params) {
    const providerKey = params.provider.toLowerCase();
    const providerInfo = PROVIDER_CONFIG[providerKey] || PROVIDER_CONFIG.default;
    const openai = new OpenAI({
      apiKey: params.apiKey,
      baseURL: providerInfo.baseURL,
    });

    // Handle image data for vision models
    const imageData = this.processImageData(params);
    let messageContent = params.prompt;

    if (imageData) {
      // Use array format for content when including images
      messageContent = [
        {
          type: 'text',
          text: params.prompt,
        },
        {
          type: 'image_url',
          image_url: {
            url: imageData.dataUrl,
          },
        },
      ];
    }

    const messages = [{ role: 'user', content: messageContent }];
    const maxTokens = Number(params.maxTokens) || 4096;
    const currentModel = params.model || providerInfo.defaultModel;
    // Include "gpt-4o-mini" in the mini models list
    const isMiniModel = ['o1-mini', 'o3-mini', 'gpt-4o-mini'].includes(currentModel) && providerKey === 'openai';

    const completionOptions = {
      model: currentModel,
      messages,
    };

    // Use max_completion_tokens for mini models, and max_tokens otherwise.
    if (isMiniModel) {
      completionOptions.max_completion_tokens = maxTokens;
    } else {
      completionOptions.max_tokens = maxTokens;
    }

    // Only add temperature if supported:
    // - Do not add if the model is mini (which includes "o1-mini", "o3-mini", "gpt-4o-mini")
    // - Or if the model is "deepseek-reasoner" or the provider is "groq"
    if (!isMiniModel && currentModel !== 'deepseek-reasoner' && providerKey !== 'groq') {
      completionOptions.temperature = Number(params.temperature) || 0;
    }

    const completion = await openai.chat.completions.create(completionOptions);

    const tokenCount = completion?.usage?.total_tokens || null;
    const content = completion?.choices?.[0]?.message?.content || '';

    return {
      generatedText: content,
      tokenCount,
    };
  }

  async generateImageWithOpenAI(params) {
    const openai = new OpenAI({ apiKey: params.apiKey });
    const operation = params.imageOperation || 'Generate';
    const model = params.model || 'dall-e-3';

    let response;

    try {
      if (operation === 'Generate') {
        // Text-to-image generation
        const requestParams = {
          model: model,
          prompt: params.imagePrompt,
          n: Number(params.numberOfImages) || 1,
          size: params.imageSize || '1024x1024',
          response_format: params.responseFormat || 'b64_json',
        };

        // Add DALL-E 3 specific parameters
        if (model === 'dall-e-3') {
          if (params.imageQuality) requestParams.quality = params.imageQuality;
          if (params.imageStyle) requestParams.style = params.imageStyle;
        }

        response = await openai.images.generate(requestParams);
      } else if (operation === 'Edit') {
        // Image editing (requires reference image)
        if (!params.referenceImage) {
          throw new Error('Reference image is required for image editing');
        }

        if (!params.imagePrompt) {
          throw new Error('Image prompt is required for image editing - describe what changes you want to make');
        }

        // Convert base64 to RGBA PNG file for OpenAI API
        const imageFile = await this.base64ToFile(params.referenceImage, 'image.png');

        console.log('OpenAI Edit - Using prompt:', params.imagePrompt);

        response = await openai.images.edit({
          model: model === 'dall-e-3' ? 'dall-e-2' : model, // DALL-E 3 doesn't support edits
          image: imageFile,
          prompt: params.imagePrompt, // This is the edit instruction
          n: Number(params.numberOfImages) || 1,
          size: params.imageSize || '1024x1024',
          response_format: params.responseFormat || 'b64_json',
        });
      } else if (operation === 'Variation') {
        // Image variation (DALL-E 2 only)
        if (!params.referenceImage) {
          throw new Error('Reference image is required for image variation');
        }

        // Convert base64 to RGBA PNG file for OpenAI API
        const imageFile = await this.base64ToFile(params.referenceImage, 'image.png');

        response = await openai.images.createVariation({
          model: 'dall-e-2', // Only DALL-E 2 supports variations
          image: imageFile,
          n: Number(params.numberOfImages) || 1,
          size: params.imageSize || '1024x1024',
          response_format: params.responseFormat || 'b64_json',
        });
      }

      // Format images with proper data URL prefix
      const images = response.data.map((img) => {
        if (img.b64_json) {
          // Add data URL prefix for base64 images
          return `data:image/png;base64,${img.b64_json}`;
        }
        return img.url;
      });

      return {
        generatedImages: images,
        imageMetadata: {
          model: model,
          operation: operation,
          size: params.imageSize || '1024x1024',
          count: images.length,
          format: params.responseFormat || 'b64_json',
        },
      };
    } catch (error) {
      console.error('OpenAI image generation error:', error);
      throw new Error(`OpenAI image generation failed: ${error.message}`);
    }
  }

  async generateImageWithGemini(params) {
    try {
      // Validate operation support
      const operation = params.imageOperation || 'Generate';
      if (operation !== 'Generate') {
        throw new Error(`Gemini only supports 'Generate' operation. Edit and Variation are not supported.`);
      }

      const genAI = new GoogleGenerativeAI(params.apiKey);
      const modelName = params.model || 'gemini-2.0-flash-exp';
      const prompt = params.imagePrompt;

      // Build generation config
      const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: 'text/plain',
      };

      // Build the model with config
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig,
      });

      // Build the request parts
      const parts = [{ text: prompt }];

      // Add Google Search grounding if requested
      const tools = [];
      if (params.useGoogleSearch === 'true' || params.useGoogleSearch === true) {
        tools.push({ googleSearch: {} });
      }

      // Generate content
      const result = await model.generateContent({
        contents: [{ role: 'user', parts }],
        tools: tools.length > 0 ? tools : undefined,
      });

      const response = result.response;
      const candidates = response.candidates || [];

      // Extract images from response
      const images = [];
      const groundingMetadata = response.groundingMetadata || null;

      // Process candidates to extract image data
      for (const candidate of candidates) {
        const content = candidate.content;
        if (content && content.parts) {
          for (const part of content.parts) {
            // Check for inline data (base64 images)
            if (part.inlineData) {
              const mimeType = part.inlineData.mimeType || 'image/png';
              const base64Data = part.inlineData.data;
              // Add proper data URL prefix
              images.push(`data:${mimeType};base64,${base64Data}`);
            }
            // Check for file data (URLs)
            else if (part.fileData && part.fileData.fileUri) {
              images.push(part.fileData.fileUri);
            }
          }
        }
      }

      return {
        generatedImages: images,
        imageMetadata: {
          model: modelName,
          aspectRatio: params.aspectRatio || '1:1',
          resolution: params.imageResolution || '1K',
          useGoogleSearch: params.useGoogleSearch === 'true',
          candidatesCount: candidates.length,
        },
        groundingMetadata: groundingMetadata,
      };
    } catch (error) {
      console.error('Gemini image generation error:', error);
      throw new Error(`Gemini image generation failed: ${error.message}`);
    }
  }

  async generateImageWithGrok(params) {
    // Validate operation support
    const operation = params.imageOperation || 'Generate';
    if (operation !== 'Generate') {
      throw new Error(`Grok only supports 'Generate' operation. Edit and Variation are not supported.`);
    }

    const openai = new OpenAI({
      apiKey: params.apiKey,
      baseURL: 'https://api.x.ai/v1',
    });

    try {
      const response = await openai.images.generate({
        model: 'grok-2-image',
        prompt: params.imagePrompt,
        n: Number(params.numberOfImages) || 1,
        response_format: params.responseFormat || 'b64_json',
      });

      // Format images with proper data URL prefix
      const images = response.data.map((img) => {
        if (img.b64_json) {
          // Add data URL prefix for base64 images (Grok returns JPEG)
          return `data:image/jpeg;base64,${img.b64_json}`;
        }
        return img.url;
      });

      const revisedPrompt = response.data[0]?.revised_prompt || null;

      return {
        generatedImages: images,
        revisedPrompt: revisedPrompt,
        imageMetadata: {
          model: 'grok-2-image',
          count: images.length,
          format: params.responseFormat || 'b64_json',
        },
      };
    } catch (error) {
      console.error('Grok image generation error:', error);
      throw new Error(`Grok image generation failed: ${error.message}`);
    }
  }

  validateParams(params) {
    const mode = params.mode || 'Text Generation';

    if (!params.provider) {
      throw new Error('Provider is required');
    }

    // Validate based on mode
    switch (mode) {
      case 'Text Generation':
        if (!params.prompt && !params.instructions) {
          throw new Error('Prompt or instructions are required for text generation');
        }
        break;
      case 'Vision (Image → Text)':
        if (!params.visionPrompt) {
          throw new Error('Vision prompt is required for vision mode');
        }
        if (!params.visionImage) {
          throw new Error('Vision image is required for vision mode');
        }
        break;
      case 'Image Generation':
        if (!params.imagePrompt) {
          throw new Error('Image prompt is required for image generation');
        }
        // Validate provider supports image generation
        const providerKey = params.provider.toLowerCase();
        const providerInfo = PROVIDER_CONFIG[providerKey] || PROVIDER_CONFIG.default;
        if (!providerInfo.supportsImageGen) {
          throw new Error(`Provider ${params.provider} does not support image generation. Supported providers: OpenAI, Gemini, Grok`);
        }
        break;
      default:
        throw new Error(`Invalid mode: ${mode}`);
    }
  }

  async base64ToFile(base64Data, filename) {
    // Remove data URL prefix if present
    const base64String = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64String, 'base64');

    // Create a File-like object for OpenAI API
    // OpenAI accepts PNG images directly - no need for RGBA conversion
    return new File([buffer], filename, { type: 'image/png' });
  }

  processImageData(params) {
    if (!params.image) return null;

    const imageData = typeof params.image === 'string' ? params.image : params.image.toString();

    // Validate data URL format
    if (!this.isValidDataUrl(imageData)) {
      throw new Error('Invalid image format. Expected data URL format: data:image/[type];base64,[data]');
    }

    const { mimeType, base64Data } = this.parseDataUrl(imageData);

    console.log('Image type:', mimeType);
    console.log('Image data:', base64Data.substring(0, 100) + '...');

    return {
      dataUrl: imageData,
      mimeType: mimeType,
      base64Data: base64Data,
    };
  }

  isValidDataUrl(dataUrl) {
    const dataUrlRegex = /^data:image\/(jpeg|jpg|png|gif|webp);base64,([A-Za-z0-9+/=]+)$/;
    return dataUrlRegex.test(dataUrl);
  }

  parseDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid data URL format');
    }

    return {
      mimeType: `image/${match[1]}`,
      base64Data: match[2],
    };
  }
}

export default new GenerateWithAiLlm();
