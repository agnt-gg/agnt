/**
 * The session oracle: GET /api/users/auth/status.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 * The desktop app used to ask https://api.agnt.gg whether a session was valid
 * while reading its agents, conversations and outputs from THIS server. Two
 * authorities for one question, and the one holding the data was never asked.
 * When the remote could not be reached the client decoded the JWT itself and
 * called that a session, so an unverified token rendered a full app.
 *
 * The fix rests on one property: THIS ROUTE AND THE DATA ROUTES MUST SHARE ONE
 * VERIFICATION. If they ever diverge, the gate can say yes while every request
 * says no — the original bug with extra steps. So these tests run the REAL
 * `authenticateToken` against the REAL handler and assert the whole chain.
 *
 * They also pin the rejection SHAPE, because the frontend's mid-session logout
 * (utils/axiosInterceptor.js) keys on `reason` to tell our own session
 * rejection apart from, say, a 401 relayed from an upstream LLM provider.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { authenticateToken } from './Middleware.js';
import UserService from '../services/UserService.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'auth-status-contract-secret';
let prevSecret;
let prevTrustRemote;

const makeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};

/**
 * The real chain: middleware first, handler only if it calls next().
 * This is what express does, and running it here means the test cannot pass
 * by talking to a handler the middleware would never have reached.
 */
const call = async (headers = {}) => {
  const req = { headers, session: {} };
  const res = makeRes();
  let reached = false;
  await authenticateToken(req, res, () => {
    reached = true;
    UserService.getAuthStatus(req, res);
  });
  return { req, res, reached };
};

beforeEach(() => {
  prevSecret = process.env.JWT_SECRET;
  prevTrustRemote = process.env.TRUST_REMOTE_AUTH;
  process.env.JWT_SECRET = SECRET;
  process.env.TRUST_REMOTE_AUTH = 'false';
});

afterEach(() => {
  if (prevSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = prevSecret;
  if (prevTrustRemote === undefined) delete process.env.TRUST_REMOTE_AUTH;
  else process.env.TRUST_REMOTE_AUTH = prevTrustRemote;
});

describe('GET /users/auth/status — confirms a session, or refuses', () => {
  it('confirms a validly signed token and names the user', async () => {
    const token = jwt.sign({ id: 'u-1', email: 'a@b.c' }, SECRET);
    const { res, reached } = await call({ authorization: `Bearer ${token}` });

    expect(reached).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      isAuthenticated: true,
      user: { id: 'u-1', email: 'a@b.c' },
    });
  });

  it('never reaches the handler without a token', async () => {
    const { res, reached } = await call();

    expect(reached, 'the handler ran for an unauthenticated caller').toBe(false);
    expect(res.statusCode).toBe(401);
    // The discriminator the frontend interceptor keys on.
    expect(res.body).toMatchObject({ error: 'Authentication required', reason: 'missing' });
  });

  it('never reaches the handler with a forged token', async () => {
    // Signed with the wrong secret: the exact case a client-side JWT *decode*
    // would have happily accepted, because decoding does not check signatures.
    const forged = jwt.sign({ id: 'attacker', email: 'e@vil.com' }, 'a-different-secret');
    const { res, reached } = await call({ authorization: `Bearer ${forged}` });

    expect(reached).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ reason: 'invalid' });
  });

  it('never reaches the handler with an expired token', async () => {
    const stale = jwt.sign({ id: 'u-1' }, SECRET, { expiresIn: -60 });
    const { res, reached } = await call({ authorization: `Bearer ${stale}` });

    expect(reached).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ reason: 'invalid' });
  });

  it.each(['Bearer null', 'Bearer undefined', 'Bearer '])(
    'refuses the placeholder header %s',
    async (authorization) => {
      // The frontend sends these literal strings when its token store is empty.
      const { res, reached } = await call({ authorization });
      expect(reached).toBe(false);
      expect(res.statusCode).toBe(401);
    },
  );

  it('refuses rather than confirming nobody, if it is ever reached unguarded', async () => {
    // Defence in depth: if a refactor moves this route behind the permissive
    // `authenticateTokenOptional`, answering 200 { isAuthenticated: false }
    // would be a confident wrong answer. The handler must fail closed on its
    // own, without relying on the middleware in front of it.
    const req = { headers: {}, user: { isAuthenticated: false } };
    const res = makeRes();
    UserService.getAuthStatus(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ reason: 'invalid' });
  });

  it('does not leak identity fields when it refuses', async () => {
    const { res } = await call({ authorization: 'Bearer not-a-jwt' });
    expect(res.body.user).toBeUndefined();
    expect(res.body.isAuthenticated).toBeUndefined();
  });
});

