/**
 * `workflowEngine.ai` for plugin tools: the account's AI, the way custom AI
 * tools get it.
 *
 * A plugin tool that needs an AI used to have to call a vendor API itself with
 * a sign-in token (`params.__auth.token`). That cannot work for AI
 * subscriptions (Claude Code, Codex) and ignores the model the user selected
 * for everything else (reported 2026-10-21: a Blog Generator plugin failed
 * with CONNECTION_REQUIRED for both connected subscriptions).
 *
 *   const { text } = await workflowEngine.ai.generate({ prompt, system, maxTokens, temperature });
 *
 * Runs on the user's selected AI (resolveAccountAi) with its fallbacks, via
 * the same generate tool as custom AI tools and workflow nodes, so usage is
 * recorded the same way. Throws on failure, with the model's own error.
 */
import { resolveAccountAi } from './accountAi.js';

const MAX_PROMPT_CHARS = 400_000;

export function createPluginAi(getUserId, engine) {
  return Object.freeze({
    /**
     * @param {{ prompt: string, system?: string, maxTokens?: number, temperature?: number }} request
     * @returns {Promise<{ text: string, provider: string, model: string }>}
     */
    async generate(request = {}) {
      const prompt = String(request.prompt ?? '');
      if (!prompt.trim()) throw new Error('ai.generate needs a prompt');
      const full = request.system ? `${String(request.system)}\n\n${prompt}` : prompt;
      if (full.length > MAX_PROMPT_CHARS) throw new Error(`ai.generate: the prompt is too long (${full.length} characters)`);
      const userId = getUserId();
      if (!userId) throw new Error('ai.generate: no signed-in user to run the AI for');
      const account = await resolveAccountAi(userId);
      const { default: GenerateWithAiLlm } = await import('../../tools/library/actions/generate-with-ai-llm.js');
      const result = await GenerateWithAiLlm.execute(
        {
          prompt: full,
          provider: account.provider,
          model: account.model,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
        },
        {},
        engine
      );
      if (result?.error) throw new Error(result.error);
      return { text: String(result?.generatedText ?? ''), provider: account.provider, model: account.model };
    },
  });
}
