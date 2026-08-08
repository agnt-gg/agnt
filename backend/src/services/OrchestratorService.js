import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { executeTool } from './orchestrator/tools.js';
import ConversationLogModel from '../models/ConversationLogModel.js';
import AgentExecutionModel from '../models/AgentExecutionModel.js';
import { createLlmClient } from './ai/LlmService.js';

// Per-conversation failover memory for the recovery banner (Option 2).
// When a turn fails over, we record { conversationId -> { provider, model } }.
// On a later turn where the PRIMARY (default) tier wins, we emit
// 'provider_recovered' and clear the entry. Ephemeral, per-process, tiny.
const __failoverMemory = new Map();
import { createLlmAdapter, requiresResponsesApi } from './orchestrator/llmAdapters.js';
import { buildProviderChain, runWithFallback, createCustomProviderIdResolver } from './orchestrator/ProviderFallback.js';
import CustomOpenAIProviderService from './ai/CustomOpenAIProviderService.js';
import { computeCacheSavings } from '../utils/cacheSavings.js';
import { recordLlmCall } from './execution/LedgerRecorder.js';
import { updateEstimateCalibration, computeResidualDrift } from '../utils/contextManager.js';
import { isSubscriptionProvider, providerSupportsTools } from './ai/providerConfigs.js';
import { manageContext, getContextBudget, estimateToolTokens, estimateTokens } from '../utils/contextManager.js';
import { capToolsToBudget, computeToolBudget, getToolCountLimit } from './orchestrator/toolSelector.js';
import { buildContextManifest, TOKEN_UNIT_RAW } from './orchestrator/contextManifest.js';
import { buildEconomics } from '../utils/contextEconomics.js';
import { promptCacheTtlMs } from '../utils/promptCacheTtl.js';
import { readOpenAiShapedCacheUsage } from '../utils/usageCacheFields.js';
import {
  getCalibration,
  recordCalibration,
  loadCalibrations,
} from './orchestrator/calibrationStore.js';
import { detectChatType, getChatConfig } from './orchestrator/chatConfigs.js';
import { pickPageContext } from './orchestrator/pageContext.js';
import { findBlockingMissingParams, formatMissingParamsError } from './orchestrator/toolArgGuard.js';
import log from '../utils/logger.js';
import OpenAI from 'openai';
import AuthManager from './auth/AuthManager.js';
import StreamEngine from '../stream/StreamEngine.js';
import db from '../models/database/index.js';
import { getRawTextFromPDFBuffer, getRawTextFromDocxBuffer } from '../stream/utils.js';
import { broadcastToUser, RealtimeEvents } from '../utils/realtimeSync.js';
import { startRun, publish as publishToRun, endRun } from './orchestrator/activeRuns.js';
import { isGlobalFrontendEvent } from './orchestrator/globalFrontendEvents.js';
import * as ProviderRegistry from './ai/ProviderRegistry.js';
import asyncToolQueue from './AsyncToolQueue.js';
import conversationManager from './ConversationManager.js';
import { loadConversationState, saveConversationState } from './orchestrator/conversationStateStore.js';
import autonomousMessageService from './AutonomousMessageService.js';
import { shouldTriggerAutonomousFollowup } from './orchestrator/autonomousFollowupConfig.js';
import UserModel from '../models/UserModel.js';
import AgentModel from '../models/AgentModel.js';
import SkillModel from '../models/SkillModel.js';
import { buildSkillsContext } from './SkillService.js';
import { createSession as createUnfirehoseSession, wrapSendEvent as wrapUnfirehoseSendEvent, isEnabled as isUnfirehoseEnabled, deriveProjectSlug as deriveUnfirehoseProjectSlug } from './unfirehose/UnfirehoseLogger.js';
import { saveBase64Image } from './ImageStorage.js';
import pathManager from '../utils/PathManager.js';
import {
  sanitizeOrphanToolCalls,
  sanitizeUnexpectedToolResults,
  sanitizeEmptyAssistantMessages,
  safePushAssistantMessage,
  extractDisplayText,
  scrubEmptyPlaceholder,
} from './orchestrator/messageSanitizers.js';


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

// Minimal synthetic assistant turn used to restore strict user/assistant
// alternation on Anthropic before the steer lands as its own user turn.
// Deliberately states only what it is — it must not put reasoning or content
// into the model's mouth.
const STEER_BRIDGE_TEXT = '(Mid-run instruction received from the user.)';

/**
 * Deliver a mid-run steer as a first-class USER turn, shaped for whichever
 * provider produced the tool results currently at the tail of `messages`.
 *
 * WHY THIS IS NOT A `role:'tool'` APPEND ANY MORE
 * ------------------------------------------------
 * The previous implementation scanned backwards for a `role:'tool'` message
 * and appended the steer text to its content. Only OpenAI-style adapters ever
 * emit that role. `AnthropicAdapter.formatToolResults` returns
 * `{ role:'user', content:[tool_result...] }` and `GeminiAdapter` returns
 * `{ role:'user', parts:[functionResponse...] }` — so on those providers the
 * scan found no anchor and fell through to pushing a bare
 * `{ role:'user', content:<string> }`.
 *
 * On Anthropic that stray user message is then merged into the tool_result
 * message by `_normalizeHistoryMessages` (llmAdapters.js), producing
 * `[tool_result, ..., text]` — the exact shape Anthropic documents as
 * "never add text blocks immediately after tool results", and which
 * llmAdapters.js:1570-1584 already flags as a known cause of degenerate
 * end_turn responses. Net effect: the steer rendered correctly in the UI but
 * never actually steered the model.
 *
 * Returns a short tag describing the shape used (for logs + tests).
 */
function applySteerAsUserTurn(messages, steerText) {
  const text = `[USER STEER — mid-run instruction from the user, not tool output]\n${steerText}`;
  const last = messages[messages.length - 1];

  // Anthropic: tool results are a user message of tool_result blocks. A second
  // user message would be merged into it, so bridge with a minimal assistant
  // turn to keep the steer a separate, first-class user turn.
  if (
    last && last.role === 'user' && Array.isArray(last.content) &&
    last.content.some((b) => b && b.type === 'tool_result')
  ) {
    messages.push({ role: 'assistant', content: [{ type: 'text', text: STEER_BRIDGE_TEXT }] });
    messages.push({ role: 'user', content: text });
    return 'anthropic-bridged';
  }

  // Gemini: parts-based history. A `content` field would be dropped on
  // conversion, and a second consecutive user turn risks a role-alternation
  // rejection, so append a text part to the same user turn.
  if (last && Array.isArray(last.parts)) {
    last.parts = [...last.parts, { text }];
    return 'gemini-parts';
  }

  // OpenAI-style (chat completions + Responses/Codex): a user turn may legally
  // follow `role:'tool'` results, and that is the semantically honest shape —
  // the steer is user input, not tool output.
  messages.push({ role: 'user', content: text });
  return 'user-turn';
}

// Open a fresh assistant bubble after a steer landed, and return its id.
//
// A turn streams into ONE assistant message for its whole life. The client
// renders an ordered transcript, so a steer appended at the tail sits BELOW an
// assistant bubble that is still receiving deltas -- meaning every word the
// agent says in response to the steer renders ABOVE the steer that caused it.
// Minting a new id splits the turn at the seam:
//
//   [assistant: pre-steer]  [user: steer]  [assistant: post-steer]
//
// Callers MUST assign the return value to the live assistantMessageId so that
// all later content_delta / tool_start / tool_end / final_content events
// address the continuation bubble instead of the sealed one.
export { applySteerAsUserTurn, STEER_BRIDGE_TEXT };

export function openSteerContinuation(sendEvent, { round, agentMeta = {} } = {}) {
  const id = `msg-asst-${Date.now()}-s${round}`;
  sendEvent('assistant_message', {
    id,
    assistantMessageId: id,
    role: 'assistant',
    content: '',
    toolCalls: [],
    timestamp: Date.now(),
    steerContinuation: true,
    ...agentMeta,
  });
  return id;
}


/**
 * Inject the current date into the latest user message.
 *
 * Cache-safe: only mutates the trailing user turn (already below Anthropic's
 * cache breakpoint), system prompt stays frozen.
 *
 * Format intent: tiny + unobtrusive. The previous verbose `Date.toString()`
 * prefix at the top of every user message biased the LLM toward
 * time/date-themed responses. Now we use a compact ISO date footer so the
 * model still has the info if asked, but the user's actual prompt sits at
 * the very top of the message where it belongs.
 */
function injectDateIntoLastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
      const isoDate = new Date().toISOString().slice(0, 10); // "2024-11-09"
      messages[i].content = `${messages[i].content}\n\n<context date="${isoDate}" />`;
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
 * Retroactively compact the message history by offloading any tool message
 * whose content exceeds a size threshold. Catches bloat that bypassed the
 * per-tool offload pass — e.g. tool results from chat surfaces that skipped
 * offloading (artifact chat), tool results produced before the offload
 * system existed, or fields below the per-field threshold whose aggregate
 * is still large.
 *
 * Compaction reuses offloadLargeData when the tool message content is
 * JSON-shaped (it can recurse into fields and offload only the large
 * substrings, preserving structural keys). For non-JSON tool content that
 * is still huge, it falls back to a whole-message offload using the same
 * preservedContent/dataRefSummaries store query_data already understands.
 *
 * Messages that already contain a {{DATA_REF}} marker are skipped — they
 * have already been compacted in a prior pass.
 *
 * @param {Array} messages - Conversation messages array
 * @param {object} conversationContext - Conversation context (mutated)
 * @param {number} threshold - Character threshold for compaction
 * @returns {{ messages: Array, compactedCount: number, compactedBytes: number }}
 */
