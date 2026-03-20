import { randomUUID } from 'crypto';
import { executeTool } from './orchestrator/tools.js';
import { executeAgentTool } from './orchestrator/agentTools.js';
import { executeWorkflowTool } from './orchestrator/workflowTools.js';
import { executeGoalTool } from './orchestrator/goalTools.js';
import { executeCodeFunction } from './orchestrator/codeTools.js';
import ConversationLogModel from '../models/ConversationLogModel.js';
import AgentExecutionModel from '../models/AgentExecutionModel.js';
import { createLlmClient } from './ai/LlmService.js';
import { createLlmAdapter } from './orchestrator/llmAdapters.js';
import { getModelCost } from './ai/providerConfigs.js';
import { manageContext } from '../utils/contextManager.js';
import { detectChatType, getChatConfig } from './orchestrator/chatConfigs.js';
import log from '../utils/logger.js';
import OpenAI from 'openai';
import AuthManager from './auth/AuthManager.js';
import StreamEngine from '../stream/StreamEngine.js';
import db from '../models/database/index.js';
import { getRawTextFromPDFBuffer, getRawTextFromDocxBuffer } from '../stream/utils.js';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';
import * as ProviderRegistry from './ai/ProviderRegistry.js';
import asyncToolQueue from './AsyncToolQueue.js';
import conversationManager from './ConversationManager.js';
import autonomousMessageService from './AutonomousMessageService.js';
import UserModel from '../models/UserModel.js';
import AgentModel from '../models/AgentModel.js';
import { createSession as createUnfirehoseSession, wrapSendEvent as wrapUnfirehoseSendEvent, isEnabled as isUnfirehoseEnabled } from './unfirehose/UnfirehoseLogger.js';

/**
 * Extract images from tool results and replace with references
 * This prevents base64 image data from bloating the context window
 */
function extractAndReplaceImages(toolResult, toolCallId) {
  const images = [];

  try {
    const result = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;

    // Check for image generation results
    if (result.generatedImages && Array.isArray(result.generatedImages)) {
      result.generatedImages.forEach((img, index) => {
        if (img && typeof img === 'string' && img.startsWith('data:image/')) {
          const imageId = `img-${toolCallId}-${index}`;
          images.push({
            id: imageId,
            data: img,
            index: index,
          });

          // Replace with reference
          result.generatedImages[index] = `{{IMAGE_REF:${imageId}}}`;
        }
      });
    }

    // Check for firstImage
    if (result.firstImage && typeof result.firstImage === 'string' && result.firstImage.startsWith('data:image/')) {
      const imageId = `img-${toolCallId}-first`;
      images.push({
        id: imageId,
        data: result.firstImage,
        index: 'first',
      });
      result.firstImage = `{{IMAGE_REF:${imageId}}}`;
    }

    return {
      modifiedResult: JSON.stringify(result),
      images: images,
    };
  } catch (e) {
    // If parsing fails, return original
    return {
      modifiedResult: toolResult,
      images: [],
    };
  }
}

/**
 * Sanitize message history by extracting embedded base64 images
 * This prevents images from previous conversations from bloating the context window
 */
function sanitizeMessageHistory(messages) {
  const extractedImages = [];

  const sanitizedMessages = messages.map((msg, msgIndex) => {
    if (!msg || !msg.content || typeof msg.content !== 'string') {
      return msg;
    }

    // Check for base64 images in message content
    const imageRegex = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g;
    let sanitizedContent = msg.content;
    const matches = [];
    let match;

    // Collect all matches first
    while ((match = imageRegex.exec(msg.content)) !== null) {
      matches.push(match[0]);
    }

    // Replace each match with a reference
    matches.forEach((imageData, imageIndex) => {
      const imageId = `img-history-${msgIndex}-${imageIndex}-${Date.now()}`;

      extractedImages.push({
        id: imageId,
        data: imageData,
        messageId: msg.id,
        index: imageIndex,
      });

      // Replace with reference
      sanitizedContent = sanitizedContent.replace(imageData, `{{IMAGE_REF:${imageId}}}`);
    });

    if (matches.length > 0) {
      console.log(`Sanitized ${matches.length} image(s) from message ${msg.id || msgIndex}`);
      return { ...msg, content: sanitizedContent };
    }

    return msg;
  });

  return { sanitizedMessages, extractedImages };
}

/**
 * Generate a compact summary of offloaded data so the LLM knows what it contains
 * @param {string} data - The raw data string
 * @param {string} dataId - The data reference ID
 * @returns {object} - Summary with type, structure, preview
 */
function generateDataSummary(data, dataId) {
  const summary = {
    dataId,
    size: data.length,
    lineCount: data.split('\n').length,
    type: 'text',
    preview: '',
    structure: null,
  };

  // Detect data type
  const trimmed = data.trim();

  // Try JSON first
  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) {
      summary.type = 'json_array';
      summary.structure = {
        itemCount: parsed.length,
      };

      // Get keys from first item if it's an object
      if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
        summary.structure.keys = Object.keys(parsed[0]);
      }

      // Sample first 2-3 items as preview
      const sampleItems = parsed.slice(0, 3);
      const sampleStr = JSON.stringify(sampleItems, null, 2);
      summary.preview = sampleStr.length > 500 ? sampleStr.substring(0, 500) + '...' : sampleStr;
    } else if (typeof parsed === 'object' && parsed !== null) {
      summary.type = 'json_object';
      summary.structure = {
        topLevelKeys: Object.keys(parsed),
      };

      // Preview first 500 chars of stringified
      const objStr = JSON.stringify(parsed, null, 2);
      summary.preview = objStr.length > 500 ? objStr.substring(0, 500) + '...' : objStr;
    }
  } catch {
    // Not JSON — check for HTML
    if (trimmed.startsWith('<!') || trimmed.startsWith('<html') || /<\w+[\s>]/.test(trimmed.substring(0, 200))) {
      summary.type = 'html';
      const titleMatch = trimmed.match(/<title[^>]*>(.*?)<\/title>/i);
      if (titleMatch) {
        summary.structure = { title: titleMatch[1] };
      }
    }

    // Preview first 500 chars for text/html
    summary.preview = trimmed.length > 500 ? trimmed.substring(0, 500) + '...' : trimmed;
  }

  return summary;
}

/**
 * Offload large data from tool results and replace with references
 * This prevents large text content from bloating the context window
 * @param {string} toolResult - The tool result (JSON string)
 * @param {string} toolCallId - The tool call ID for generating unique references
 * @param {object} conversationContext - The conversation context to store preserved data
 * @param {number} threshold - Character threshold for offloading (default: 50000)
 * @returns {object} - Modified result for display, full result for LLM, and array of offloaded data references
 */
function offloadLargeData(toolResult, toolCallId, conversationContext, threshold = 50000) {
  const offloadedData = [];

  try {
    const result = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;

    // Ensure dataRefSummaries exists
    if (!conversationContext.dataRefSummaries) {
      conversationContext.dataRefSummaries = {};
    }

    // Recursively scan object for large string fields
    function scanAndReplace(obj, path = '') {
      if (typeof obj === 'string') {
        // Check if string exceeds threshold
        if (obj.length > threshold) {
          const dataId = `data-${toolCallId}-${Date.now()}-${offloadedData.length}`;

          // Store in preserved content
          if (!conversationContext.preservedContent) {
            conversationContext.preservedContent = {};
          }
          conversationContext.preservedContent[dataId] = obj;

          // Generate and store summary
          const summary = generateDataSummary(obj, dataId);
          conversationContext.dataRefSummaries[dataId] = summary;

          offloadedData.push({
            id: dataId,
            size: obj.length,
            path: path,
            summary: summary,
          });

          console.log(`[Data Offload] Offloaded ${obj.length} chars to ${dataId} (path: ${path}, type: ${summary.type})`);

          // Build rich replacement with summary info for LLM
          const structureInfo = summary.type === 'json_array' && summary.structure
            ? `${summary.structure.itemCount} items` + (summary.structure.keys ? `, keys: ${summary.structure.keys.join(', ')}` : '')
            : summary.type === 'json_object' && summary.structure
              ? `keys: ${summary.structure.topLevelKeys.join(', ')}`
              : summary.type === 'html' && summary.structure?.title
                ? `title: "${summary.structure.title}"`
                : '';

          const lines = [
            `[Offloaded data: ${dataId}] (${summary.type}, ${summary.size} chars, ${summary.lineCount} lines${structureInfo ? ', ' + structureInfo : ''})`,
          ];
          if (summary.preview) {
            lines.push(`Preview: ${summary.preview.substring(0, 300).replace(/\n/g, ' ')}`);
          }
          lines.push(`[Use query_data tool with dataId="${dataId}" to search/extract]`);
          lines.push(`Reference: {{DATA_REF:${dataId}}}`);

          return lines.join('\n');
        }
        return obj;
      } else if (Array.isArray(obj)) {
        return obj.map((item, index) => scanAndReplace(item, `${path}[${index}]`));
      } else if (obj !== null && typeof obj === 'object') {
        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
          newObj[key] = scanAndReplace(value, path ? `${path}.${key}` : key);
        }
        return newObj;
      }
      return obj;
    }

    const modifiedResult = scanAndReplace(result);

    return {
      modifiedResult: JSON.stringify(modifiedResult),
      offloadedData: offloadedData,
    };
  } catch (e) {
    // If parsing fails, return original
    console.warn('[Data Offload] Failed to parse tool result for offloading:', e.message);
    return {
      modifiedResult: toolResult,
      offloadedData: [],
    };
  }
}

/**
 * REMOVED: isAsyncTool() function
 * Async execution is now determined by the _executeAsync parameter in tool arguments
 * ANY tool can be run async by the LLM adding: _executeAsync: true, _estimatedMinutes: N
 */

/**
 * Process uploaded files and extract text content
 */
async function processUploadedFiles(files) {
  let fileContext = '';
  const imageData = [];

  if (!files || files.length === 0) {
    return { fileContext, imageData };
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileBuffer = file.buffer;
    const fileType = file.mimetype;
    let textContent = '';

    if (fileType.startsWith('image/')) {
      // Handle images - store for vision models
      // DO NOT add placeholder text to fileContext - images are handled separately
      imageData.push({
        type: fileType,
        data: fileBuffer.toString('base64'),
        filename: file.originalname,
      });
      console.log(`[Vision] Prepared image for vision model: ${file.originalname} (${fileType})`);
      continue; // Skip adding to fileContext
    } else {
      // Process text-based files
      try {
        switch (fileType) {
          case 'application/pdf':
            textContent = await getRawTextFromPDFBuffer(fileBuffer);
            break;
          case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
            textContent = await getRawTextFromDocxBuffer(fileBuffer);
            break;
          case 'text/plain':
          case 'text/csv':
          case 'text/markdown':
          case 'application/json':
          case 'text/javascript':
          case 'text/html':
          case 'text/css':
          case 'application/octet-stream':
            textContent = fileBuffer.toString('utf-8');
            break;
          default:
            textContent = `[Unsupported file type: ${fileType}]`;
        }
      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        textContent = `[Error processing file: ${file.originalname}]`;
      }
    }

    fileContext += `\n\n[FILE ${i + 1}/${files.length}: ${file.originalname}]\n${textContent}\n`;
  }

  return { fileContext, imageData };
}

/**
 * Universal chat handler that replaces all the duplicate chat handlers
 * Supports: orchestrator, agent, workflow, tool, goal, and suggestions
 */
