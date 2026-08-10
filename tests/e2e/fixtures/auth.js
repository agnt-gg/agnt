/**
 * Signed-in state for the e2e specs.
 *
 * WHY THIS WAS REWRITTEN (2026-08-10)
 * ───────────────────────────────────
 * Every spec that used this fixture had been failing for months, silently,
 * because none of them were in CI. They all rendered "Sign in to AGNT /
 * Session expired" instead of the app. Two independent causes, both of which
 * post-date the fixture:
 *
 *  1. THE TOKEN WAS NOT A TOKEN. It was the string 'mock-test-token', and only
 *     four endpoints were mocked. The app makes ~20 authenticated calls at
 *     boot (/api/version, /api/layouts, /api/widget-definitions,
 *     /api/users/connection-health, six provider auth probes...). Every
 *     unmocked one 401'd, and frontend/src/utils/axiosInterceptor.js signs the
 *     session out on the FIRST 401 from ANY endpoint — a guard added after
 *     this fixture was written. So the app logged itself out mid-boot.
 *     Fixed by signing a REAL JWT the backend will accept, so the unmocked
 *     calls succeed instead of 401ing.
 *
 *  2. THE SECOND AUTH CHECK LEAVES THE MACHINE. userAuth.js has two callers of
 *     /users/auth/status: one on API_CONFIG.BASE_URL (local) and one on
 *     API_CONFIG.REMOTE_URL, which is https://api.agnt.gg. A locally-signed
 *     token is meaningless there, so the cloud answers
 *     {isAuthenticated:false} — a DEFINITIVE rejection, not an outage — and
 *     the session goes INVALID even though the local backend is happy.
 *     The '**\/users/auth/status' mock below covers BOTH, which is why it must
 *     stay even though the token is now real.
 *
 * NETWORK IS BLOCKED, DELIBERATELY
 * ────────────────────────────────
 * Because of (2) these specs would otherwise depend on api.agnt.gg being up.
 * A CI gate that fails when a third party has an outage is a gate people learn
 * to ignore, and the @ci tag contract promises no network. So every request
 * that is not local is ABORTED rather than allowed — which also means a future
 * unmocked external call fails loudly here instead of silently working on a
 * developer's machine and breaking on a runner.
 */
import jwt from 'jsonwebtoken';

/**
 * The secret the harness backend is started with (fixtures/appFixture.js sets
 * JWT_SECRET to this). Overridable so a developer can point a spec at a
 * differently-configured backend without editing code.
 */
export const TEST_JWT_SECRET = process.env.AGNT_E2E_JWT_SECRET || 'agnt-e2e-jwt-secret';

export const TEST_USER_ID = 'e2e-test-user';

/**
 * Port for the harness backend.
 *
 * 34600, NEVER 3333. The specs used to hardcode `3333 + workerIndex`, which is
 * where a real AGNT install listens — and main.js does not fail on a busy
 * port, it ADOPTS whatever already answers its health check
 * ("[connection] sharing the AGNT backend already on port ..."). So running
 * the suite on a developer's machine pointed it at their live backend and
 * their real data. Nothing warned about it.
 */
export const e2ePort = (workerIndex = 0) => Number(process.env.AGNT_E2E_PORT || 34600) + workerIndex;

/** A token the local backend will actually verify. */
export function signTestToken({ secret = TEST_JWT_SECRET, userId = TEST_USER_ID } = {}) {
  return jwt.sign({ id: userId, userId, email: 'test@agnt.gg' }, secret);
}

export const mockUser = {
  id: TEST_USER_ID,
  email: 'test@agnt.gg',
  name: 'Test Agent',
  isAuthenticated: true,
};

export const mockSubscription = {
  planType: 'pro',
  status: 'active',
  features: { agents: true, workflows: true },
};

export const mockWorkflowsData = [
  { id: 'wf-1', name: 'Test Workflow 1', description: 'A test workflow', status: 'active', updatedAt: new Date().toISOString() },
  { id: 'wf-2', name: 'Test Workflow 2', description: 'Another test workflow', status: 'draft', updatedAt: new Date().toISOString() },
];

export const mockAgentsData = [
  { id: 'agent-1', name: 'Test Agent 1', role: 'Test Role', description: 'A test agent', avatar: '🤖' },
  { id: 'agent-2', name: 'Test Agent 2', role: 'Helper', description: 'Another test agent', avatar: '👾' },
];

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Refuse every request that would leave this machine.
 *
 * Registered FIRST on purpose: Playwright gives priority to the most recently
 * registered matching handler, so the specific mocks added after this one win,
 * and this catches only what nothing else claimed.
 */
async function blockExternalRequests(page) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(url)
      || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:');
    if (local) return route.fallback();
    // Loud on purpose. A silent allow here is how a suite starts depending on
    // a third party without anyone deciding that it should.
    console.warn(`[e2e] BLOCKED external request: ${url}`);
    return route.abort('blockedbyclient');
  });
}

/**
 * Put the page in a signed-in state.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ token?: string }} [opts] token defaults to a freshly signed one.
 */
export async function loginUser(page, { token = signTestToken() } = {}) {
  await blockExternalRequests(page);

  // Covers BOTH the local and the api.agnt.gg caller — see the header.
  await page.route('**/users/auth/status', (route) => route.fulfill(json({ isAuthenticated: true, user: mockUser })));
  await page.route('**/users/subscription/status', (route) => route.fulfill(json(mockSubscription)));
  await page.route('**/referrals/user/**', (route) => route.fulfill(json({ pseudonym: 'TestUser' })));
  await page.route('**/auth/connected', (route) => route.fulfill(json(['OpenAI', 'Anthropic'])));

  // addInitScript, not evaluate: the store reads localStorage during module
  // init, so a token written after load is a token the app has already decided
  // it does not have. The old fixture papered over this with a reload().
  await page.addInitScript((t) => {
    localStorage.setItem('token', t);
    localStorage.setItem('hasCompletedOnboarding', 'true');
    localStorage.setItem('selectedProvider', 'OpenAI');
    localStorage.setItem('selectedModel', 'gpt-4o');
  }, token);
}

export async function mockWorkflows(page) {
  await page.route('**/workflows/**', (route) => route.fulfill(json({ workflows: mockWorkflowsData })));
}

export async function mockAgents(page) {
  await page.route('**/agents/**', (route) => route.fulfill(json({ agents: mockAgentsData })));
}
