import BaseAction from '../BaseAction.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai/index.mjs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import AuthManager from '../../../services/auth/AuthManager.js';
import CodexAuthManager from '../../../services/auth/CodexAuthManager.js';
import ClaudeCodeAuthManager from '../../../services/auth/ClaudeCodeAuthManager.js';
import GeminiCliAuthManager from '../../../services/auth/GeminiCliAuthManager.js';
import AntigravityAuthManager from '../../../services/auth/AntigravityAuthManager.js';
import { createLlmClient } from '../../../services/ai/LlmService.js';
import { createLlmAdapter } from '../../../services/orchestrator/llmAdapters.js';
import { getProviderConfig, resolveMaxOutputTokens, getRecommendedModels, buildBaseURLs } from '../../../services/ai/providerConfigs.js';
import * as ProviderRegistry from '../../../services/ai/ProviderRegistry.js';
import { recordLlmCall } from '../../../services/execution/LedgerRecorder.js';

/**
 * Provider facts come from the registry. This file used to carry its own copy.
 *
 * A 150-line PROVIDER_CONFIG table lived here with baseURLs, default models,
 * vision flags and image-model lists for twenty providers. It was a duplicate
 * of services/ai/providerConfigs.js, and it had drifted — measured 2026-08-11:
 *
 *   - 6 stale default models (groq mixtral-8x7b-32768, cerebras llama-3.3-70b,
 *     openrouter openai/gpt-3.5-turbo, zai GLM-4.7, togetherai Mixtral-8x7B,
 *     local llama-3.2-1b) naming models their provider no longer lists;
 *   - 4 wrong capability flags — it BLOCKED vision on cerebras and cursor-cli,
 *     which support it, and ADVERTISED vision on deepseek and local, which do
 *     not;
 *   - stale image model lists (grok-2-image, dall-e-2, nano-banana-pro-preview);
 *   - kimi-code and chutes missing entirely, so they fell through to a default
 *     of gpt-4o-mini pointed at api.openai.com.
 *
 * Every image and vision defect in the audit descended from this one table.
 * The registry is refreshed from the vendors and is what chat already uses, so
 * asking it is both correct today and correct after the next model launch.
 *
 * baseURLs come from buildBaseURLs() specifically, rather than reading
 * getProviderConfig().baseURL: that helper is what LlmService itself uses and
 * it supplies `local`, which has no registry entry of its own. Verified
 * against the deleted table before removal — the only differences were a
 * trailing slash and deepseek's optional /v1 suffix, both accepted by the SDK.
 */
const BASE_URLS = buildBaseURLs();

/** The provider's current default model, per the registry. */
function providerDefaultModel(providerKey) {
  const cfg = getProviderConfig(providerKey);
  return cfg?.recommendedModels?.[0] || cfg?.fallbackModels?.[0] || null;
}