async function universalChatHandler(req, res, context = {}) {
  const userId = req.user?.id || null;
  const authToken = req.headers.authorization;
  const files = req.files || []; // Multer files

  // Detect chat type and get configuration
  const chatType = detectChatType(req, context);
  const config = getChatConfig(chatType);

  log(`Universal chat handler: ${chatType}`, { userId, chatType });

  // Handle suggestions differently (JSON response)
  if (chatType === 'suggestions') {
    return handleSuggestions(req, res, config, userId, authToken);
  }

  // Extract common parameters
  const {
    messages: originalMessages,
    message,
    history = [],
    conversationId: inputConversationId = null,
    provider,
    model: inputModel,
    // Context-specific parameters
    agentId,
    agentContext,
    agentState,
    workflowId,
    workflowContext,
    workflowState,
    toolId,
    toolContext,
    toolState,
    widgetId,
    widgetContext,
    widgetState,
    goalId,
    goalContext,
    reasoningEnabled: rawReasoningEnabled,
    enabledTools: rawEnabledTools,
  } = req.body;

  // Normalize reasoningEnabled (FormData sends strings, JSON sends booleans)
  const reasoningEnabled = rawReasoningEnabled === true || rawReasoningEnabled === 'true';

  // Resolve provider/model: request body → agent config → user defaults
  let resolvedProvider = provider;
  let resolvedModel = inputModel;

  if (!resolvedProvider || !resolvedModel) {
    // Try agent's own config (when chatting with a specific agent)
    if (agentId && agentId !== 'agent-chat') {
      try {
        const agent = await AgentModel.findOne(agentId);
        if (agent) {
          resolvedProvider = resolvedProvider || agent.provider;
          resolvedModel = resolvedModel || agent.model;
        }
      } catch (e) {
        console.warn(`[Chat] Could not load agent ${agentId} for provider/model fallback:`, e.message);
      }
    }

    // Fall back to user's default settings
    if (!resolvedProvider || !resolvedModel) {
      try {
        const userSettings = await UserModel.getUserSettings(userId);
        resolvedProvider = resolvedProvider || userSettings.selectedProvider;
        resolvedModel = resolvedModel || userSettings.selectedModel;
      } catch (e) {
        console.warn('[Chat] Could not load user settings for provider/model fallback:', e.message);
      }
    }
  }

  // Last resort: fallback to first provider with valid credentials
  if (!resolvedProvider || !resolvedModel) {
    try {
      const providerKeys = Object.keys(ProviderRegistry.PROVIDER_CAPABILITIES);
      for (const providerKey of providerKeys) {
        try {
          const apiKey = await AuthManager._getApiKey(userId, providerKey);
          if (apiKey) {
            const textModels = ProviderRegistry.getTextModels(providerKey);
            if (textModels.length > 0) {
              resolvedProvider = resolvedProvider || providerKey;
              resolvedModel = resolvedModel || textModels[0];
              console.log(`[Chat] Auto-fallback to provider: ${resolvedProvider}, model: ${resolvedModel}`);
              break;
            }
          }
        } catch (e) {
          // Skip this provider, try next
        }
      }
    } catch (e) {
      console.warn('[Chat] Could not auto-detect provider fallback:', e.message);
    }
  }

  if (!resolvedProvider || !resolvedModel) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({ error: 'Could not determine AI provider/model. Please select a provider in settings.' });
  }

  // CRITICAL: Normalize provider to lowercase to ensure consistent handling
  const normalizedProvider = resolvedProvider.toLowerCase();
  let model = resolvedModel;



  // Keep DB in sync with the provider/model the frontend is actually using,
  // so background processes (InsightEngine, etc.) always have current values.
  UserModel.updateUserSettings(userId, {
    selectedProvider: resolvedProvider,
    selectedModel: model,
  }).catch(e => {
    console.warn('[Chat] Failed to sync provider/model to DB (non-critical):', e.message);
  });

  // Validate message input (different formats for different handlers)
  const messageInput = originalMessages || (message ? [...history, { role: 'user', content: message }] : null);
  if (!messageInput) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({ error: 'Messages or message with history are required in the request body.' });
  }

  // Set up streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Abort controller for cancelling LLM streams when client disconnects
  const streamAbortController = new AbortController();
  let isClientDisconnected = false;

  // Use res.on('close') — fires when the *response* connection is closed by the client.
  // req.on('close') can fire prematurely once the request body is consumed.
  res.on('close', () => {
    if (!res.writableFinished) {
      isClientDisconnected = true;
      streamAbortController.abort();
      console.log(`[Stream Abort] Client disconnected during ${chatType} chat, aborting LLM stream`);
    }
  });

  const rawSendEvent = (eventName, data) => {
    if (isClientDisconnected) return;
    try {
      // Send via SSE (Server-Sent Events) to current client
      res.write(`event: ${eventName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      console.error('Error writing to stream, client likely disconnected', e);
    }

    // Broadcast via Socket.IO to all user's connected clients (real-time sync across tabs)
    if (userId) {
      // Map SSE event names to Socket.IO event names for chat events
      const chatEventMappings = {
        'assistant_message': RealtimeEvents.CHAT_MESSAGE_START,
        'content_delta': RealtimeEvents.CHAT_CONTENT_DELTA,
        'tool_start': RealtimeEvents.CHAT_TOOL_START,
        'tool_end': RealtimeEvents.CHAT_TOOL_END,
        'done': RealtimeEvents.CHAT_MESSAGE_END,
      };

      const socketEvent = chatEventMappings[eventName];
      if (socketEvent) {
        broadcastToUser(userId, socketEvent, {
          ...data,
          conversationId,
          chatType,
          timestamp: Date.now(),
        });
      }
    }
  };

  // Generate conversation ID
  const isNewConversation = !inputConversationId;
  const conversationId = inputConversationId || randomUUID();

  // --- unfirehose/1.0 integration ---
  let sendEvent = rawSendEvent;
  let unfirehoseSession = null;
  if (isUnfirehoseEnabled()) {
    try {
      const firstPrompt = message || (originalMessages && originalMessages[originalMessages.length - 1]?.content);
      unfirehoseSession = createUnfirehoseSession({
        conversationId,
        provider: normalizedProvider,
        model,
        chatType,
        firstPrompt: typeof firstPrompt === 'string' ? firstPrompt : String(firstPrompt || ''),
      });
      sendEvent = wrapUnfirehoseSendEvent(unfirehoseSession, rawSendEvent);
      console.log(`[unfirehose] Session ${conversationId} → ${unfirehoseSession.outputFile}`);
    } catch (ufErr) {
      console.error('[unfirehose] Failed to initialize session:', ufErr.message);
    }
  }

  sendEvent('conversation_started', { conversationId });

  // Variables for logging
  let messages = [];
  const allToolCallsForLogging = [];
  let finalContentForLogging = '';
  let streamErrorForLogging = null;

  // Agent execution tracking
  let agentExecutionId = null;
  let toolCallsCount = 0;
  const executionStartTime = Date.now();
  const toolExecutionIds = new Map(); // Map toolCallId -> toolExecutionId

  // Extract latest user message text for tool selection keyword matching
  const latestUserMessage = (() => {
    if (message && typeof message === 'string') return message;
    if (messageInput && messageInput.length > 0) {
      for (let i = messageInput.length - 1; i >= 0; i--) {
        const msg = messageInput[i];
        if (msg && msg.role === 'user' && typeof msg.content === 'string') {
          return msg.content;
        }
      }
    }
    return '';
  })();

  // Initialize conversation context
  const conversationContext = {
    preservedContent: {},
    dataRefSummaries: {},
    llmClient: null,
    openai: null,
    // Context-specific data
    agentId,
    agentContext,
    agentState,
    workflowId,
    workflowContext,
    workflowState,
    toolId,
    toolContext,
    toolState,
    widgetId,
    widgetContext,
    widgetState,
    goalId,
    goalContext,
    userId,
    conversationId,
    // Latest user message text (for dynamic tool selection)
    latestUserMessage,
    // User-selected enabled tools from frontend tool selector
    enabledTools: (() => {
      if (!rawEnabledTools) return null;
      try {
        const parsed = typeof rawEnabledTools === 'string' ? JSON.parse(rawEnabledTools) : rawEnabledTools;
        return Array.isArray(parsed) && parsed.length > 0 ? new Set(parsed) : null;
      } catch { return null; }
    })(),
    // AI provider settings
    provider: resolvedProvider,
    model,
    normalizedProvider,
    // Abort signal for cancelling LLM streams
    abortSignal: streamAbortController.signal,
    // Track activated skills for this session (Agent Skills standard - progressive disclosure)
    activatedSkills: new Set(),
  };

  // Token usage accumulator — tracks real LLM token consumption across all rounds
  // Declared before try/catch so it's accessible in the finally block
  const tokenAccumulator = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  try {
    // Process uploaded files
    const { fileContext, imageData } = await processUploadedFiles(files);

    // Send file processing event if files were uploaded
    if (files.length > 0) {
      sendEvent('files_processed', {
        fileCount: files.length,
        hasImages: imageData.length > 0,
        fileNames: files.map((f) => f.originalname),
      });
    }

    // Create agent execution record for tracking in Runs screen (non-blocking)
    // Track all chat types except suggestions (agent, orchestrator, workflow, goal, tool)
    // This DB write does NOT need to complete before streaming starts — fire and resolve in background
    const agentExecutionPromise = (chatType !== 'suggestions' && userId)
      ? (async () => {
          try {
            const initialPromptText = message || (originalMessages && originalMessages[originalMessages.length - 1]?.content) || '';
            const agentNameForExecution = agentContext?.name || (chatType === 'agent' ? 'Agent Chat' : chatType === 'orchestrator' ? 'Orchestrator' : chatType.charAt(0).toUpperCase() + chatType.slice(1));

            const execId = await AgentExecutionModel.create(
              userId,
              agentId || null,
              agentNameForExecution,
              conversationId,
              typeof initialPromptText === 'string' ? initialPromptText.substring(0, 500) : String(initialPromptText).substring(0, 500),
              resolvedProvider,
              model,
              'running'
            );

            agentExecutionId = execId;

            sendEvent('agent_execution_started', {
              executionId: agentExecutionId,
              agentName: agentNameForExecution,
              chatType,
            });

            console.log(`[Agent Execution] Created execution ${agentExecutionId} for ${chatType} chat`);
          } catch (execError) {
            console.error('[Agent Execution] Failed to create execution record:', execError);
          }
        })()
      : Promise.resolve();

    const client = await createLlmClient(normalizedProvider, userId, { conversationId, authToken });
    const adapter = await createLlmAdapter(normalizedProvider, client, model, { reasoningEnabled });

    // Store client in context
    conversationContext.llmClient = client;
    if (normalizedProvider === 'openai' || normalizedProvider === 'openai-codex' || normalizedProvider === 'openai-codex') {
      conversationContext.openai = client;
    }

    // Store image data in context for vision models
    if (imageData.length > 0) {
      conversationContext.imageData = imageData;
    }

    // Get tool schemas for this chat type
    const toolSchemas = await config.getToolSchemas(conversationContext);

    // CRITICAL: Check if model supports vision when images are uploaded
    let modelSupportsVision = false;
    if (imageData.length > 0) {
      const ProviderRegistry = await import('./ai/ProviderRegistry.js');
      const visionModels = ProviderRegistry.getVisionModels(normalizedProvider);
      modelSupportsVision = visionModels.includes(model);

      if (!modelSupportsVision) {
        console.warn(`[Vision Check] Model '${model}' does not support vision, but ${imageData.length} image(s) were uploaded.`);
        console.warn(`[Vision Check] Will inject system message to force analyze_image tool use.`);
      }
    }

    // Build system prompt
    const currentDate = new Date().toString();
    let systemPrompt = await config.buildSystemPrompt(currentDate, {
      ...conversationContext,
      toolSchemas,
    });

    // Prepare messages - filter out any corrupted messages first, then clone
    messages = messageInput
      .filter((msg) => msg && msg.role && msg.content !== undefined)
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
        name: msg.name,
        tool_calls: msg.tool_calls,
        tool_call_id: msg.tool_call_id,
      }));

    // Broadcast user message to all connected tabs (real-time sync)
    if (userId && messages.length > 0) {
      const lastUserMessage = messages[messages.length - 1];
      if (lastUserMessage && lastUserMessage.role === 'user') {
        broadcastToUser(userId, RealtimeEvents.CHAT_USER_MESSAGE, {
          conversationId,
          chatType,
          message: lastUserMessage,
          timestamp: Date.now(),
        });
      }
    }

    // Log the latest user message to unfirehose
    if (unfirehoseSession) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg) {
        unfirehoseSession.logUserMessage(lastUserMsg.content);
      }
    }

    // Add file context to the first user message if files were uploaded
    // Images are handled separately via vision API
    if (fileContext.trim()) {
      const firstUserMsgIndex = messages.findIndex((m) => m.role === 'user');
      if (firstUserMsgIndex !== -1) {
        messages[firstUserMsgIndex].content = `${fileContext}\n\n${messages[firstUserMsgIndex].content}`;
      }
    }

    // Log vision context if images are present
    if (imageData.length > 0) {
      console.log(`[Vision] Prepared ${imageData.length} image(s) for vision model processing`);
    }

    // Add or update system message
    const systemMessageIndex = messages.findIndex((m) => m.role === 'system');
    if (systemMessageIndex !== -1) {
      messages[systemMessageIndex].content = `${systemPrompt}\n\n${messages[systemMessageIndex].content}`;
    } else {
      messages.unshift({ role: 'system', content: systemPrompt });
    }

    // Resolve agent metadata for @ mention responses (avatar + name for SSE event)
    let agentMeta = {};
    if (chatType === 'agent' && agentId && agentId !== 'agent-chat') {
      try {
        const agent = agentContext?.name
          ? { name: agentContext.name, icon: agentContext.icon || null }
          : await (async () => {
              const AgentModel = (await import('../models/AgentModel.js')).default;
              const a = await AgentModel.findOne(agentId);
              return a ? { name: a.name, icon: a.icon || null } : null;
            })();
        if (agent) {
          agentMeta = { agentName: agent.name, agentIcon: agent.icon || null };
        }
      } catch (e) {
        console.warn('[Chat] Failed to resolve agent metadata for message:', e.message);
      }
    }

    // When an @ mentioned agent responds in an existing conversation, the history
    // contains messages from the orchestrator (Annie). Inject a strong identity
    // override right before the last user message so the LLM doesn't continue as Annie.
    if (chatType === 'agent' && agentId && agentId !== 'agent-chat') {
      const agentName = agentMeta.agentName || 'the requested agent';
      const lastUserIdx = messages.length - 1;
      if (lastUserIdx > 0 && messages[lastUserIdx].role === 'user') {
        messages.splice(lastUserIdx, 0, {
          role: 'system',
          content: `[Identity Switch] The user has @mentioned ${agentName}. You MUST respond as ${agentName} — NOT as Annie or any other assistant. Use ${agentName}'s personality, knowledge, and capabilities. Do not reference Annie or claim to be a different agent.`,
        });
      }
    }

    // CRITICAL: If images were uploaded but model doesn't support vision, inject a system message
    // that FORCES the LLM to use the analyze_image tool
    if (imageData.length > 0 && !modelSupportsVision) {
      const imageFileNames = imageData.map((img) => img.filename).join(', ');
      const forceAnalyzeImageMessage = {
        role: 'system',
        content: `🚨 CRITICAL INSTRUCTION 🚨
The user has uploaded ${imageData.length} image(s): ${imageFileNames}

Your current model (${model}) DOES NOT support vision/image analysis directly.

YOU MUST use the 'analyze_image' tool to analyze these images. DO NOT try to respond without using this tool first.

The analyze_image tool accepts:
- prompt: Your question or instruction about the image (e.g., "What's in this image?", "Describe this image", "Extract text from this image")
- provider: AI provider to use (default: 'openai')
- model: Vision model to use (default: 'gpt-4o-mini')

Example tool call:
{
  "prompt": "What is shown in this image?",
  "provider": "openai",
  "model": "gpt-4o-mini"
}

IMPORTANT: The image data is already available in the system context. You don't need to provide the image data yourself - just call the analyze_image tool with your prompt.`,
      };

      messages.push(forceAnalyzeImageMessage);
      console.log(`[Vision Check] Injected system message to force analyze_image tool use for ${imageData.length} image(s)`);
    }

    // Deduplicate tools by name
    const uniqueToolMap = new Map();
    for (const tool of toolSchemas) {
      if (!uniqueToolMap.has(tool.function.name)) {
        uniqueToolMap.set(tool.function.name, tool);
      }
    }
    let finalToolSchemas = Array.from(uniqueToolMap.values());

    // Generate assistant message ID early (needed for image extraction events)
    const assistantMessageId = `msg-asst-${Date.now()}`;

    // CRITICAL: Sanitize message history to extract embedded images
    // This prevents images from previous conversations from bloating the context window
    const { sanitizedMessages, extractedImages } = sanitizeMessageHistory(messages);
    messages = sanitizedMessages;

    // Send extracted images via SSE events
    if (extractedImages.length > 0) {
      console.log(`[Message Sanitization] Extracted ${extractedImages.length} image(s) from message history`);
      extractedImages.forEach((image) => {
        sendEvent('image_generated', {
          assistantMessageId: image.messageId || assistantMessageId,
          imageId: image.id,
          imageData: image.data,
          index: image.index,
        });
      });
    }

    // Apply context management
    const contextResult = manageContext(messages, model, finalToolSchemas, normalizedProvider);

    // Send context status
    sendEvent('context_status', {
      currentTokens: contextResult.managedTokens,
      tokenLimit: contextResult.contextWindow,
      utilizationPercent: (contextResult.managedTokens / contextResult.contextWindow) * 100,
      model: model,
      messagesCount: contextResult.messages.length,
    });

    if (contextResult.wasManaged) {
      console.log(`Context automatically managed: ${contextResult.originalTokens} -> ${contextResult.managedTokens} tokens`);
      sendEvent('context_managed', {
        originalTokens: contextResult.originalTokens,
        managedTokens: contextResult.managedTokens,
        tokenLimit: contextResult.tokenLimit,
        reduction: contextResult.originalTokens - contextResult.managedTokens,
        strategy: 'automatic_truncation',
      });
    }

    /**
     * Normalize and accumulate token usage from any provider format
     */
    function accumulateUsage(usage) {
      if (!usage) return;
      const input = usage.prompt_tokens || usage.input_tokens || 0;
      const output = usage.completion_tokens || usage.output_tokens || 0;
      tokenAccumulator.inputTokens += input;
      tokenAccumulator.outputTokens += output;
      tokenAccumulator.totalTokens += input + output;
    }

    // Send initial assistant message
    sendEvent('assistant_message', {
      id: assistantMessageId,
      assistantMessageId, // Also include for Socket.IO broadcast consistency
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: Date.now(),
      ...agentMeta,
    });

    let { responseMessage, toolCalls, toolCallError, invalidToolCalls, toolsSkipped, toolsSkippedReason, recoveredFromError, recoveredError, usage: initialUsage } = await adapter.callStream(
      contextResult.messages,
      finalToolSchemas,
      (chunk) => {
        // Handle streaming chunks
        if (chunk.type === 'content') {
          sendEvent('content_delta', {
            assistantMessageId,
            delta: chunk.delta,
            accumulated: chunk.accumulated,
          });
        } else if (chunk.type === 'reasoning') {
          sendEvent('reasoning_delta', {
            assistantMessageId,
            delta: chunk.delta,
            accumulated: chunk.accumulated,
          });
        } else if (chunk.type === 'tool_call_delta') {
          // Optionally send tool call progress updates
          // For now, we'll wait until tool calls are complete
        }
      },
      conversationContext // Pass context for vision image handling
    );
    accumulateUsage(initialUsage);

    // Handle API errors that the adapter recovered from (401, 429, etc.)
    if (recoveredFromError) {
      console.warn(`[OrchestratorService] LLM adapter recovered from error: ${recoveredError}`);
      const rawContent = responseMessage?.content;
      const errorContent = (typeof rawContent === 'string' && rawContent)
        || `API Error: ${typeof recoveredError === 'string' ? recoveredError : String(recoveredError)}`;
      // Send as content_delta to fill the existing empty assistant message bubble
      sendEvent('content_delta', {
        assistantMessageId,
        delta: errorContent,
        accumulated: errorContent,
      });
    }

    // Handle tools being skipped (model doesn't support function calling)
    if (toolsSkipped) {
      console.log(`[OrchestratorService] Tools were skipped: ${toolsSkippedReason}`);
      sendEvent('tools_skipped', {
        assistantMessageId,
        reason: toolsSkippedReason,
        message: `⚠️ ${toolsSkippedReason}`,
      });
    }

    // Handle invalid tool calls
    if (invalidToolCalls && invalidToolCalls.length > 0) {
      console.warn('Invalid tool calls detected and filtered out:', invalidToolCalls);
      sendEvent('invalid_tool_calls', {
        assistantMessageId,
        invalidToolCalls: invalidToolCalls.map(({ toolCall, issues }) => ({
          toolName: toolCall.function?.name || 'unknown',
          issues: issues,
          attemptedArgs: toolCall.function?.arguments,
        })),
        message: 'Some tool calls were malformed and have been filtered out. The system will continue with valid tool calls only.',
      });

      // Log invalid tool calls for debugging
      allToolCallsForLogging.push({
        type: 'invalid_tool_calls',
        count: invalidToolCalls.length,
        details: invalidToolCalls,
      });
    }

    // Handle tool call errors
    if (toolCallError) {
      console.warn('Tool call error detected, retrying with context:', toolCallError);
      sendEvent('tool_error', {
        error: 'Tool call error: ' + toolCallError.message,
        details: toolCallError.details,
        continuing: true,
        retrying: true,
      });

      if (!toolCalls || toolCalls.length === 0) {
        console.log('Tool call error handled by adapter, continuing with recovery response');
      }
    }

    messages.push(responseMessage);

    // Ensure agent execution record is ready before tool loop needs it
    await agentExecutionPromise;

    // Tool execution loop - LLM decides when to stop
    let currentRound = 0;
    const toolExecutionDetails = [];

    while (toolCalls && toolCalls.length > 0 && currentRound < config.maxToolRounds && !isClientDisconnected) {
      currentRound++;
      console.log(`[Tool Loop] Round ${currentRound}: Executing ${toolCalls.length} tool(s)`);

      const toolPromises = toolCalls.map(async (toolCall) => {
        const functionName = toolCall.function.name;
        let functionArgs;
        let toolCallError = null;

        try {
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          toolCallError = `Failed to parse tool arguments: ${parseError.message}`;
          console.error(`Tool argument parsing failed for ${functionName}:`, toolCall.function.arguments, parseError);

          sendEvent('tool_end', { assistantMessageId, toolCall: { id: toolCall.id, error: toolCallError } });

          return {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: JSON.stringify({
              success: false,
              error: toolCallError,
              recoverable: true,
              suggestion: `Please check the parameters for ${functionName} and try again.`,
            }),
          };
        }

        let functionResponseContent;
        let toolCallResult = null;

        sendEvent('tool_start', { assistantMessageId, toolCall: { id: toolCall.id, name: functionName, args: functionArgs } });

        // Track tool execution start
        let currentToolExecutionId = null;
        if (agentExecutionId) {
          try {
            currentToolExecutionId = await AgentExecutionModel.createToolExecution(
              agentExecutionId,
              functionName,
              toolCall.id,
              functionArgs
            );
            toolExecutionIds.set(toolCall.id, currentToolExecutionId);
            toolCallsCount++;
          } catch (toolExecError) {
            console.error('[Agent Execution] Failed to create tool execution record:', toolExecError);
          }
        }

        // CHECK IF LLM REQUESTED ASYNC EXECUTION via _executeAsync parameter
        const shouldExecuteAsync = functionArgs._executeAsync === true;
        const estimatedMinutes = functionArgs._estimatedMinutes || null;

        // Pass raw args to AsyncToolQueue - it strips control params internally
        // For sync execution, strip them here
        const cleanArgs = { ...functionArgs };
        delete cleanArgs._executeAsync;
        delete cleanArgs._estimatedMinutes;
        delete cleanArgs._interval;
        delete cleanArgs._stopAfter;
        delete cleanArgs._duration;

        // Preserved before offloading to avoid DATA_REF placeholders in frontend events
        let preservedFrontendEvents = null;

        if (shouldExecuteAsync) {
          console.log(`[AsyncTool] ${chatType === 'agent' ? 'Agent' : 'Orchestrator'} requested async execution for: ${functionName}`);

          const estimatedDuration = estimatedMinutes ? estimatedMinutes * 60 * 1000 : null;

          // Queue the async tool for background execution
          const executionId = asyncToolQueue.enqueue(
            toolCall.id,
            conversationId,
            userId,
            functionName,
            functionArgs, // Pass raw args - AsyncToolQueue strips control params internally
            assistantMessageId, // Pass message ID for frontend status updates
            {
              onProgress: async (progressData, execution) => {
                // Trigger autonomous message for progress update
                await autonomousMessageService.triggerToolProgress(conversationId, {
                  toolCallId: toolCall.id,
                  functionName,
                  progress: progressData,
                  executionId: execution.executionId,
                });
              },
              onComplete: async (result, execution) => {
                // Trigger autonomous message for completion
                await autonomousMessageService.triggerToolCompletion(conversationId, {
                  toolCallId: toolCall.id,
                  functionName,
                  result,
                  executionId: execution.executionId,
                  duration: execution.completedAt - execution.startedAt,
                });
              },
              onError: async (error, execution) => {
                // Trigger autonomous message for error
                await autonomousMessageService.triggerToolFailure(conversationId, {
                  toolCallId: toolCall.id,
                  functionName,
                  error: error.message || String(error),
                  executionId: execution.executionId,
                });
              },
            },
            // Execute function wrapper - routes to correct executor based on chatType
            async (args, onProgress) => {
              console.log(`[AsyncTool] Executing ${functionName} for ${chatType} chat`);

              // Route to correct tool executor based on chat type
              if (chatType === 'agent') {
                const isAgentManagement = conversationContext.agentId === 'agent-chat';
                if (isAgentManagement) {
                  return await executeAgentTool(functionName, args, authToken, conversationContext);
                } else {
                  return await executeTool(functionName, args, authToken, conversationContext);
                }
              } else if (chatType === 'workflow') {
                return await executeWorkflowTool(functionName, args, authToken, conversationContext);
              } else if (chatType === 'goal') {
                return await executeGoalTool(functionName, args, authToken, conversationContext);
              } else if (chatType === 'tool') {
                return await executeToolFunction(functionName, args, authToken, conversationContext);
              } else if (chatType === 'widget') {
                return await executeWidgetFunction(functionName, args, authToken, conversationContext);
              } else if (chatType === 'artifact') {
                return await executeCodeFunction(functionName, args);
              } else {
                // Default to orchestrator tools
                return await executeTool(functionName, args, authToken, conversationContext);
              }
            }
          );

          // Return immediate response indicating tool was queued
          const asyncResult = {
            success: true,
            status: 'queued',
            executionId,
            message: `${functionName} started in the background. You'll receive updates as it progresses.`,
            estimatedDuration,
          };

          functionResponseContent = JSON.stringify(asyncResult);
          toolCallResult = asyncResult; // Set the parsed result for tool_end event

          console.log(`[AsyncTool] Queued ${functionName} with execution ID ${executionId} (${chatType} chat)`);
        } else {
          // SYNCHRONOUS TOOL EXECUTION (existing behavior)
          try {
            // Execute tool based on chat type
            let rawFunctionResponse;

            if (chatType === 'agent') {
            // Check if this is agent management chat (AgentForge) or chatting WITH an agent
            const isAgentManagement = conversationContext.agentId === 'agent-chat';

            if (isAgentManagement) {
              // Agent management uses AGENT_TOOLS (generate_agent, modify_agent, etc.)
              rawFunctionResponse = await executeAgentTool(functionName, functionArgs, authToken, conversationContext);
            } else {
              // Chatting with a specific agent uses orchestrator tools
              rawFunctionResponse = await executeTool(functionName, functionArgs, authToken, conversationContext);
            }
          } else if (chatType === 'workflow') {
            rawFunctionResponse = await executeWorkflowTool(functionName, functionArgs, authToken, conversationContext);
          } else if (chatType === 'goal') {
            rawFunctionResponse = await executeGoalTool(functionName, functionArgs, authToken, conversationContext);
          } else if (chatType === 'tool') {
            rawFunctionResponse = await executeToolFunction(functionName, functionArgs, authToken, conversationContext);
          } else if (chatType === 'widget') {
            rawFunctionResponse = await executeWidgetFunction(functionName, functionArgs, authToken, conversationContext);
          } else if (chatType === 'artifact') {
            rawFunctionResponse = await executeCodeFunction(functionName, functionArgs);
          } else {
            // Default to orchestrator tools
            rawFunctionResponse = await executeTool(functionName, functionArgs, authToken, conversationContext);
          }

          functionResponseContent = rawFunctionResponse;

          // Preserve frontend events before any offloading/truncation mangles the content
          // Then strip them from functionResponseContent — they contain full source_code
          // which bloats LLM context and gets corrupted by DATA_REF offloading
          try {
            const rawParsed = JSON.parse(rawFunctionResponse);
            if (rawParsed && rawParsed.frontendEvents) {
              preservedFrontendEvents = rawParsed.frontendEvents;
              delete rawParsed.frontendEvents;
              functionResponseContent = JSON.stringify(rawParsed);
            }
          } catch { /* ignore parse errors — will be handled later */ }

          // Extract and replace images to prevent context window overflow
          const { modifiedResult, images } = extractAndReplaceImages(functionResponseContent, toolCall.id);
          if (images.length > 0) {
            console.log(`Extracted ${images.length} image(s) from ${functionName} tool result`);
            functionResponseContent = modifiedResult;

            // Send images via SSE events
            images.forEach((image) => {
              sendEvent('image_generated', {
                assistantMessageId,
                toolCallId: toolCall.id,
                imageId: image.id,
                imageData: image.data,
                index: image.index,
              });
            });
          }

          // Offload large data to prevent context window overflow
          // Skip for artifact chat — the LLM needs full file content for edit_file search strings
          const skipOffload = chatType === 'artifact';
          const { modifiedResult: dataOffloadedResult, offloadedData } = skipOffload
            ? { modifiedResult: functionResponseContent, offloadedData: [] }
            : offloadLargeData(
              functionResponseContent,
              toolCall.id,
              conversationContext,
              50000 // 50000 character threshold - only very large content gets offloaded
            );
          if (offloadedData.length > 0) {
            console.log(`[Data Offload] Offloaded ${offloadedData.length} large data field(s) from ${functionName} tool result`);

            // Send full content to frontend for display, but use offloaded version for LLM context
            // This way the user can see the full content, but LLM doesn't get overwhelmed
            offloadedData.forEach((data) => {
              const fullContent = conversationContext.preservedContent[data.id];
              sendEvent('data_content', {
                assistantMessageId,
                toolCallId: toolCall.id,
                dataId: data.id,
                fullContent: fullContent,
                size: data.size,
                path: data.path,
                summary: data.summary || null,
              });
            });

            functionResponseContent = dataOffloadedResult;

            // Send data offload notification
            sendEvent('data_offloaded', {
              assistantMessageId,
              toolCallId: toolCall.id,
              offloadedCount: offloadedData.length,
              totalSize: offloadedData.reduce((sum, d) => sum + d.size, 0),
              message: `Offloaded ${offloadedData.length} large data field(s) to prevent context bloat`,
            });
          }

          // Hard cap on tool result size to prevent context window overflow
          // Even after data offloading, some tools return massive results with many sub-50k fields
          // Skip for artifact chat — LLM needs full file content for accurate edits
          const MAX_TOOL_RESULT_CHARS = 100000; // ~28k tokens
          if (!skipOffload && functionResponseContent.length > MAX_TOOL_RESULT_CHARS) {
            console.log(`[Context Protection] Tool ${functionName} result too large (${functionResponseContent.length} chars), truncating to ${MAX_TOOL_RESULT_CHARS}`);
            try {
              const parsed = JSON.parse(functionResponseContent);
              // Try to create a meaningful summary
              if (parsed.success !== undefined && parsed.result) {
                // For array results, keep count and first few items
                if (Array.isArray(parsed.result)) {
                  const summary = {
                    ...parsed,
                    result: parsed.result.slice(0, 10),
                    _truncated: true,
                    _total_count: parsed.result.length,
                    _note: `Showing first 10 of ${parsed.result.length} items. Full data was sent to the frontend.`,
                  };
                  functionResponseContent = JSON.stringify(summary);
                } else {
                  // For object results, stringify and truncate
                  functionResponseContent = functionResponseContent.substring(0, MAX_TOOL_RESULT_CHARS - 200) +
                    '\n\n[Content truncated - full data sent to frontend. Total size: ' + functionResponseContent.length + ' chars]';
                }
              } else {
                functionResponseContent = functionResponseContent.substring(0, MAX_TOOL_RESULT_CHARS - 200) +
                  '\n\n[Content truncated - full data sent to frontend. Total size: ' + functionResponseContent.length + ' chars]';
              }
            } catch {
              functionResponseContent = functionResponseContent.substring(0, MAX_TOOL_RESULT_CHARS - 200) +
                '\n\n[Content truncated - full data sent to frontend. Total size: ' + functionResponseContent.length + ' chars]';
            }
            console.log(`[Context Protection] Truncated ${functionName} result to ${functionResponseContent.length} chars`);
          }

          // Parse and validate response
          try {
            toolCallResult = JSON.parse(functionResponseContent);

            if (toolCallResult && toolCallResult.success === false) {
              toolCallError = toolCallResult.error || 'Tool execution returned failure status';
              console.warn(`Tool ${functionName} returned failure:`, toolCallError);
            }
          } catch (parseError) {
            toolCallError = `Failed to parse tool response: ${parseError.message}`;
            console.error(`Tool response parsing failed for ${functionName}:`, parseError);

            // Enhanced recovery strategies (from streamHandler)
            let recoveredContent = null;

            try {
              const cleanedContent = functionResponseContent.replace(/[\x00-\x1F\x7F]/g, (match) => {
                const charCode = match.charCodeAt(0);
                switch (charCode) {
                  case 9:
                  case 10:
                  case 13:
                    return ' ';
                  default:
                    return '';
                }
              });

              recoveredContent = JSON.parse(cleanedContent);
              console.log(`Tool ${functionName} response recovered by removing control characters`);
            } catch (cleanError) {
              try {
                const jsonMatch = functionResponseContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const extractedJson = jsonMatch[0].replace(/[\x00-\x1F\x7F]/g, (match) => {
                    const charCode = match.charCodeAt(0);
                    switch (charCode) {
                      case 9:
                      case 10:
                      case 13:
                        return ' ';
                      default:
                        return '';
                    }
                  });
                  recoveredContent = JSON.parse(extractedJson);
                  console.log(`Tool ${functionName} response recovered by extracting JSON`);
                }
              } catch (extractError) {
                console.log(`Tool ${functionName} response could not be recovered, creating safe wrapper`);
              }
            }

            if (recoveredContent) {
              toolCallResult = recoveredContent;
              functionResponseContent = JSON.stringify(recoveredContent);
              toolCallError = null;
            } else {
              const safeRawOutput =
                functionResponseContent.length > 1000
                  ? functionResponseContent.substring(0, 1000) + '...[truncated for safety]'
                  : functionResponseContent;

              toolCallResult = {
                success: false,
                error: 'Tool response contained malformed JSON that could not be recovered',
                parse_error: parseError.message,
                raw_output_preview: safeRawOutput.replace(/[\x00-\x1F\x7F]/g, ''),
                recoverable: true,
                suggestion: `The ${functionName} tool returned malformed JSON. The system attempted recovery but was unable to parse the response. The task will continue with this error noted.`,
                recovery_attempted: true,
              };

              functionResponseContent = JSON.stringify(toolCallResult);
              console.log(`Tool ${functionName} response wrapped safely after failed recovery attempts`);
            }
          }
          } catch (executionError) {
            toolCallError = `Tool execution failed: ${executionError.message}`;
            console.error(`Tool execution error for ${functionName}:`, executionError);

            toolCallResult = {
              success: false,
              error: toolCallError,
              recoverable: true,
              suggestion: `The ${functionName} tool encountered an error. You may want to try a different approach or check the parameters.`,
            };
            functionResponseContent = JSON.stringify(toolCallResult);
          }
        } // End of async/sync tool execution if-else

        // Store execution details
        toolExecutionDetails.push({
          name: functionName,
          arguments: functionArgs,
          response: functionResponseContent,
          result: toolCallResult,
          error: toolCallError,
        });

        allToolCallsForLogging.push({
          name: functionName,
          args: functionArgs,
          result: toolCallResult,
          error: toolCallError,
        });

        // Update tool execution record
        if (currentToolExecutionId) {
          try {
            const toolStatus = toolCallError ? 'failed' : 'completed';
            await AgentExecutionModel.updateToolExecution(
              currentToolExecutionId,
              toolStatus,
              toolCallResult,
              toolCallError,
              0 // credits calculated based on duration
            );
          } catch (toolUpdateError) {
            console.error('[Agent Execution] Failed to update tool execution record:', toolUpdateError);
          }
        }

        // Send frontend events if they exist (for tool chat)
        // Use preserved events (captured before offloading) to avoid DATA_REF placeholders
        const frontendEventsToSend = preservedFrontendEvents || (toolCallResult && toolCallResult.frontendEvents);
        if (frontendEventsToSend) {
          frontendEventsToSend.forEach((event) => {
            sendEvent('frontend_event', {
              assistantMessageId,
              eventType: event.type,
              eventData: event.data,
            });
          });
        }

        // Strip frontendEvents from toolCallResult before tool_end — they are already
        // dispatched via frontend_event SSEs above. Keeping them in tool_end causes
        // double-processing in handleToolAction, and the offloaded/DATA_REF'd versions
        // would overwrite the widget with placeholder strings instead of actual source code.
        if (toolCallResult && toolCallResult.frontendEvents) {
          delete toolCallResult.frontendEvents;
        }

        sendEvent('tool_end', { assistantMessageId, toolCall: { id: toolCall.id, result: toolCallResult, error: toolCallError } });

        return {
          tool_call_id: toolCall.id,
          role: 'tool',
          name: functionName,
          content: functionResponseContent,
        };
      });

      const toolResponses = await Promise.all(toolPromises);
      const formattedToolResponses = adapter.formatToolResults(toolResponses);
      messages.push(...formattedToolResponses);

      // Send tool execution summary for this round
      sendEvent('tool_executions', { assistantMessageId, tool_executions: toolExecutionDetails, round: currentRound });

      // Dynamic tool loading: check if discover_tools requested new categories
      if (conversationContext._requestedToolCategories && conversationContext._requestedToolCategories.size > 0) {
        try {
          const { getToolsForCategories } = await import('./orchestrator/toolSelector.js');
          const allSchemas = await (await import('./orchestrator/tools.js')).getAvailableToolSchemas();
          const newSchemas = getToolsForCategories(allSchemas, conversationContext._requestedToolCategories);
          let addedCount = 0;
          for (const schema of newSchemas) {
            if (!finalToolSchemas.some((s) => s.function?.name === schema.function?.name)) {
              finalToolSchemas.push(schema);
              addedCount++;
            }
          }
          // Track newly loaded groups
          if (!conversationContext._loadedToolGroups) {
            conversationContext._loadedToolGroups = new Set();
          }
          for (const cat of conversationContext._requestedToolCategories) {
            conversationContext._loadedToolGroups.add(cat);
          }
          console.log(`[ToolSelector] Dynamically loaded ${addedCount} new tools from categories: ${[...conversationContext._requestedToolCategories].join(', ')}`);
          conversationContext._requestedToolCategories.clear();
        } catch (dynamicLoadErr) {
          console.error('[ToolSelector] Failed to dynamically load tools:', dynamicLoadErr);
        }
      }

      // Apply context management before next LLM call
      const loopContextResult = manageContext(messages, model, finalToolSchemas, normalizedProvider);
      if (loopContextResult.wasManaged) {
        console.log(`[Tool Loop] Context managed: ${loopContextResult.originalTokens} -> ${loopContextResult.managedTokens} tokens`);
        sendEvent('context_managed', {
          originalTokens: loopContextResult.originalTokens,
          managedTokens: loopContextResult.managedTokens,
          tokenLimit: loopContextResult.tokenLimit,
          round: currentRound,
        });
      }

      // Make next LLM call with streaming to get response to tool results
      console.log(`[Tool Loop] Round ${currentRound}: Calling LLM for response to tool results`);
      const nextResponse = await adapter.callStream(
        loopContextResult.messages,
        finalToolSchemas,
        (chunk) => {
          // Stream content and tool calls in real-time
          if (chunk.type === 'content') {
            sendEvent('content_delta', {
              assistantMessageId,
              delta: chunk.delta,
              accumulated: chunk.accumulated,
            });
          } else if (chunk.type === 'reasoning') {
            sendEvent('reasoning_delta', {
              assistantMessageId,
              delta: chunk.delta,
              accumulated: chunk.accumulated,
            });
          }
        },
        conversationContext
      );

      responseMessage = nextResponse.responseMessage;
      toolCalls = nextResponse.toolCalls;
      accumulateUsage(nextResponse.usage);

      // If the adapter recovered from an error (e.g. 429 rate limit), the error
      // message was returned as responseMessage.content but was never streamed
      // via onChunk. Send it to the frontend now so the user sees the error.
      if (nextResponse.recoveredFromError && responseMessage.content) {
        const errorContent = typeof responseMessage.content === 'string'
          ? responseMessage.content
          : JSON.stringify(responseMessage.content);
        sendEvent('content_delta', {
          assistantMessageId,
          delta: errorContent,
          accumulated: errorContent,
        });
      }

      messages.push(responseMessage);

      // Log what happened in this round
      if (toolCalls && toolCalls.length > 0) {
        console.log(`[Tool Loop] Round ${currentRound}: LLM made ${toolCalls.length} more tool call(s), continuing loop`);
      } else {
        console.log(`[Tool Loop] Round ${currentRound}: LLM provided final response, ending loop`);
      }
    }

    if (currentRound >= config.maxToolRounds) {
      console.warn(`[Tool Loop] Maximum rounds (${config.maxToolRounds}) reached, forcing completion`);
      sendEvent('error', {
        error: `Maximum tool call rounds (${config.maxToolRounds}) reached. Stopping to prevent infinite loop.`,
      });
    }

    // Extract final content — always extract text from content arrays
    const rawContent = responseMessage.content;
    if (typeof rawContent === 'string') {
      finalContentForLogging = rawContent;
    } else if (Array.isArray(rawContent)) {
      // Handle Anthropic-style [{type: "text", text: "..."}] arrays (all providers)
      const textParts = rawContent
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text);
      finalContentForLogging = textParts.join('\n\n') || JSON.stringify(rawContent);
    } else if (rawContent && typeof rawContent === 'object') {
      finalContentForLogging = rawContent.text || rawContent.message || JSON.stringify(rawContent);
    } else {
      finalContentForLogging = rawContent || '';
    }

    // Safety net: if tool loop ran but final response has no text content,
    // make one more LLM call to generate a summary response
    if (currentRound > 0 && !finalContentForLogging) {
      console.log('[Tool Loop] Final response had no text content after tool execution, requesting follow-up');
      try {
        // Add a nudge message to prompt the LLM to summarize
        messages.push({
          role: 'user',
          content: '[System: Your previous response contained only tool calls with no text. Please provide a brief summary of what you found/did based on the tool results above.]',
        });

        const followUpContext = manageContext(messages, model, finalToolSchemas, normalizedProvider);
        const followUpResponse = await adapter.callStream(
          followUpContext.messages,
          [], // No tools - force a text-only response
          (chunk) => {
            if (chunk.type === 'content') {
              sendEvent('content_delta', {
                assistantMessageId,
                delta: chunk.delta,
                accumulated: chunk.accumulated,
              });
            } else if (chunk.type === 'reasoning') {
              sendEvent('reasoning_delta', {
                assistantMessageId,
                delta: chunk.delta,
                accumulated: chunk.accumulated,
              });
            }
          },
          conversationContext
        );

        accumulateUsage(followUpResponse.usage);
        if (followUpResponse.responseMessage.content) {
          finalContentForLogging = typeof followUpResponse.responseMessage.content === 'string'
            ? followUpResponse.responseMessage.content
            : followUpResponse.responseMessage.content?.find?.((c) => c.type === 'text')?.text || '';
          messages.push(followUpResponse.responseMessage);
        }
      } catch (followUpError) {
        console.error('[Tool Loop] Follow-up LLM call failed:', followUpError.message);
      }
    }

    // Send final content event
    sendEvent('final_content', {
      assistantMessageId,
      content: finalContentForLogging,
      usage: tokenAccumulator.totalTokens > 0 ? tokenAccumulator : undefined,
    });
  } catch (error) {
    console.error(`Error in universal chat handler (${chatType}), but CONTINUING PROCESSING:`, error);
    streamErrorForLogging = { message: error.message, details: error.toString() };

    let errorMessage = 'I encountered an error but will continue processing your request.';
    if (error.response && error.response.data) {
      errorMessage = error.response.data.error ? error.response.data.error.message : errorMessage;
    } else if (error.message) {
      errorMessage = error.message;
    }

    if (error.constructor.name === 'BadRequestError' || (error.status && error.status === 400)) {
      errorMessage = 'The LLM generated an invalid tool call, but I will continue processing.';
      console.error('BadRequestError details (continuing anyway):', error.error || error);

      finalContentForLogging =
        "I encountered a tool call error, but I'm continuing to process your request. Please let me know if you'd like me to try a different approach.";
    }

    sendEvent('error', {
      error: errorMessage,
      details: error.toString(),
      continuing: true,
      recovery: true,
    });

    if (!finalContentForLogging) {
      finalContentForLogging =
        "I encountered some technical difficulties but I'm still here to help. Please feel free to continue our conversation or try rephrasing your request.";
    }

    sendEvent('final_content', {
      assistantMessageId: `msg-asst-${Date.now()}`,
      content: finalContentForLogging,
      recovered_from_error: true,
    });
  } finally {
    // Log conversation
    const logData = {
      conversationId,
      userId: userId,
      initial_prompt: message || (originalMessages && originalMessages[originalMessages.length - 1]?.content),
      full_history: JSON.stringify(messages),
      final_response: finalContentForLogging,
      tool_calls: JSON.stringify(allToolCallsForLogging),
      errors: streamErrorForLogging ? JSON.stringify(streamErrorForLogging) : null,
    };

    const logPromise = isNewConversation ? ConversationLogModel.create(logData) : ConversationLogModel.update(logData);
    await logPromise.catch((logError) => console.error('Failed to write stream log to DB:', logError));

    // Finalize agent execution tracking
    if (agentExecutionId) {
      try {
        const finalStatus = streamErrorForLogging ? 'failed' : 'completed';
        const finalResponseText = typeof finalContentForLogging === 'string'
          ? finalContentForLogging
          : String(finalContentForLogging || '');

        // Calculate estimated cost from real token usage
        let tokenUsageForDb = null;
        if (tokenAccumulator.totalTokens > 0) {
          const costInfo = getModelCost(normalizedProvider, model, tokenAccumulator.inputTokens, tokenAccumulator.outputTokens);
          tokenUsageForDb = {
            inputTokens: tokenAccumulator.inputTokens,
            outputTokens: tokenAccumulator.outputTokens,
            totalTokens: tokenAccumulator.totalTokens,
            estimatedCost: costInfo?.totalCost || 0,
          };
          console.log(`[Token Usage] ${tokenAccumulator.inputTokens} in / ${tokenAccumulator.outputTokens} out = ${tokenAccumulator.totalTokens} total tokens, est. cost: $${(tokenUsageForDb.estimatedCost || 0).toFixed(6)}`);
        }

        const computeSeconds = (Date.now() - executionStartTime) / 1000;

        await AgentExecutionModel.update(
          agentExecutionId,
          finalStatus,
          finalResponseText,
          computeSeconds,
          toolCallsCount,
          streamErrorForLogging ? streamErrorForLogging.message : null,
          tokenUsageForDb
        );

        sendEvent('agent_execution_completed', {
          executionId: agentExecutionId,
          status: finalStatus,
          toolCallsCount,
          tokenUsage: tokenAccumulator.totalTokens > 0 ? tokenAccumulator : undefined,
        });

        console.log(`[Agent Execution] Completed execution ${agentExecutionId} with status ${finalStatus}, ${toolCallsCount} tool calls`);
      } catch (execError) {
        console.error('[Agent Execution] Failed to finalize execution record:', execError);
      }
    }

    // Store conversation context for autonomous messages
    // This allows async tools to trigger AI responses later
    conversationManager.store(conversationId, {
      ...conversationContext,
      messages,
      authToken,
      agentExecutionId, // Link autonomous messages to the execution
    });

    console.log(`[ConversationManager] Stored conversation ${conversationId} for autonomous messages`);

    // Fire-and-forget: trigger insight extraction from chat execution
    if (agentExecutionId && userId) {
      import('./evolution/InsightTriggers.js').then(({ default: InsightTriggers }) => {
        InsightTriggers.onChatCompleted(agentExecutionId, userId, {
          agentId,
          conversationId,
          provider: normalizedProvider,
          model,
        }).catch(err => {
          console.error('[InsightTriggers] Chat insight extraction failed (non-critical):', err.message);
        });
      }).catch(() => {});
    }

    sendEvent('done', { message: 'Stream ended' });
    res.end();
  }
}

