import {currentTeamExecution} from './TeamExecutionContext.js';
import {resolveToolCapabilities} from '../security/toolCapabilities.js';
import {OWNER_ONLY} from '../security/memberIsolation.js';

export function requireTeamTool(toolName){const context=currentTeamExecution();if(!context)return;
 if(!context.allowedTools?.has(toolName))throw Object.assign(new Error('Tool is not authorized for this team run: '+toolName),{code:'team_tool_denied'});
}

/** Always allowed in a published workflow: triggers, flow control and the team's own model connection. */
export const SAFE_TEAM_NODES=new Set(['generic-trigger','trigger-timer','stop-workflow','random-number','generate-with-ai-llm']);

/**
 * May a published item use this tool or node in a team run?
 *
 * Exactly what a member may run themselves (memberIsolation): a declared capability profile that reaches
 * none of the instance's own code, files or database. Unprofiled names (plugins, custom tools, anything
 * new) stay refused. Credentials are a separate wall: a team run cannot use personal credentials at all
 * (AuthManager.getValidAccessToken -> assertPersonalCredentialContext), only its granted connection.
 *
 * Bravo, 2026-10-31: published workflows were limited to the five SAFE_TEAM_NODES and team runs started
 * with an empty tool allow-list, so web search, scraping, email and HTTP steps could never run.
 */
/** Never in an approved team run: the owner-only set, plus starting other agents/goals outside the approved revision. */
const TEAM_REFUSED=new Set([...OWNER_ONLY,'delegate']);
export function teamRunnable(name){
 if(typeof name!=='string'||!name)return false;
 if(SAFE_TEAM_NODES.has(name))return true;
 const profile=resolveToolCapabilities(name,{});
 return Boolean(profile)&&!profile.capabilities.some(capability=>TEAM_REFUSED.has(capability));
}

/**
 * The tools/nodes a published definition uses, split by teamRunnable. Publishing approves one revision,
 * so its `allowed` set is exactly what that revision's runs may call.
 */
export function teamNeeds(kind,definition){
 const names=kind==='workflow'?(definition?.nodes||[]).map(node=>node?.type)
  :kind==='agent'?(definition?.assignedTools||[]).map(tool=>typeof tool==='string'?tool:tool?.name||tool?.id):[];
 const unique=[...new Set(names.filter(name=>typeof name==='string'&&name))];
 return {allowed:unique.filter(teamRunnable),refused:unique.filter(name=>!teamRunnable(name))};
}
