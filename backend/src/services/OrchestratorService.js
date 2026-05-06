import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { executeTool } from './orchestrator/tools.js';
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
import SkillModel from '../models/SkillModel.js';
import { buildSkillsContext } from './SkillService.js';
import { createSession as createUnfirehoseSession, wrapSendEvent as wrapUnfirehoseSendEvent, isEnabled as isUnfirehoseEnabled } from './unfirehose/UnfirehoseLogger.js';
import { saveBase64Image } from './ImageStorage.js';

// Synthetic tool_result injected when the stream is aborted mid tool-run.
// Without this, the next turn replays a message list with tool_use blocks that
// have no corresponding tool_result and Anthropic returns:
//   "tool_use ids were found without tool_result blocks immediately after"
const CANCELLED_TOOL_RESULT = JSON.stringify({
  success: false,
  error: 'Tool execution cancelled: stream aborted before completion.',
});

// Mid-run user steering. While a turn is streaming, the chat input is
// otherwise dead — this lets a user nudge the agent's next round without
// aborting. Steers are stashed per conversation, drained between tool
// rounds, and appended to the last tool-result message's content (Hermes
// /steer pattern). Tool-result messages already invalidate the prefix
// cache per turn, so this append is cache-neutral.
const pendingSteers = new Map(); // conversationId → string

export function stashSteer(conversationId, content) {
  if (!conversationId || !content || typeof content !== 'string') return false;
  const trimmed = content.trim();
  if (!trimmed) return false;
  const prev = pendingSteers.get(conversationId);
  pendingSteers.set(conversationId, prev ? `${prev}\n${trimmed}` : trimmed);
  return true;
}

function drainSteer(conversationId) {
  const text = pendingSteers.get(conversationId);
  pendingSteers.delete(conversationId);
  return text || null;
}

export function clearSteer(conversationId) {
  return pendingSteers.delete(conversationId);
}

function applySteerToLastToolResult(messages, steerText) {
  const tail = `\n\n[USER STEER (mid-run, not tool output): ${steerText}]`;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'tool') continue;
    if (typeof msg.content === 'string') {
      msg.content = msg.content + tail;
    } else if (Array.isArray(msg.content)) {
      msg.content = [...msg.content, { type: 'text', text: tail }];
    } else {
      // Unknown content shape — fall back to a sibling user message.
      messages.push({ role: 'user', content: tail });
    }
    return true;
  }
  // No tool message to anchor onto — push as a standalone user nudge.
  messages.push({ role: 'user', content: tail });
  return true;
}

/**
 * Ensure every tool_use (Anthropic) / tool_calls[] (OpenAI-style) has a matching
 * tool_result / role:'tool' reply in the next message. If not, inject a synthetic
 * "cancelled" result so the conversation can be safely replayed to the provider.
 */
function sanitizeOrphanToolCalls(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;
  const out = [];
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const next = msgs[i + 1];
    out.push(msg);

    if (!msg || msg.role !== 'assistant') continue;

    // Anthropic-style: content array with tool_use blocks; tool_results live in the next user message.
    if (Array.isArray(msg.content)) {
      const toolUseBlocks = msg.content.filter((b) => b && b.type === 'tool_use');
      if (toolUseBlocks.length > 0) {
        const nextIsToolResultMsg =
          next && next.role === 'user' && Array.isArray(next.content) &&
          next.content.some((b) => b && b.type === 'tool_result');
        const presentIds = nextIsToolResultMsg
          ? new Set(next.content.filter((b) => b && b.type === 'tool_result').map((b) => b.tool_use_id))
          : new Set();
        const orphans = toolUseBlocks.filter((b) => !presentIds.has(b.id));
        if (orphans.length > 0) {
          const syntheticBlocks = orphans.map((b) => ({
            type: 'tool_result',
            tool_use_id: b.id,
            content: CANCELLED_TOOL_RESULT,
            is_error: true,
          }));
          if (nextIsToolResultMsg) {
            next.content = [...next.content, ...syntheticBlocks];
          } else {
            out.push({ role: 'user', content: syntheticBlocks });
          }
          console.warn(`[sanitizeOrphanToolCalls] Injected ${orphans.length} synthetic tool_result(s) for orphan tool_use blocks: ${orphans.map((b) => b.id).join(', ')}`);
        }
      }
    }

    // OpenAI-style: tool_calls[] on assistant; each needs a role:'tool' follow-up with matching tool_call_id.
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const presentIds = new Set();
      let j = i + 1;
      while (j < msgs.length && msgs[j] && msgs[j].role === 'tool') {
        if (msgs[j].tool_call_id) presentIds.add(msgs[j].tool_call_id);
        j++;
      }
      const orphans = msg.tool_calls.filter((tc) => tc && tc.id && !presentIds.has(tc.id));
      if (orphans.length > 0) {
        for (const tc of orphans) {
          out.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.function?.name || 'unknown',
            content: CANCELLED_TOOL_RESULT,
          });
        }
        console.warn(`[sanitizeOrphanToolCalls] Injected ${orphans.length} synthetic tool message(s) for orphan tool_calls: ${orphans.map((tc) => tc.id).join(', ')}`);
      }
    }
  }
  return out;
}

// Empty-response placeholder text. This string is structural padding for the
// LLM's *next* turn (strict providers reject empty assistant messages). It
// must NEVER reach the user-facing UI — see `extractDisplayText` /
// `scrubEmptyPlaceholder` below for the SSE-boundary scrubbers.
const EMPTY_RESPONSE_PLACEHOLDER = '[The model returned an empty response.]';

/**
 * Extract user-displayable text from any assistant content shape:
 *   - string                             → returned as-is
 *   - Anthropic-style array of blocks    → text blocks joined
 *   - generic object {text|message}      → that field
 *   - anything else                      → ''
 *
 * Used at SSE boundaries so we never JSON.stringify an array into the chat
 * stream (which is exactly how `[{"type":"text","text":"..."}]` was leaking
 * to the UI).
 */
function extractDisplayText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n\n');
  }
  if (content && typeof content === 'object') {
    return content.text || content.message || '';
  }
  return '';
}

/**
 * If the extracted display text is *only* the empty-response placeholder,
 * collapse it to ''. Returns the original text otherwise. Use this at every
 * point where assistant content crosses into the SSE stream or the persisted
 * `final_response` DB field — the placeholder is provider-bookkeeping, not
 * something a human should ever read.
 */
function scrubEmptyPlaceholder(text) {
  if (typeof text !== 'string') return '';
  return text.trim() === EMPTY_RESPONSE_PLACEHOLDER ? '' : text;
}

/**
 * Check whether an assistant message is effectively empty — no text, no tool
 * calls, no tool_use blocks. Strict providers (Anthropic, Kimi, OpenAI) reject
 * these on replay with "must not be empty" 400 errors.
 */
function isEmptyAssistantMessage(msg) {
  if (!msg || msg.role !== 'assistant') return false;

  const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
  if (hasToolCalls) return false;

  const content = msg.content;
  if (typeof content === 'string') {
    return content.trim() === '';
  }
  if (Array.isArray(content)) {
    const hasStructuralBlock = content.some((b) => {
      if (!b || typeof b !== 'object') return false;
      if (b.type === 'text') return typeof b.text === 'string' && b.text.trim() !== '';
      if (b.type === 'tool_use') return true;
      if (b.type === 'image') return true;
      return false;
    });
    return !hasStructuralBlock;
  }
  // null/undefined content with no tool_calls
  return content == null;
}