/**
 * Handle suggestions (JSON response, not streaming)
 */
async function handleSuggestions(req, res, config, userId, authToken) {
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required for authentication.' });
  }

  const { history = [], lastUserMessage = '', lastAssistantMessage = '', agentContext, provider, model } = req.body;

  // Validate required parameters
  if (!provider || !model) {
    return res.status(400).json({ error: 'Provider and model are required in the request body.' });
  }

  let client;
  let adapter;
  try {
    client = await createLlmClient(provider, userId);
    adapter = await createLlmAdapter(provider, client, model);
  } catch (authError) {
    console.error('Authentication error:', authError);
    return res.status(500).json({ error: `${provider} authentication failed. Please set up your ${provider} API key.` });
  }

  try {
    const currentDate = new Date().toString();
    const systemPrompt = await config.buildSystemPrompt(currentDate, { agentContext });

    const messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Based on this conversation:
Last user message: "${lastUserMessage}"
Last assistant response: "${lastAssistantMessage}"

Generate 3 smart, contextual suggestions that would be helpful next steps. Return ONLY the JSON array.`,
      },
    ];

    // Use the adapter to call the LLM (non-streaming for suggestions)
    const { responseMessage, recoveredFromError, recoveredError } = await adapter.call(messages, []);

    // If the adapter recovered from an error, return fallback suggestions with error info
    if (recoveredFromError) {
      console.error('API error occurred while generating suggestions:', recoveredError);

      // Return fallback suggestions since the API call failed
      const fallbackSuggestions = [
        { id: 'fallback_1', text: 'Tell me more about this', icon: '💭' },
        { id: 'fallback_2', text: 'Show me an example', icon: '📝' },
        { id: 'fallback_3', text: 'What else can you do?', icon: '🔍' },
      ];

      return res.json({
        suggestions: fallbackSuggestions,
        error: recoveredError || 'API error occurred'
      });
    }

    // Extract content based on provider
    let content;
    if (provider.toLowerCase() === 'anthropic') {
      // Anthropic returns content as an array of blocks
      if (Array.isArray(responseMessage.content)) {
        const textBlock = responseMessage.content.find((c) => c.type === 'text');
        content = textBlock ? textBlock.text : '';
      } else {
        content = responseMessage.content || '';
      }
    } else {
      // OpenAI-like providers return content as a string
      content = responseMessage.content || '';
    }

    // Ensure content is a string
    if (Array.isArray(content)) {
      const textBlock = content.find((c) => c.type === 'text');
      content = textBlock ? textBlock.text : JSON.stringify(content);
    }
    if (!content || typeof content !== 'string') {
      throw new Error('No content received from LLM');
    }

    // Clean up response
    content = content.trim();

    // Strip DeepSeek <think>...</think> reasoning tags
    if (content.includes('<think>')) {
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    }

    if (content.startsWith('```json')) {
      content = content.substring(7);
    }
    if (content.startsWith('```')) {
      content = content.substring(3);
    }
    if (content.endsWith('```')) {
      content = content.substring(0, content.length - 3);
    }
    content = content.trim();

    try {
      const suggestions = JSON.parse(content);

      if (Array.isArray(suggestions) && suggestions.length === 3) {
        const suggestionsWithIds = suggestions.map((s, index) => ({
          id: `dynamic_${Date.now()}_${index}`,
          text: s.text || 'Explore more',
          icon: s.icon || '◊',
        }));

        res.json({ suggestions: suggestionsWithIds });
      } else {
        throw new Error('Invalid suggestions format');
      }
    } catch (parseError) {
      console.error('Failed to parse suggestions:', parseError);
      console.error('Raw content:', content);

      // Fallback suggestions
      const fallbackSuggestions = [
        { id: 'fallback_1', text: 'Tell me more about this', icon: '💭' },
        { id: 'fallback_2', text: 'Show me an example', icon: '📝' },
        { id: 'fallback_3', text: 'What else can you do?', icon: '🔍' },
      ];

      res.json({ suggestions: fallbackSuggestions });
    }
  } catch (error) {
    console.error('Error generating suggestions:', error);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
}

