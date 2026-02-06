import { randomUUID } from 'crypto';
import { executeTool } from './orchestrator/tools.js';
import { executeAgentTool } from './orchestrator/agentTools.js';
import { executeWorkflowTool } from './orchestrator/workflowTools.js';
import { executeGoalTool } from './orchestrator/goalTools.js';
import ConversationLogModel from '../models/ConversationLogModel.js';
import AgentExecutionModel from '../models/AgentExecutionModel.js';
import { createLlmClient } from './ai/LlmService.js';
import { createLlmAdapter } from './orchestrator/llmAdapters.js';
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

          offloadedData.push({
            id: dataId,
            size: obj.length,
            path: path,
          });

          console.log(`[Data Offload] Offloaded ${obj.length} chars to ${dataId} (path: ${path})`);

          // Replace with reference
          return `{{DATA_REF:${dataId}}}`;
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
    goalId,
    goalContext,
  } = req.body;

  // Validate required parameters
  if (!provider || !inputModel) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({ error: 'Provider and model are required in the request body.' });
  }

  // CRITICAL: Normalize provider to lowercase to ensure consistent handling
  const normalizedProvider = provider.toLowerCase();
  let model = inputModel;

  // Guardrail: Codex CLI accounts do not support every OpenAI model name.
  if (normalizedProvider === 'openai-codex-cli') {
    const supportedModels = ProviderRegistry.getTextModels(normalizedProvider);
    if (Array.isArray(supportedModels) && supportedModels.length > 0 && !supportedModels.includes(model)) {
      const fallbackModel = supportedModels[0] || 'gpt-5-codex';
      console.warn(
        `[Codex CLI] Model '${model}' is not supported for Codex CLI. Falling back to '${fallbackModel}'.`
      );
      model = fallbackModel;
    }
  }

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

  const sendEvent = (eventName, data) => {
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
  sendEvent('conversation_started', { conversationId });

  // Variables for logging
  let messages = [];
  const allToolCallsForLogging = [];
  let finalContentForLogging = '';
  let streamErrorForLogging = null;

  // Agent execution tracking
  let agentExecutionId = null;
  let toolCallsCount = 0;
  const toolExecutionIds = new Map(); // Map toolCallId -> toolExecutionId

  // Initialize conversation context
  const conversationContext = {
    preservedContent: {},
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
    goalId,
    goalContext,
    userId,
    conversationId,
    // AI provider settings
    provider,
    model,
    normalizedProvider,
  };

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

    // Create agent execution record for tracking in Runs screen
    // Track all chat types except suggestions (agent, orchestrator, workflow, goal, tool)
    if (chatType !== 'suggestions' && userId) {
      try {
        const initialPromptText = message || (originalMessages && originalMessages[originalMessages.length - 1]?.content) || '';
        const agentNameForExecution = agentContext?.name || (chatType === 'agent' ? 'Agent Chat' : chatType === 'orchestrator' ? 'Orchestrator' : chatType.charAt(0).toUpperCase() + chatType.slice(1));

        agentExecutionId = await AgentExecutionModel.create(
          userId,
          agentId || null,
          agentNameForExecution,
          conversationId,
          typeof initialPromptText === 'string' ? initialPromptText.substring(0, 500) : String(initialPromptText).substring(0, 500),
          provider,
          model
        );

        // Update status to running
        await AgentExecutionModel.updateStatus(agentExecutionId, 'running');

        sendEvent('agent_execution_started', {
          executionId: agentExecutionId,
          agentName: agentNameForExecution,
          chatType,
        });

        console.log(`[Agent Execution] Created execution ${agentExecutionId} for ${chatType} chat`);
      } catch (execError) {
        console.error('[Agent Execution] Failed to create execution record:', execError);
        // Continue without execution tracking - don't fail the chat
      }
    }

    const client = await createLlmClient(normalizedProvider, userId, { conversationId, authToken });
    const adapter = await createLlmAdapter(normalizedProvider, client, model);

    // Store client in context
    conversationContext.llmClient = client;
    if (normalizedProvider === 'openai' || normalizedProvider === 'openai-codex' || normalizedProvider === 'openai-codex-cli') {
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
    const contextResult = manageContext(messages, model, finalToolSchemas);

    // Send context status
    sendEvent('context_status', {
      currentTokens: contextResult.managedTokens,
      tokenLimit: contextResult.tokenLimit,
      utilizationPercent: (contextResult.managedTokens / contextResult.tokenLimit) * 100,
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

    // Initial LLM call with streaming
    // Send initial assistant message
    sendEvent('assistant_message', {
      id: assistantMessageId,
      assistantMessageId, // Also include for Socket.IO broadcast consistency
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: Date.now(),
    });

    let { responseMessage, toolCalls, toolCallError, invalidToolCalls, toolsSkipped, toolsSkippedReason, recoveredFromError, recoveredError } = await adapter.callStream(
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
        } else if (chunk.type === 'tool_call_delta') {
          // Optionally send tool call progress updates
          // For now, we'll wait until tool calls are complete
        }
      },
      conversationContext // Pass context for vision image handling
    );

    // Handle API errors that the adapter recovered from (401, 429, etc.)
    if (recoveredFromError) {
      console.warn(`[OrchestratorService] LLM adapter recovered from error: ${recoveredError}`);
      const errorContent = responseMessage?.content || `API Error: ${recoveredError}`;
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

    // Tool execution loop - LLM decides when to stop
    let currentRound = 0;
    const toolExecutionDetails = [];

    while (toolCalls && toolCalls.length > 0 && currentRound < config.maxToolRounds) {
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

        // Remove special params before passing to tool
        const cleanArgs = { ...functionArgs };
        delete cleanArgs._executeAsync;
        delete cleanArgs._estimatedMinutes;

        if (shouldExecuteAsync) {
          console.log(`[AsyncTool] ${chatType === 'agent' ? 'Agent' : 'Orchestrator'} requested async execution for: ${functionName}`);

          const estimatedDuration = estimatedMinutes ? estimatedMinutes * 60 * 1000 : null;

          // Queue the async tool for background execution
          const executionId = asyncToolQueue.enqueue(
            toolCall.id,
            conversationId,
            userId,
            functionName,
            cleanArgs, // Use cleaned args without special params
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
          } else {
            // Default to orchestrator tools
            rawFunctionResponse = await executeTool(functionName, functionArgs, authToken, conversationContext);
          }

          // Handle web scraping content preservation (from streamHandler)
          if (functionName === 'web_scrape') {
            try {
              const fullResult = JSON.parse(rawFunctionResponse);
              if (fullResult.success) {
                if (!conversationContext.preservedContent) {
                  conversationContext.preservedContent = {};
                }
                conversationContext.preservedContent.lastWebScrape = {
                  url: fullResult.url,
                  fullContent: rawFunctionResponse,
                  timestamp: Date.now(),
                };
                console.log(`Preserved FULL web scrape content BEFORE truncation (${rawFunctionResponse.length} chars)`);
              }
            } catch (e) {
              console.log('Could not parse web scrape result for content preservation:', e.message);
            }
          }

          functionResponseContent = rawFunctionResponse;
          console.log(`NO TRUNCATION - using full content for ${functionName} (${rawFunctionResponse.length} chars)`);

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
          // Use 50000 char threshold - most web scrapes will NOT be offloaded
          const { modifiedResult: dataOffloadedResult, offloadedData } = offloadLargeData(
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
        if (toolCallResult && toolCallResult.frontendEvents) {
          toolCallResult.frontendEvents.forEach((event) => {
            sendEvent('frontend_event', {
              assistantMessageId,
              eventType: event.type,
              eventData: event.data,
            });
          });
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

      // Apply context management before next LLM call
      const loopContextResult = manageContext(messages, model, finalToolSchemas);
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
          }
        },
        conversationContext
      );

      responseMessage = nextResponse.responseMessage;
      toolCalls = nextResponse.toolCalls;

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

    // Extract final content
    if (normalizedProvider === 'anthropic') {
      const textBlock = responseMessage.content.find((c) => c.type === 'text');
      finalContentForLogging = textBlock ? textBlock.text : '';
    } else {
      finalContentForLogging = responseMessage.content;
    }

    // Send final content event
    sendEvent('final_content', { assistantMessageId, content: finalContentForLogging });
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
          ? finalContentForLogging.substring(0, 2000)
          : String(finalContentForLogging || '').substring(0, 2000);

        await AgentExecutionModel.update(
          agentExecutionId,
          finalStatus,
          finalResponseText,
          0, // credits_used - could be calculated based on tokens
          toolCallsCount,
          streamErrorForLogging ? streamErrorForLogging.message : null
        );

        sendEvent('agent_execution_completed', {
          executionId: agentExecutionId,
          status: finalStatus,
          toolCallsCount,
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

export default universalChatHandler;
