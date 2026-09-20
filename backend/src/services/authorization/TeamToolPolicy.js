import {currentTeamExecution} from './TeamExecutionContext.js';
export function requireTeamTool(toolName){const context=currentTeamExecution();if(!context)return;
 if(!context.allowedTools?.has(toolName))throw Object.assign(new Error('Tool is not authorized for this team run: '+toolName),{code:'team_tool_denied'});
}
export const SAFE_TEAM_NODES=new Set(['generic-trigger','trigger-timer','stop-workflow','random-number','generate-with-ai-llm']);
