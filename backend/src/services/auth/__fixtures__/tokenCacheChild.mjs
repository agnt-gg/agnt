/**
 * A real forked child, for the one test that has to cross a process boundary.
 *
 * WHY A FIXTURE AND NOT A MOCK
 * ----------------------------
 * The defect this guards against was invisible to every mock: the cache was
 * written in one process and read in another, and a mocked child shares the
 * parent's module registry, so the parent's cache answers the child's question
 * and the test passes while production is broken. That is exactly what happened
 * — 13 green assertions over a module that could never work where it was used.
 *
 * So this is forked for real. It imports the SAME module the receivers import,
 * and it reports what `authHeader()` actually returns inside its own process.
 *
 * It deliberately mirrors WorkflowProcess.js's dispatch — same message type,
 * same `data.token` / `data.userId` shape, same early return — so that if the
 * real handler's contract drifts, the shape asserted here drifts with it and
 * the pair stops agreeing.
 */
import {
  rememberSessionToken,
  authHeader,
  getSessionToken,
  getSessionUserId,
} from '../sessionTokenCache.js';

function report(stage) {
  process.send({
    stage,
    pid: process.pid,
    header: authHeader(),
    token: getSessionToken(),
    userId: getSessionUserId(),
    isWorkflowProcess: process.env.IS_WORKFLOW_PROCESS === 'true',
  });
}

process.on('message', (message) => {
  const { type, data } = message || {};

  // Mirrors the real handler in workflow/WorkflowProcess.js.
  if (type === 'SESSION_TOKEN') {
    rememberSessionToken(data?.token, data?.userId);
    report('after-token');
    return;
  }

  if (type === 'REPORT') {
    report('on-demand');
  }
});

// Announce the starting state: this MUST be an empty header. If a fresh child
// somehow already had a token, the test below would be proving nothing.
report('initial');