function compactMessageHistory(messages, conversationContext, threshold = 50000) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, compactedCount: 0, compactedBytes: 0 };
  }

  let compactedCount = 0;
  let compactedBytes = 0;

  const compacted = messages.map((msg, idx) => {
    if (!msg || msg.role !== 'tool') return msg;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.length <= threshold) return msg;
    // Already-compacted messages carry the marker — leave them alone.
    if (content.includes('{{DATA_REF:')) return msg;

    const callId = msg.tool_call_id || `historical-${idx}-${Date.now()}`;

    // Path A: try structural offload on JSON-shaped content. This preserves
    // the surrounding tool-result envelope (success flags, paths, etc.) and
    // only offloads the large string fields nested inside.
    const { modifiedResult, offloadedData } = offloadLargeData(content, callId, conversationContext, threshold);
    if (offloadedData.length > 0 && typeof modifiedResult === 'string' && modifiedResult.length < content.length) {
      compactedCount++;
      compactedBytes += content.length - modifiedResult.length;
      console.log(
        `[History Compact] Offloaded tool message (${content.length} -> ${modifiedResult.length} chars, ` +
        `${offloadedData.length} field${offloadedData.length === 1 ? '' : 's'}, call_id=${callId})`
      );
      return { ...msg, content: modifiedResult };
    }

    // Path B: non-JSON or unstructured content. Offload the whole message
    // body as a single opaque blob into the same preserved store, then
    // replace the content with a placeholder + summary the LLM can route
    // through query_data.
    const dataId = `data-${callId}-historical-${idx}`;
    if (!conversationContext.preservedContent) conversationContext.preservedContent = {};
    if (!conversationContext.dataRefSummaries) conversationContext.dataRefSummaries = {};
    conversationContext.preservedContent[dataId] = content;
    const summary = generateDataSummary(content, dataId);
    conversationContext.dataRefSummaries[dataId] = summary;

    const placeholderLines = [
      `[Offloaded historical data: ${dataId}] (${summary.type}, ${summary.size} chars, ${summary.lineCount} lines)`,
    ];
    if (summary.preview) {
      placeholderLines.push(`Preview: ${summary.preview.substring(0, 300).replace(/\n/g, ' ')}`);
    }
    placeholderLines.push(`[Use query_data tool with dataId="${dataId}" to search/extract]`);
    placeholderLines.push(`Reference: {{DATA_REF:${dataId}}}`);
    const placeholder = placeholderLines.join('\n');

    compactedCount++;
    compactedBytes += content.length - placeholder.length;
    console.log(
      `[History Compact] Offloaded tool message as opaque blob ` +
      `(${content.length} -> ${placeholder.length} chars, dataId=${dataId})`
    );
    return { ...msg, content: placeholder };
  });

  return { messages: compacted, compactedCount, compactedBytes };
}

/**
 * REMOVED: isAsyncTool() function
 * Async execution is now determined by the _executeAsync parameter in tool arguments
 * ANY tool can be run async by the LLM adding: _executeAsync: true, _estimatedMinutes: N
 */

// Uploads land beside the DB and images at the canonical AGNT data root.
// See PRD-060 for resolver semantics.
const resolveUploadsDir = () => path.join(pathManager.getDataDir(), 'uploads');

const sanitizeFilename = (name) => {
  const base = path.basename(String(name || 'file'));
  return base.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 200) || 'file';
};

