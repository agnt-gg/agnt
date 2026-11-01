import { describe, it, expect } from 'vitest';
import { teamRunnable, teamNeeds, requireTeamTool, SAFE_TEAM_NODES } from './TeamToolPolicy.js';
import { withTeamExecution } from './TeamExecutionContext.js';
import { NativeTeamExecution } from '../NativeTeamExecution.js';

/**
 * Bravo, 2026-10-31: a published team workflow could use only five node types (generic-trigger,
 * trigger-timer, stop-workflow, random-number, generate-with-ai-llm) and every team run started with
 * an empty tool allow-list, so web search, scraping, email and HTTP steps never ran. A published item
 * may now use what a member may run themselves; code, files and the database stay out.
 */
const validate = (kind, definition) => new NativeTeamExecution().validate({ kind, content: JSON.stringify(definition) });

describe('team tool policy', () => {
  it('allows network and data steps; refuses code, files, the database and anything unprofiled', () => {
    for (const name of ['web-search', 'web-scrape', 'send-email', 'custom-api', 'data-transformer', 'delay', 'web_search', 'web_scrape', ...SAFE_TEAM_NODES]) expect(teamRunnable(name), name).toBe(true);
    for (const name of ['execute-javascript', 'execute-python', 'database-operation', 'execute_shell_command', 'execute_javascript_code', 'write_file', 'read_file', 'file_operations', 'agnt-agent', 'some_plugin_tool', '', undefined]) expect(teamRunnable(name), String(name)).toBe(false);
  });

  it('a published workflow with search, scrape and email steps is accepted, and its run may use exactly those', () => {
    const workflow = { nodes: [{ type: 'trigger-timer' }, { type: 'web-search' }, { type: 'web-scrape' }, { type: 'send-email' }] };
    expect(() => validate('workflow', workflow)).not.toThrow();
    expect(new Set(teamNeeds('workflow', workflow).allowed)).toEqual(new Set(['trigger-timer', 'web-search', 'web-scrape', 'send-email']));
  });

  it('a workflow with a database step, or a code step, is refused, naming what is not allowed', () => {
    expect(() => validate('workflow', { nodes: [{ type: 'web-search' }, { type: 'database-operation' }] })).toThrow(/not enabled for shared execution: database-operation/);
    expect(() => validate('workflow', { nodes: [{ type: 'web-search', base: 'CODE_JS' }] })).toThrow(/not enabled for shared execution/);
  });

  it('an agent may carry allowed tools; shell tools, workflows and skills are refused', () => {
    expect(() => validate('agent', { systemPrompt: 'x', assignedTools: ['web_search', 'web_scrape'] })).not.toThrow();
    expect(() => validate('agent', { assignedTools: ['web_search', 'execute_shell_command'] })).toThrow(/execute_shell_command/);
    expect(() => validate('agent', { assignedWorkflows: ['wf-1'] })).toThrow(/workflow\/skill/);
  });

  it('inside a team run only the allow-listed tools pass', async () => {
    await withTeamExecution({ teamId: 't', principalId: 'p', actorId: 'a', allowedTools: new Set(['web_search']) }, async () => {
      expect(() => requireTeamTool('web_search')).not.toThrow();
      expect(() => requireTeamTool('send_email')).toThrow(/not authorized for this team run/);
    });
    expect(() => requireTeamTool('anything')).not.toThrow(); // outside a team run this policy does not apply
  });
});
