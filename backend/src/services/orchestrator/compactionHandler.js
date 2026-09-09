/**
 * POST /orchestrator/compress — distil a conversation's history into one
 * summary the client folds its transcript behind.
 *
 * The client owns the fold: it decides which messages to summarise, sends
 * them here in the same wire shape /chat receives, and inserts the returned
 * summary into its own message list. This handler owns what only the server
 * can do — call the provider, price the call, record it, and reset the
 * eviction watermark so the next turn is not cut at a stale point.
 *
 * Accounting is identical to a chat turn: one agent_executions row (origin
 * 'compaction') and one ledger row, written from the same usage object, so
 * the Context & Cost panel and Traces both see the spend.
 */

import AgentExecutionModel from '../../models/AgentExecutionModel.js';
import { createLlmClient } from '../ai/LlmService.js';
import { createLlmAdapter } from './llmAdapters.js';
import { recordLlmCall } from '../execution/LedgerRecorder.js';
import { computeCacheSavings } from '../../utils/cacheSavings.js';
import { getContextBudget } from '../../utils/contextManager.js';
import { isSubscriptionProvider } from '../ai/providerConfigs.js';
import conversationManager from '../ConversationManager.js';
import { loadConversationState, saveConversationState } from './conversationStateStore.js';
import {
  distillConversation,
  extractResponseText,
  DEFAULT_TARGET_TOKENS,
} from './conversationCompaction.js';

const MAX_TARGET_TOKENS = 20000;
const MIN_TARGET_TOKENS = 500;

/**
 * Forget the chunked-eviction watermark for this conversation.
 *
 * manageContext() forgets it on its own when the history fits the budget,
 * which a compressed history always should. The explicit reset is for the
 * case where it does not: the clamp `min(evictedUnits, units - 1)` would
 * then drop nearly the whole (already short) history on the next turn.
 */
async function resetEvictionWatermark(conversationId, userId) {
  if (!conversationId) return;
  const live = conversationManager.get(conversationId);
  if (live) live._evictedUnits = 0;
  try {
    const stored = await loadConversationState(conversationId);
    if (stored) {
      stored._evictedUnits = 0;
      await saveConversationState(conversationId, userId, stored);
    }
  } catch (e) {
    // Non-critical: the next turn re-derives and manageContext self-heals.
    console.warn('[Compaction] Could not reset the eviction watermark:', e?.message || e);
  }
}

export async function handleCompaction(req, res) {
  const userId = req.user?.id || null;
  if (!userId) return res.status(401).json({ success: false, error: 'Authentication required.' });

  const { conversationId = null, messages, provider, model } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: 'messages must be a non-empty array.' });
  }
  if (!provider || !model) {
    return res.status(400).json({ success: false, error: 'provider and model are required.' });
  }
  const targetTokens = Math.min(
    MAX_TARGET_TOKENS,
    Math.max(MIN_TARGET_TOKENS, Math.floor(Number(req.body.targetTokens) || DEFAULT_TARGET_TOKENS)),
  );

  const normalizedProvider = String(provider).trim().toLowerCase();

  let adapter;
  try {
    const client = await createLlmClient(normalizedProvider, userId);
    adapter = await createLlmAdapter(normalizedProvider, client, model);
  } catch (authError) {
    console.error('[Compaction] Provider setup failed:', authError?.message || authError);
    return res.status(500).json({
      success: false,
      error: `${provider} authentication failed. Please set up your ${provider} API key.`,
    });
  }

  const startedAt = Date.now();
  let executionId = null;
  try {
    executionId = await AgentExecutionModel.create(
      userId,
      null,
      'Compress conversation',
      conversationId,
      `Compress ${messages.length} message${messages.length === 1 ? '' : 's'} into a summary`,
      normalizedProvider,
      model,
      'running',
      { origin: 'compaction' },
    );
  } catch (e) {
    // The distillation is the product; the record is bookkeeping.
    console.warn('[Compaction] Could not create execution record:', e?.message || e);
  }

  const callModel = async (llmMessages) => {
    const { responseMessage, usage, recoveredFromError, recoveredError } = await adapter.call(llmMessages, []);
    if (recoveredFromError) {
      throw new Error(typeof recoveredError === 'string' ? recoveredError : (recoveredError?.message || 'Provider error'));
    }
    return { text: extractResponseText(responseMessage), usage };
  };

  try {
    const { availableTokens } = getContextBudget(model, normalizedProvider);
    const result = await distillConversation({
      messages,
      callModel,
      contextBudgetTokens: availableTokens,
      targetTokens,
    });

    const durationMs = Date.now() - startedAt;
    const u = result.usage;
    const costInfo = u.totalTokens > 0
      ? computeCacheSavings(normalizedProvider, model, u.inputTokens, u.outputTokens, {
        cacheReadTokens: u.cacheReadTokens,
        cacheCreation5mTokens: u.cacheCreation5mTokens,
        cacheCreation1hTokens: u.cacheCreation1hTokens,
      })
      : null;
    const estimatedCost = costInfo ? costInfo.actualCost : null;

    if (executionId) {
      await Promise.all([
        AgentExecutionModel.update(
          executionId,
          'completed',
          result.summary.slice(0, 4000),
          durationMs / 1000,
          0,
          null,
          {
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            totalTokens: u.totalTokens,
            estimatedCost: estimatedCost || 0,
            cacheReadTokens: u.cacheReadTokens,
            cacheCreationTokens: u.cacheCreationTokens,
          },
        ).catch((e) => console.warn('[Compaction] Could not finalize execution record:', e?.message || e)),
        recordLlmCall({
          userId,
          executionId,
          origin: 'compaction',
          conversationId,
          provider: normalizedProvider,
          model,
          usage: u,
          durationMs,
          status: 'ok',
        }),
      ]);
    }

    await resetEvictionWatermark(conversationId, userId);

    console.log(
      `[Compaction] ${conversationId || 'unsaved'}: ${messages.length} messages → summary in ${result.calls} call(s), ` +
      `${u.inputTokens} in / ${u.outputTokens} out${estimatedCost != null ? `, $${estimatedCost.toFixed(4)}` : ''}`,
    );

    return res.json({
      success: true,
      summary: result.summary,
      provider: normalizedProvider,
      model,
      executionId,
      chunks: result.chunks,
      calls: result.calls,
      durationMs,
      tokenUsage: {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: u.totalTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheCreationTokens: u.cacheCreationTokens,
      },
      estimatedCost,
      uncachedCost: costInfo ? costInfo.uncachedCost : null,
      subscriptionBased: isSubscriptionProvider(normalizedProvider),
    });
  } catch (error) {
    const message = error?.message || 'Compression failed';
    console.error('[Compaction] Failed:', message);
    if (executionId) {
      AgentExecutionModel.update(executionId, 'failed', null, (Date.now() - startedAt) / 1000, 0, message)
        .catch(() => {});
    }
    return res.status(502).json({ success: false, error: message });
  }
}

export default handleCompaction;
