// Tasks in chat — Annie's one tool for doing real work in the open.
//
// task_checkpoint posts a card in the conversation (the plan, the exact draft,
// this routine run, or the final review) and ENDS HER TURN: the orchestrator's
// tool loop stops after it (OrchestratorService, next to the mention_agent
// floor pass). The person approves, asks for changes, or skips a run; their
// reply resumes her in the same chat. See services/TaskCheckpoints.js.
//
// The card is rendered by the chat itself (TaskCheckpointCard.vue) from this
// tool's result, so the result carries the checkpoint id, never just text.

import db from '../../models/database/index.js';
import { databaseRepository } from '../authorization/ScopeRepository.js';
import { TaskCheckpoints, CHECKPOINT_KINDS, createBoardClient } from '../TaskCheckpoints.js';
import { CloudTeamClient } from '../CloudTeamClient.js';
import { broadcastToUser } from '../../utils/realtimeSync.js';

export function getTaskToolSchemas() {
  return [
    {
      type: 'function',
      function: {
        name: 'task_checkpoint',
        description:
          'Show the person a card in this chat and WAIT for their decision. Your turn ends when you call this; their reply (approve, change request, or skip) arrives as their next message. ' +
          'Use it whenever you are doing real work that sends, posts, publishes, pays, deletes, books or otherwise changes something outside this chat, BEFORE doing it: ' +
          '1) kind="plan": the steps, with the real specifics (who, how many, which records) and a line saying what you will NOT do; ' +
          '2) kind="review": the exact output to check (the full email text with To/Subject, the table, the post) before it goes anywhere; ' +
          '3) kind="final": when finished, a checklist of what was planned plus every output; ' +
          '4) kind="routine": after a finished task the person wants repeated, the routine (when it runs, each step, what still asks them first, what you will measure); create the schedule only after they approve it, passing runMode ("ask" if any step sends or changes something, else "auto") and sourceConversationId (this chat\'s id) so its card shows how it runs and links back here; ' +
          '5) kind="run": inside a routine run, this run\'s specifics before acting. ' +
          'Put EVERYTHING the person is approving in `content` (markdown, tables welcome): never ask them to approve something they cannot see on the card. ' +
          'Do not call it for questions, research, summaries or anything read-only. One card at a time; after a change request, post the revised card.',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...CHECKPOINT_KINDS], description: 'Which checkpoint this is.' },
            title: { type: 'string', description: 'Short card title, e.g. "The plan · 3 steps" or "Check the 3 emails".' },
            content: { type: 'string', description: 'Markdown: everything being approved, in full.' },
            task_title: { type: 'string', description: 'The task this work is, in a few words, e.g. "Send the January price notice". Give it on the first card.' },
            teamspace: { type: 'string', description: 'On a team: the teamspace whose board should carry this task (its name). Omit for private work.' },
          },
          required: ['kind', 'title', 'content'],
        },
      },
    },
  ];
}

const TASK_TOOL_NAMES = new Set(getTaskToolSchemas().map((s) => s.function.name));
export const isTaskTool = (name) => TASK_TOOL_NAMES.has(name);

let service = null;
function checkpoints() {
  if (!service) service = new TaskCheckpoints(databaseRepository(db), createBoardClient());
  return service;
}

/**
 * On a team's instance: the caller's team here (asked of the cloud, the authority) and the
 * teamspace with that name, read through the team routes with the caller's own token so a
 * teamspace they cannot open is never found. Null anywhere else.
 */
export async function resolveTeamspace(authToken, teamspaceName, { cloud = new CloudTeamClient(), fetchImpl = fetch, slug = process.env.AGNT_TENANT_SLUG } = {}) {
  if (!slug || !authToken || !teamspaceName) return null;
  const bearer = authToken.startsWith('Bearer ') ? authToken : 'Bearer ' + authToken;
  const teams = await cloud.request(bearer, '');
  const team = Array.isArray(teams) ? teams.find((t) => t?.tenantSlug === slug) : null;
  if (!team) return null;
  const response = await fetchImpl(`http://localhost:${process.env.PORT || 3333}/api/teams/${encodeURIComponent(team.id)}/workspaces`, { headers: { Authorization: bearer } });
  const spaces = response.ok ? await response.json() : [];
  const wanted = String(teamspaceName).trim().toLowerCase();
  const space = (Array.isArray(spaces) ? spaces : []).find((s) => String(s.name).toLowerCase() === wanted);
  return space ? { teamId: team.id, workspaceId: space.id, name: space.name } : null;
}

export async function executeTaskTool(toolName, args, authToken, context = {}, deps = {}) {
  if (!isTaskTool(toolName)) return { success: false, error: `Unknown task tool: ${toolName}` };
  const userId = context?.userId;
  const conversationId = context?.conversationId;
  if (!userId || !conversationId) return { success: false, error: 'A checkpoint needs a signed-in person and a conversation.' };
  try {
    let team = null;
    let teamNote = null;
    if (args?.teamspace) {
      try {
        team = await (deps.resolveTeamspace || resolveTeamspace)(authToken, args.teamspace);
        if (!team) teamNote = `No teamspace named "${args.teamspace}" here, so this task stays private.`;
      } catch (error) {
        teamNote = `Could not reach the team board (${error.message}); this task stays private.`;
      }
    }
    const { checkpoint, linkError } = await (deps.checkpoints || checkpoints()).create(userId, conversationId, args || {}, { authToken, team });
    // Home's "Needs you" and the rail badge update in every open window.
    (deps.notify || broadcastToUser)(userId, 'checkpoint:changed', { id: checkpoint.id, conversationId, state: checkpoint.state });
    return {
      success: true,
      status: 'awaiting_decision',
      checkpoint: { id: checkpoint.id, kind: checkpoint.kind, title: checkpoint.title, task: checkpoint.task },
      message: 'The card is in the chat. Stop here and wait for the person\'s reply; do not act on it until they approve.',
      ...(teamNote || linkError ? { note: teamNote || `The board card could not be updated: ${linkError}` } : {}),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