/** The provider's current default IMAGE model, per the registry. */
function imageDefaultModel(providerKey) {
  return ProviderRegistry.getImageGenCapabilities(providerKey)?.defaultModel || null;
}

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
          } else if (normalizedProvider === 'openai-codex') {
            const codexStatus = await CodexAuthManager.checkApiUsable();
            if (!codexStatus.available) {
              throw new Error('OpenAI Codex is not connected. Use device login to connect.');
            }
            accessTokenOrApiKey = CodexAuthManager.getAccessToken();
            if (!accessTokenOrApiKey) {
              throw new Error('OpenAI Codex token not found after login.');
            }
          } else if (normalizedProvider === 'gemini-cli') {
            const gcStatus = await GeminiCliAuthManager.checkApiUsable();
            if (gcStatus?.deprecated) {
              // Google discontinued Gemini CLI consumer OAuth on June 18, 2026 (PRD-107)
              throw new Error(gcStatus.hint);
            }
            accessTokenOrApiKey = await GeminiCliAuthManager.getAccessToken();
            if (!accessTokenOrApiKey) {
              throw new Error('Gemini CLI is not connected. Use Google OAuth or paste an API key to connect.');
            }
          } else if (normalizedProvider === 'antigravity') {
            accessTokenOrApiKey = await AntigravityAuthManager.getAccessToken();
            if (!accessTokenOrApiKey) {
              throw new Error('Antigravity is not connected. Use Google OAuth to connect.');
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

      // Add API key + userId to params (userId is needed for createLlmClient on claude-code)
      const paramsWithAuth = { ...params, apiKey: accessTokenOrApiKey, userId };

      // Route based on mode
      const mode = params.mode || 'Text Generation';
      let response;

      const startedAt = Date.now();

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

      // PRD-122: record the call.
      //
      // Deliberately ONE call site rather than one per provider. Every branch
      // of handleTextGeneration/handleVision already normalises its provider's
      // usage into { inputTokens, outputTokens } and funnels through here, so
      // pricing at the funnel cannot be forgotten when a ninth provider is
      // added — which is precisely how the workflow path came to capture
      // tokens for years without ever pricing them.
      await recordLlmCall({
        userId,
        origin: 'workflow_node',
        originId: workflowEngine?.currentExecutionId || null,
        provider: normalizedProvider,
        model: params.model || response?.model || 'unknown',
        usage: {
          inputTokens: response?.inputTokens || 0,
          outputTokens: response?.outputTokens || 0,
        },
        durationMs: Date.now() - startedAt,
      });

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

  /**
   * Which generator serves each provider.
   *
   * This replaced two twenty-arm `switch (provider)` statements — one in
   * handleTextGeneration, one in handleVision — that listed the same providers
   * in the same order and differed only in the params they forwarded. Two
   * copies of one routing decision is how a provider ends up supported for
   * text and quietly missing for vision, which is invisible until a user picks
   * that combination.
   *
   * A table cannot drift from itself. Anything absent falls through to the
   * OpenAI-compatible generator, which is what fourteen of the twenty use.
   */
  static PROVIDER_ROUTES = {
    anthropic: 'generateWithAnthropic',
    'claude-code': 'generateWithAnthropic',
    'openai-codex': 'generateWithCodex',
    'kimi-code': 'generateWithKimiCode',
    chutes: 'generateWithChutes',
    'gemini-cli': 'generateWithGoogleGateway',
    antigravity: 'generateWithGoogleGateway',
    // Local CLI transports: the client MUST come from createLlmClient, so they
    // use the managed helper with an explicit default model.
    'grok-build': { method: 'generateWithManagedOpenAiLike', provider: 'grok-build', defaultModel: 'grok-4.5' },
    'cursor-cli': { method: 'generateWithManagedOpenAiLike', provider: 'cursor-cli', defaultModel: 'cursor-grok-4.5-high' },
  };

  /**
   * The one place a provider key selects a generator.
   * @param {object} params    the node's parameters
   * @param {object} overrides prompt/image for this mode
   * @param {string} mode      'text' | 'vision', for the error message only
   */
  async routeToProvider(params, overrides, mode = 'text') {
    const provider = String(params.provider || '').toLowerCase();
    if (!provider) {
      throw new Error(`Unsupported provider${mode === 'vision' ? ' for vision' : ''}: ${params.provider}`);
    }

    const route = GenerateWithAiLlm.PROVIDER_ROUTES[provider];
    const merged = { ...params, ...overrides };

    if (typeof route === 'string') return this[route](merged);
    if (route) return this[route.method](merged, { provider: route.provider, defaultModel: route.defaultModel });

    // Default: the OpenAI-compatible transport. Reached by cerebras, deepseek,
    // gemini, grokai, groq, kimi, local, minimax, openai, openrouter,
    // togetherai and zai — and by any provider added later, which is the point.
    return this.generateWithOpenAiLike(merged);
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

    const response = await this.routeToProvider(params, { prompt: fullPrompt });

    return {
      generatedText: response.generatedText,
      tokenCount: response.tokenCount,
      inputTokens: response.inputTokens || 0,
      outputTokens: response.outputTokens || 0,
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

    const response = await this.routeToProvider(params, { prompt, image }, 'vision');

    return {
      generatedText: response.generatedText,
      tokenCount: response.tokenCount,
      inputTokens: response.inputTokens || 0,
      outputTokens: response.outputTokens || 0,
      error: null,
    };
  }

  /**
   * Which generator serves each image-capable provider.
   *
   * Same shape as PROVIDER_ROUTES above, and for the same reason: a switch is
   * a second place to forget a provider. The set of KEYS here must match the
   * registry's image-capable providers exactly — pinned by a test, so adding
   * one to the registry without implementing it fails loudly instead of
   * throwing "not implemented" at whoever picked it in the UI.
   */
  static IMAGE_ROUTES = {
    openai: 'generateImageWithOpenAI',
    gemini: 'generateImageWithGemini',
    grokai: 'generateImageWithGrok',
  };

  async handleImageGeneration(params) {
    const provider = params.provider.toLowerCase();

    // The REGISTRY decides who can generate images. The local table this used
    // to consult listed stale image models and disagreed with the catalog the
    // orchestrator validates against, so a user could pick a provider the tool
    // advertised and have it rejected here.
    if (!ProviderRegistry.supportsImageGeneration(provider)) {
      const supported = ProviderRegistry.getImageGenProviders().map((p) => p.name || p.provider).join(', ');
      throw new Error(`Provider ${params.provider} does not support image generation. Supported providers: ${supported}`);
    }

    const method = GenerateWithAiLlm.IMAGE_ROUTES[provider];
    if (!method) {
      throw new Error(`Image generation not implemented for provider: ${params.provider}`);
    }
    const response = await this[method](params);

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

  async generateWithGoogleGateway(params) {
    // gemini-cli / antigravity authenticate against the cloudcode-pa OAuth
    // gateway — a raw GoogleGenerativeAI(apiKey) client would call the wrong
    // endpoint (generativelanguage). Delegate to createLlmClient, which returns
    // the GeminiOAuthProxy / AntigravityOAuthProxy the orchestrator chat uses
    // (or a plain GoogleGenAI client for gemini-cli in API-key mode). The proxy
    // mirrors the SDK surface: models.generateContent → { text, usageMetadata }.
    const provider = params.provider.toLowerCase();
    const client = await createLlmClient(provider, params.userId);
    const model = params.model || providerDefaultModel(provider) || 'gemini-2.5-pro';

    const parts = [{ text: params.prompt }];
    const imageData = this.processImageData(params);
    if (imageData) {
      parts.push({ inlineData: { mimeType: imageData.mimeType, data: imageData.base64Data } });
    }

    const config = {};
    if (params.temperature != null && params.temperature !== '') {
      config.temperature = Number(params.temperature);
    }
    if (params.maxTokens) {
      config.maxOutputTokens = Number(params.maxTokens);
    } else {
      config.maxOutputTokens = resolveMaxOutputTokens(provider, model);
    }

    const response = await client.models.generateContent({
      model,
      config,
      contents: [{ role: 'user', parts }],
    });

    const usage = response.usageMetadata || {};
    return {
      generatedText: response.text || '',
      tokenCount: usage.totalTokenCount || 0,
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
    };
  }

  async generateWithAnthropic(params) {
    const provider = params.provider.toLowerCase();

    // For claude-code (and regular anthropic), delegate to the SAME
    // createLlmClient + createLlmAdapter + adapter.call() path the orchestrator
    // chat uses. The adapter handles the billing header block, cache_control,
    // model-specific max_tokens, and retries — no duplication.
    if (provider === 'claude-code' || provider === 'anthropic') {
      const client = await createLlmClient(provider, params.userId);
      const model = params.model || (provider === 'claude-code' ? 'claude-sonnet-4-5-20250929' : 'claude-3-5-sonnet-20241022');
      const adapter = await createLlmAdapter(provider, client, model);

      // Build user message content (text + optional image) in Anthropic format.
      const userContent = [{ type: 'text', text: params.prompt }];
      const imageData = this.processImageData(params);
      if (imageData) {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: imageData.mimeType,
            data: imageData.base64Data,
          },
        });
      }

      const result = await adapter.call([{ role: 'user', content: userContent }], []);

      // Extract text from Anthropic content blocks
      const responseContent = result?.responseMessage?.content;
      const textBlock = Array.isArray(responseContent)
        ? responseContent.find((b) => b.type === 'text')
        : null;
      const generatedText = textBlock?.text || '';
      const usage = result?.usage || {};

      return {
        generatedText,
        tokenCount: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
      };
    }

    // Fallback: any other anthropic-like provider routes through a direct SDK call.
    const anthropic = new Anthropic({ apiKey: params.apiKey });
    const messages = [
      { role: 'user', content: [{ type: 'text', text: params.prompt }] },
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

    const anthropicModel = params.model || 'claude-3-5-sonnet-20241022';
    const response = await anthropic.messages.create({
      model: anthropicModel,
      max_tokens: Number(params.maxTokens) || resolveMaxOutputTokens('anthropic', anthropicModel),
      temperature: Number(params.temperature) || 0,
      messages,
    });

    return {
      generatedText: response.content[0].text,
      tokenCount: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0),
      inputTokens: response.usage.input_tokens || 0,
      outputTokens: response.usage.output_tokens || 0,
    };
  }

  async generateWithCodex(params) {
    // Codex uses OAuth + a custom ChatGPT backend (chatgpt.com/backend-api/codex)
    // and only exposes /responses, not /chat/completions. Constructing a raw OpenAI
    // SDK client here would miss the OAuth token, the ChatGPT-Account-ID header, and
    // would call the wrong endpoint. Delegate to the same createLlmClient +
    // createLlmAdapter path the orchestrator chat uses.
    const provider = 'openai-codex';
    if (!params.model) {
      throw new Error('Codex provider requires an explicit model in the workflow node configuration (no defaultModel fallback).');
    }
    const client = await createLlmClient(provider, params.userId);
    const adapter = await createLlmAdapter(provider, client, params.model);

    // Vision: the Responses API needs input_image blocks, which the adapter
    // builds from context.imageData. Previously this method accepted an image
    // argument and never used it, so analyze_image asked Codex to describe a
    // picture it was never sent.
    const imageData = this.processImageData(params);
    const context = imageData
      ? { imageData: [{ type: imageData.mimeType, data: imageData.base64Data }] }
      : {};

    const { responseMessage, usage } = await adapter.call(
      [{ role: 'user', content: params.prompt }],
      [],
      context,
    );

    let generatedText = '';
    if (typeof responseMessage?.content === 'string') {
      generatedText = responseMessage.content;
    } else if (Array.isArray(responseMessage?.content)) {
      generatedText = responseMessage.content
        .filter((b) => b && (b.type === 'text' || b.type === 'output_text' || typeof b.text === 'string'))
        .map((b) => b.text || '')
        .join('');
    }

    const inputTokens = usage?.input_tokens || usage?.prompt_tokens || 0;
    const outputTokens = usage?.output_tokens || usage?.completion_tokens || 0;
    return {
      generatedText,
      tokenCount: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
    };
  }

  /**
   * Shared path for providers whose client MUST come from createLlmClient:
   * custom baseURL, a spoofed CLI User-Agent, OAuth, or an encrypting
   * transport (Chutes' E2EE fetch). Building a raw OpenAI SDK client for
   * these silently targets api.openai.com and/or bypasses encryption.
   *
   * Images are sent as an OpenAI-style multimodal content array with the
   * image part FIRST, which is the shape Kimi documents; a serialised-string
   * array is explicitly unsupported.
   * https://platform.kimi.ai/docs/guide/use-kimi-vision-model
   */
  async generateWithManagedOpenAiLike(params, { provider, defaultModel }) {
    const client = await createLlmClient(provider, params.userId);
    const model = params.model || defaultModel || getRecommendedModels(provider)?.[0];
    if (!model) {
      throw new Error(`${provider} requires an explicit model in the node configuration.`);
    }
    const adapter = await createLlmAdapter(provider, client, model);

    const imageData = this.processImageData(params);
    const userContent = imageData
      ? [
        { type: 'image_url', image_url: { url: imageData.dataUrl } },
        { type: 'text', text: params.prompt },
      ]
      : params.prompt;

    const { responseMessage, usage } = await adapter.call(
      [{ role: 'user', content: userContent }],
      [],
    );

    let generatedText = '';
    if (typeof responseMessage?.content === 'string') {
      generatedText = responseMessage.content;
    } else if (Array.isArray(responseMessage?.content)) {
      generatedText = responseMessage.content
        .filter((b) => b && (b.type === 'text' || b.type === 'output_text' || typeof b.text === 'string'))
        .map((b) => b.text || '')
        .join('');
    }

    const inputTokens = usage?.input_tokens || usage?.prompt_tokens || 0;
    const outputTokens = usage?.output_tokens || usage?.completion_tokens || 0;
    return {
      generatedText,
      tokenCount: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
    };
  }

  async generateWithKimiCode(params) {
    // Kimi Code: custom baseURL (api.kimi.com/coding/v1) + a User-Agent that
    // spoofs kimi-cli + developer->user role mapping. All four Kimi Code
    // models accept image input (verified live against the API).
    return this.generateWithManagedOpenAiLike(params, {
      provider: 'kimi-code',
      defaultModel: 'kimi-for-coding',
    });
  }

  async generateWithChutes(params) {
    // Chutes is E2EE: createLlmClient installs ChutesE2EEFetchTransport, which
    // encrypts the payload. It is also absent from the local PROVIDER_CONFIG
    // map, so the raw-SDK path would resolve baseURL undefined -> api.openai.com.
    return this.generateWithManagedOpenAiLike(params, { provider: 'chutes' });
  }

  async generateWithOpenAiLike(params) {
    const providerKey = params.provider.toLowerCase();
    const sharedConfig = getProviderConfig(providerKey);
    const defaultHeaders = sharedConfig?.sdkOptions?.defaultHeaders;
    const openai = new OpenAI({
      apiKey: params.apiKey,
      baseURL: BASE_URLS[providerKey],
      ...(defaultHeaders ? { defaultHeaders } : {}),
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
    const currentModel = params.model || providerDefaultModel(providerKey);
    const maxTokens = Number(params.maxTokens) || resolveMaxOutputTokens(providerKey, currentModel);
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

    // ROUTED THROUGH THE SHARED ADAPTER.
    //
    // This function serves most of the catalog — groq, deepseek, openrouter,
    // togetherai, grokai, minimax, zai and friends — and used to call
    // `openai.chat.completions.create` itself. That meant the workflow AI node
    // was a third provider implementation alongside the orchestrator and
    // StreamEngine, and it had none of their fixes: no cache affinity, no
    // usage-before-choices guard on the streaming path, no normalized usage,
    // no retry/backoff, and no provider-specific tool-schema handling.
    //
    // The CLIENT is still built here rather than by createLlmClient, on
    // purpose: a workflow node may carry its own `params.apiKey`, and the
    // vault-backed factory has no way to accept one. Keeping construction
    // local preserves bring-your-own-key; routing the CALL through the adapter
    // is what buys the shared behaviour.
    //
    // The node's own max-tokens and temperature rules are preserved verbatim
    // via extraBody, which the adapter merges into the request — including the
    // max_completion_tokens spelling the o-series/mini models require, and the
    // deliberate omission of temperature for models that reject it.
    const adapter = await createLlmAdapter(providerKey, openai, currentModel, {
      provider: providerKey,
      extraBody: {
        ...(isMiniModel
          ? { max_completion_tokens: completionOptions.max_completion_tokens }
          : { max_tokens: completionOptions.max_tokens }),
        ...(completionOptions.temperature !== undefined
          ? { temperature: completionOptions.temperature }
          : {}),
      },
    });

    const { responseMessage, usage, recoveredFromError, recoveredError } = await adapter.call(messages, []);

    // A workflow node must fail loudly. The adapter recovers from an exhausted
    // retry by returning the provider's error text as the assistant message,
    // which is right for a chat turn and wrong for a node whose output feeds
    // the next step.
    if (recoveredFromError) {
      throw new Error(recoveredError || 'Provider request failed after retries');
    }

    let content = '';
    if (typeof responseMessage?.content === 'string') {
      content = responseMessage.content;
    } else if (Array.isArray(responseMessage?.content)) {
      content = responseMessage.content
        .filter((b) => b && (b.type === 'text' || b.type === 'output_text' || typeof b.text === 'string'))
        .map((b) => b.text || '')
        .join('');
    }

    const inputTokens = usage?.prompt_tokens || usage?.input_tokens || 0;
    const outputTokens = usage?.completion_tokens || usage?.output_tokens || 0;

    return {
      generatedText: content,
      tokenCount: usage?.total_tokens || (inputTokens + outputTokens) || null,
      inputTokens,
      outputTokens,
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
      // Registry default, not a literal. The previous fallback was
      // 'gemini-2.0-flash-exp', which the catalog no longer lists — the same
      // class of stale hardcoded default as the seven found in StreamEngine.
      const modelName = params.model || imageDefaultModel('gemini');
      const prompt = params.imagePrompt;

      // Build generation config
      const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: resolveMaxOutputTokens('gemini', modelName),
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
      // From the registry, not a literal. This was the twelfth hardcoded copy
      // of an xAI base URL in the codebase.
      baseURL: BASE_URLS.grokai,
    });

    // HONOUR THE REQUESTED MODEL.
    //
    // This used to send a hardcoded 'grok-2-image' and ignore params.model
    // entirely — while the orchestrator's generate_image tool validated the
    // user's choice against the registry's live model list and accepted it.
    // Validation that the implementation then discards is worse than no
    // validation: it reports success for a request that was never made.
    // Measured 2026-08-11: the registry lists grok-imagine-image-pro and
    // grok-imagine-image; grok-2-image is not among them.
    const model = params.model || imageDefaultModel('grokai');

    try {
      const response = await openai.images.generate({
        model,
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
          model,
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
        // Validate provider supports image generation — against the registry,
        // the same source handleImageGeneration and the orchestrator's
        // generate_image schema now use, so all three agree by construction.
        if (!ProviderRegistry.supportsImageGeneration(params.provider.toLowerCase())) {
          const supported = ProviderRegistry.getImageGenProviders().map((p) => p.name || p.provider).join(', ');
          throw new Error(`Provider ${params.provider} does not support image generation. Supported providers: ${supported}`);
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