/**
 * Rescue already-contaminated conversation histories. Walks the inbound
 * message list and drops empty assistant messages whose removal would not
 * orphan a tool_result pair; otherwise pads them with a placeholder so the
 * next provider call doesn't 400 with "message ... must not be empty".
 */
function sanitizeEmptyAssistantMessages(msgs) {
  if (!Array.isArray(msgs) || msgs.length === 0) return msgs;

  const EMPTY_PLACEHOLDER = EMPTY_RESPONSE_PLACEHOLDER;
  const out = [];
  let dropped = 0;
  let padded = 0;

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (!isEmptyAssistantMessage(msg)) {
      out.push(msg);
      continue;
    }

    // Empty assistant. Dropping is safe only if the surrounding messages don't
    // depend on it (i.e., no following tool_result user message expecting a
    // tool_use from this assistant). If it has no tool_calls/tool_use, it
    // can't be referenced — safe to drop entirely.
    const hasStructuralRef = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    if (!hasStructuralRef) {
      dropped++;
      continue;
    }

    // Keep structurally but pad content so provider accepts it.
    const patched = { ...msg };
    if (typeof msg.content === 'string' || msg.content == null) {
      patched.content = EMPTY_PLACEHOLDER;
    } else if (Array.isArray(msg.content)) {
      patched.content = [{ type: 'text', text: EMPTY_PLACEHOLDER }, ...msg.content.filter((b) => b && b.type !== 'text')];
    }
    out.push(patched);
    padded++;
  }

  if (dropped > 0 || padded > 0) {
    console.warn(`[sanitizeEmptyAssistantMessages] Rescued history: dropped ${dropped} empty assistant message(s), padded ${padded}`);
  }
  return out;
}

/**
 * Final defense before pushing an assistant message into conversation history.
 * If the adapter-level normalizer missed an empty response, pad it here so
 * it never reaches the next provider call as an empty message.
 */
function safePushAssistantMessage(messages, responseMessage) {
  if (!responseMessage || typeof responseMessage !== 'object') {
    console.warn('[safePushAssistantMessage] Refusing to push non-object assistant message');
    return;
  }
  if (isEmptyAssistantMessage(responseMessage)) {
    console.warn('[safePushAssistantMessage] Adapter returned empty assistant message; padding before history push');
    const padded = { ...responseMessage };
    if (Array.isArray(padded.content)) {
      padded.content = [{ type: 'text', text: EMPTY_RESPONSE_PLACEHOLDER }];
    } else {
      padded.content = EMPTY_RESPONSE_PLACEHOLDER;
    }
    messages.push(padded);
    return;
  }
  messages.push(responseMessage);
}

/**
 * Inject the current date/time into the latest user message.
 * This keeps the system prompt 100% stable for prompt caching while
 * ensuring the LLM always knows the current date.
 */
function injectDateIntoLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
      const dateStr = new Date().toString();
      messages[i].content = `[Current date: ${dateStr}]\n\n${messages[i].content}`;
      return;
    }
  }
}

/**
 * Extract images from tool results and replace with references
 * This prevents base64 image data from bloating the context window
 */