/**
 * Execute tool functions for tool chat (extracted from toolChatHandler)
 */
async function executeToolFunction(functionName, args, authToken, context) {
  const { userId, toolState, llmClient, provider, model } = context;

  try {
    let result;

    switch (functionName) {
      case 'generate_tool_update':
        const StreamEngine = (await import('../stream/StreamEngine.js')).default;
        const streamEngine = new StreamEngine(userId);

        try {
          let enhancedInstruction = args.instruction;

          if (args.currentToolState && Object.keys(args.currentToolState).length > 0) {
            enhancedInstruction = `Current tool state: ${JSON.stringify(args.currentToolState, null, 2)}\n\nInstruction: ${
              args.instruction
            }\n\nPlease modify the existing tool according to the instruction, keeping existing fields that aren't being changed.`;
          }

          const generatedResult = await streamEngine.generateTool(enhancedInstruction, provider, model);
          const toolData = JSON.parse(generatedResult.template);

          result = {
            success: true,
            toolData: toolData,
            operationType: args.operationType || 'update',
            message: `Successfully ${args.operationType || 'updated'} tool based on instruction: "${args.instruction}"`,
            frontendEvents: generateFrontendEvents(toolData, args.operationType || 'update'),
          };
        } catch (generationError) {
          console.error('Error in tool generation:', generationError);
          result = {
            success: false,
            error: generationError.message,
            message: 'Failed to generate/update tool. Please try rephrasing your instruction.',
          };
        }
        break;

      case 'save_tool':
        if (args.toolData && db) {
          const toolId = args.toolData.id || `tool-${Date.now()}`;
          const toolData = {
            ...args.toolData,
            id: toolId,
            isShareable: args.isShareable || false,
            updatedAt: new Date().toISOString(),
          };

          result = await new Promise((resolve) => {
            // Use the full schema including base and code
            const query = `INSERT OR REPLACE INTO tools (id, base, title, category, type, icon, description, config, code, parameters, outputs, created_by, is_shareable, created_at, updated_at) 
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;

            // Extract parameters and outputs from toolData if they exist, or use toolData itself as parameters (legacy behavior)
            // For code tools, parameters are defined in 'fields' or 'parameters'
            const parameters = toolData.parameters || toolData.fields || {};
            const outputs = toolData.outputs || {};

            db.run(
              query,
              [
                toolId,
                toolData.base || 'AI',
                toolData.name || 'Untitled Tool',
                'custom',
                toolData.type || `custom-tool-${Date.now()}`,
                toolData.icon || 'custom',
                toolData.description || '',
                toolData.config ? JSON.stringify(toolData.config) : null,
                toolData.code || null,
                JSON.stringify(parameters),
                JSON.stringify(outputs),
                userId,
                args.isShareable ? 1 : 0,
              ],
              function (err) {
                if (err) {
                  resolve({
                    success: false,
                    message: err.message,
                  });
                } else {
                  resolve({
                    success: true,
                    toolId: toolId,
                    toolData: toolData,
                    message: 'Tool saved successfully to database',
                  });
                }
              }
            );
          });
        } else {
          result = {
            success: false,
            message: 'Tool data is required for saving',
          };
        }
        break;

      case 'load_tool':
        if (args.toolId && db) {
          result = await new Promise((resolve) => {
            db.get('SELECT * FROM tools WHERE id = ? AND (created_by = ? OR is_shareable = 1)', [args.toolId, userId], (err, row) => {
              if (err || !row) {
                resolve({
                  success: false,
                  message: err ? err.message : 'Tool not found or access denied',
                });
              } else {
                resolve({
                  success: true,
                  toolData: JSON.parse(row.parameters || '{}'),
                  message: 'Tool loaded successfully',
                });
              }
            });
          });
        } else {
          result = {
            success: false,
            message: 'Tool ID required',
          };
        }
        break;

      case 'delete_tool':
        if (args.toolId && db) {
          result = await new Promise((resolve) => {
            db.run('DELETE FROM tools WHERE id = ? AND created_by = ?', [args.toolId, userId], function (err) {
              if (err) {
                resolve({
                  success: false,
                  message: err.message,
                });
              } else {
                resolve({
                  success: this.changes > 0,
                  toolId: args.toolId,
                  message: this.changes > 0 ? 'Tool deleted successfully' : 'Tool not found or unauthorized',
                });
              }
            });
          });
        } else {
          result = {
            success: false,
            message: 'Tool ID required',
          };
        }
        break;

      case 'list_tools':
        if (db) {
          result = await new Promise((resolve) => {
            const query = args.category
              ? 'SELECT id, title, description, category, created_at FROM tools WHERE created_by = ? AND category = ?'
              : 'SELECT id, title, description, category, created_at FROM tools WHERE created_by = ?';

            const params = args.category ? [userId, args.category] : [userId];

            db.all(query, params, (err, rows) => {
              if (err) {
                resolve({
                  success: false,
                  message: err.message,
                });
              } else {
                const toolList = rows.map((row) => ({
                  id: row.id,
                  title: row.title,
                  description: row.description,
                  category: row.category,
                  createdAt: row.created_at,
                }));
                resolve({
                  success: true,
                  tools: toolList,
                  count: toolList.length,
                  message: `Found ${toolList.length} tools`,
                });
              }
            });
          });
        } else {
          result = {
            success: false,
            message: 'Unable to list tools - database not available',
          };
        }
        break;

      case 'run_tool':
        if (args.toolData) {
          result = {
            success: true,
            toolData: args.toolData,
            parameters: args.parameters || {},
            message: 'Tool execution initiated successfully',
            executionId: `exec-${Date.now()}`,
          };
        } else {
          result = {
            success: false,
            message: 'Tool data is required for execution',
          };
        }
        break;

      default:
        result = {
          success: false,
          message: `Unknown function: ${functionName}`,
        };
    }

    return JSON.stringify(result);
  } catch (error) {
    console.error(`Error executing tool function ${functionName}:`, error);
    return JSON.stringify({
      success: false,
      error: error.message,
    });
  }
}

/**
 * Generate frontend events based on tool data (from toolChatHandler)
 */
function generateFrontendEvents(toolData, operationType) {
  const events = [];

  if (toolData.name) {
    events.push({
      type: 'tool-field-updated',
      data: { field: 'title', value: toolData.name },
    });
  }

  if (toolData.description) {
    events.push({
      type: 'tool-field-updated',
      data: { field: 'description', value: toolData.description },
    });
  }

  if (toolData.base) {
    let toolType = 'AI';
    if (toolData.base.toLowerCase() === 'javascript') {
      toolType = 'CODE_JS';
    } else if (toolData.base.toLowerCase() === 'python') {
      toolType = 'CODE_PYTHON';
    }

    events.push({
      type: 'tool-field-updated',
      data: { field: 'toolType', value: toolType },
    });
  }

  if (toolData.code) {
    events.push({
      type: 'tool-field-updated',
      data: { field: 'code', value: toolData.code },
    });
  }

  const instructionsField = toolData.fields?.find((f) => f.name === 'template-instructions');
  if (instructionsField) {
    events.push({
      type: 'tool-field-updated',
      data: { field: 'instructions', value: instructionsField.value },
    });
  }

  if (toolData.fields) {
    toolData.fields.forEach((field) => {
      if (['template-name', 'template-instructions'].includes(field.name)) {
        return;
      }

      events.push({
        type: 'tool-custom-field-added',
        data: {
          fieldName: field.name,
          fieldType: field.type || 'text',
          label: field.label || field.name,
          value: field.value || '',
        },
      });
    });
  }

  if (operationType === 'create') {
    events.unshift({
      type: 'tool-fields-cleared',
      data: {},
    });
  }

  return events;
}

/**
 * Execute widget functions for widget chat
 */
async function executeWidgetFunction(functionName, args, authToken, context) {
  const { userId, widgetState, provider, model } = context;

  try {
    let result;

    switch (functionName) {
      case 'edit_widget_code': {
        try {
          const currentSource = widgetState?.source_code || '';
          if (!currentSource) {
            result = {
              success: false,
              error: 'No source code exists yet. Use generate_widget to create the initial widget first.',
              message: 'Cannot apply edits — no source code found.',
            };
            break;
          }

          let updatedSource = currentSource;
          const applied = [];
          const failed = [];

          // Normalize whitespace for fuzzy matching: collapse runs of whitespace to single space
          const normalizeWS = (s) => s.replace(/\s+/g, ' ').trim();

          // Find the actual substring in source that matches the search string with normalized whitespace
          function fuzzyFind(source, search) {
            // Try exact match first
            const exactIdx = source.indexOf(search);
            if (exactIdx !== -1) return { start: exactIdx, end: exactIdx + search.length };

            // Fuzzy: normalize both and find the match, then map back to original positions
            const normSearch = normalizeWS(search);
            if (!normSearch) return null;

            // Slide through source, building normalized windows
            let srcPos = 0;
            const srcLen = source.length;
            while (srcPos < srcLen) {
              // Skip to next non-space or start
              let windowStart = srcPos;
              let normWindow = '';
              let windowEnd = srcPos;

              // Build normalized window character by character
              while (windowEnd < srcLen) {
                const ch = source[windowEnd];
                if (/\s/.test(ch)) {
                  // Collapse whitespace
                  if (!normWindow.endsWith(' ') && normWindow.length > 0) {
                    normWindow += ' ';
                  }
                  windowEnd++;
                } else {
                  normWindow += ch;
                  windowEnd++;
                }

                // Check if we have a match
                const trimmedWindow = normWindow.trim();
                if (trimmedWindow === normSearch) {
                  return { start: windowStart, end: windowEnd };
                }

                // If window is already longer than search, bail
                if (trimmedWindow.length > normSearch.length + 10) break;
              }
              srcPos++;
            }
            return null;
          }

          for (let i = 0; i < args.edits.length; i++) {
            const edit = args.edits[i];
            const match = fuzzyFind(updatedSource, edit.search);
            if (match) {
              updatedSource = updatedSource.substring(0, match.start) + edit.replace + updatedSource.substring(match.end);
              applied.push({ index: i, search: edit.search.substring(0, 80) });
            } else {
              failed.push({ index: i, search: edit.search.substring(0, 80), reason: 'Search string not found in source code' });
            }
          }

          if (applied.length === 0) {
            result = {
              success: false,
              error: 'None of the search strings were found in the current source code.',
              failed,
              message: 'No edits could be applied. Check that your search strings exactly match the current source code.',
            };
            break;
          }

          // Build widget data with updated source
          const widgetData = { source_code: updatedSource };
          const existingId = widgetState?.id;
          const isExistingWidget = existingId && existingId !== 'widget-forge';

          // Auto-save to DB
          let savedWidgetId = existingId;
          try {
            if (db && isExistingWidget) {
              await new Promise((resolve, reject) => {
                db.run(
                  `UPDATE widget_definitions SET source_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                  [updatedSource, existingId],
                  (err) => (err ? reject(err) : resolve())
                );
              });
              widgetData.id = savedWidgetId;
            }
          } catch (saveErr) {
            console.error('Widget auto-save failed:', saveErr.message);
          }

          // Update context so subsequent tool calls in the same turn see the updated source
          if (widgetState) {
            widgetState.source_code = updatedSource;
          }

          const frontendEvents = generateWidgetFrontendEvents(widgetData, 'update');
          if (savedWidgetId && savedWidgetId !== 'widget-forge') {
            frontendEvents.push({
              type: 'widget-autosaved',
              data: { id: savedWidgetId, widgetData: { ...widgetState, source_code: updatedSource } },
            });
          }

          result = {
            success: true,
            applied,
            failed: failed.length > 0 ? failed : undefined,
            description: args.description,
            message: `Applied ${applied.length}/${args.edits.length} edits: ${args.description}`,
            frontendEvents,
          };
        } catch (editError) {
          console.error('Error in edit_widget_code:', editError);
          result = {
            success: false,
            error: editError.message,
            message: 'Failed to apply edits to widget code.',
          };
        }
        break;
      }

      case 'generate_widget': {
        try {
          let enhancedInstruction = args.instruction;

          // If rewriting, include current source for context
          if (args.operationType === 'rewrite' && widgetState?.source_code) {
            enhancedInstruction = `Current widget source code:\n${widgetState.source_code}\n\nInstruction: ${args.instruction}\n\nCompletely rewrite the widget according to the instruction.`;
          }

          // Generate widget HTML via second LLM call
          const client = await createLlmClient(context.provider || 'openai', userId);
          const adapter = await createLlmAdapter(context.provider || 'openai', client, context.model || 'gpt-4');

          const useTheme = args.useThemeStyles !== undefined ? args.useThemeStyles !== false : widgetState?.useThemeStyles !== false;
          let themeSection = '';
          if (useTheme) {
            themeSection = `
THEME STYLING:
The widget iframe is pre-loaded with CSS custom properties (variables) that match the user's active theme.
Do NOT define any :root variables yourself — they are already injected automatically.
Just USE var(--variable-name) references in your CSS. NEVER hardcode hex/rgb color values.

Available semantic variables (use these for all styling):
- var(--color-text) — normal body text
- var(--color-text-muted) — secondary/dimmed text
- var(--color-primary) — accent color for headings, key values, active states, highlights
- var(--color-secondary) — second accent color
- var(--color-background) — main widget background
- var(--color-darker-0) through var(--color-darker-3) — elevated surfaces (cards, panels) with increasing opacity
- var(--terminal-border-color) — borders
- var(--terminal-border-color-light) — subtle/lighter borders
- rgba(var(--primary-rgb), 0.15) — tinted accent backgrounds
- var(--color-popup) — background for dropdowns, selects, option menus, modals, and popover overlays
- var(--color-red) — errors
- var(--color-yellow) — warnings

Layout variables:
- var(--spacing-xxs) through var(--spacing-xxl) — padding, margins, gaps
- var(--font-size-xs) through var(--font-size-xxl) — typography sizes
- var(--font-weight-light|normal|medium|semibold|bold) — font weights
- var(--border-radius-xs|sm|md|lg|xl|full) — border radius
- var(--shadow-sm|md|lg|xl) — box shadows
- var(--transition-fast|medium|slow) — transitions

EXAMPLE — themed widget CSS (no :root block needed):
\`\`\`css
body {
  margin: 0;
  padding: var(--spacing-md);
  background: var(--color-background);
  color: var(--color-text);
  font-family: var(--font-family-primary);
  font-size: var(--font-size-sm);
}
.card {
  background: var(--color-darker-1);
  border: 1px solid var(--terminal-border-color);
  border-radius: var(--border-radius-md);
  padding: var(--spacing-md);
  box-shadow: var(--shadow-md);
}
.card h2 {
  color: var(--color-primary);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  margin: 0 0 var(--spacing-sm) 0;
}
.muted { color: var(--color-text-muted); }
.badge {
  background: rgba(var(--primary-rgb), 0.15);
  color: var(--color-primary);
  padding: var(--spacing-xxs) var(--spacing-sm);
  border-radius: var(--border-radius-sm);
  font-size: var(--font-size-xs);
}
\`\`\``;
          }

          const widgetGenPrompt = `Generate a complete, self-contained HTML document for a dashboard widget.

RULES:
- Return ONLY the raw HTML document — no markdown fences, no JSON wrapper, no explanation
- Start with <!DOCTYPE html> and end with </html>
- Include ALL CSS inside <style> tags
- Include ALL JavaScript inside <script> tags
- The HTML must be completely self-contained and render directly in an iframe with srcdoc
- Use inline/hardcoded data — no template literals, no external variables, no params.*
- Use the app's font variables: var(--font-family-primary) for all UI text, var(--font-family-mono) for code/monospace text. Do NOT use system font stacks like -apple-system or 'Segoe UI'.
${useTheme ? '- Use the theme CSS variables provided below for ALL styling — do NOT hardcode colors' : '- Dark theme preferred (dark backgrounds, light text) unless the user specifies otherwise'}

DESIGN QUALITY (CRITICAL — NON-NEGOTIABLE):
- This widget MUST look like it was crafted by a world-class design agency — bold, visually unique, and forward-thinking
- Think high-end architecture firm portfolio, not generic enterprise software — confident, distinctive, visually striking
- Use a base-2 spacing scale for all padding, margins, and gaps (2, 4, 8, 16, 24, 32, 48, 64px) — never arbitrary values
- Clear typographic hierarchy: distinct sizes for headings, subheadings, body, and captions with consistent line-height
- Generous whitespace, strong visual hierarchy, consistent alignment and grid structure
- Polished interactive states and smooth transitions on all interactive elements
- Purposeful use of color: accent colors as highlights, not floods — accents on key UI elements and data points
- Every element intentional, refined, and bespoke — NEVER generic or cookie-cutter
${themeSection}

USER REQUEST: ${enhancedInstruction}`;

          const { responseMessage } = await adapter.call(
            [
              { role: 'system', content: 'You generate widget HTML. Return ONLY the raw HTML document. No markdown, no JSON, no explanation — just the HTML starting with <!DOCTYPE html>. IMPORTANT: Output properly formatted, indented HTML with 2-space indentation. Do NOT minify the code. Every widget you produce must look like it was crafted by a world-class design agency — bold, visually unique, forward-thinking, and bespoke. Think high-end architecture firm portfolio, not generic enterprise software.' },
              { role: 'user', content: widgetGenPrompt },
            ],
            []
          );

          // Extract content from response
          let content;
          if (Array.isArray(responseMessage.content)) {
            const textBlock = responseMessage.content.find((c) => c.type === 'text');
            content = textBlock ? textBlock.text : '';
          } else {
            content = responseMessage.content || '';
          }

          // Strip markdown fences if the LLM wrapped it anyway
          content = content.trim();
          if (content.startsWith('```html')) content = content.substring(7);
          else if (content.startsWith('```')) content = content.substring(3);
          if (content.endsWith('```')) content = content.substring(0, content.length - 3);
          content = content.trim();

          // Sanitize control characters that break JSON serialization
          // Keep \n, \r, \t (valid in strings) but remove other control chars (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
          content = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

          // Extract a name from the <title> tag if present
          const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
          const widgetName = titleMatch ? titleMatch[1].trim() : (args.instruction.substring(0, 50) + (args.instruction.length > 50 ? '...' : ''));

          const widgetData = {
            name: widgetName,
            description: args.instruction.substring(0, 200),
            widget_type: 'html',
            source_code: content,
          };

          // Auto-save the generated widget to the database
          const operationType = args.operationType || 'create';
          const existingId = widgetState?.id;
          const isExistingWidget = existingId && existingId !== 'widget-forge';

          let savedWidgetId = existingId;
          try {
            if (db) {
              if (isExistingWidget) {
                await new Promise((resolve, reject) => {
                  db.run(
                    `UPDATE widget_definitions SET name = ?, description = ?, source_code = ?, widget_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [widgetData.name, widgetData.description, widgetData.source_code, widgetData.widget_type, existingId],
                    (err) => (err ? reject(err) : resolve())
                  );
                });
              } else {
                savedWidgetId = 'cw_' + randomUUID().replace(/-/g, '').slice(0, 12);
                await new Promise((resolve, reject) => {
                  db.run(
                    `INSERT INTO widget_definitions (id, user_id, name, description, icon, category, widget_type, source_code, config, data_bindings, default_size, min_size)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                      savedWidgetId,
                      userId || 'anonymous',
                      widgetData.name,
                      widgetData.description,
                      'fas fa-puzzle-piece',
                      'custom',
                      widgetData.widget_type,
                      widgetData.source_code,
                      '{}',
                      '[]',
                      '{"cols":4,"rows":3}',
                      '{"cols":2,"rows":2}',
                    ],
                    (err) => (err ? reject(err) : resolve())
                  );
                });
              }
              widgetData.id = savedWidgetId;
            }
          } catch (saveErr) {
            console.error('Widget auto-save failed:', saveErr.message);
          }

          // Update context so subsequent tool calls in the same turn see the updated source
          if (widgetState) {
            widgetState.source_code = content;
            widgetState.name = widgetData.name;
            widgetState.description = widgetData.description;
            widgetState.widget_type = widgetData.widget_type;
            if (savedWidgetId) widgetState.id = savedWidgetId;
          }

          const frontendEvents = generateWidgetFrontendEvents(widgetData, operationType);
          if (savedWidgetId && savedWidgetId !== 'widget-forge') {
            frontendEvents.push({
              type: 'widget-autosaved',
              data: { id: savedWidgetId, widgetData },
            });
          }

          // Return result without source_code — it's already sent to the frontend via events
          // and stored in widgetState. Including it bloats the tool response and risks JSON parse errors.
          const { source_code: _sc, ...widgetDataSummary } = widgetData;
          result = {
            success: true,
            widgetData: { ...widgetDataSummary, source_code_length: content.length },
            operationType,
            message: `Successfully generated widget: "${widgetData.name}"`,
            frontendEvents,
          };
        } catch (generationError) {
          console.error('Error in generate_widget:', generationError);
          result = {
            success: false,
            error: generationError.message,
            message: 'Failed to generate widget. Please try rephrasing your instruction.',
          };
        }
        break;
      }

      case 'update_widget_config': {
        try {
          const VALID_WIDGET_CATEGORIES = ['custom', 'dashboard', 'home', 'assets', 'system'];
          const configFields = ['name', 'description', 'icon', 'category', 'widget_type', 'default_size', 'min_size'];
          const updates = {};
          for (const field of configFields) {
            if (args[field] !== undefined) {
              updates[field] = args[field];
            }
          }

          // Validate category against allowed values
          if (updates.category && !VALID_WIDGET_CATEGORIES.includes(updates.category)) {
            updates.category = 'custom';
          }

          if (Object.keys(updates).length === 0) {
            result = {
              success: false,
              error: 'No fields provided to update.',
              message: 'Please specify at least one field to update (name, description, icon, category, widget_type, default_size, min_size).',
            };
            break;
          }

          const existingId = widgetState?.id;
          const isExistingWidget = existingId && existingId !== 'widget-forge';

          // Auto-save to DB
          if (db && isExistingWidget) {
            const setClauses = [];
            const params = [];
            for (const [field, value] of Object.entries(updates)) {
              setClauses.push(`${field} = ?`);
              params.push(typeof value === 'object' ? JSON.stringify(value) : value);
            }
            setClauses.push('updated_at = CURRENT_TIMESTAMP');
            params.push(existingId);

            try {
              await new Promise((resolve, reject) => {
                db.run(
                  `UPDATE widget_definitions SET ${setClauses.join(', ')} WHERE id = ?`,
                  params,
                  (err) => (err ? reject(err) : resolve())
                );
              });
            } catch (saveErr) {
              console.error('Widget config auto-save failed:', saveErr.message);
            }
          }

          // Update context so subsequent tool calls in the same turn see the updated config
          if (widgetState) {
            Object.assign(widgetState, updates);
          }

          // Generate frontend events for each changed field
          const frontendEvents = [];
          for (const [field, value] of Object.entries(updates)) {
            frontendEvents.push({
              type: 'widget-field-updated',
              data: { field, value },
            });
          }
          if (isExistingWidget) {
            frontendEvents.push({
              type: 'widget-autosaved',
              data: { id: existingId, widgetData: { ...widgetState, ...updates } },
            });
          }

          result = {
            success: true,
            updated: updates,
            message: `Updated widget config: ${Object.keys(updates).join(', ')}`,
            frontendEvents,
          };
        } catch (configError) {
          console.error('Error in update_widget_config:', configError);
          result = {
            success: false,
            error: configError.message,
            message: 'Failed to update widget configuration.',
          };
        }
        break;
      }

      case 'save_widget':
        if (args.widgetData && db) {
          const VALID_SAVE_CATEGORIES = ['custom', 'dashboard', 'home', 'assets', 'system'];
          const widgetId = args.widgetData.id || `widget-def-${Date.now()}`;
          const sanitizedCategory = VALID_SAVE_CATEGORIES.includes(args.widgetData.category) ? args.widgetData.category : 'custom';
          const widgetData = {
            ...args.widgetData,
            id: widgetId,
            category: sanitizedCategory,
            updatedAt: new Date().toISOString(),
          };

          result = await new Promise((resolve) => {
            const query = `INSERT OR REPLACE INTO widget_definitions (id, name, description, icon, category, widget_type, source_code, config, default_size, min_size, created_by, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;

            db.run(
              query,
              [
                widgetId,
                widgetData.name || 'Untitled Widget',
                widgetData.description || '',
                widgetData.icon || 'fas fa-puzzle-piece',
                widgetData.category || 'custom',
                widgetData.widget_type || 'html',
                widgetData.source_code || null,
                widgetData.config ? JSON.stringify(widgetData.config) : null,
                widgetData.default_size ? JSON.stringify(widgetData.default_size) : '{"cols":4,"rows":3}',
                widgetData.min_size ? JSON.stringify(widgetData.min_size) : '{"cols":2,"rows":2}',
                userId,
              ],
              function (err) {
                if (err) {
                  resolve({
                    success: false,
                    message: err.message,
                  });
                } else {
                  resolve({
                    success: true,
                    widgetId: widgetId,
                    widgetData: widgetData,
                    message: 'Widget saved successfully to database',
                    frontendEvents: [{ type: 'widget-saved', data: { widgetId, widgetData } }],
                  });
                }
              }
            );
          });
        } else {
          result = {
            success: false,
            message: 'Widget data is required for saving',
          };
        }
        break;

      case 'load_widget':
        if (args.widgetId && db) {
          result = await new Promise((resolve) => {
            db.get('SELECT * FROM widget_definitions WHERE id = ?', [args.widgetId], (err, row) => {
              if (err || !row) {
                resolve({
                  success: false,
                  message: err ? err.message : 'Widget not found',
                });
              } else {
                resolve({
                  success: true,
                  widgetData: row,
                  message: 'Widget loaded successfully',
                });
              }
            });
          });
        } else {
          result = {
            success: false,
            message: 'Widget ID required',
          };
        }
        break;

      case 'get_agnt_api':
        // Delegate to native tool handler
        return await executeTool(functionName, args, authToken, context);

      default:
        result = {
          success: false,
          message: `Unknown function: ${functionName}`,
        };
    }

    return JSON.stringify(result);
  } catch (error) {
    console.error(`Error executing widget function ${functionName}:`, error);
    return JSON.stringify({
      success: false,
      error: error.message,
    });
  }
}

/**
 * Generate frontend events for widget updates
 */
function generateWidgetFrontendEvents(widgetData, operationType) {
  const events = [];

  const fieldsToPush = ['name', 'description', 'widget_type', 'icon', 'category', 'config', 'default_size', 'min_size'];
  for (const field of fieldsToPush) {
    if (widgetData[field] !== undefined) {
      events.push({
        type: 'widget-field-updated',
        data: { field, value: widgetData[field] },
      });
    }
  }

  if (widgetData.source_code || widgetData.code) {
    events.push({
      type: 'widget-field-updated',
      data: { field: 'source_code', value: widgetData.source_code || widgetData.code },
    });
  }

  if (operationType === 'create') {
    events.unshift({
      type: 'widget-fields-cleared',
      data: {},
    });
  }

  return events;
}

async function getAvailableTools(req, res) {
  try {
    const { DEFAULT_TOOLS, TOOL_GROUPS, GROUP_DESCRIPTIONS } = await import('./orchestrator/toolSelector.js');
    const { getAvailableToolSchemas } = await import('./orchestrator/tools.js');
    const toolRegistry = (await import('./orchestrator/toolRegistry.js')).default;
    await toolRegistry.ensureInitialized();

    const allSchemas = await getAvailableToolSchemas();

    // Build schema lookup map
    const schemaMap = new Map();
    for (const schema of allSchemas) {
      const name = schema.function?.name;
      if (name) {
        schemaMap.set(name, { name, description: schema.function.description || '' });
      }
    }

    // Collect all built-in tool names (defaults + groups) into one set, deduped
    const builtInNames = new Set(DEFAULT_TOOLS);
    for (const tools of Object.values(TOOL_GROUPS)) {
      for (const name of tools) builtInNames.add(name);
    }

    const accountedFor = new Set();

    // Category: Built In (all defaults + group tools combined)
    const builtInTools = [...builtInNames].map(name => {
      accountedFor.add(name);
      return { name, description: schemaMap.get(name)?.description || '' };
    });

    // Category: Plugins (from toolRegistry plugin tools)
    const pluginTools = toolRegistry.getAllPluginTools().map(t => {
      const name = t.openApiSchema?.function?.name || t.type.replace(/-/g, '_');
      accountedFor.add(name);
      return {
        name,
        description: t.description || schemaMap.get(name)?.description || '',
        pluginName: t.pluginName || null,
      };
    });

    // Category: Installed (registry tools not in built-in/plugins)
    const installedTools = [];
    for (const [name, info] of schemaMap) {
      if (!accountedFor.has(name)) {
        accountedFor.add(name);
        installedTools.push({ name, description: info.description });
      }
    }

    // Build response — nothing is locked, everything toggleable
    const categories = [
      {
        id: 'builtin',
        name: 'Built In',
        description: 'Default system tools, platform tools, media, shell, email, and memory',
        locked: false,
        tools: builtInTools,
      },
    ];

    if (pluginTools.length > 0) {
      categories.push({
        id: 'plugins',
        name: 'Plugins',
        description: 'Tools from installed plugins',
        locked: false,
        tools: pluginTools,
      });
    }

    if (installedTools.length > 0) {
      categories.push({
        id: 'installed',
        name: 'Installed',
        description: 'Additional registered tools',
        locked: false,
        tools: installedTools,
      });
    }

    res.json({ categories });
  } catch (error) {
    console.error('Error getting available tools:', error);
    res.status(500).json({ error: 'Failed to get available tools' });
  }
}

export default universalChatHandler;
export { getAvailableTools };
