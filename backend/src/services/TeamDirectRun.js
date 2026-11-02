import { withToolActor, issueToolToken, TOOL_TOKEN_MAX_TTL_SECONDS } from './security/toolRunAuthority.js';
import { isNonOwnerMember } from './security/memberIsolation.js';
import { policyRefusalMessage } from './authorization/teamPolicy.js';
import { teamRunOutcome } from './ai/runOutcome.js';

const refuse = (status, message, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };

/**
 * Run a teamspace agent's CURRENT definition as the teammate who asked: an agent on a board card, or
 * @mentioned in teamspace chat, that has no published version yet.
 *
 * Same rules as running it from its page (ScopeApiMiddleware): the owner's "Run workflows and agents"
 * policy and the teammate's runs.execute + connections.use in this teamspace. The run acts as the
 * teammate (withToolActor), so every tool call it makes passes memberIsolation exactly as their chat
 * does: code, shell and files in the kernel sandbox, no SQL, no unapproved plugins. It uses the agent's
 * own model and assigned tools, on the teamspace's connections (credentialUserId of the workspace).
 *
 * A published agent still runs its approved revision on the team connection (NativeTeamExecution).
 */
export async function runAgentAsTeammate({ team, actorId, authorization, scope, workspaceId, agentId, input, cloud }) {
  if (actorId !== process.env.AGNT_TENANT_OWNER) {
    if (team?.policy?.permissions?.['workflows.run'] === false) refuse(403, policyRefusalMessage('workflows.run'), { code: 'team_policy_denied' });
    const access = '/' + encodeURIComponent(team.id) + '/instances/' + encodeURIComponent(team.tenantSlug) + '/workspaces/' + encodeURIComponent(workspaceId) + '/access/';
    await cloud.request(authorization, access + 'runs.execute');
    await cloud.request(authorization, access + 'connections.use');
  }
  const { default: AgentModel } = await import('../models/AgentModel.js');
  const agent = await AgentModel.findOne(agentId);
  if (!agent || agent.created_by !== scope.resourceOwnerId) refuse(404, 'Agent not found in this teamspace');
  const assigned = new Set((agent.assignedTools || []).map((tool) => (typeof tool === 'string' ? tool : tool?.name || tool?.id)).filter(Boolean));
  const { getAvailableToolSchemas } = await import('./orchestrator/tools.js');
  const toolSchemas = assigned.size
    ? (await getAvailableToolSchemas({ asyncEnabled: false, userId: scope.resourceOwnerId })).filter((schema) => assigned.has(schema.function?.name))
    : [];
  const { default: service } = await import('./ai/LlmExecutionService.js');
  // A run-scoped token for the teammate, so the tool calls this run makes after the request can still prove who it is.
  const runAuthorization = isNonOwnerMember(actorId) ? 'Bearer ' + issueToolToken(actorId, { ttlSeconds: TOOL_TOKEN_MAX_TTL_SECONDS }) : authorization;
  const result = await withToolActor(actorId, () => service.executeWithTools({
    provider: agent.provider,
    model: agent.model,
    userId: scope.resourceOwnerId,
    systemPrompt: agent.systemPrompt || agent.system_prompt || '',
    messages: [{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input ?? {}) }],
    toolSchemas,
    maxToolRounds: toolSchemas.length ? 10 : 1,
    context: { agentId, actorId },
  }), runAuthorization);
  return teamRunOutcome(result);
}