describe('the gate is wired to the same verification as the data routes', () => {
  const routes = fs.readFileSync(path.join(HERE, 'UserRoutes.js'), 'utf8');
  const line = routes.split('\n').find((l) => l.includes("'/auth/status'"));

  const clientSource = () =>
    fs.readFileSync(path.join(HERE, '../../../frontend/src/store/auth/userAuth.js'), 'utf8');

  /**
   * The body of the verifySession action, by brace matching.
   *
   * Asserting against the whole file cannot distinguish the GATE from the
   * profile fetch that legitimately still calls the remote -- and a rule that
   * cannot tell those apart is either vacuous or wrong. (It was wrong: the
   * first version of this test failed on fetchUserData's remote call.)
   */
  function verifySessionBody() {
    const src = clientSource();
    const at = src.indexOf('async verifySession(');
    if (at === -1) return '';
    const open = src.indexOf('{', src.indexOf(')', at));
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') {
        depth -= 1;
        if (depth === 0) return src.slice(open, i + 1);
      }
    }
    return '';
  }

  it('the route exists', () => {
    expect(line, 'GET /users/auth/status is gone — the client has no oracle').toBeTruthy();
  });

  it('sits behind authenticateToken, not the permissive variant', () => {
    // `authenticateTokenOptional` lets anonymous callers through so the handler
    // can decide. For this route that would mean answering "not signed in"
    // with a 200, which the client would have to interpret — and the whole
    // point is that interpretation stops happening on the client.
    expect(line).toContain('authenticateToken');
    expect(line).not.toContain('authenticateTokenOptional');
    expect(line).toContain('UserService.getAuthStatus');
  });

  it('is the exact path the client probes', () => {
    // Two files, one URL. A rename on either side would otherwise fail as a
    // 404 -> classified as a transient error -> session stuck UNKNOWN, which
    // looks like "AGNT will not let me in" with nothing in the logs.
    expect(verifySessionBody()).toContain('${API_CONFIG.BASE_URL}/users/auth/status');
  });

  it('the GATE talks to the data backend, whatever else talks to the remote', () => {
    // Scoped to verifySession on purpose. The remote has an endpoint of the
    // same name and fetchUserData still calls it -- for the display name, the
    // pseudonym and the plan tier, which are genuinely the remote's to answer.
    // What must never come back is the remote deciding who is SIGNED IN: that
    // is the question it could not answer offline, and answering it from a
    // client-side JWT decode is what rendered an app for an unverified token.
    const gate = verifySessionBody();
    expect(gate, 'the session gate is asking api.agnt.gg again').not.toContain('REMOTE_URL');
    expect(gate).toContain('BASE_URL');
  });

  it('the gate is not TTL-cached, structurally', () => {
    // Every other fetch in that module is wrapped in withFreshness. A gate
    // answered from a cache reports "valid" for a session revoked a minute
    // ago, and the previous gate had to opt out of the cache by hand with a
    // forceRefresh flag someone could forget.
    const client = clientSource();
    expect(client).toMatch(/\n    async verifySession\(/);
    expect(client).not.toMatch(/verifySession:\s*withFreshness/);
  });

  it('nothing belonging to the user loads until the session is verified', () => {
    // Boot used to fire ~20 requests for the user's agents, workflows, tools
    // and conversations while the session was still unverified, and the fix was
    // an ORDERING check: verify, then load.
    //
    // That ordering is no longer something boot can get wrong, because boot no
    // longer loads anything. Loading hangs off the session transition, and the
    // only transition that starts it is the one INTO 'valid' — which only
    // verifySession can produce. The guarantee moved from "these two lines are
    // in the right order" to "there is no other order expressible".
    const boot = fs.readFileSync(path.join(HERE, '../../../frontend/src/main.js'), 'utf8');
    const sessionBoot = fs.readFileSync(
      path.join(HERE, '../../../frontend/src/store/auth/sessionBoot.js'),
      'utf8',
    );

    expect(boot, 'boot never verifies the session').toMatch(
      /await store\.dispatch\('userAuth\/verifySession'\)/,
    );
    expect(boot, 'boot loads user data directly again').not.toMatch(/dispatch\('initializeStore'\)/);
    expect(sessionBoot).toMatch(/dispatch\('initializeStore'\)/);
    // ...and the sequence is gated on the verified state, not merely sequenced
    // after a call that might have failed.
    expect(sessionBoot).toMatch(/if \(next === 'valid'\)/);
  });

  it('the client keys its mid-session logout on the reason we actually send', () => {
    const interceptor = fs.readFileSync(
      path.join(HERE, '../../../frontend/src/utils/axiosInterceptor.js'),
      'utf8',
    );
    expect(interceptor).toContain("reason === 'invalid'");
    // 'missing' must NOT be here. It means WE sent no Authorization header —
    // a fact about our own request, never about the token — and logging out on
    // it was self-perpetuating: the logout cleared localStorage, so every later
    // request was also bare, so the session could never heal. The interceptor
    // deliberately excludes it and this asserts that exclusion holds.
    expect(interceptor).not.toContain("reason === 'missing'");
    // Both are still minted by the middleware — nothing else is.
    // The client acting on only one of them is the point, not an oversight.
    const middleware = fs.readFileSync(path.join(HERE, 'Middleware.js'), 'utf8');
    const reasons = [...middleware.matchAll(/reason:\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(new Set(reasons)).toEqual(new Set(['missing', 'invalid']));
  });
});