function extractAndReplaceImages(toolResult, toolCallId) {
  const images = [];

  try {
    const result = typeof toolResult === 'string' ? JSON.parse(toolResult) : toolResult;

    const preSavedIds = Array.isArray(result.savedImageIds) ? result.savedImageIds : [];
    const preSavedFirstId = typeof result.firstImageId === 'string' ? result.firstImageId : null;

    // Check for image generation results
    if (result.generatedImages && Array.isArray(result.generatedImages)) {
      result.generatedImages.forEach((img, index) => {
        if (img && typeof img === 'string' && img.startsWith('data:image/')) {
          const imageId = preSavedIds[index] || `img-${toolCallId}-${index}`;
          if (!preSavedIds[index]) saveBase64Image(imageId, img);
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
      const imageId = preSavedFirstId || `img-${toolCallId}-first`;
      if (!preSavedFirstId) saveBase64Image(imageId, result.firstImage);
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
      saveBase64Image(imageId, imageData);

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

// Mirrors ImageStorage.js's data-dir cascade so uploads land in the same root.
const resolveUploadsDir = () => {
  let dataDir;
  if (process.env.NODE_ENV === 'production' && fs.existsSync('/app/data')) {
    dataDir = '/app/data';
  } else if (process.env.USER_DATA_PATH) {
    dataDir = path.join(process.env.USER_DATA_PATH, 'Data');
  } else if (process.env.NODE_ENV !== 'production' || process.cwd().includes('backend')) {
    dataDir = path.resolve(process.cwd(), 'data');
  } else {
    dataDir = path.join(process.env.HOME || process.env.USERPROFILE, '.agnt', 'data');
  }
  return path.join(dataDir, 'uploads');
};

const sanitizeFilename = (name) => {
  const base = path.basename(String(name || 'file'));
  return base.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 200) || 'file';
};

/**
 * Process uploaded files: persist to disk so tools that take a filesystem
 * path can use them, AND extract text / base64 for inline LLM context.
 */
async function processUploadedFiles(files, conversationId) {
  let fileContext = '';
  const imageData = [];
  const savedFiles = [];

  if (!files || files.length === 0) {
    return { fileContext, imageData, savedFiles };
  }

  // Per-conversation upload dir so paths are stable and easy to clean up later.
  const safeConvId = String(conversationId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const convDir = path.join(resolveUploadsDir(), safeConvId);
  try {
    fs.mkdirSync(convDir, { recursive: true });
  } catch (err) {
    console.error('[Upload] Failed to create upload dir:', convDir, err.message);
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const fileBuffer = file.buffer;
    const fileType = file.mimetype;
    let textContent = '';

    // Save the buffer to disk under a sanitized name; collisions get an index prefix.
    try {
      const safeName = sanitizeFilename(file.originalname);
      const finalName = savedFiles.some((f) => path.basename(f.path) === safeName)
        ? `${i}_${safeName}`
        : safeName;
      const savedPath = path.join(convDir, finalName);
      fs.writeFileSync(savedPath, fileBuffer);
      savedFiles.push({
        filename: file.originalname,
        path: savedPath,
        mimetype: fileType,
        size: fileBuffer.length,
      });
    } catch (err) {
      console.error(`[Upload] Failed to save file ${file.originalname}:`, err.message);
    }

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

  return { fileContext, imageData, savedFiles };
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
    codeId,
    codeContext,
    skillId,
    skillInstructions,
    skillName,
    skillDescription,
    skillAllowedTools,
    reasoningValue: rawReasoningValue,
    reasoningEnabled: rawReasoningEnabled,
    enabledTools: rawEnabledTools,
  } = req.body;

  // Normalize reasoningEnabled (FormData sends strings, JSON sends booleans)
  const reasoningEnabled = rawReasoningEnabled === true || rawReasoningEnabled === 'true';
  const reasoningValue = typeof rawReasoningValue === 'string' && rawReasoningValue.trim()
    ? rawReasoningValue.trim().toLowerCase()
    : (reasoningEnabled ? 'on' : 'default');

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
  let messageInput = originalMessages || (message ? [...history, { role: 'user', content: message }] : null);
  if (!messageInput) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({ error: 'Messages or message with history are required in the request body.' });
  }

  messageInput = sanitizeOrphanToolCalls(messageInput);
  messageInput = sanitizeEmptyAssistantMessages(messageInput);

  // Set up streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Abort controller for cancelling LLM streams when client disconnects
  const streamAbortController = new AbortController();
  let isClientDisconnected = false;

  // SSE keepalive: Docker bridge NAT, reverse proxies (nginx/traefik), and corporate
  // middleboxes silently drop idle TCP connections after 30–120s. During long tool
  // executions or slow LLM generation, no bytes flow on the SSE channel and the
  // connection dies with no error. A periodic comment line (`:` prefix) is ignored
  // by the EventSource spec but keeps the underlying socket warm.
  const HEARTBEAT_INTERVAL_MS = 15000;
  const heartbeatInterval = setInterval(() => {
    if (isClientDisconnected || res.writableFinished) {
      clearInterval(heartbeatInterval);
      return;
    }
    try {
      res.write(': keepalive\n\n');
    } catch (e) {
      console.warn('[Stream Heartbeat] Write failed, marking client disconnected:', e.message);
      isClientDisconnected = true;
      streamAbortController.abort();
      clearInterval(heartbeatInterval);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Use res.on('close') — fires when the *response* connection is closed by the client.
  // req.on('close') can fire prematurely once the request body is consumed.
  res.on('close', () => {
    clearInterval(heartbeatInterval);
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
    codeId,
    codeContext,
    userId,
    conversationId,
    // Latest user message text (for dynamic tool selection)
    latestUserMessage,
    // User-selected enabled tools from frontend tool selector.
    //
    // null  = frontend didn't send a list → backend picks defaults
    // Set() = frontend explicitly sent zero tools → user wants zero tools
    //
    // We must distinguish these two — collapsing an empty array to null made
    // "turn off all tools" silently fall through to the no-selection branch,
    // which then sent every tool the chat had access to.
    enabledTools: (() => {
      if (rawEnabledTools === undefined || rawEnabledTools === null) return null;
      try {
        const parsed = typeof rawEnabledTools === 'string' ? JSON.parse(rawEnabledTools) : rawEnabledTools;
        return Array.isArray(parsed) ? new Set(parsed) : null;
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

  // CRITICAL for prompt caching: restore frozen-per-conversation state from prior turns.
  // The system prompt must be byte-identical across turns or the Anthropic prompt cache
  // (and OpenAI/Gemini equivalents) miss on every request.
  // We persist: _frozenSkillsCatalog, _frozenMemorySection, _loadedToolGroups, activatedSkills.
  const priorContext = conversationManager.get(conversationId);
  if (priorContext) {
    if (priorContext._frozenSkillsCatalog !== undefined) {
      conversationContext._frozenSkillsCatalog = priorContext._frozenSkillsCatalog;
    }
    if (priorContext._frozenMemorySection !== undefined) {
      conversationContext._frozenMemorySection = priorContext._frozenMemorySection;
    }
    if (priorContext._loadedToolGroups) {
      conversationContext._loadedToolGroups = new Set(priorContext._loadedToolGroups);
    }
    if (priorContext.activatedSkills) {
      conversationContext.activatedSkills = new Set(priorContext.activatedSkills);
    }
  }

  // Token usage accumulator — tracks real LLM token consumption across all rounds
  // Declared before try/catch so it's accessible in the finally block
  const tokenAccumulator = {
    inputTokens: 0, outputTokens: 0, totalTokens: 0,
    cacheReadTokens: 0, cacheCreationTokens: 0,
    // Hybrid-TTL breakdown of cache writes (Anthropic extended-cache-ttl beta).
    // Sum equals cacheCreationTokens. If the split is not reported, the full
    // write total is treated as 5m (pre-beta behavior).
    cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
  };

  try {
    // Process uploaded files
    const { fileContext, imageData, savedFiles } = await processUploadedFiles(files, conversationId);

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
    const adapter = await createLlmAdapter(normalizedProvider, client, model, { reasoningEnabled, reasoningValue });

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

    // Build system prompt (no dynamic date — frozen for prompt caching)
    // Pass conversationContext directly (NOT a spread copy) so that freeze writes
    // (_frozenSkillsCatalog, _frozenMemorySection) mutate the real context and
    // survive to be stored in conversationManager at end of turn.
    conversationContext.toolSchemas = toolSchemas;
    let systemPrompt = await config.buildSystemPrompt(conversationContext);

    // Per-conversation skill injection (set via /skill in chat).
    // Resolution order:
    //   1) inline `skillInstructions` from the request body (covers
    //      filesystem-discovered skills with synthetic `fs-*` ids that the
    //      DB doesn't know about),
    //   2) DB lookup by skillId,
    //   3) filesystem discovery service for `fs-*` style ids.
    console.log(
      `[Skill Inject] Received: skillId=${skillId || 'none'}, skillName=${skillName || 'none'}, ` +
      `inline.instructionsLen=${(skillInstructions || '').length}, inline.descLen=${(skillDescription || '').length}`
    );

    if (skillId || skillInstructions) {
      try {
        let activeSkill = null;
        let resolutionPath = 'none';

        // (1) Always try DB lookup first when an id is provided — backend has
        //     source of truth, frontend cache can be stale or sparse.
        if (skillId) {
          try {
            const dbSkill = await SkillModel.findById(skillId);
            if (dbSkill && dbSkill.instructions) {
              activeSkill = dbSkill;
              resolutionPath = 'db';
            }
          } catch (e) {
            console.warn(`[Skill Inject] DB lookup threw for ${skillId}:`, e.message);
          }
        }

        // (2) Filesystem discovery for fs-* ids (or as fallback if DB missed).
        if (!activeSkill && typeof skillId === 'string' && skillId.startsWith('fs-')) {
          try {
            const { default: SkillDiscoveryService } = await import('./SkillDiscoveryService.js');
            if (SkillDiscoveryService.initialized) {
              const slug = skillId.slice(3);
              const fsSkill = SkillDiscoveryService.getSkillContent(slug) || SkillDiscoveryService.getSkill(slug);
              if (fsSkill && fsSkill.instructions) {
                activeSkill = {
                  name: fsSkill.displayName || fsSkill.name || slug,
                  description: fsSkill.description || '',
                  instructions: fsSkill.instructions,
                };
                resolutionPath = 'filesystem';
              } else {
                console.warn(`[Skill Inject] Filesystem skill "${slug}" found but has empty instructions`);
              }
            } else {
              console.warn(`[Skill Inject] SkillDiscoveryService not initialized; skipping fs lookup`);
            }
          } catch (e) {
            console.warn(`[Skill Inject] Filesystem lookup failed for ${skillId}:`, e.message);
          }
        }

        // (3) Final fallback: trust inline instructions sent by the client.
        //     This covers transient cases (skill not yet persisted) and avoids
        //     a hard fail if both lookups missed.
        if (!activeSkill && skillInstructions && skillInstructions.trim().length > 0) {
          activeSkill = {
            name: skillName || 'skill',
            description: skillDescription || '',
            instructions: skillInstructions,
            allowed_tools: skillAllowedTools || null,
          };
          resolutionPath = 'inline';
        }

        if (activeSkill && activeSkill.instructions && activeSkill.instructions.trim().length > 0) {
          const skillBlock = buildSkillsContext([activeSkill]);
          if (skillBlock) {
            // Prepend (not append) so the skill instructions sit *before* the
            // base system prompt's date/time/general guidance. Some prompts
            // open with verbose date instructions that bias the LLM away from
            // the skill if the skill block is buried at the end.
            systemPrompt = `${skillBlock}\n\n${systemPrompt}`;
            console.log(
              `[Skill Inject] OK: prepended ${skillBlock.length}b skill block for "${activeSkill.name}" ` +
              `via ${resolutionPath} (systemPrompt now ${systemPrompt.length}b, instructionsLen=${activeSkill.instructions.length})`
            );
          }
        } else if (skillId && !activeSkill) {
          console.warn(
            `[Skill Inject] FAILED to resolve skillId "${skillId}" via DB/filesystem/inline. ` +
            `inlineLen=${(skillInstructions || '').length}, fsCandidate=${skillId.startsWith?.('fs-') || false}`
          );
        } else if (activeSkill && !activeSkill.instructions?.trim()) {
          console.warn(`[Skill Inject] Skill "${activeSkill.name}" resolved but has empty instructions; nothing to inject`);
        }
      } catch (e) {
        console.warn(`[Skill Inject] Unexpected error for skillId ${skillId}:`, e.message);
      }
    }

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

    // Build an [ATTACHED FILES] block listing absolute disk paths so the LLM can
    // pass them to tools that take a file path (video gen, file_operations, etc.).
    // Without this, images especially had no path — only base64 for vision.
    let attachmentsBlock = '';
    if (savedFiles && savedFiles.length > 0) {
      const lines = savedFiles.map(
        (f) => `- ${f.path} (${f.mimetype}, ${Math.round(f.size / 1024)} KB)`,
      );
      attachmentsBlock =
        `[ATTACHED FILES]\n` +
        `The user uploaded ${savedFiles.length} file(s), saved on disk at these absolute paths. ` +
        `Pass these paths to any tool that accepts a file path parameter (video generators, file_operations, etc.):\n` +
        `${lines.join('\n')}\n[/ATTACHED FILES]\n\n`;
    }

    // Add file context (and attachments block) to the first user message if files were uploaded.
    // Images are handled separately via vision API.
    if (attachmentsBlock || fileContext.trim()) {
      const firstUserMsgIndex = messages.findIndex((m) => m.role === 'user');
      if (firstUserMsgIndex !== -1) {
        messages[firstUserMsgIndex].content = `${attachmentsBlock}${fileContext}\n\n${messages[firstUserMsgIndex].content}`;
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
    // override into the last user message so the LLM doesn't continue as Annie.
    // NOTE: Injected as a prefix to the user message (not a separate system message)
    // because many providers reject or mishandle multiple system messages.
    if (chatType === 'agent' && agentId && agentId !== 'agent-chat') {
      const agentName = agentMeta.agentName || 'the requested agent';
      const lastUserIdx = messages.length - 1;
      if (lastUserIdx > 0 && messages[lastUserIdx].role === 'user' && typeof messages[lastUserIdx].content === 'string') {
        messages[lastUserIdx].content = `[Identity: You are ${agentName}. Respond as ${agentName} — NOT as Annie or any other assistant.]\n\n${messages[lastUserIdx].content}`;
      }
    }

    // CRITICAL: If images were uploaded but model doesn't support vision, inject a system message
    // that FORCES the LLM to use the analyze_image tool
    if (imageData.length > 0 && !modelSupportsVision) {
      const imageFileNames = imageData.map((img) => img.filename).join(', ');
      const forceAnalyzeImageMessage = {
        role: 'user',
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

    // Claude Code OAuth: Anthropic's third-party-app classifier flags mcp_client's
    // shape as a wrapper framework and routes the request to "extra usage" billing
    // (returns 400 invalid_request_error). Strip it on this provider only.
    if (normalizedProvider === 'claude-code') {
      finalToolSchemas = finalToolSchemas.filter((t) => t.function?.name !== 'mcp_client');
    }

    conversationContext.finalToolSchemas = finalToolSchemas;

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

    // Inject current date into the latest user message (keeps system prompt stable for caching)
    injectDateIntoLastUserMessage(messages);

    // Apply context management
    const contextResult = manageContext(messages, model, finalToolSchemas, normalizedProvider);

    // Send context status.
    // `currentTokens` / `utilizationPercent` are retained for backwards
    // compatibility but now reflect the TRUE per-request input size
    // (system + tools + messages), not just the messages-array estimate.
    // The breakdown fields drive the segmented bar in the frontend.
    sendEvent('context_status', {
      currentTokens: contextResult.totalRequestTokens,
      tokenLimit: contextResult.contextWindow,
      utilizationPercent: (contextResult.totalRequestTokens / contextResult.contextWindow) * 100,
      model: model,
      messagesCount: contextResult.messages.length,
      breakdown: {
        systemTokens: contextResult.systemTokens,
        toolTokens: contextResult.toolTokens,
        messagesTokens: contextResult.messagesTokens,
        outputBufferTokens: contextResult.outputBufferTokens,
        totalRequestTokens: contextResult.totalRequestTokens,
      },
    });

    if (contextResult.wasManaged) {
      console.log(`Context automatically managed: ${contextResult.originalTokens} -> ${contextResult.managedTokens} tokens`);
      messages = contextResult.messages;
      sendEvent('context_managed', {
        originalTokens: contextResult.originalTokens,
        managedTokens: contextResult.managedTokens,
        tokenLimit: contextResult.tokenLimit,
        reduction: contextResult.originalTokens - contextResult.managedTokens,
        strategy: 'automatic_truncation',
      });
    }

    /**
     * Normalize and accumulate token usage from any provider format.
     *
     * Anthropic returns: input_tokens (uncached only) + cache_read_input_tokens + cache_creation_input_tokens
     *   → true total input = input_tokens + cache_read + cache_creation
     * OpenAI returns: prompt_tokens (total) with prompt_tokens_details.cached_tokens as a subset
     *   → true total input = prompt_tokens (already includes cached)
     */
    function accumulateUsage(usage) {
      if (!usage) return;
      const output = usage.completion_tokens || usage.output_tokens || 0;
      tokenAccumulator.outputTokens += output;

      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheWrite = usage.cache_creation_input_tokens || 0;

      if (cacheRead > 0 || cacheWrite > 0) {
        // Anthropic: input_tokens is ONLY the uncached portion
        // Total input = uncached + cache_read + cache_creation
        const uncached = usage.input_tokens || 0;
        const totalInput = uncached + cacheRead + cacheWrite;
        tokenAccumulator.inputTokens += totalInput;
        tokenAccumulator.cacheReadTokens += cacheRead;
        tokenAccumulator.cacheCreationTokens += cacheWrite;

        // Hybrid-TTL split. Flat fields are populated by the streaming adapter
        // (llmAdapters.js); nested `cache_creation.ephemeral_*` shape may arrive
        // directly from the non-streaming SDK response. If neither is present,
        // attribute the full write total to 5m (back-compat with pre-beta).
        const write5m = usage.cache_creation_5m_input_tokens
          || usage.cache_creation?.ephemeral_5m_input_tokens
          || 0;
        const write1h = usage.cache_creation_1h_input_tokens
          || usage.cache_creation?.ephemeral_1h_input_tokens
          || 0;
        if (write5m + write1h > 0) {
          tokenAccumulator.cacheCreation5mTokens += write5m;
          tokenAccumulator.cacheCreation1hTokens += write1h;
        } else {
          tokenAccumulator.cacheCreation5mTokens += cacheWrite;
        }
      } else {
        // OpenAI / others: prompt_tokens is already the full total
        const input = usage.prompt_tokens || usage.input_tokens || 0;
        tokenAccumulator.inputTokens += input;
        // OpenAI cached tokens (subset of prompt_tokens)
        if (usage.prompt_tokens_details?.cached_tokens) {
          tokenAccumulator.cacheReadTokens += usage.prompt_tokens_details.cached_tokens;
        }
      }

      tokenAccumulator.totalTokens = tokenAccumulator.inputTokens + tokenAccumulator.outputTokens;
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
    // Also catches the wasEmpty branch — adapters mark empty responses with
    // recoveredFromError so the user gets *something* in the bubble. We
    // scrub the structural placeholder here so it doesn't render.
    if (recoveredFromError) {
      console.warn(
        `[OrchestratorService] LLM adapter recovered from error ` +
        `(provider=${normalizedProvider} model=${model} chatType=${chatType}): ${recoveredError}`
      );
      const extracted = extractDisplayText(responseMessage?.content);
      const scrubbed = scrubEmptyPlaceholder(extracted);
      if (!scrubbed) {
        console.warn(
          `[Empty Response] provider=${normalizedProvider} model=${model} ` +
          `round=0 chatType=${chatType} recoveredError="${recoveredError || 'unknown'}" ` +
          `→ suppressing placeholder from chat stream`
        );
      }
      const errorContent = scrubbed
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

    // Tool-calls-filtered recovery:
    // When the adapter's validation (AJV or JSON-salvage) dropped every tool
    // call the model attempted, and the surviving text is trivially short
    // ("I'll work on it now..."), the tool loop would otherwise exit silently
    // and the user sees Annie stop mid-task. Do one orchestrator-level retry
    // with explicit validation feedback, then surface clearly if still empty.
    const allToolCallsWereInvalid =
      invalidToolCalls && invalidToolCalls.length > 0 && (!toolCalls || toolCalls.length === 0);
    const rawContentStr = typeof responseMessage?.content === 'string'
      ? responseMessage.content
      : Array.isArray(responseMessage?.content)
        ? responseMessage.content.filter((b) => b?.type === 'text').map((b) => b.text || '').join(' ')
        : '';
    const contentIsWeak = rawContentStr.trim().length < 200;

    if (allToolCallsWereInvalid && contentIsWeak && !recoveredFromError) {
      console.warn('[Tool Retry] All tool calls were filtered out and content is minimal — retrying with explicit validation feedback');

      const validationSummary = invalidToolCalls
        .map(({ toolCall, issues }) => {
          const name = toolCall?.function?.name || 'unknown';
          const args = toolCall?.function?.arguments || '(empty)';
          const issueList = Array.isArray(issues) ? issues.join('; ') : String(issues);
          return `- Tool "${name}" failed validation: ${issueList}\n  Attempted args: ${args.substring(0, 300)}${args.length > 300 ? '...' : ''}`;
        })
        .join('\n');

      sendEvent('tool_error', {
        error: 'All tool calls were filtered out by schema validation; retrying with correction guidance.',
        details: { invalidCount: invalidToolCalls.length },
        continuing: true,
        retrying: true,
      });

      // Build retry messages: include the failed assistant turn + a correction nudge
      const retryMessages = [
        ...contextResult.messages,
        responseMessage,
        {
          role: 'user',
          content: `[System: Your previous response generated ${invalidToolCalls.length} tool call(s) that failed schema validation. Specific failures:\n${validationSummary}\n\nPlease retry. Either (a) call the correct tool with parameters that match its schema exactly, or (b) respond with a plain-text answer if no tool is needed. Do not repeat the malformed call.]`,
        },
      ];

      try {
        const retryResponse = await adapter.callStream(
          retryMessages,
          finalToolSchemas,
          (chunk) => {
            if (chunk.type === 'content') {
              sendEvent('content_delta', { assistantMessageId, delta: chunk.delta, accumulated: chunk.accumulated });
            } else if (chunk.type === 'reasoning') {
              sendEvent('reasoning_delta', { assistantMessageId, delta: chunk.delta, accumulated: chunk.accumulated });
            }
          },
          conversationContext
        );
        accumulateUsage(retryResponse.usage);

        if (retryResponse.toolCalls && retryResponse.toolCalls.length > 0) {
          console.log(`[Tool Retry] Recovered ${retryResponse.toolCalls.length} valid tool call(s) after validation-feedback retry`);
          responseMessage = retryResponse.responseMessage;
          toolCalls = retryResponse.toolCalls;
          invalidToolCalls = retryResponse.invalidToolCalls;
        } else {
          // Still no valid tool calls — accept the retry's text response if it's
          // more substantial, and surface the failure clearly to the user.
          const retryContentStr = typeof retryResponse.responseMessage?.content === 'string'
            ? retryResponse.responseMessage.content
            : '';
          if (retryContentStr.trim().length > rawContentStr.trim().length) {
            responseMessage = retryResponse.responseMessage;
          }
          sendEvent('tool_error', {
            error: `The model was unable to produce valid tool calls after a correction retry. ${invalidToolCalls.length} attempt(s) failed schema validation. Try rephrasing your request or switching providers.`,
            details: { invalidCount: invalidToolCalls.length },
            continuing: false,
            retrying: false,
          });
        }
      } catch (retryErr) {
        console.error('[Tool Retry] Validation-feedback retry failed:', retryErr.message);
        sendEvent('tool_error', {
          error: `Tool-call retry failed: ${retryErr.message}`,
          continuing: true,
          retrying: false,
        });
      }
    }

    safePushAssistantMessage(messages, responseMessage);

    // Ensure agent execution record is ready before tool loop needs it
    await agentExecutionPromise;

    // Tool execution loop - LLM decides when to stop
    let currentRound = 0;
    const toolExecutionDetails = [];

    while (toolCalls && toolCalls.length > 0 && currentRound < config.maxToolRounds && !isClientDisconnected) {
      currentRound++;
      console.log(`[Tool Loop] Round ${currentRound}: Executing ${toolCalls.length} tool(s)`);

      // Per-user "Async tool execution" toggle. Default is OFF (experimental
      // opt-in). Strict-true check means any context that didn't go through
      // chatConfigs (and therefore lacks _frozenAsyncToolsEnabled) is treated
      // as disabled. When off, the prompt has no async guidance and the tool
      // schemas have no async params, so the LLM shouldn't try to use them.
      // Belt-and-suspenders: if a stale schema or in-flight turn slips one
      // through anyway, force it to sync below.
      const asyncToolsGloballyDisabled =
        conversationContext._frozenAsyncToolsEnabled !== true;

      // Build the set of (toolName + arg-fingerprint) being queued async this
      // round. Used to reject the LLM emitting BOTH an async + sync version of
      // the *same logical call* (same args) — which would dump a preview
      // answer into the queueing reply and double-output when the autonomous
      // follow-up later delivers the real result.
      //
      // Keyed on name + clean-args (control params stripped) so legitimately
      // distinct parallel calls — three `generate_image` with different
      // prompts, etc. — are NOT collapsed into a single fingerprint.
      //
      // Also skipped entirely when the global toggle is off: nothing will
      // actually queue async, so the dedup must be a no-op (otherwise sync
      // calls get rejected pointing at an async result that never arrives).
      const stripAsyncControlParams = (rawArgs) => {
        const a = { ...rawArgs };
        delete a._executeAsync;
        delete a._estimatedMinutes;
        delete a._interval;
        delete a._stopAfter;
        delete a._duration;
        delete a._delayFirst;
        return a;
      };
      const asyncQueuedFingerprints = new Set();
      if (!asyncToolsGloballyDisabled) {
        for (const tc of toolCalls) {
          try {
            const args = JSON.parse(tc.function.arguments);
            if (args && args._executeAsync === true) {
              asyncQueuedFingerprints.add(
                `${tc.function.name}::${JSON.stringify(stripAsyncControlParams(args))}`
              );
            }
          } catch {
            // Per-call parse error is reported separately downstream.
          }
        }
      }

      const toolPromises = toolCalls.map(async (toolCall) => {
        const functionName = toolCall.function.name;
        let functionArgs;
        let toolCallError = null;

        try {
          functionArgs = JSON.parse(toolCall.function.arguments);
        } catch (parseError) {
          toolCallError = `Failed to parse tool arguments: ${parseError.message}`;
          console.error(`Tool argument parsing failed for ${functionName}:`, toolCall.function.arguments, parseError);

          sendEvent('tool_end', { assistantMessageId, toolCall: { id: toolCall.id, name: functionName, error: toolCallError } });

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

        // CHECK IF LLM REQUESTED ASYNC EXECUTION via _executeAsync parameter.
        // The per-user toggle wins: if disabled globally for this user, treat
        // the call as sync regardless of what the LLM submitted. The schemas
        // and prompt should have prevented this, but a stale tool schema or a
        // leftover param in an in-flight turn can still arrive — fall back to
        // sync silently rather than fail the call.
        const llmRequestedAsync = functionArgs._executeAsync === true;
        if (llmRequestedAsync && asyncToolsGloballyDisabled) {
          console.warn(`[AsyncTool] User has async tools disabled; downgrading ${functionName} to sync.`);
        }
        const shouldExecuteAsync = llmRequestedAsync && !asyncToolsGloballyDisabled;
        const estimatedMinutes = functionArgs._estimatedMinutes || null;

        // Reject sync duplicates of the SAME logical call (same name + same
        // non-control args) that are ALSO being queued async in this batch.
        // Without this, the LLM can ask for `file_operations` both async
        // (delayed) and sync (preview) for the same path in one turn, then
        // dump the preview answer into the queueing reply — producing
        // duplicate output when the autonomous follow-up later delivers the
        // real result. Fingerprint match on args ensures legitimately distinct
        // parallel calls (e.g. three different `generate_image` prompts) are
        // NOT collapsed.
        const callFingerprint =
          `${functionName}::${JSON.stringify(stripAsyncControlParams(functionArgs))}`;
        const isDuplicateSyncOfAsyncTool =
          !shouldExecuteAsync && asyncQueuedFingerprints.has(callFingerprint);

        // Pass raw args to AsyncToolQueue - it strips control params internally
        // For sync execution, strip them here
        const cleanArgs = { ...functionArgs };
        delete cleanArgs._executeAsync;
        delete cleanArgs._estimatedMinutes;
        delete cleanArgs._interval;
        delete cleanArgs._stopAfter;
        delete cleanArgs._duration;
        delete cleanArgs._delayFirst;

        // Preserved before offloading to avoid DATA_REF placeholders in frontend events
        let preservedFrontendEvents = null;

        if (isDuplicateSyncOfAsyncTool) {
          console.warn(`[AsyncTool] Rejecting sync duplicate of async-queued tool: ${functionName}`);
          const dupError = {
            success: false,
            error: `Tool "${functionName}" was already queued asynchronously in this same turn. The sync duplicate is rejected to prevent double-output. The async result will arrive via autonomous message — do not preview the answer; wait for it.`,
            hint: 'Reply only acknowledges the queue (e.g. "Started X in the background, results coming"). Do not include the actual answer data — that arrives in a separate autonomous message.',
          };
          functionResponseContent = JSON.stringify(dupError);
          toolCallResult = dupError;
        } else if (shouldExecuteAsync) {
          console.log(`[AsyncTool] ${chatType === 'agent' ? 'Agent' : 'Orchestrator'} requested async execution for: ${functionName}`);

          // Validate async control params up-front. Without this, _interval: 0
          // silently degrades to one-shot, and orphan _stopAfter / _duration /
          // _delayFirst (without _interval) are silently dropped — the LLM
          // gets a misleading "queued" success and the wrong shape runs.
          const asyncValidation = asyncToolQueue.validateAsyncParams(functionArgs);
          if (!asyncValidation.valid) {
            console.warn(`[AsyncTool] Validation failed for ${functionName}: ${asyncValidation.error}`);
            const validationError = {
              success: false,
              error: asyncValidation.error,
              hint: 'Adjust the async control parameters and retry.',
            };
            functionResponseContent = JSON.stringify(validationError);
            toolCallResult = validationError;
            // Skip enqueue; downstream handling at the end of the .map callback
            // wraps this synthetic error into the tool-result message so the
            // LLM sees it on its next turn and self-corrects.
          } else {

          const estimatedDuration = estimatedMinutes
            ? estimatedMinutes * 60 * 1000
            : (functionArgs._interval && Number(functionArgs._stopAfter) === 1
              ? Number(functionArgs._interval) * 1000
              : null);

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
                if (progressData?.type === 'iteration_complete') {
                  return;
                }
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
            // Execute function wrapper — single dispatcher across all chat surfaces
            async (args, onProgress) => {
              console.log(`[AsyncTool] Executing ${functionName} for ${chatType} chat`);
              return await executeTool(functionName, args, authToken, conversationContext);
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
          } // End of valid-async-params else branch
        } else {
          // SYNCHRONOUS TOOL EXECUTION — single dispatcher across all chat surfaces
          try {
            let rawFunctionResponse = await executeTool(functionName, functionArgs, authToken, conversationContext);

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
            const originalSize = functionResponseContent.length;
            console.log(`[Context Protection] Tool ${functionName} result too large (${originalSize} chars), truncating to ${MAX_TOOL_RESULT_CHARS}`);

            // Build a JSON-valid truncation envelope. NEVER raw-substring-cut the payload —
            // that corrupts JSON whenever the cut lands inside a string literal, which then
            // breaks JSON.parse downstream.
            const buildTruncationEnvelope = (extra = {}) =>
              JSON.stringify({
                success: false,
                _truncated: true,
                _original_size: originalSize,
                _max_size: MAX_TOOL_RESULT_CHARS,
                error: `Tool ${functionName} result exceeded the ${MAX_TOOL_RESULT_CHARS}-char context-protection cap.`,
                suggestion:
                  'Request a narrower query, paginate, or call a more specific tool (e.g. fetch schema for a single item instead of listing all items with full detail).',
                ...extra,
              });

            try {
              const parsed = JSON.parse(functionResponseContent);

              // Try to create a meaningful, JSON-valid summary for known shapes.
              if (parsed && parsed.success !== undefined && Array.isArray(parsed.result)) {
                const summary = {
                  ...parsed,
                  result: parsed.result.slice(0, 10),
                  _truncated: true,
                  _original_size: originalSize,
                  _total_count: parsed.result.length,
                  _note: `Showing first 10 of ${parsed.result.length} items. Full data was sent to the frontend.`,
                };
                functionResponseContent = JSON.stringify(summary);
              } else {
                // Unknown object shape — preserve top-level keys as a hint but drop the values.
                const topLevelKeys =
                  parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
                functionResponseContent = buildTruncationEnvelope({
                  _top_level_keys: topLevelKeys,
                });
              }
            } catch {
              // Payload wasn't valid JSON to begin with — still emit a valid envelope.
              functionResponseContent = buildTruncationEnvelope();
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

        sendEvent('tool_end', { assistantMessageId, toolCall: { id: toolCall.id, name: functionName, result: toolCallResult, error: toolCallError } });

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

      // Drain any user steers that arrived during this round and append them
      // to the last tool-result message. The model picks them up on the next
      // LLM call without us starting a new turn.
      const steerText = drainSteer(conversationId);
      if (steerText) {
        applySteerToLastToolResult(messages, steerText);
        sendEvent('steering_applied', { content: steerText, round: currentRound });
        console.log(`[Steering] Applied steer at round ${currentRound} (${steerText.length} chars)`);
      }

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

      // Apply context management before next LLM call — but only if critically close
      // to the limit. Within a single turn's tool loop, the message prefix should stay
      // stable to preserve prompt cache hits. Between turns, the prefix changes anyway.
      let loopContextResult = manageContext(messages, model, finalToolSchemas, normalizedProvider);
      const utilization = loopContextResult.contextWindow > 0
        ? (loopContextResult.totalRequestTokens / loopContextResult.contextWindow)
        : 0;
      if (utilization < 0.95 && loopContextResult.wasManaged) {
        // Skip context management — utilization is below 95%, preserve cache
        console.log(`[Cache] Skipping context management in tool loop to preserve cache (utilization: ${(utilization * 100).toFixed(1)}%)`);
        loopContextResult = { ...loopContextResult, wasManaged: false, messages };
      }
      if (loopContextResult.wasManaged) {
        console.log(`[Tool Loop] Context managed: ${loopContextResult.originalTokens} -> ${loopContextResult.managedTokens} tokens`);
        messages = loopContextResult.messages;
        sendEvent('context_managed', {
          originalTokens: loopContextResult.originalTokens,
          managedTokens: loopContextResult.managedTokens,
          tokenLimit: loopContextResult.tokenLimit,
          round: currentRound,
        });
      }

      // Emit updated context status so the UI reflects the growing message
      // history after each tool round (user sees tool_result bytes added).
      sendEvent('context_status', {
        currentTokens: loopContextResult.totalRequestTokens,
        tokenLimit: loopContextResult.contextWindow,
        utilizationPercent: (loopContextResult.totalRequestTokens / loopContextResult.contextWindow) * 100,
        model: model,
        messagesCount: loopContextResult.messages.length,
        breakdown: {
          systemTokens: loopContextResult.systemTokens,
          toolTokens: loopContextResult.toolTokens,
          messagesTokens: loopContextResult.messagesTokens,
          outputBufferTokens: loopContextResult.outputBufferTokens,
          totalRequestTokens: loopContextResult.totalRequestTokens,
        },
      });

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
      //
      // CRITICAL: extract text properly. Earlier this code did
      // `JSON.stringify(responseMessage.content)` which serialized Anthropic
      // array shapes verbatim — the user saw raw `[{"type":"text",...}]` in
      // chat. Use extractDisplayText so arrays unwrap correctly, and
      // scrubEmptyPlaceholder so the bookkeeping placeholder
      // ("[The model returned an empty response.]") never reaches the UI.
      if (nextResponse.recoveredFromError && responseMessage.content) {
        const extracted = extractDisplayText(responseMessage.content);
        const scrubbed = scrubEmptyPlaceholder(extracted);
        // Diagnostic: empty responses are usually a streaming bug or a
        // tool-call-only turn the adapter mistakenly classified as empty.
        // Log enough to identify which provider/model/round triggered it.
        if (!scrubbed) {
          console.warn(
            `[Empty Response] provider=${normalizedProvider} model=${model} ` +
            `round=${currentRound} chatType=${chatType} recoveredError="${nextResponse.recoveredError || 'unknown'}" ` +
            `→ suppressing placeholder from chat stream`
          );
        }
        // Fall back to a real error sentence when we have nothing to show.
        const errorContent = scrubbed
          || `API Error: ${typeof nextResponse.recoveredError === 'string' ? nextResponse.recoveredError : String(nextResponse.recoveredError || 'empty response')}`;
        sendEvent('content_delta', {
          assistantMessageId,
          delta: errorContent,
          accumulated: errorContent,
        });
      }

      safePushAssistantMessage(messages, responseMessage);

      // Log what happened in this round
      if (toolCalls && toolCalls.length > 0) {
        console.log(`[Tool Loop] Round ${currentRound}: LLM made ${toolCalls.length} more tool call(s), continuing loop`);
      } else {
        console.log(`[Tool Loop] Round ${currentRound}: LLM provided final response, ending loop`);
      }
    }

    // The between-rounds drain only fires when there's a next round. If the
    // turn ended on a final response (no more tool calls), any steer queued
    // during that final stream is still parked. Clear it here so the
    // frontend's auto-fire (which resends the steer text as a fresh user
    // turn) doesn't double-apply on the next POST.
    if (drainSteer(conversationId)) {
      console.log(`[Steering] Cleared leftover steer for ${conversationId} (turn ended without drain — frontend will auto-fire)`);
    }

    if (currentRound >= config.maxToolRounds) {
      console.warn(`[Tool Loop] Maximum rounds (${config.maxToolRounds}) reached, forcing completion`);
      sendEvent('error', {
        error: `Maximum tool call rounds (${config.maxToolRounds}) reached. Stopping to prevent infinite loop.`,
      });
    }

    // Extract final content — always extract text from content arrays.
    // scrubEmptyPlaceholder collapses the bookkeeping placeholder to ''; the
    // safety-net follow-up below will then trigger a real summary turn.
    finalContentForLogging = scrubEmptyPlaceholder(extractDisplayText(responseMessage.content));

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
        if (followUpContext.wasManaged) {
          messages = followUpContext.messages;
        }
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
          finalContentForLogging = scrubEmptyPlaceholder(
            extractDisplayText(followUpResponse.responseMessage.content)
          );
          safePushAssistantMessage(messages, followUpResponse.responseMessage);
        }
      } catch (followUpError) {
        console.error('[Tool Loop] Follow-up LLM call failed:', followUpError.message);
      }
    }

    // Send final content event. Final scrub here covers any code path that
    // set finalContentForLogging without going through extractDisplayText —
    // the placeholder must never reach the chat UI.
    sendEvent('final_content', {
      assistantMessageId,
      content: scrubEmptyPlaceholder(finalContentForLogging),
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
      content: scrubEmptyPlaceholder(finalContentForLogging),
      recovered_from_error: true,
    });
  } finally {
    // Ensure every tool_use / tool_call has a matching tool_result. When the client
    // disconnects mid-run (Stop button), the tool loop is skipped and the assistant's
    // tool_use block is saved without a result — the next turn then fails with
    // "tool_use ids were found without tool_result blocks immediately after".
    messages = sanitizeOrphanToolCalls(messages);
    messages = sanitizeEmptyAssistantMessages(messages);

    // Log conversation
    const logData = {
      conversationId,
      userId: userId,
      initial_prompt: message || (originalMessages && originalMessages[originalMessages.length - 1]?.content),
      full_history: JSON.stringify(messages),
      // Persist a clean final_response — old reloads of this conversation
      // would otherwise re-render the bookkeeping placeholder as the saved
      // assistant text. The full_history above keeps the placeholder intact
      // because subsequent provider calls still need the non-empty padding.
      final_response: scrubEmptyPlaceholder(finalContentForLogging),
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
        // Cost calc accounts for cache read/write multipliers (e.g. Anthropic cache
        // reads are 0.1× base input rate). Without this, cached traffic was being
        // overcharged 10× in the displayed/persisted cost.
        let tokenUsageForDb = null;
        if (tokenAccumulator.totalTokens > 0) {
          const costInfo = getModelCost(
            normalizedProvider,
            model,
            tokenAccumulator.inputTokens,
            tokenAccumulator.outputTokens,
            {
              cacheReadTokens: tokenAccumulator.cacheReadTokens,
              cacheCreation5mTokens: tokenAccumulator.cacheCreation5mTokens,
              cacheCreation1hTokens: tokenAccumulator.cacheCreation1hTokens,
            }
          );
          tokenUsageForDb = {
            inputTokens: tokenAccumulator.inputTokens,
            outputTokens: tokenAccumulator.outputTokens,
            totalTokens: tokenAccumulator.totalTokens,
            estimatedCost: costInfo?.totalCost || 0,
            cacheReadTokens: tokenAccumulator.cacheReadTokens,
            cacheCreationTokens: tokenAccumulator.cacheCreationTokens,
          };
          const write5m = tokenAccumulator.cacheCreation5mTokens;
          const write1h = tokenAccumulator.cacheCreation1hTokens;
          const uncached = tokenAccumulator.inputTokens - tokenAccumulator.cacheReadTokens - tokenAccumulator.cacheCreationTokens;
          const cacheInfo = (tokenAccumulator.cacheReadTokens > 0 || tokenAccumulator.cacheCreationTokens > 0)
            ? ` (cache: ${tokenAccumulator.cacheReadTokens} read, ${write5m} write-5m, ${write1h} write-1h, ${uncached} uncached)`
            : '';
          console.log(`[Token Usage] ${tokenAccumulator.inputTokens} in${cacheInfo} / ${tokenAccumulator.outputTokens} out = ${tokenAccumulator.totalTokens} total, est. cost: $${(tokenUsageForDb.estimatedCost || 0).toFixed(6)}`);
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
          cacheMetrics: (tokenAccumulator.cacheReadTokens > 0 || tokenAccumulator.cacheCreationTokens > 0) ? {
            cacheReadTokens: tokenAccumulator.cacheReadTokens,
            cacheCreationTokens: tokenAccumulator.cacheCreationTokens,
            cacheCreation5mTokens: tokenAccumulator.cacheCreation5mTokens,
            cacheCreation1hTokens: tokenAccumulator.cacheCreation1hTokens,
            uncachedTokens: tokenAccumulator.inputTokens - tokenAccumulator.cacheReadTokens - tokenAccumulator.cacheCreationTokens,
            hitRate: tokenAccumulator.inputTokens > 0
              ? ((tokenAccumulator.cacheReadTokens / tokenAccumulator.inputTokens) * 100).toFixed(1)
              : '0',
          } : undefined,
          estimatedCost: tokenUsageForDb?.estimatedCost || 0,
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
      chatType, // Routes autonomous follow-up events to the right chat surface
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

    clearInterval(heartbeatInterval);
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
    const systemPrompt = await config.buildSystemPrompt({ agentContext });

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


async function getAvailableTools(req, res) {
  try {
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

    // Plugin tool names — anything truly user-installed via the .agnt plugin
    // pipeline. We compute this first so we can subtract it from "Built In".
    const pluginNameSet = new Set();
    const pluginTools = toolRegistry.getAllPluginTools().map((t) => {
      const name = t.openApiSchema?.function?.name || t.type.replace(/-/g, '_');
      pluginNameSet.add(name);
      return {
        name,
        description: t.description || schemaMap.get(name)?.description || '',
        pluginName: t.pluginName || null,
      };
    });

    // MCP tool categories — a single top-level "MCP" group with one
    // subcategory per discovered server. Names are namespaced as
    // `mcp__server__tool` and MUST be excluded from "Built In" below so
    // they only appear in their own MCP category. Without this exclusion
    // the same tool appears in both lists, and toggling either category's
    // group checkbox flips the shared state in both — the "conflict" the
    // user sees in the dropdown.
    //
    // Recurses into subcategories: the parent MCP group has empty
    // `tools: []` and the real tools live in `subcategories[].tools`.
    let mcpCategories = [];
    const mcpNameSet = new Set();
    const collectToolNames = (cat) => {
      for (const tool of cat.tools || []) {
        if (tool.name) mcpNameSet.add(tool.name);
      }
      for (const sub of cat.subcategories || []) {
        collectToolNames(sub);
      }
    };
    try {
      const { default: MCPToolService } = await import('./MCPToolService.js');
      mcpCategories = await MCPToolService.getCategories();
      for (const cat of mcpCategories) {
        collectToolNames(cat);
      }
    } catch (err) {
      console.warn('[OrchestratorService] Failed to load MCP categories:', err.message);
    }

    // Built In = everything else surfaced by getAvailableToolSchemas().
    // The unified registry now aggregates from many internal sources (native,
    // agent, workflow, goal, code, tool-forge, widget, registry library),
    // so we treat the schemaMap as the source of truth and exclude plugin
    // and MCP tools — those have their own categories.
    const builtInTools = [];
    for (const [name, info] of schemaMap) {
      if (pluginNameSet.has(name)) continue;
      if (mcpNameSet.has(name)) continue;
      builtInTools.push({ name, description: info.description });
    }
    builtInTools.sort((a, b) => a.name.localeCompare(b.name));

    // Build response in the canonical order:
    //   1. Built In  (the frontend re-splits this into Specialty Tools +
    //      System Built In Tools — Specialty bubbles to the top, locked)
    //   2. Plugins
    //   3. MCP  (single top-level entry; per-server entries are nested
    //      subcategories inside it, kept hierarchical so users with many
    //      MCP servers don't get a flat wall of top-level categories)
    const categories = [
      {
        id: 'builtin',
        name: 'Built In',
        description: 'Tools that ship with AGNT — system, agents, workflows, widgets, tool forge, code, and platform integrations.',
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

    // mcpCategories is now a single-element array containing the parent
    // "MCP" group with `subcategories: [<server>, <server>, ...]`. Append
    // it last so it sits beneath Built In + Plugins in the dropdown.
    for (const cat of mcpCategories) {
      categories.push(cat);
    }

    res.json({ categories });
  } catch (error) {
    console.error('Error getting available tools:', error);
    res.status(500).json({ error: 'Failed to get available tools' });
  }
}

export default universalChatHandler;
export { getAvailableTools };
