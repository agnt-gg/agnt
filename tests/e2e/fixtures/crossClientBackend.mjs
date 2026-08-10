/**
 * Harness backend for tests/e2e/cross-client-runs.spec.js.
 *
 * Stands up the REAL pieces of the backend the two-tab tests depend on, and
 * nothing else:
 *
 *   REAL  OrchestratorRoutes         -> GET /runs, GET /runs/:id/stream (SSE replay)
 *   REAL  activeRuns registry        -> startRun / publish / the replay log
 *   REAL  broadcastToUser            -> the "(N clients)" line the tests assert on
 *   REAL  resolveSocketIdentity      -> token-derived room membership
 *   REAL  authenticateToken          -> a genuinely signed JWT, not a mocked guard
 *
 * STAND-IN, stated plainly: POST /api/harness/start-run replaces
 * universalChatHandler. A real chat turn needs a real LLM, which would make a
 * CI gate slow, costly and nondeterministic for reasons that have nothing to do
 * with run visibility. This trigger performs the SAME two steps, in the SAME
 * order, with the SAME payload as the real call site in OrchestratorService.js:
 *
 *     activeRun = startRun({ conversationId, userId, chatType, ... });
 *     broadcastToUser(userId, RealtimeEvents.RUN_STARTED, {
 *       conversationId, chatType, startedAt, originClientId,
 *     });
 *
 * That the real call site does exactly that — after startRun, before the first
 * sendEvent, gated on userId, reading x-agnt-client-id — is pinned separately by
 * backend/src/services/OrchestratorService.runAnnouncement.test.js, which is
 * mutation-verified: deleting the broadcast fails four of its assertions.
 *
 * So the EMISSION is covered by source contract, and everything DOWNSTREAM of
 * the wire — Socket.IO delivery, two real browser clients, per-tab identity,
 * echo suppression, adoptAnnouncedRun, the SSE reattach — is covered for real,
 * by the spec that spawns this.
 *
 * ISOLATION: AGNT_HOME is redirected to a throwaway directory BEFORE any backend
 * module is imported, so this can never touch a developer's real agnt.db. The
 * directory is removed on exit.
 *
 *   node crossClientBackend.mjs <port>
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const PORT = Number(process.argv[2]);
if (!PORT) {
  console.error('usage: node crossClientBackend.mjs <port>');
  process.exit(2);
}

// tests/e2e/fixtures/ -> tests/e2e/ -> tests/ -> repo root. Derived rather than
// configured, so this works in any checkout without a path to keep in sync.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// ---- isolate the data directory BEFORE importing anything from the backend ----
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-xclient-'));
const dataDir = path.join(TMP, '.agnt', 'data');
fs.mkdirSync(dataDir, { recursive: true });
// An empty agnt.db stops the bootstrap treating this as a fresh install that
// should inherit an orphaned database — which would copy a real one in.
fs.writeFileSync(path.join(dataDir, 'agnt.db'), '');

process.env.AGNT_HOME = TMP;
delete process.env.USER_DATA_PATH;
delete process.env.DOCKER_CONTAINER;
delete process.env.TRUST_REMOTE_AUTH; // force the local jwt.verify path
process.env.JWT_SECRET = 'harness-xclient-secret';

const fromRepo = (p) => import(path.join(REPO, p));

const express = (await fromRepo('node_modules/express/index.js')).default;
const jwt = (await fromRepo('node_modules/jsonwebtoken/index.js')).default;
const { Server: SocketIOServer } = await fromRepo('node_modules/socket.io/dist/index.js');

const orchestratorRoutes = (await fromRepo('backend/src/routes/OrchestratorRoutes.js')).default;
const { startRun, publish, endRun } = await fromRepo('backend/src/services/orchestrator/activeRuns.js');
const { broadcastToUser, RealtimeEvents } = await fromRepo('backend/src/utils/realtimeSync.js');
const { resolveSocketIdentity } = await fromRepo('backend/src/utils/socketIdentity.js');

/** Must match USER in frontend/_harness/crossclient.js. */
const USER = 'u-xclient-harness';

const app = express();
app.use(express.json());

// Mounted at /api/orchestrator so the frontend's
// `${API_CONFIG.BASE_URL}/orchestrator/runs` resolves exactly as in a browser.
app.use('/api/orchestrator', orchestratorRoutes);

// The SPA's session gate. Harmless to provide, and it keeps the harness honest
// about who is signed in.
app.get('/api/users/auth/status', (_req, res) => {
  res.json({ isAuthenticated: true, user: { id: USER, email: 'harness@test.local' } });
});

/** Start a run and announce it — the stand-in for universalChatHandler. */
app.post('/api/harness/start-run', (request, res) => {
  const conversationId = request.body?.conversationId || `conv-xclient-${Date.now()}`;
  const chatType = request.body?.chatType || 'orchestrator';

  const activeRun = startRun({
    conversationId,
    userId: USER,
    chatType,
    userMessage: request.body?.userMessage || 'run some long running task',
  });

  // Replayable content, so a client attaching later demonstrably receives the
  // turn from its BEGINNING rather than an empty registration. This is what
  // separates a real reattach from the delta mirror in the assertions.
  publish(activeRun, 'conversation_started', { conversationId });
  publish(activeRun, 'assistant_message', { id: 'a1', role: 'assistant', content: '' });
  publish(activeRun, 'content_delta', { assistantMessageId: 'a1', delta: 'Starting the long job' });

  broadcastToUser(USER, RealtimeEvents.RUN_STARTED, {
    conversationId,
    chatType,
    startedAt: activeRun?.startedAt || Date.now(),
    originClientId: request?.headers?.['x-agnt-client-id'] || null,
  });

  res.json({ ok: true, conversationId, originClientId: request?.headers?.['x-agnt-client-id'] || null });
});

/** Finish a run, so teardown does not leave replay buffers or timers behind. */
app.post('/api/harness/end-run', (request, res) => {
  endRun(request.body?.conversationId, 'completed');
  res.json({ ok: true });
});

const server = http.createServer(app);

// Real Socket.IO with the REAL identity resolution. This is the transport the
// whole of 7a/7b depends on, so it is not simulated.
const io = new SocketIOServer(server, { cors: { origin: true, credentials: true } });
io.on('connection', (socket) => {
  socket.on('authenticate', (data) => {
    const identity = resolveSocketIdentity(data);
    if (!identity.ok) {
      socket.emit('authenticated', { success: false, error: identity.reason });
      return;
    }
    socket.join(`user:${identity.userId}`);
    socket.userId = identity.userId;
    socket.emit('authenticated', { success: true, userId: identity.userId, verified: identity.verified });
  });
});
// broadcastToUser reads global.io — this is what makes the real fan-out work,
// and therefore what makes the "(N clients)" assertion meaningful.
global.io = io;

server.on('error', (e) => {
  console.log(`HARNESS_ERROR ${e.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const token = jwt.sign({ id: USER, userId: USER, email: 'harness@test.local' }, process.env.JWT_SECRET);
  console.log(`HARNESS_TOKEN ${token}`);
  console.log(`HARNESS_USER ${USER}`);
  console.log(`HARNESS_TMP ${TMP}`);
  console.log(`HARNESS_READY ${PORT}`);
});

const shutdown = () => {
  try { server.close(); } catch { /* already closed */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
