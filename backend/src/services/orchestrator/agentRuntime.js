import { getChatConfig } from './chatConfigs.js';
import { getProviderConfig } from '../ai/providerConfigs.js';

/**
 * THE SINGLE ASSEMBLY PATH FOR A SAVED AGENT'S RUNTIME.
 *
 * A saved agent is a persona + an assigned toolset + assigned skills +
 * accumulated memory. Three surfaces run one: the agent chat, the `agnt-agent`
 * workflow node, and the goal system's TaskOrchestrator. Until this module,
 * only the chat surface assembled all four — the other two hand-rolled a
 * subset, and drifted.
 *
 * WHAT THE DRIFT COST (issue #64, reported 2026-08-14):
 *
 *   - AgentService._getAgentContext() called getAvailableToolSchemas() with no
 *     userId, so Tool Forge (custom) tools were never in the registry it
 *     searched. Every assigned custom tool missed the lookup, logged a warn,
 *     and availableTools came back []. TaskOrchestrator had the identical bug.
 *   - The workflow node passed agent.systemPrompt straight to the model, so
 *     the agent got its persona and NOTHING else — no skills catalog, no
 *     memory, no platform guidance. Commit f0eeca3d moved those blocks into
 *     the chat prompt builder; the workflow node was still reading them from
 *     _getAgentContext, and silently got a persona-only prompt from then on.
 *   - TaskOrchestrator filtered tools by assignedTools alone, ignoring
 *     toolAccessMode, AGENT_DEFAULT_TOOLS and UNIVERSAL_TOOLS — so a goal-run
 *     agent could not call activate_skill or save_agent_memory even though
 *     the prompt told it to.
 *
 * All three failed SILENTLY AND CONFIDENTLY: an empty tool list cannot produce
 * a tool_use block, so the model narrates a plausible result instead. The
 * reporter's client received a fabricated Prometheus security scan.
 *
 * WHY THIS IS A DELEGATION AND NOT A REIMPLEMENTATION.
 *
 * Every line below routes through getChatConfig('agent') — literally the
 * object the agent chat uses. There is no second copy of the tool-filtering
 * rules, the skills catalog, the memory digest or the prompt block order to
 * keep in sync, because there is no second copy at all. That is the property
 * that stops #64 from recurring: an improvement to the chat prompt builder
 * lands in workflows and goals in the same commit, or it lands nowhere.
 *
 * @param {object}  args
 * @param {string}  args.agentId            Saved agent id. Not 'agent-chat'.
 * @param {string}  args.userId             Owner. REQUIRED — custom tools and
 *                                          memory are user-scoped, and passing
 *                                          null here is the original bug.
 * @param {string} [args.latestUserMessage] Drives keyword tool-gating (open
 *                                          mode) and memory relevance ranking.
 * @param {string} [args.provider]          Used only for prompt-block gates.
 * @param {Set|Array|null} [args.enabledTools] Runtime narrowing. null = none.
 * @param {object} [args.contextOverrides]  Extra fields merged into the chat
 *                                          context (e.g. conversationId).
 * @returns {Promise<{systemPrompt: string, toolSchemas: Array, context: object}>}
 */
export async function buildAgentRuntime({
  agentId,
  userId,
  latestUserMessage = '',
  provider = null,
  enabledTools = null,
  contextOverrides = {},
}) {
  if (!agentId || agentId === 'agent-chat') {
    throw new Error('buildAgentRuntime requires a saved agent id');
  }
  if (!userId) {
    // Fail loud. A missing userId is precisely what made #64 invisible: it
    // does not throw anywhere downstream, it just quietly yields an empty
    // custom-tool set and an amnesiac agent.
    throw new Error(`buildAgentRuntime requires a userId (agent ${agentId})`);
  }

  const config = getChatConfig('agent');

  // The chat context object. Its private _frozen* fields are memo slots the
  // config populates; we hand it back to the caller so a resident agent (one
  // that loops in a workflow) can reuse it across turns and pay the skills
  // catalog / memory digest cost exactly once.
  const context = {
    agentId,
    userId,
    latestUserMessage,
    enabledTools,
    ...contextOverrides,
  };

  if (provider) {
    const cfg = getProviderConfig(provider);
    context.provider = provider;
    context.normalizedProvider = cfg ? cfg.key : String(provider).toLowerCase();
  }

  // ORDER IS LOAD-BEARING, and mirrors OrchestratorService (see the
  // conversationContext.toolSchemas assignment before buildSystemPrompt
  // there). buildUnifiedSystemPrompt resolves its block gates from the
  // RESOLVED tool surface — build the prompt first and the image, async and
  // memory-recall blocks all gate off a surface that is still undefined.
  const toolSchemas = await config.getToolSchemas(context);
  context.toolSchemas = toolSchemas;
  const systemPrompt = await config.buildSystemPrompt(context);

  return { systemPrompt, toolSchemas, context };
}

export default { buildAgentRuntime };
