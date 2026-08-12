import AgentExecutionModel from '../../models/AgentExecutionModel.js';
import EvolutionSettingsModel from '../../models/EvolutionSettingsModel.js';
import db from '../../models/database/index.js';
import { shouldExtract, chatSignature } from './ExtractionGate.js';
import { broadcastToUser } from '../../utils/realtimeSync.js';

/**
 * ChatSkillForge — the missing seam between normal chat and skill evolution.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────────
 * Skills could only ever be forged from a completed Goal. That was never a UX
 * oversight, it was a MEASUREMENT DEPENDENCY: SkillEvolver needs a fitness
 * number to decide whether a candidate earned its place, and a goal evaluation
 * was the only fitness number in the system. Chat produces none, so chat could
 * not reach the forge — and ~99% of real usage is chat. Users saw memories
 * accumulate, never a skill, and reasonably concluded the product does not
 * learn.
 *
 * ── THE FIX: RECURRENCE IS THE FITNESS SIGNAL ─────────────────────────────
 * Deciding "is this worth turning into a procedure?" does not actually require
 * a quality score. It requires evidence of REUSE, and reuse is a count. The
 * third time a turn has the same tool-shape it is a procedure rather than an
 * occurrence. ExtractionGate already counts signature recurrence for workflows;
 * this reuses that table verbatim under a different source_type.
 *
 * That threshold is also the whole safety argument. Writing a skill on the
 * FIRST sighting — the obvious implementation, and the one competing agent
 * products ship — produces skill sprawl: dozens of unvalidated procedures
 * extracted from one-off tasks, which look like learning and rot silently.
 * Waiting for the third sighting means every skill is born with evidence
 * attached, and it is what keeps this cheap: the expensive LLM judge runs once
 * per recurring procedure, not once per turn.
 *
 * ── WHY THIS IS NOT BEHIND `insightsEnabled` ──────────────────────────────
 * The insight master switch gates a per-turn LLM extraction, which is why it
 * defaults off. This path is inherently rare — it costs nothing until the user
 * has genuinely repeated themselves three times — so gating it behind a switch
 * nobody can find would reproduce the exact problem it exists to solve. It has
 * its own opt-out (`chatSkillForge`) and is on by default.
 *
 * Fire-and-forget throughout: nothing here may affect chat execution.
 */

/**
 * A turn with fewer than this many tool calls is a conversation, not a
 * procedure. Pure-prose answers have nothing mechanical to write down, and
 * admitting them would let a single tool call ("search the web") become a
 * "skill" the moment it is repeated three times.
 */
const MIN_TOOL_CALLS = 2;

/**
 * Occurrences of the same signature before a skill is proposed.
 *
 * Three, not two: two is a coincidence often enough to matter, and the cost of
 * waiting one more turn is a day of latency on a feature the user waited months
 * for. Not five, because a procedure the user has repeated five times has
 * already cost them the repetition this is meant to remove.
 */
const MIN_OCCURRENCES = 3;

class ChatSkillForge {
  /**
   * Called after every chat turn. Returns the evolution result when a skill was
   * forged or refined, otherwise null.
   */
  static async onChatCompleted(executionId, userId, context = {}) {
    try {
      if (!executionId || !userId) return null;

      const settings = await EvolutionSettingsModel.get(userId);
      if (settings.chatSkillForge === false) return null;

      const details = await AgentExecutionModel.getExecutionDetails(executionId);
      if (!details) return null;

      // Only learn from turns that actually worked. A failed run's tool shape is
      // evidence of a dead end, and the recurrence counter must not be advanced
      // by it either — otherwise repeatedly failing the same way would forge a
      // skill that teaches the failure.
      if (details.status !== 'completed') return null;

      const toolExecutions = details.toolExecutions || [];
      if (toolExecutions.length < MIN_TOOL_CALLS) return null;

      const signature = chatSignature(details, toolExecutions);
      const scopeId = details.agentId || 'orchestrator';
      const gate = await shouldExtract({
        userId,
        sourceType: 'chat_procedure',
        scopeId,
        signature,
      });

      // ── WHY THIS IS NOT JUST `gate.extract` ──────────────────────────────
      // shouldExtract stamps last_extracted_at on the FIRST sighting, so by the
      // third the cooldown has not elapsed and `extract` is false. Reading it
      // alone would mean a procedure is recognised on occurrence 1 (when there
      // is no evidence) and never again. So: the crossing of the threshold
      // fires unconditionally, and after that the cooldown governs re-forging —
      // which is what routes a still-recurring procedure back into
      // SkillEvolver.refineSkill a day later instead of hourly.
      if (gate.occurrences < MIN_OCCURRENCES) return null;
      if (gate.occurrences > MIN_OCCURRENCES && !gate.extract) return null;

      console.log(`[ChatSkillForge] Recurring procedure detected (${gate.occurrences}x) on ${scopeId} — analyzing ${executionId}`);

      const conversationLog = await this._loadConversationLog(details.conversationId);

      const TraceAnalyzer = (await import('../goal/TraceAnalyzer.js')).default;
      const analysis = await TraceAnalyzer.analyzeChatTrace(details, userId, {
        occurrences: gate.occurrences,
        conversationLog,
        provider: context.provider || details.provider,
        model: context.model || details.model,
      });

      if (!analysis?.skillCandidate?.shouldGenerate) {
        console.log('[ChatSkillForge] Judge declined to propose a skill');
        return null;
      }

      // A non-goal source ref. SkillEvolver takes this as its `sourceGoalId` and
      // needs no modification to accept it: GoalModel.findOne returns nothing
      // for it, so the goal-only A/B test declines by its own existing guard and
      // the skill lands as a draft — the path that was already written for
      // "could not measure this". The string is still recorded as provenance, so
      // the forged skill points back at the conversation that produced it.
      const sourceRef = `chat:${executionId}`;

      const SkillEvolver = (await import('../goal/SkillEvolver.js')).default;
      const result = await SkillEvolver.evolveSkill(analysis, sourceRef, userId);

      if (result && (result.action === 'kept' || result.action === 'promoted')) {
        console.log(`[ChatSkillForge] Forged "${result.skillName}" v${result.version} from ${gate.occurrences} similar chats`);
        broadcastToUser(userId, 'evolution:skill_forged', {
          skillId: result.skillId,
          skillName: result.skillName,
          version: result.version,
          occurrences: gate.occurrences,
          conversationId: details.conversationId,
          executionId,
          isRefinement: (result.version || 1) > 1,
        });
      }

      return result;
    } catch (error) {
      console.error('[ChatSkillForge] onChatCompleted failed (non-critical):', error.message);
      return null;
    }
  }

  /**
   * The user's own messages. Without them the judge sees a bare tool list and
   * writes a skill about reading files; with them it sees what the procedure was
   * FOR. Failure is non-fatal — a toolshape-only analysis is worse, not broken.
   * @private
   */
  static _loadConversationLog(conversationId) {
    if (!conversationId) return Promise.resolve(null);
    return new Promise((resolve) => {
      db.get(
        'SELECT * FROM conversation_logs WHERE conversation_id = ?',
        [conversationId],
        (err, row) => resolve(err ? null : (row || null))
      );
    });
  }
}

export { MIN_TOOL_CALLS, MIN_OCCURRENCES };
export default ChatSkillForge;