// Anthropic (and most vision APIs) sniff the actual bytes and reject when the
// declared media_type doesn't match. Browsers derive File.type from the OS
// extension association, not from the bytes — so a JPEG saved with a .png
// extension propagates as image/png all the way to the API and 400s.
// This sniffer reads the leading bytes and returns the true media_type, or
// null when the format isn't one Anthropic/OpenAI/Gemini accept inline.
function detectImageMediaType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // GIF: "GIF8"
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  // WebP: "RIFF"...."WEBP"
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return 'image/webp';
  return null;
}

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
    const declaredType = file.mimetype;
    // For images, trust magic bytes over the browser-declared mimetype.
    // Falls back to declaredType for non-image saves.
    const sniffedImageType = declaredType.startsWith('image/') ? detectImageMediaType(fileBuffer) : null;
    const isImage = declaredType.startsWith('image/') || !!sniffedImageType;
    const fileType = sniffedImageType || declaredType;
    if (sniffedImageType && sniffedImageType !== declaredType) {
      console.warn(`[Upload] Image media type mismatch for ${file.originalname}: declared=${declaredType}, actual=${sniffedImageType} (using sniffed)`);
    }
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

    if (isImage) {
      // Handle images - store for vision models.
      // unsupported=true marks formats no inline-vision API accepts (BMP, SVG, HEIC, AVIF, …)
      // so adapters can skip injection cleanly instead of 400-ing.
      const supported = sniffedImageType !== null;
      imageData.push({
        type: fileType,
        data: fileBuffer.toString('base64'),
        filename: file.originalname,
        unsupported: !supported,
      });
      if (supported) {
        console.log(`[Vision] Prepared image for vision model: ${file.originalname} (${fileType})`);
      } else {
        console.warn(`[Vision] Image ${file.originalname} (declared ${declaredType}) is not a format supported inline by vision APIs; will be skipped at injection.`);
      }
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

  // Multipart bodies (used when files are attached) arrive with every field as
  // a string. The downstream destructure expects `messages`, `pageContext`,
  // `pageState`, `agentContext`, etc. as objects/arrays, so decode any field
  // whose string value looks like JSON. Non-JSON strings are left untouched.
  if (files.length > 0 && req.body && typeof req.body === 'object') {
    for (const [k, v] of Object.entries(req.body)) {
      if (typeof v !== 'string') continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      const first = trimmed[0];
      if (first !== '{' && first !== '[') continue;
      try { req.body[k] = JSON.parse(trimmed); } catch { /* leave as string */ }
    }
  }

  // Per-user tunable runtime caps (Settings → AI Provider). One DB fetch
  // covers both knobs — toolOutputCap (hard cap on tool result size returned
  // to the LLM) and maxToolRounds (cap on tool-loop rounds per turn).
  // Falls back to the historical defaults when the user record is missing or
  // the columns are null on legacy rows.
  let toolOutputCap = 100000;
  let maxToolRoundsOverride = null;
  if (userId) {
    try {
      const _userRuntimeSettings = await UserModel.getUserSettings(userId);
      if (Number.isFinite(_userRuntimeSettings.toolOutputCap)) {
        toolOutputCap = _userRuntimeSettings.toolOutputCap;
      }
      if (Number.isFinite(_userRuntimeSettings.maxToolRounds) && _userRuntimeSettings.maxToolRounds > 0) {
        maxToolRoundsOverride = _userRuntimeSettings.maxToolRounds;
      }
    } catch (e) {
      console.warn('[Chat] Could not load runtime caps from user settings:', e.message);
    }
  }

  // Detect chat type and get configuration
  const chatType = detectChatType(req, context);
  // getChatConfig returns a shared object — clone before mutating so per-user
  // overrides never leak into other requests.
  let config = { ...getChatConfig(chatType) };
  // Apply user override uniformly: replaces the per-surface default
  // (orchestrator/agent/tool/widget/goal=100, workflow/artifact=25). The
  // suggestions surface keeps its own 0 cap — it never enters this handler.
  if (maxToolRoundsOverride !== null) {
    config.maxToolRounds = maxToolRoundsOverride;
  }

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
    // One Canvas chats send their own workspace identity in pageState. The
    // canvas tools address their writes to it, so a widget asked for in one
    // workspace cannot land in another when the user switches tabs mid-turn.
    workspaceState,
    // This turn will be SPOKEN as well as shown, so the answer is asked for in
    // two registers — a short opening paragraph for the voice, the detail after
    // a blank line for the screen (system-prompts/voiceRegister.js).
    voiceMode,
    // When false, use this turn's provider/model but do NOT persist them as the
    // account-wide default. Sent by per-workspace-provider turns so that using a
    // tab with its own provider never rewrites the user's global default.
    // Defaults true → existing callers are unaffected.
    persistDefault = true,
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
  // NOTE: normalizedProvider/model are LET (not const) because automatic
  // provider failover (buildProviderChain/runWithFallback) may re-point them
  // to a fallback tier for the remainder of the turn if the primary provider
  // exhausts its retries on the first LLM call.
  let normalizedProvider = resolvedProvider.toLowerCase();
  let model = resolvedModel;

  // Keep DB in sync with the provider/model the frontend is actually using,
  // so background processes (InsightEngine, etc.) always have current values.
  //
  // GUARDED: a per-workspace-provider turn passes persistDefault=false (or a
  // workspaceState carrying its own ai override), meaning "use this provider
  // for THIS turn only". In that case we must NOT write it back as the global
  // default, or selecting a provider for one workspace/tab would silently
  // change the account-wide default for every other surface.
  const workspaceHasAiOverride = !!(workspaceState && workspaceState.ai && workspaceState.ai.provider);
  // FormData turns (file uploads) transmit persistDefault as the STRING
  // 'false', which is truthy — normalize both encodings before the guard.
  const persistDefaultNormalized = !(persistDefault === false || persistDefault === 'false');
  if (persistDefaultNormalized && !workspaceHasAiOverride) {
    UserModel.updateUserSettings(userId, {
      selectedProvider: resolvedProvider,
      selectedModel: model,
    }).catch(e => {
      console.warn('[Chat] Failed to sync provider/model to DB (non-critical):', e.message);
    });
  } else {
    console.debug('[Chat] Skipping default-provider write-back (turn-only provider).');
  }

  // Build the automatic-failover provider chain for THIS TURN ONLY.
  // tier 0 = the primary above; tiers 1..3 = the user's configured fallbacks.
  // We load settings unconditionally here (the earlier settings fetch is
  // block-scoped inside the provider-resolution branch and may not have run).
  // Any failure fails safe to a single-tier chain = today's behavior.
  // IMPORTANT: this must NOT persist the fallback provider as the default —
  // the sync above already recorded the PRIMARY, and we never call
  // updateUserSettings with a fallback tier.
  let providerChain = [{ provider: normalizedProvider, model, tier: 0, primary: true }];
  try {
    // Custom OpenAI-compatible providers are keyed by UUID and are absent from
    // ProviderRegistry, so buildProviderChain drops them unless we hand it the
    // user's active ids. createLlmAdapter already resolves such a provider at
    // call time, so a custom tier runs fine once it survives chain building.
    //
    // LAZY: this is a SQLite query on the per-turn hot path, and failover is
    // off by default, so it must only be paid where a chain is actually built.
    // Memoized, so the two call sites below cost one query, not two. Fails safe
    // to [] = no custom tiers, never a broken turn.
    const resolveCustomProviderIds = createCustomProviderIdResolver(
      () => CustomOpenAIProviderService.getProvidersByUserId(userId),
      (cpErr) => console.warn('[Chat] Could not load custom providers for failover chain:', cpErr.message),
    );

    // Phase 4: prefer the ACTIVE AGENT's own fallback chain when it has one
    // (fallbackEnabled). A coding agent pinned to Claude-Code should fail over
    // to ITS configured backups, not the user's global list. Only when the
    // agent has no chain (or no agent is active) do we use the user's chain.
    let agentChain = null;
    if (agentId && agentId !== 'agent-chat' && agentId !== 'orchestrator') {
      try {
        const agentForFb = await AgentModel.findOne(agentId);
        if (agentForFb && agentForFb.fallbackEnabled) {
          agentChain = buildProviderChain({
            provider: normalizedProvider,
            model,
            fallbackEnabled: true,
            fallbackProviders: agentForFb.fallbackProviders,
            customProviderIds: await resolveCustomProviderIds(),
          });
        }
      } catch (agErr) {
        console.warn('[Chat] Could not load agent fallback chain:', agErr.message);
      }
    }

    if (agentChain && agentChain.length > 1) {
      providerChain = agentChain;
      console.log('[Chat] Provider failover chain (agent):', providerChain.map(t => `${t.provider}/${t.model || '(default model)'}`).join(' → '));
    } else {
      const fbSettings = await UserModel.getUserSettings(userId);
      if (fbSettings && fbSettings.fallbackEnabled) {
        providerChain = buildProviderChain({
          provider: normalizedProvider,
          model,
          fallbackEnabled: fbSettings.fallbackEnabled,
          fallbackProviders: fbSettings.fallbackProviders,
          customProviderIds: await resolveCustomProviderIds(),
        });
        if (providerChain.length > 1) {
          console.log('[Chat] Provider failover chain (user):', providerChain.map(t => `${t.provider}/${t.model || '(default model)'}`).join(' → '));
        }
      }
    }
  } catch (e) {
    console.warn('[Chat] Could not build provider failover chain (using primary only):', e.message);
    providerChain = [{ provider: normalizedProvider, model, tier: 0, primary: true }];
  }

  // Validate message input (different formats for different handlers)
  let messageInput = originalMessages || (message ? [...history, { role: 'user', content: message }] : null);
  if (!messageInput) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({ error: 'Messages or message with history are required in the request body.' });
  }

  messageInput = sanitizeOrphanToolCalls(messageInput);
  messageInput = sanitizeUnexpectedToolResults(messageInput);
  messageInput = sanitizeEmptyAssistantMessages(messageInput);

  // Set up streaming response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Abort controller for cancelling LLM generation.
  //
  // IMPORTANT: this is aborted ONLY on an explicit client cancel (the Stop
  // button, routed through activeRuns.cancelRun). It is deliberately NOT
  // aborted when the SSE socket closes — a refresh must not destroy work the
  // user asked for. See activeRuns.js for the full rationale.
  const streamAbortController = new AbortController();

  // Is THIS response still writable? Distinct from "is the run still alive".
  // Conflating the two is the bug: the transport can die many times over while
  // a single run completes.
  let sseOpen = true;

  // Set once the conversation id is known; every event is mirrored into it so a
  // reattaching client can replay the turn from the beginning.
  let activeRun = null;

  // SSE keepalive: Docker bridge NAT, reverse proxies (nginx/traefik), and corporate
  // middleboxes silently drop idle TCP connections after 30–120s. During long tool
  // executions or slow LLM generation, no bytes flow on the SSE channel and the
  // connection dies with no error. A periodic comment line (`:` prefix) is ignored
  // by the EventSource spec but keeps the underlying socket warm.
  const HEARTBEAT_INTERVAL_MS = 15000;
  const heartbeatInterval = setInterval(() => {
    if (!sseOpen || res.writableFinished) {
      clearInterval(heartbeatInterval);
      return;
    }
    try {
      res.write(': keepalive\n\n');
    } catch (e) {
      console.warn('[Stream Heartbeat] Write failed, closing SSE transport:', e.message);
      sseOpen = false;
      clearInterval(heartbeatInterval);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Use res.on('close') — fires when the *response* connection is closed by the client.
  // req.on('close') can fire prematurely once the request body is consumed.
  //
  // A closed socket means "this browser tab stopped listening", which is exactly
  // what a refresh looks like. It does NOT mean "the user changed their mind".
  // The run continues; the client can reattach via GET /orchestrator/runs/:id/stream.
  res.on('close', () => {
    clearInterval(heartbeatInterval);
    if (!res.writableFinished) {
      sseOpen = false;
      console.log(
        `[Stream] SSE transport closed for ${chatType} chat (conversation ${activeRun?.conversationId || 'pending'}) — run continues, reattachable`,
      );
    }
  });

  const rawSendEvent = (eventName, data) => {
    // 1. The socket that started this turn — may already be gone.
    if (sseOpen) {
      try {
        res.write(`event: ${eventName}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        console.warn('[Stream] SSE write failed, transport closed:', e.message);
        sseOpen = false;
      }
    }

    // 2. Replay log + any reattached clients. This is what survives a refresh,
    //    so it must run whether or not the original socket is still alive.
    if (activeRun) publishToRun(activeRun, eventName, data);

    // Broadcast via Socket.IO to all user's connected clients (real-time sync across tabs)
    if (userId) {
      // Map SSE event names to Socket.IO event names for chat events
      const chatEventMappings = {
        'assistant_message': RealtimeEvents.CHAT_MESSAGE_START,
        'content_delta': RealtimeEvents.CHAT_CONTENT_DELTA,
        'tool_pending': RealtimeEvents.CHAT_TOOL_START,
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

  // Register the run BEFORE the first event is emitted, so the replay log is
  // complete from `conversation_started` onward. A client that reattaches at any
  // later point sees the identical event sequence the original socket saw.
  activeRun = startRun({
    conversationId,
    userId,
    chatType,
    abortController: streamAbortController,
    userMessage: (() => {
      if (typeof message === 'string' && message) return message;
      if (Array.isArray(originalMessages)) {
        for (let i = originalMessages.length - 1; i >= 0; i--) {
          const m = originalMessages[i];
          if (m?.role === 'user' && typeof m.content === 'string') return m.content;
        }
      }
      return null;
    })(),
  });

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
        projectSlug: deriveUnfirehoseProjectSlug({
          chatType,
          agentContext,
          workflowContext,
          toolContext,
          widgetContext,
          goalContext,
          goalId,
        }),
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
    // Context-specific data — EVERY page-context field, copied mechanically
    // from one list (see pageContext.js). This used to be eighteen names
    // written out by hand, duplicating the destructure above; the two drifted
    // and `workspaceState` reached the handler but never the context, so every
    // One Canvas turn lost its workspace identity. Spreading from the shared
    // list means a new field cannot be added to one place and forgotten in the
    // other.
    ...pickPageContext(req.body),
    userId,
    conversationId,
    // PRD-051 identity mapping — coarse Phase 1 roles; refined in Phase 3
    role: agentId ? 'agent' : goalId ? 'goal' : 'user',
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
  //
  // TWO SOURCES, ONE RESTORE PATH. The in-memory Map is authoritative and free;
  // the DB row is the fallback that survives a backend restart, which otherwise
  // re-derived the whole prefix for every live conversation and paid the 2.0x
  // cache-write rate on the next turn. Both produce the same shape and feed the
  // identical block below, so the two can never drift apart — which is the only
  // way a fallback like this stays correct.
  const priorContext = conversationManager.get(conversationId)
    || await loadConversationState(conversationId);
  // A brand-new conversation used to start at calibration 1.0 and rediscover
  // the provider's real overhead over its first few turns, under-reporting
  // size and cost the whole time. The ratio is a property of the provider, so
  // seed it from what has already been learned and let the per-conversation
  // EMA refine from there. Null when nothing trustworthy is known yet, which
  // reproduces exactly the old behaviour.
  await loadCalibrations();
  const seededCalibration = getCalibration(normalizedProvider, model);
  if (seededCalibration != null) {
    conversationContext._estimateCalibration = seededCalibration;
  }
  if (priorContext) {
    if (priorContext._frozenSkillsCatalog !== undefined) {
      conversationContext._frozenSkillsCatalog = priorContext._frozenSkillsCatalog;
    }
    if (priorContext._frozenMemorySection !== undefined) {
      conversationContext._frozenMemorySection = priorContext._frozenMemorySection;
    }
    // Every section of the system block must be frozen for the whole
    // conversation, not just recomputed identically and hoped for. These three
    // were being re-derived each turn: custom instructions and the async
    // toggle re-read the user row, and the workspace section re-read the
    // directory from disk. Any of them changing mid-conversation silently
    // rewrites the cached prefix and every message after it — ~$1.89 on a 178k
    // conversation, against sections that cost 4.3k / 0.2k tokens to send.
    if (priorContext._frozenCustomInstructions !== undefined) {
      conversationContext._frozenCustomInstructions = priorContext._frozenCustomInstructions;
    }
    if (priorContext._frozenWorkspaceSection !== undefined) {
      conversationContext._frozenWorkspaceSection = priorContext._frozenWorkspaceSection;
    }
    if (priorContext._frozenAsyncToolsEnabled !== undefined) {
      conversationContext._frozenAsyncToolsEnabled = priorContext._frozenAsyncToolsEnabled;
    }
    // Which gated prompt blocks are resident. Frozen for the same reason as
    // everything above, and for a sharper one: the gates read the tool
    // surface, which GROWS via discover_tools, so re-resolving each turn let
    // the system block change mid-conversation and rewrite every cached
    // message before it. See chatConfigs.loadFrozenPromptGates.
    if (Array.isArray(priorContext._frozenPromptGates)) {
      conversationContext._frozenPromptGates = priorContext._frozenPromptGates;
    }
    if (priorContext._loadedToolGroups) {
      conversationContext._loadedToolGroups = new Set(priorContext._loadedToolGroups);
    }
    // Tool-surface pin. When the tool array had to be capped to fit the model's
    // window, the exact ORDERED selection is replayed on every later turn so the
    // cached prompt prefix stays byte-identical. Losing this would re-derive a
    // possibly different array each turn and miss the cache on every request.
    if (Array.isArray(priorContext._pinnedToolNames)) {
      conversationContext._pinnedToolNames = [...priorContext._pinnedToolNames];
    }
    // First-seen tool order for the discovery path (chatConfigs
    // applyStableToolOrder). Replayed so each turn's tools array is an exact
    // prefix-extension of the previous turn's — required for prompt caching.
    if (Array.isArray(priorContext._toolOrder)) {
      conversationContext._toolOrder = [...priorContext._toolOrder];
    }
    // Prior turn's prompt/tool fingerprints so the manifest can report whether
    // the cached prefix actually survived into this turn.
    if (priorContext._manifestFingerprints) {
      conversationContext._manifestFingerprints = priorContext._manifestFingerprints;
    }
    // Estimate->real token calibration learned from provider usage reports.
    // Persisted so the compression trigger stays honest from turn 1 of the
    // next turn instead of relearning the conversation's density each time.
    if (typeof priorContext._residualDrift === 'number') {
      conversationContext._residualDrift = priorContext._residualDrift;
    }
    if (typeof priorContext._estimateCalibration === 'number') {
      conversationContext._estimateCalibration = priorContext._estimateCalibration;
    }
    // Persistent eviction watermark. Once context compression has to drop
    // old message units, the SAME units must stay dropped on every later
    // turn or the prompt prefix changes per-request and the provider's
    // prompt cache never hits again. manageContext moves it forward in
    // low-water chunks; we just replay it.
    if (typeof priorContext._evictedUnits === 'number') {
      conversationContext._evictedUnits = priorContext._evictedUnits;
    }
    if (priorContext._loadedToolNames) {
      conversationContext._loadedToolNames = new Set(priorContext._loadedToolNames);
    }
    if (priorContext.activatedSkills) {
      conversationContext.activatedSkills = new Set(priorContext.activatedSkills);
    }
    // Offloaded tool-result bytes (the query_data backing store). The end-of-
    // turn conversationManager.store() spreads the whole context into the Map,
    // so these were ALWAYS carried across turns — but this restore block never
    // copied them back, so every DATA_REF died the moment its turn ended even
    // though the bytes were sitting in memory. The placeholder text survives
    // in message history forever; the data it points at must survive with it.
    // Shallow-spread: the big strings are shared by reference (no duplication),
    // and new refs added this turn mutate only the fresh object.
    if (priorContext.preservedContent && typeof priorContext.preservedContent === 'object') {
      conversationContext.preservedContent = { ...priorContext.preservedContent };
    }
    if (priorContext.dataRefSummaries && typeof priorContext.dataRefSummaries === 'object') {
      conversationContext.dataRefSummaries = { ...priorContext.dataRefSummaries };
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

            // PRD-122: stamp the run with its origin and (when nested) its
            // parent, so a subagent run is distinguishable from a
            // user-initiated one. `parentExecutionId` arrives via the handler
            // context when one run spawns another; a plain chat turn is a root.
            const parentExecutionId = context?.parentExecutionId || null;
            const rootExecutionId = parentExecutionId
              ? await AgentExecutionModel.getRootFor(parentExecutionId)
              : null;

            const execId = await AgentExecutionModel.create(
              userId,
              agentId || null,
              agentNameForExecution,
              conversationId,
              typeof initialPromptText === 'string' ? initialPromptText.substring(0, 500) : String(initialPromptText).substring(0, 500),
              resolvedProvider,
              model,
              'running',
              // Record the surface verbatim. `chatType` is already exactly the
              // set in CHAT_SURFACE_ORIGINS; collapsing it to 'chat' here threw
              // away the only feature-attribution signal this table ever had.
              { parentExecutionId, rootExecutionId, origin: chatType }
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

    // client/adapter are LET so failover can rebuild them on a fallback tier.
    let client = await createLlmClient(normalizedProvider, userId, { conversationId, authToken });
    let adapter = await createLlmAdapter(normalizedProvider, client, model, { reasoningEnabled, reasoningValue, conversationId });

    // Store client in context
    conversationContext.llmClient = client;
    if (normalizedProvider === 'openai' || normalizedProvider === 'openai-codex') {
      conversationContext.openai = client;
    }

    // Store image data in context for vision models
    if (imageData.length > 0) {
      conversationContext.imageData = imageData;
    }

    // Get tool schemas for this chat type
    const toolSchemas = await config.getToolSchemas(conversationContext);

    // CRITICAL: Check if model supports vision when images are uploaded.
    // supportsVision() uses getModelMetadata's variant fallback chain so
    // codex variants (gpt-5.2-codex → gpt-5.2, gpt-5.5, etc.) are correctly
    // recognized as vision-capable even though the openai-codex provider has
    // no static modelMetadata of its own.
    let modelSupportsVision = false;
    if (imageData.length > 0) {
      const ProviderRegistry = await import('./ai/ProviderRegistry.js');
      modelSupportsVision = ProviderRegistry.supportsVision(normalizedProvider, model);

      if (!modelSupportsVision) {
        console.warn(`[Vision Check] Model '${model}' (provider '${normalizedProvider}') does not support vision, but ${imageData.length} image(s) were uploaded.`);
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
          // agentId travels with every assistant_message event so the frontend
          // can attribute the message to a SPEAKER (group-chat transcript
          // rendering matches own-vs-foreign by id, with name as the legacy
          // fallback for conversations persisted before this field existed).
          agentMeta = { agentId, agentName: agent.name, agentIcon: agent.icon || null };
        }
      } catch (e) {
        console.warn('[Chat] Failed to resolve agent metadata for message:', e.message);
      }
    }

    // Identity is STRUCTURAL now, not prompt-injected. The frontend renders
    // each participant's view of the shared transcript per-speaker: the
    // responding agent's own turns arrive as role:'assistant', and every
    // other participant (the orchestrator, other agents) arrives as
    // role:'user' prefixed with its speaker label ([Annie]: / [@Name]:).
    // The model therefore never sees a foreign turn as its own words, which
    // is what the old "[Identity: You are X — NOT Annie]" injection was
    // papering over.

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

    // Cap the tool surface to what this model can actually afford, leaving a
    // guaranteed reserve for the conversation itself.
    //
    // This is a NO-OP whenever the full surface fits — every large-window model
    // (Sonnet 5, Opus 5, Gemini 2.5, GPT-5.6, Codex Sol) is completely
    // unaffected. It engages only for models that physically cannot hold both
    // the tools and the chat (128k-200k tiers), where the alternative was the
    // context manager's emergency recovery deleting the user's conversation.
    let toolCapResult = null;
    // Providers whose transport cannot carry tool schemas at all (the one-shot
    // print CLIs: grok-build, cursor-cli) get an empty surface. Their clients
    // silently drop options.tools, so anything sent here is pure budget waste
    // — and worse, the tool instructions in the prompt make the model narrate
    // calls that never execute.
    if (!providerSupportsTools(normalizedProvider) && finalToolSchemas.length > 0) {
      console.log(
        `[ToolBudget] ${normalizedProvider} cannot receive tool schemas (CLI transport) — ` +
        `sending 0/${finalToolSchemas.length} tools.`
      );
      finalToolSchemas = [];
    }
    {
      const { availableTokens } = getContextBudget(model, normalizedProvider);
      // The system prompt is not conversation and not tools — it ships on every
      // request and must be reserved before the tool surface is sized.
      const systemPromptTokens = estimateTokens(systemPrompt || '');
      const toolBudget = computeToolBudget(availableTokens, { reservedTokens: systemPromptTokens });
      // Chat Completions rejects >128 functions outright; the Responses API and
      // the native-schema providers (Anthropic, Gemini) do not.
      const usesResponsesApi = normalizedProvider === 'openai-codex'
        || (normalizedProvider === 'openai' && requiresResponsesApi(model));
      const maxToolCount = getToolCountLimit(normalizedProvider, { usesResponsesApi });
      const capResult = capToolsToBudget(finalToolSchemas, {
        budgetTokens: toolBudget,
        pinnedNames: conversationContext._pinnedToolNames || null,
        loadedToolNames: conversationContext._loadedToolNames || null,
        maxToolCount,
      });
      if (capResult.capped) {
        console.warn(
          `[ToolBudget] ${normalizedProvider}/${model}: tool surface ${estimateToolTokens(finalToolSchemas)} tokens ` +
          `/ ${finalToolSchemas.length} tools exceeds the ${toolBudget}-token allowance ` +
          `(of ${availableTokens} available, ${systemPromptTokens} reserved for the system prompt)` +
          `${maxToolCount ? ` or the ${maxToolCount}-tool provider limit` : ''}. ` +
          `Sending ${capResult.schemas.length}/${finalToolSchemas.length} tools (${capResult.toolTokens} tokens); ` +
          `${capResult.hiddenCount} remain reachable via discover_tools.`
        );
        finalToolSchemas = capResult.schemas;
        conversationContext._pinnedToolNames = capResult.pinnedNames;
      }
      // Retained for the manifest: how many tools were dropped to fit is a
      // real correctness signal that used to end at the console.warn above.
      toolCapResult = capResult;
    }

    conversationContext.finalToolSchemas = finalToolSchemas;

    // Generate assistant message ID early (needed for image extraction events).
    // MUTABLE by design: a mid-run user steer splits the turn into multiple
    // assistant bubbles so the transcript reads in true chronological order.
    // See the steer drain inside the tool loop below.
    let assistantMessageId = `msg-asst-${Date.now()}`;

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

    // Retroactively compact any bloated tool messages in the history before
    // counting tokens. Catches bloat from per-tool paths that skipped
    // offloading (e.g. artifact chat) or from conversations that pre-date
    // the offload system. Offloaded bytes go into preservedContent so the
    // LLM can still retrieve them via the query_data tool.
    const compactedHistory = compactMessageHistory(messages, conversationContext);
    if (compactedHistory.compactedCount > 0) {
      console.log(
        `[History Compact] Reduced ${compactedHistory.compactedCount} tool message(s) ` +
        `by ${compactedHistory.compactedBytes} chars before context management`
      );
      messages = compactedHistory.messages;
    }

    // Apply context management
    const contextResult = manageContext(messages, model, finalToolSchemas, normalizedProvider, {
      calibration: conversationContext._estimateCalibration || 1,
      evictedUnits: conversationContext._evictedUnits || 0,
    });
    conversationContext._evictedUnits = contextResult.evictedUnits || 0;

    // Send context status.
    // `currentTokens` / `utilizationPercent` are retained for backwards
    // compatibility but now reflect the TRUE per-request input size
    // (system + tools + messages), not just the messages-array estimate.
    // The breakdown fields drive the segmented bar in the frontend.
    //
    // EVERY TOKEN COUNT BELOW IS RAW (`unit: 'raw'`), and `calibration` is the
    // factor a display surface must multiply them by to show what the provider
    // will actually count. The backend used to apply that factor here, per
    // consumer — this event got it, the context_manifest event did not, and
    // buildEconomics got calibrated bucket totals while priceItems priced raw
    // per-item tokens at the same rate. The same panel therefore rendered
    // "System 37.6k" beside an inventory whose sections summed to 24.9k, and
    // its "recurring drivers" understated the floor cost they were meant to
    // explain by exactly the calibration factor.
    //
    // A unit conversion applied N times in N places will disagree N ways.
    // Emit ONE unit, publish the factor, and let the display boundary convert
    // once (see frontend/src/services/contextCalibration.js).
    const displayCalibration = conversationContext._estimateCalibration > 1
      ? conversationContext._estimateCalibration
      : 1;
    conversationContext._turnRound = 1;
    sendEvent('context_status', {
      round: 1,
      unit: TOKEN_UNIT_RAW,
      calibration: displayCalibration,
      currentTokens: contextResult.totalRequestTokens,
      tokenLimit: contextResult.contextWindow,
      utilizationPercent: (contextResult.totalRequestTokens / contextResult.contextWindow) * 100,
      model: model,
      messagesCount: contextResult.messages.length,
      breakdown: {
        systemTokens: contextResult.systemTokens,
        toolTokens: contextResult.toolTokens,
        messagesTokens: contextResult.messagesTokens,
        // NOT an estimate of existing text — a fixed reserve held back from the
        // window for the reply. Calibration does not apply to it.
        outputBufferTokens: contextResult.outputBufferTokens,
        totalRequestTokens: contextResult.totalRequestTokens,
        calibration: displayCalibration,
        // Leftover error AFTER calibration is applied, i.e. how wrong the
        // corrected number still is. A ratio, never scaled.
        residualDrift: conversationContext._residualDrift ?? null,
      },
    });

    // Itemized inventory of everything in this request: which prompt sections,
    // which tools and why, what was hidden or dropped, and whether the cached
    // prompt prefix survived. All of it was already computed above.
    try {
      const { manifest, fingerprints } = buildContextManifest({
        cacheTtlMs: promptCacheTtlMs(normalizedProvider, model),
        // RAW tokens, matching the per-item tokens priceItems works from. The
        // floor cost and the itemized costs that explain it must be computed
        // from the same unit or they cannot add up.
        economics: buildEconomics({
          provider: normalizedProvider,
          model,
          systemTokens: contextResult.systemTokens,
          toolTokens: contextResult.toolTokens,
        }),
        calibration: displayCalibration,
        systemPrompt,
        promptSections: conversationContext._promptSections || [],
        toolSchemas: finalToolSchemas,
        toolProvenance: conversationContext._toolProvenance || {},
        toolSurfaceMeta: conversationContext._toolSurfaceMeta || {},
        contextResult,
        capResult: toolCapResult,
        prior: conversationContext._manifestFingerprints || null,
      });
      conversationContext._manifestFingerprints = fingerprints;
      sendEvent('context_manifest', manifest);
    } catch (manifestError) {
      // Never let an observability feature break a chat turn.
      console.warn('[ContextManifest] Failed to build manifest:', manifestError.message);
    }

    if (contextResult.wasManaged) {
      console.log(`Context automatically managed: ${contextResult.originalTokens} -> ${contextResult.managedTokens} tokens`);
      // Do NOT reassign `messages` here. `messages` is the canonical chat
      // ledger that gets persisted to conversation_logs.full_history in the
      // finally block. The trimmed copy is for the provider call only and
      // is already read directly from contextResult.messages below.
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

      // Cache tokens observed in THIS round. Turn end is far too late to be the
      // only cache signal: an agentic turn runs for tens of minutes making
      // cached requests the whole way through, so a panel fed only by
      // `agent_execution_completed` reported a provably-warm cache as "gone
      // cold" for the entire duration of the very turn that was hitting it.
      // Every round that comes back with cache tokens is a CONFIRMED
      // observation that the prefix was alive at that instant -- report it then.
      let roundCacheRead = 0;
      let roundCacheWrite = 0;

      const cacheRead = usage.cache_read_input_tokens || 0;
      const cacheWrite = usage.cache_creation_input_tokens || 0;

      if (cacheRead > 0 || cacheWrite > 0) {
        roundCacheRead = cacheRead;
        roundCacheWrite = cacheWrite;
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
        // Cached-prompt reads. Chat Completions reports these under
        // `prompt_tokens_details.cached_tokens`; the Responses API — which is
        // what OpenAI gpt-5.x and ALL Codex models use — reports the identical
        // figure under `input_tokens_details.cached_tokens`. Reading only the
        // Chat Completions shape meant every Codex cache hit was accumulated as
        // zero, so no dashboard could ever show whether Codex caching worked.
        const { cacheReadTokens: cachedReadTokens, cacheWriteTokens } =
          readOpenAiShapedCacheUsage(usage);
        if (cachedReadTokens > 0) {
          tokenAccumulator.cacheReadTokens += cachedReadTokens;
          roundCacheRead = cachedReadTokens;
        }

        // Cache WRITES on an OpenAI-shaped response. OpenRouter reports these
        // as `prompt_tokens_details.cache_write_tokens` for every upstream with
        // explicit caching and a cache-write price. AGNT read only the `cached_
        // tokens` half of that object, so a write was indistinguishable from no
        // caching at all: 816 OpenRouter executions in the live ledger recorded
        // cache_creation_tokens = 0 while genuinely paying a write premium.
        // Unlike Anthropic's native shape, `prompt_tokens` here ALREADY
        // includes these tokens (verified live: prompt_tokens 8522 with
        // cache_write_tokens 8513), so inputTokens must not be incremented
        // again — only the write bucket is credited.
        if (cacheWriteTokens > 0) {
          tokenAccumulator.cacheCreationTokens += cacheWriteTokens;
          // Bucket by the TTL we actually ASKED for. The response does not echo
          // it back, and the request is the only place the duration is known.
          const writeTtlMs = promptCacheTtlMs(normalizedProvider, model);
          if (writeTtlMs != null && writeTtlMs >= 60 * 60 * 1000) {
            tokenAccumulator.cacheCreation1hTokens += cacheWriteTokens;
          } else {
            tokenAccumulator.cacheCreation5mTokens += cacheWriteTokens;
          }
          roundCacheWrite = cacheWriteTokens;
        }
      }

      tokenAccumulator.totalTokens = tokenAccumulator.inputTokens + tokenAccumulator.outputTokens;

      if (roundCacheRead > 0 || roundCacheWrite > 0) {
        sendEvent('cache_activity', {
          at: new Date().toISOString(),
          round: conversationContext._turnRound || 1,
          cacheReadTokens: roundCacheRead,
          cacheCreationTokens: roundCacheWrite,
        });
      }
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

    // Track which tool call IDs we've already announced as pending so we only
    // fire tool_pending once per tool (adapters emit tool_call_delta repeatedly
    // as args stream in).
    const announcedToolIds = new Set();

    // The streaming chunk handler is factored out so failover can reuse it
    // across provider tiers. NOTE: the adapter only returns recoveredFromError
    // when ZERO content chunks were emitted, so a failed tier never streams
    // partial tokens — making pre-first-token failover clean.
    const onStreamChunk = (chunk) => {
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
          // Announce the pending pill the moment we know the tool name+id, so
          // the UI doesn't look frozen while args are still streaming. The
          // canonical tool_start event below will upgrade it with full args.
          const tc = chunk.toolCall;
          console.log('[tool_pending DEBUG] got tool_call_delta:', { id: tc?.id, name: tc?.function?.name, already: announcedToolIds.has(tc?.id) });
          if (tc?.id && tc?.function?.name && !announcedToolIds.has(tc.id)) {
            announcedToolIds.add(tc.id);
            console.log('[tool_pending DEBUG] emitting tool_pending SSE event for', tc.function.name, tc.id);
            sendEvent('tool_pending', {
              assistantMessageId,
              toolCall: { id: tc.id, name: tc.function.name },
            });
          }
        }
    };

    // Run the first LLM call across the provider failover chain. Each tier
    // rebuilds client+adapter; on failover we re-point the OUTER client/adapter/
    // normalizedProvider/model so the rest of the turn (tool loop) continues on
    // the tier that actually worked.
    const runTierStream = async (tier) => {
      if (!tier.primary) {
        // Rebuild client+adapter for the fallback tier.
        normalizedProvider = String(tier.provider).toLowerCase();
        // Resolve the tier's model. buildProviderChain already fills tier.model
        // with the provider's default when none was configured, so a null here
        // means "provider default" — do NOT carry the PRIMARY provider's model
        // across to a different provider (it would be an invalid model id).
        model = tier.model || (await import('./ai/ProviderRegistry.js')).getTextModels(normalizedProvider)?.[0] || tier.model;
        client = await createLlmClient(normalizedProvider, userId, { conversationId, authToken });
        adapter = await createLlmAdapter(normalizedProvider, client, model, { reasoningEnabled, reasoningValue, conversationId });
        conversationContext.llmClient = client;
        // Keep the shared conversation context in sync so tools that resolve
        // provider/model from context (analyze_image, custom tool execution,
        // etc.) use the tier that actually served the turn — not the primary.
        conversationContext.provider = normalizedProvider;
        conversationContext.normalizedProvider = normalizedProvider;
        conversationContext.model = model;
        if (normalizedProvider === 'openai' || normalizedProvider === 'openai-codex') {
          conversationContext.openai = client;
        }
      }
      return adapter.callStream(
        contextResult.messages,
        finalToolSchemas,
        onStreamChunk,
        conversationContext // Pass context for vision image handling
      );
    };

    const { result: _r0, tier: _r0Tier } = await runWithFallback({
      chain: providerChain,
      runOne: runTierStream,
      onFallback: ({ from, to, reason }) => {
        console.warn(`[Chat] Provider failover: ${from.provider}/${from.model || '?'} → ${to.provider}/${to.model || '?'} (${reason})`);
        // Remember, for THIS conversation, that we failed over — so a later
        // turn that succeeds back on the primary can announce the recovery.
        if (conversationId) {
          __failoverMemory.set(conversationId, { provider: to.provider, model: to.model });
        }
        sendEvent('provider_fallback', {
          from: { provider: from.provider, model: from.model },
          to: { provider: to.provider, model: to.model },
          reason,
          tier: to.tier,
        });
      },
    });

    // Recovery banner (Option 2): if this turn ran on the PRIMARY provider and
    // an earlier turn in this conversation had failed over, the default is back.
    // Emit once and clear the memory so it only fires on the transition.
    if (conversationId && _r0Tier && _r0Tier.primary && !_r0?.recoveredFromError && __failoverMemory.has(conversationId)) {
      __failoverMemory.delete(conversationId);
      console.log(`[Chat] Provider recovered: back on ${normalizedProvider}/${model || '?'}`);
      sendEvent('provider_recovered', {
        backTo: { provider: normalizedProvider, model },
      });
    }

    let { responseMessage, toolCalls, toolCallError, invalidToolCalls, toolsSkipped, toolsSkippedReason, recoveredFromError, recoveredError, usage: initialUsage } = _r0;
    accumulateUsage(initialUsage);
    // Fold this round's REAL prompt size (provider-reported) into the
    // estimate calibration used by every subsequent manageContext call.
    // Leftover error after the correction we actually applied. Must be
    // measured BEFORE the fold below, which overwrites that correction.
    {
      const residual = computeResidualDrift(
        conversationContext._estimateCalibration, initialUsage, contextResult.totalRequestTokens);
      if (residual != null) {
        conversationContext._residualDrift =
          conversationContext._residualDrift == null
            ? residual
            : conversationContext._residualDrift * 0.5 + residual * 0.5;
      }
    }
    conversationContext._estimateCalibration = updateEstimateCalibration(
      conversationContext._estimateCalibration,
      initialUsage,
      contextResult.totalRequestTokens
    );
    if (conversationContext._estimateCalibration > 0) {
      recordCalibration(normalizedProvider, model, conversationContext._estimateCalibration);
    }

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
      if (scrubbed) {
        sendEvent('content_delta', {
          assistantMessageId,
          delta: scrubbed,
          accumulated: scrubbed,
        });
      } else {
        console.warn(
          `[Empty Response] provider=${normalizedProvider} model=${model} ` +
          `round=0 chatType=${chatType} recoveredError="${recoveredError || 'unknown'}" ` +
          `→ suppressing empty/error placeholder from chat stream`
        );
      }
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
            } else if (chunk.type === 'tool_call_delta') {
              const tc = chunk.toolCall;
              if (tc?.id && tc?.function?.name && !announcedToolIds.has(tc.id)) {
                announcedToolIds.add(tc.id);
                sendEvent('tool_pending', {
                  assistantMessageId,
                  toolCall: { id: tc.id, name: tc.function.name },
                });
              }
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
    // Set when mention_agent executes: the floor passes to another
    // participant, so this speaker's turn ENDS — no further LLM rounds, no
    // forced follow-up summary. The frontend dispatches the mentioned
    // agent's turn when it sees the tool_end.
    let floorPassed = false;

    // Gate on an EXPLICIT cancel, not on transport health. A closed socket used
    // to stop the tool loop here, which is why refreshing mid-run killed the
    // work outright instead of merely hiding it.
    while (toolCalls && toolCalls.length > 0 && currentRound < config.maxToolRounds && !streamAbortController.signal.aborted) {
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

        // ---- Universal required-parameter gate --------------------------
        //
        // Every tool call from every provider converges here. This is the only
        // place in the system where that is true, which makes it the only
        // correct home for a guarantee that applies to all of them.
        //
        // The guarantee: a tool never executes when NONE of the parameters its
        // schema requires arrived — i.e. the arguments were lost in transit.
        //
        // Schema validation previously lived inside OpenAiLikeAdapter alone.
        // Anthropic, Gemini, OpenAI-Responses and Codex adapters never ran it
        // and never returned `invalidToolCalls`, so three of five adapter
        // families dispatched whatever they received. A truncated Anthropic
        // tool call became `{}` and executed — `edit_file` with no `path`
        // resolved to the workspace root and died on `EISDIR`, an error with
        // no relationship to the actual fault.
        //
        // The predicate is "every required parameter is absent", NOT "a
        // required parameter is absent". Replaying 87,843 production calls
        // showed the stricter reading would block 248 calls that SUCCEEDED,
        // because third-party plugin schemas over-declare `required`. See the
        // module header in toolArgGuard.js for the full measurement — that
        // narrowing is load-bearing, do not tighten it without re-running
        // projects/edit-file-empty-args/probe-predicates.mjs.
        //
        // Fails OPEN on unknown schemas so tools discovered mid-turn, via MCP,
        // or from plugins are never blocked by a stale snapshot.
        const missingParams = findBlockingMissingParams(functionName, functionArgs, finalToolSchemas);
        if (missingParams.length > 0) {
          const guardError = formatMissingParamsError(functionName, missingParams, functionArgs);
          console.error(
            `[Tool Guard] BLOCKED ${functionName}: missing required parameter(s) ` +
            `[${missingParams.join(', ')}]. Raw arguments: ${String(toolCall.function.arguments).slice(0, 300)}`,
          );

          // Record the block exactly like any other tool failure so it is
          // measurable in agent_tool_executions rather than invisible.
          if (agentExecutionId) {
            try {
              const guardExecId = await AgentExecutionModel.createToolExecution(
                agentExecutionId,
                functionName,
                toolCall.id,
                functionArgs,
              );
              toolExecutionIds.set(toolCall.id, guardExecId);
              toolCallsCount++;
              // Positional signature: (id, status, output, error, creditsUsed, tokenUsage)
              await AgentExecutionModel.updateToolExecution(
                guardExecId,
                'failed',
                guardError,
                guardError.error,
              );
            } catch (guardLogError) {
              console.error('[Tool Guard] Failed to record blocked tool execution:', guardLogError.message);
            }
          }

          sendEvent('tool_end', {
            assistantMessageId,
            toolCall: { id: toolCall.id, name: functionName, error: guardError.error },
          });

          return {
            tool_call_id: toolCall.id,
            role: 'tool',
            name: functionName,
            content: JSON.stringify(guardError),
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

          // Autonomous-follow-up gate: by default an async tool's completion
          // just updates its tool-call card in the originating assistant
          // message (via the ASYNC_TOOL_COMPLETED SSE broadcast inside
          // AsyncToolQueue). Only tools listed in autonomousFollowupConfig
          // also get the LLM-narrated follow-up message that
          // AutonomousMessageService spawns. Without this gate, EVERY async
          // tool produced an extra assistant message even when the result
          // was self-explanatory and the originating message was still on
          // screen — see autonomousFollowupConfig.js for the rationale.
          const wantsAutonomousFollowup = shouldTriggerAutonomousFollowup(functionName);
          const asyncCallbacks = wantsAutonomousFollowup
            ? {
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
              }
            : {};

          // Queue the async tool for background execution
          const executionId = asyncToolQueue.enqueue(
            toolCall.id,
            conversationId,
            userId,
            functionName,
            functionArgs, // Pass raw args - AsyncToolQueue strips control params internally
            assistantMessageId, // Pass message ID for frontend status updates
            asyncCallbacks,
            // Execute function wrapper — single dispatcher across all chat surfaces
            async (args, onProgress) => {
              console.log(`[AsyncTool] Executing ${functionName} for ${chatType} chat (autonomous follow-up: ${wantsAutonomousFollowup ? 'on' : 'off'})`);
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

          // Offload large data to prevent context window overflow.
          // The artifact-chat skip was removed in favor of teaching Annie
          // to use query_data + slice/search to retrieve the verbatim
          // strings she needs for edit_file. The system prompt explains
          // the workflow; the artifact specialty now includes query_data.
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

          // Hard cap on tool result size to prevent context window overflow.
          // Even after data offloading, some tools return massive results
          // with many sub-50k fields whose aggregate is enormous. The
          // artifact-chat carve-out was removed alongside the offload skip;
          // huge file reads now route through query_data instead.
          const MAX_TOOL_RESULT_CHARS = toolOutputCap; // user-tunable; default 100000 (~28k tokens)
          if (functionResponseContent.length > MAX_TOOL_RESULT_CHARS) {
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
          console.log(`[Orchestrator] ${functionName} dispatching ${frontendEventsToSend.length} frontend event(s):`, frontendEventsToSend.map(e => e.type).join(', '));
          frontendEventsToSend.forEach((event) => {
            sendEvent('frontend_event', {
              assistantMessageId,
              eventType: event.type,
              eventData: event.data,
            });
            // Window-scoped events (tours, app background) must reach every tab
            // the user has open, not just the SSE-originating one. Mirror them
            // over socket.io so a tab that's only listening to broadcasts (chat
            // sent from a different window, etc.) still applies the effect.
            // The list lives in orchestrator/globalFrontendEvents.js so it is
            // extended in one place instead of three.
            if (userId && isGlobalFrontendEvent(event.type)) {
              try {
                broadcastToUser(userId, event.type, {
                  ...event.data,
                  conversationId,
                  chatType,
                  timestamp: Date.now(),
                });
                console.log(`[Orchestrator] mirrored ${event.type} to socket.io for user ${userId}`);
              } catch (broadcastErr) {
                console.warn('[Orchestrator] socket.io tutorial broadcast failed:', broadcastErr.message);
              }
            }
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
        const steerShape = applySteerAsUserTurn(messages, steerText);
        // Carry the OUTGOING message id so the client can seal that bubble
        // (clear its spinner) before the continuation bubble opens below.
        sendEvent('steering_applied', {
          content: steerText,
          round: currentRound,
          assistantMessageId,
        });
        console.log(`[Steering] Applied steer at round ${currentRound} (${steerText.length} chars, shape=${steerShape})`);
      }

      // Send tool execution summary for this round
      sendEvent('tool_executions', { assistantMessageId, tool_executions: toolExecutionDetails, round: currentRound });

      // Split the assistant turn at the steer seam.
      //
      // A turn used to stream into exactly ONE bubble for its entire life, so
      // every delta produced AFTER a steer was appended to a bubble that
      // already sat ABOVE the steer message in the ordered transcript. The
      // steer therefore appeared to land after the very work it caused.
      // Minting a new id makes all subsequent content_delta / tool_start /
      // tool_end / final_content events land in a fresh bubble BELOW the steer.
      //
      // Ordering matters: this runs AFTER tool_executions so that round's
      // summary still attaches to the bubble that actually produced it.
      if (steerText) {
        assistantMessageId = openSteerContinuation(sendEvent, { round: currentRound, agentMeta });
      }

      // ---- Terminal floor pass -------------------------------------------
      // mention_agent hands the floor to another participant. Once it has
      // executed (its tool_result is already in `messages` and its tool_end
      // already streamed to the frontend), this speaker's turn is OVER: no
      // follow-up LLM round, no summary. Enforced here rather than trusted
      // to the prompt — the model cannot babble past a handoff it can no
      // longer continue.
      if (toolCalls.some((tc) => tc.function?.name === 'mention_agent')) {
        floorPassed = true;
        console.log(`[Floor] mention_agent executed in round ${currentRound} — ending turn, floor passes`);
        sendEvent('floor_passed', { assistantMessageId, round: currentRound });
        break;
      }

      // Dynamic tool loading: check if discover_tools requested new categories
      if (conversationContext._requestedToolCategories && conversationContext._requestedToolCategories.size > 0) {
        try {
          const { getToolsForCategories } = await import('./orchestrator/toolSelector.js');
          const allSchemas = await (await import('./orchestrator/tools.js')).getAvailableToolSchemas();
          let newSchemas = getToolsForCategories(allSchemas, conversationContext._requestedToolCategories);
          // A discover_tools load must never step over the channel's ceiling.
          // The ceiling is what the user permitted (see chatConfigs
          // resolveToolCeiling / restricted saved agents); without this filter
          // the model could recover, by category, every tool the user had
          // deliberately unchecked — and a restricted agent could load past
          // its own declared assignedTools boundary.
          const toolCeiling = conversationContext._toolCeiling;
          if (toolCeiling instanceof Set) {
            const before = newSchemas.length;
            newSchemas = newSchemas.filter((s) => toolCeiling.has(s.function?.name));
            if (before !== newSchemas.length) {
              console.log(`[ToolSelector] Ceiling withheld ${before - newSchemas.length} tool(s) from discover_tools load`);
            }
          }
          let addedCount = 0;
          if (!conversationContext._loadedToolNames) {
            conversationContext._loadedToolNames = new Set();
          }
          for (const schema of newSchemas) {
            const schemaName = schema.function?.name;
            if (schemaName) conversationContext._loadedToolNames.add(schemaName);
            if (!finalToolSchemas.some((s) => s.function?.name === schemaName)) {
              finalToolSchemas.push(schema);
              addedCount++;
              // APPEND to the pin (never insert). The cached prompt prefix is
              // preserved up to the append point; re-ordering would invalidate
              // the whole cached tools block instead of just extending it.
              if (Array.isArray(conversationContext._pinnedToolNames) && schemaName) {
                conversationContext._pinnedToolNames.push(schemaName);
              }
              // Register the append in the discovery-path order log too so
              // the NEXT turn emits this tool at the same position instead of
              // re-sorting it into registry order (which would invalidate the
              // cached prompt prefix).
              if (
                Array.isArray(conversationContext._toolOrder) &&
                schemaName &&
                !conversationContext._toolOrder.includes(schemaName)
              ) {
                conversationContext._toolOrder.push(schemaName);
              }
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

      // Retroactively compact bloated tool messages from earlier rounds
      // before re-counting tokens. (See universal-chat entry point for
      // the longer rationale.) Within a tool loop this is the layer that
      // rescues the conversation if a tool result in *this* round dumped
      // more bytes than the per-tool offload caught.
      const loopCompacted = compactMessageHistory(messages, conversationContext);
      if (loopCompacted.compactedCount > 0) {
        console.log(
          `[History Compact] Tool loop reduced ${loopCompacted.compactedCount} ` +
          `tool message(s) by ${loopCompacted.compactedBytes} chars`
        );
        messages = loopCompacted.messages;
      }

      // Apply context management before next LLM call — but only if critically close
      // to the limit. Within a single turn's tool loop, the message prefix should stay
      // stable to preserve prompt cache hits. Between turns, the prefix changes anyway.
      //
      // The gate must be compared against the ORIGINAL request size, not
      // the managed one — otherwise a successful reduction (e.g.,
      // 390k → 127k) appears "below the gate" in its managed form and we
      // throw the reduction away, sending the original 390k to the
      // provider, which rejects it. The original utilization tells us
      // whether management was genuinely needed.
      //
      // Codex Responses (chatgpt.com/backend-api/codex/responses) sends
      // store: false stateless requests with no prompt cache to preserve;
      // it also replays encrypted reasoning blobs every turn that count
      // against the window. Never revert reductions for Codex.
      let loopContextResult = manageContext(messages, model, finalToolSchemas, normalizedProvider, {
        calibration: conversationContext._estimateCalibration || 1,
        evictedUnits: conversationContext._evictedUnits || 0,
      });
      conversationContext._evictedUnits = loopContextResult.evictedUnits || 0;
      const cacheGate = 0.95;
      const originalRequestTokens = loopContextResult.originalTokens + loopContextResult.toolTokens;
      const originalUtilization = loopContextResult.contextWindow > 0
        ? (originalRequestTokens / loopContextResult.contextWindow)
        : 0;
      // A standing eviction watermark is the conversation's persistent state,
      // not a minor truncation — reverting it mid-turn would flip the prefix
      // between the evicted view (turn start) and the full view (tool rounds),
      // breaking the cache twice per round AND risking the provider wall.
      const canRevert = normalizedProvider !== 'openai-codex'
        && originalUtilization < cacheGate
        && loopContextResult.wasManaged
        && !(loopContextResult.evictedUnits > 0);
      if (canRevert) {
        // Original already fit comfortably; reduction was minor truncation.
        // Revert to preserve the cache prefix for the next turn.
        console.log(`[Cache] Skipping context management in tool loop to preserve cache (original utilization: ${(originalUtilization * 100).toFixed(1)}%, gate: ${(cacheGate * 100).toFixed(0)}%)`);
        loopContextResult = { ...loopContextResult, wasManaged: false, messages };
      } else if (loopContextResult.wasManaged) {
        // Reduction was required to fit the window; sacrifice cache for
        // correctness. (For Codex, also: no cache exists to preserve.)
        console.log(`[Cache] Keeping context-managed messages (original utilization: ${(originalUtilization * 100).toFixed(1)}%, provider: ${normalizedProvider})`);
      }
      if (loopContextResult.wasManaged) {
        console.log(`[Tool Loop] Context managed: ${loopContextResult.originalTokens} -> ${loopContextResult.managedTokens} tokens`);
        // Do NOT reassign `messages` — the next adapter call below reads
        // loopContextResult.messages directly, and `messages` must stay
        // intact so the full ledger is persisted to full_history.
        sendEvent('context_managed', {
          originalTokens: loopContextResult.originalTokens,
          managedTokens: loopContextResult.managedTokens,
          tokenLimit: loopContextResult.tokenLimit,
          round: currentRound,
        });
      }

      // Emit updated context status so the UI reflects the growing message
      // history after each tool round (user sees tool_result bytes added).
      // RAW, exactly like the turn-start event above — a turn whose rounds were
      // reported in different units would draw a step change in the per-round
      // chart that no request actually made.
      const loopDisplayCal = conversationContext._estimateCalibration > 1
        ? conversationContext._estimateCalibration
        : 1;
      conversationContext._turnRound = (conversationContext._turnRound || 1) + 1;
      sendEvent('context_status', {
        round: conversationContext._turnRound,
        unit: TOKEN_UNIT_RAW,
        calibration: loopDisplayCal,
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
          calibration: loopDisplayCal,
          residualDrift: conversationContext._residualDrift ?? null,
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
          } else if (chunk.type === 'tool_call_delta') {
            const tc = chunk.toolCall;
            if (tc?.id && tc?.function?.name && !announcedToolIds.has(tc.id)) {
              announcedToolIds.add(tc.id);
              sendEvent('tool_pending', {
                assistantMessageId,
                toolCall: { id: tc.id, name: tc.function.name },
              });
            }
          }
        },
        conversationContext
      );

      responseMessage = nextResponse.responseMessage;
      toolCalls = nextResponse.toolCalls;
      accumulateUsage(nextResponse.usage);
      // Leftover error after the correction we actually applied. Must be
      // measured BEFORE the fold below, which overwrites that correction.
      {
        const residual = computeResidualDrift(
          conversationContext._estimateCalibration, nextResponse.usage, loopContextResult.totalRequestTokens);
        if (residual != null) {
          conversationContext._residualDrift =
            conversationContext._residualDrift == null
              ? residual
              : conversationContext._residualDrift * 0.5 + residual * 0.5;
        }
      }
      conversationContext._estimateCalibration = updateEstimateCalibration(
        conversationContext._estimateCalibration,
        nextResponse.usage,
        loopContextResult.totalRequestTokens
      );
      if (conversationContext._estimateCalibration > 0) {
        recordCalibration(normalizedProvider, model, conversationContext._estimateCalibration);
      }

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
        if (scrubbed) {
          sendEvent('content_delta', {
            assistantMessageId,
            delta: scrubbed,
            accumulated: scrubbed,
          });
        } else {
          console.warn(
            `[Empty Response] provider=${normalizedProvider} model=${model} ` +
            `round=${currentRound} chatType=${chatType} recoveredError="${nextResponse.recoveredError || 'unknown'}" ` +
            `→ suppressing empty/error placeholder from chat stream`
          );
        }
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
    // make one more LLM call to generate a summary response.
    // NOT when the floor was passed — the turn deliberately ends on the
    // handoff; forcing a summary here would give the speaker an extra turn
    // and defeat the terminal-tool contract.
    if (currentRound > 0 && !finalContentForLogging && !floorPassed) {
      console.log('[Tool Loop] Final response had no text content after tool execution, requesting follow-up');
      try {
        // Add a nudge message to prompt the LLM to summarize
        messages.push({
          role: 'user',
          content: '[System: Your previous response contained only tool calls with no text. Please provide a brief summary of what you found/did based on the tool results above.]',
        });

        const followUpCompacted = compactMessageHistory(messages, conversationContext);
        if (followUpCompacted.compactedCount > 0) {
          console.log(
            `[History Compact] Follow-up reduced ${followUpCompacted.compactedCount} ` +
            `tool message(s) by ${followUpCompacted.compactedBytes} chars`
          );
          messages = followUpCompacted.messages;
        }
        const followUpContext = manageContext(messages, model, finalToolSchemas, normalizedProvider, {
          calibration: conversationContext._estimateCalibration || 1,
          evictedUnits: conversationContext._evictedUnits || 0,
        });
        conversationContext._evictedUnits = followUpContext.evictedUnits || 0;
        // Do NOT reassign `messages` — the adapter call below reads
        // followUpContext.messages directly; `messages` must stay intact
        // for full_history persistence.
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
        // Leftover error after the correction we actually applied. Must be
        // measured BEFORE the fold below, which overwrites that correction.
        {
          const residual = computeResidualDrift(
            conversationContext._estimateCalibration, followUpResponse.usage, followUpContext.totalRequestTokens);
          if (residual != null) {
            conversationContext._residualDrift =
              conversationContext._residualDrift == null
                ? residual
                : conversationContext._residualDrift * 0.5 + residual * 0.5;
          }
        }
        conversationContext._estimateCalibration = updateEstimateCalibration(
          conversationContext._estimateCalibration,
          followUpResponse.usage,
          followUpContext.totalRequestTokens
        );
      if (conversationContext._estimateCalibration > 0) {
        recordCalibration(normalizedProvider, model, conversationContext._estimateCalibration);
      }
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
    messages = sanitizeUnexpectedToolResults(messages);
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

    // Finalize the agent execution record BEFORE persisting the
    // conversation log. The log write rewrites the full multi-MB history blob
    // and re-tokenizes it into conversation_logs_fts; under I/O contention it
    // can stall long enough that the status update (previously awaited after
    // it) was never reached, leaving the execution stuck at status=running
    // forever. The status update is a tiny single-row write — it lands first.
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
          // Actual cost AND the "if nothing had been cached" baseline, from the
          // same pricing function so the two can never drift. The delta is what
          // caching saved (negative on a prefix-write turn — see cacheSavings.js).
          const costInfo = computeCacheSavings(
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
            estimatedCost: costInfo?.actualCost || 0,
            uncachedCost: costInfo ? costInfo.uncachedCost : null,
            savedCost: costInfo ? costInfo.savedCost : null,
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

        // PRD-122: mirror this turn into the ledger.
        //
        // agent_executions.estimated_cost stays authoritative for the existing
        // Traces/ContextMonitor surfaces; the ledger is what makes cross-path
        // totals possible at all. Both are written from the SAME accumulator,
        // so they cannot disagree — an integration test pins that.
        if (tokenAccumulator.totalTokens > 0) {
          await recordLlmCall({
            userId,
            executionId: agentExecutionId,
            origin: chatType, // same surface tag as the agent_executions row above
            conversationId,
            provider: normalizedProvider,
            model,
            usage: tokenAccumulator,
            durationMs: Date.now() - executionStartTime,
            status: streamErrorForLogging ? 'error' : 'ok',
            error: streamErrorForLogging ? streamErrorForLogging.message : null,
          });
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
          // Which model actually served THIS turn. The panel header shows the
          // currently-selected model, which is not necessarily the one that ran
          // earlier turns - without this the rollup misattributes cost.
          provider: normalizedProvider,
          model,
          subscriptionBased: isSubscriptionProvider(normalizedProvider),
          // What caching cost/saved this turn. null = model has no pricing
          // metadata, so the panel shows nothing rather than a fake $0.00.
          costBreakdown: tokenUsageForDb && tokenUsageForDb.uncachedCost != null ? {
            actual: tokenUsageForDb.estimatedCost || 0,
            uncached: tokenUsageForDb.uncachedCost,
            saved: tokenUsageForDb.savedCost,
          } : null,
        });

        console.log(`[Agent Execution] Completed execution ${agentExecutionId} with status ${finalStatus}, ${toolCallsCount} tool calls`);
      } catch (execError) {
        console.error('[Agent Execution] Failed to finalize execution record:', execError);
      }
    }

    // Conversation-log persistence now runs AFTER execution-status
    // finalization, raced against a timeout so a stalled write (plus its FTS5
    // re-index) can never wedge the tail of the run. A rejection handler is
    // attached immediately, so a late failure can never surface as an
    // unhandledRejection.
    const LOG_WRITE_TIMEOUT_MS = 30000;
    const logPromise = (isNewConversation
      ? ConversationLogModel.create(logData)
      : ConversationLogModel.update(logData).then((updateResult) => {
          // A conversation whose original create failed/timed out would make
          // every subsequent update a 0-row no-op — fall back to create so the
          // conversation is never permanently unpersistable.
          if (updateResult && updateResult.updated === false) {
            console.warn(`Conversation log update matched 0 rows for ${conversationId} — falling back to create`);
            return ConversationLogModel.create(logData);
          }
          return updateResult;
        })
    ).catch((logError) => {
      console.error('Failed to write stream log to DB:', logError);
      return null;
    });
    let logWriteTimer;
    const logTimeout = new Promise((resolve) => {
      logWriteTimer = setTimeout(() => resolve('__log_write_timeout__'), LOG_WRITE_TIMEOUT_MS);
    });
    const logRaceResult = await Promise.race([logPromise, logTimeout]);
    clearTimeout(logWriteTimer);
    if (logRaceResult === '__log_write_timeout__') {
      console.warn(`Conversation-log write for ${conversationId} exceeded ${LOG_WRITE_TIMEOUT_MS}ms — run already finalized; leaving the write to land in the background.`);
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

    // Mirror the prefix-critical subset to disk so a restart does not cost a
    // full cache write on this conversation's next turn. Fire-and-forget: it is
    // an optimisation in front of an already-correct path, and skips itself
    // entirely when nothing changed (the frozen sections settle on turn 1).
    saveConversationState(conversationId, userId, conversationContext).catch((err) => {
      console.error('[ConversationState] Persist failed (non-critical):', err.message);
    });

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

    // Release the run AFTER 'done' is emitted, so reattached clients receive the
    // terminator before their socket is closed.
    endRun(conversationId, streamAbortController.signal.aborted ? 'cancelled' : 'completed');

    if (sseOpen) {
      try {
        res.end();
      } catch (e) {
        console.warn('[Stream] res.end() failed — transport already gone:', e.message);
      }
    }
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


// Display order + friendly names for built-in subcategories. Maps each
// internal TOOL_GROUPS key to the bucket label users see in the dropdown.
// Order here = order in the UI (top-to-bottom).
const BUILTIN_DISPLAY_GROUPS = [
  { id: 'core', name: 'Core' },
  { id: 'shell', name: 'Shell & Terminal' },
  { id: 'agent_management', name: 'Agents' },
  { id: 'workflow_authoring', name: 'Workflows' },
  { id: 'goal_management', name: 'Goals' },
  { id: 'tool_authoring', name: 'Tool Forge' },
  { id: 'widget_authoring', name: 'Widgets' },
  { id: 'artifact_code', name: 'Artifacts' },
  { id: 'media', name: 'Media' },
  { id: 'email', name: 'Email' },
  { id: 'memory', name: 'Memory' },
  { id: 'tutorial', name: 'Guided Tours' },
  { id: 'agnt_platform', name: 'AGNT Platform' },
];

// Map built-in tools into subcategories using TOOL_GROUPS as the taxonomy.
// `agnt_platform` is a superset that pulls in many leaf-group tools — we
// process it LAST so a more specific group claims a tool first. Anything
// not in any group lands in "Other" so nothing disappears.
async function buildBuiltinSubcategories(tools) {
  const { TOOL_GROUPS, GROUP_DESCRIPTIONS } = await import('./orchestrator/toolSelector.js');
  const assigned = new Set();
  const toolsByGroup = {};
  for (const { id } of BUILTIN_DISPLAY_GROUPS) toolsByGroup[id] = [];

  const orderedGroups = BUILTIN_DISPLAY_GROUPS.filter((g) => g.id !== 'agnt_platform')
    .concat(BUILTIN_DISPLAY_GROUPS.filter((g) => g.id === 'agnt_platform'));

  for (const group of orderedGroups) {
    const names = TOOL_GROUPS[group.id] || [];
    for (const tool of tools) {
      if (assigned.has(tool.name)) continue;
      if (names.includes(tool.name)) {
        toolsByGroup[group.id].push(tool);
        assigned.add(tool.name);
      }
    }
  }

  const unassigned = tools.filter((t) => !assigned.has(t.name));
  const subcategories = [];
  for (const group of BUILTIN_DISPLAY_GROUPS) {
    const groupTools = toolsByGroup[group.id];
    if (!groupTools || groupTools.length === 0) continue;
    groupTools.sort((a, b) => a.name.localeCompare(b.name));
    subcategories.push({
      id: `builtin.${group.id}`,
      name: group.name,
      description: GROUP_DESCRIPTIONS[group.id] || '',
      tools: groupTools,
    });
  }
  if (unassigned.length > 0) {
    unassigned.sort((a, b) => a.name.localeCompare(b.name));
    subcategories.push({
      id: 'builtin.other',
      name: 'Other',
      description: 'Tools not yet bucketed into a sector.',
      tools: unassigned,
    });
  }
  return subcategories;
}

// Recursively sort a category's subcategories and tools A-Z by name.
// Mutates in place.
function sortCategoryTreeAlphabetically(category) {
  if (!category) return;
  if (Array.isArray(category.tools)) {
    category.tools.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }
  if (Array.isArray(category.subcategories)) {
    category.subcategories.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    for (const sub of category.subcategories) {
      sortCategoryTreeAlphabetically(sub);
    }
  }
}

// Bucket plugin tools by their owning plugin so users see plugin names
// rather than a flat list of tool ids with no provenance.
function buildPluginSubcategories(pluginTools) {
  const byPlugin = new Map();
  for (const tool of pluginTools) {
    const key = tool.pluginName || '(unknown plugin)';
    if (!byPlugin.has(key)) byPlugin.set(key, []);
    byPlugin.get(key).push(tool);
  }
  const subcategories = [];
  const sortedPlugins = [...byPlugin.keys()].sort((a, b) => a.localeCompare(b));
  for (const pluginName of sortedPlugins) {
    const tools = byPlugin.get(pluginName);
    tools.sort((a, b) => a.name.localeCompare(b.name));
    subcategories.push({
      id: `plugin.${pluginName.toLowerCase().replace(/\s+/g, '-')}`,
      name: pluginName,
      description: '',
      tools,
    });
  }
  return subcategories;
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
    //   1. Built In  (subdivided by sector — Agents / Workflows / Goals /
    //      Tool Forge / Widgets / Artifacts / Media / etc.). The frontend
    //      may re-split this into Specialty Tools + System Tools when the
    //      channel has locked specialty tools; otherwise it renders the
    //      nested sectors directly.
    //   2. Plugins  (subdivided by plugin name, so each plugin's tools are
    //      grouped under their owning plugin rather than dumped in one
    //      A-Z flat list with no provenance).
    //   3. MCP  (single top-level entry; per-server entries are nested
    //      subcategories inside it, kept hierarchical so users with many
    //      MCP servers don't get a flat wall of top-level categories)
    const builtinSubcategories = await buildBuiltinSubcategories(builtInTools);
    const categories = [
      {
        id: 'builtin',
        name: 'Built In',
        description: 'Tools that ship with AGNT — system, agents, workflows, widgets, tool forge, code, and platform integrations.',
        locked: false,
        // Keep the flat list available for any legacy reader, but the
        // frontend prefers `subcategories` when present.
        tools: [],
        subcategories: builtinSubcategories,
      },
    ];

    if (pluginTools.length > 0) {
      categories.push({
        id: 'plugins',
        name: 'Plugins',
        description: 'Tools from installed plugins',
        locked: false,
        tools: [],
        subcategories: buildPluginSubcategories(pluginTools),
      });
    }

    // mcpCategories is now a single-element array containing the parent
    // "MCP" group with `subcategories: [<server>, <server>, ...]`. Append
    // it last so it sits beneath Built In + Plugins in the dropdown.
    for (const cat of mcpCategories) {
      categories.push(cat);
    }

    // Recursive A-Z sort: every subcategory list and every tools list
    // throughout the tree gets sorted by display name. Built In, Plugins,
    // and MCP all get consistent alphabetical ordering inside their
    // top-level buckets. (Top-level order — Built In → Plugins → MCP —
    // is intentional and preserved.)
    for (const cat of categories) {
      sortCategoryTreeAlphabetically(cat);
    }

    res.json({ categories });
  } catch (error) {
    console.error('Error getting available tools:', error);
    res.status(500).json({ error: 'Failed to get available tools' });
  }
}

export default universalChatHandler;
export { getAvailableTools };
