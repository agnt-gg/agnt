/**
 * THE CONTAINER, AS SHIPPED, RUN THROUGH THE REAL AUTH PATH.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS, IN THE EXACT SHAPE IT DOES
 * ---------------------------------------------------------------------------
 * GitHub issue #144. For three weeks the default docker-compose.yml produced a
 * container that ACCEPTED a bearer token anyone could sign (JWT_SECRET was the
 * string `CHANGE_ME_IN_PRODUCTION`, in a public repository) and REJECTED every
 * genuine login (that string is not the issuer's key). Both facts were
 * derivable from the compose file and the middleware; nothing read them
 * together. The guard that existed scanned the compose file for a different
 * defect and passed.
 *
 * So this test does the one thing that was missing: it takes the environment
 * the compose file and Dockerfile actually give a container — parsed from the
 * files, not retyped here — puts the real `secretsBootstrap` and the real
 * `authenticateToken` under it, and sends the three requests that matter:
 * the owner's genuine token, a stranger's genuine token, and a forgery.
 *
 * The issuer is simulated at the `fetch` boundary, not by mocking the
 * verifier module, so the verifier, its cache and the membership floor all
 * run for real. The simulation is faithful to api.agnt.gg in the one respect
 * that matters here: it answers 200 only for tokens it issued, and 401 for
 * everything else — including a token signed with the published desktop key,
 * which the real issuer refuses for lack of a proof claim.
 *
 * The desktop path is asserted last, deliberately: every install in the field
 * is one, and the property most worth keeping is that none of this touches it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

const OWNER = { id: 'owner-account-0123456789abcdef', email: 'Owner@Example.test' };
const TEAMMATE = { id: 'teammate-account-abcdef01234567', email: 'teammate@example.test' };
const STRANGER = { id: 'stranger-account-fedcba98765432', email: 'stranger@example.test' };

/** Signed by the issuer. This process never learns that key; only the fake issuer can check it. */
const ISSUER_KEY = 'the-issuer-signing-key-this-container-must-never-hold';
const issued = (account) => jwt.sign({ id: account.id, email: account.email, auth_type: 'google' }, ISSUER_KEY);

// ---------------------------------------------------------------------------
// The shipped artefacts, read literally.
// ---------------------------------------------------------------------------

/** `environment:` entries of docker-compose.yml with compose's own default syntax resolved. */
function composeEnvironment() {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
  const env = {};
  const required = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    const m = line.slice(2).match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, name, value] = m;
    const sub = value.match(/^\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*)|:\?([^}]*))?\}$/);
    if (!sub) env[name] = value;
    else if (sub[3] !== undefined) required.add(name); // ${VAR:?message}: compose refuses to start without it
    else env[name] = sub[2] ?? '';
  }
  return { env, required };
}

/** `ENV NAME=value` lines of the Dockerfile. */
function dockerfileEnvironment() {
  const env = {};
  for (const raw of fs.readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^ENV\s+([A-Z_][A-Z0-9_]*)=(\S+)/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const compose = composeEnvironment();
const dockerfile = dockerfileEnvironment();

// ---------------------------------------------------------------------------
// Environment discipline. Everything the container sets, plus everything the
// auth path reads, is saved, cleared and restored around every test.
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  ...new Set([
    ...Object.keys(compose.env),
    ...compose.required,
    ...Object.keys(dockerfile),
    'JWT_SECRET',
    'SESSION_SECRET',
    'ENCRYPTION_KEY',
    'AGNT_AUTH_MODE',
    'AGNT_TENANT_SLUG',
    'AGNT_TENANT_OWNER',
    'AGNT_TENANT_MEMBERS',
    'TRUST_REMOTE_AUTH',
    'USER_DATA_PATH',
    'APP_PATH',
    'NODE_ENV',
    'SOCKET_AUTH_STRICT',
    'AGNT_SKIP_DB_INIT',
  ]),
];
const saved = {};
let dataDir;
let server;
let baseUrl;
let syncedUsers;
let issuerCalls;

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-docker-defaults-'));
  issuerCalls = [];
  syncedUsers = [];
  vi.resetModules();
});

afterEach(async () => {
  if (server) await new Promise((r) => server.close(r));
  server = null;
  vi.doUnmock('../models/database/index.js');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** The container's environment: Dockerfile ENV, then compose, then what an operator must supply. */
function applyContainerEnvironment({ owner = OWNER.email, members } = {}) {
  Object.assign(process.env, dockerfile, compose.env);
  // The one thing compose insists the operator provide.
  if (owner !== null) process.env.AGNT_TENANT_OWNER = owner;
  if (members !== undefined) process.env.AGNT_TENANT_MEMBERS = members;
  // The container's /app/data, in a temp dir; the secrets it generates land here.
  process.env.USER_DATA_PATH = dataDir;
  process.env.APP_PATH = dataDir;
  process.env.AGNT_SKIP_DB_INIT = '1';
}

/**
 * api.agnt.gg, reduced to the one endpoint the verifier calls. It does what
 * the real issuer does: verifies the signature with ITS key and answers from
 * the claims it signed. Anything signed with any other key — the old compose
 * placeholder, the published desktop key — is 401.
 */
function simulateIssuer() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, options) => {
      const token = String(options?.headers?.Authorization || '').replace(/^Bearer /, '');
      issuerCalls.push(String(url));
      let claims;
      try {
        claims = jwt.verify(token, ISSUER_KEY);
      } catch {
        return { ok: false, status: 401, json: async () => ({ isAuthenticated: false }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ isAuthenticated: true, user: { id: claims.id, email: String(claims.email).toLowerCase() } }),
      };
    })
  );
}

/** Boot the auth path exactly as server.js does: secrets first, then the middleware. */
async function boot() {
  vi.doMock('../models/database/index.js', () => ({
    default: {
      get: (_sql, _params, cb) => cb(null, undefined),
      run: (sql, params, cb) => {
        if (/INSERT INTO users/i.test(sql)) syncedUsers.push(params?.[0]);
        if (typeof cb === 'function') cb(null);
      },
      all: (_sql, _params, cb) => cb(null, []),
    },
  }));
  const bootstrap = await import('./secretsBootstrap.js');
  const ownership = await import('../services/auth/tenantOwnership.js');
  const { authenticateToken } = await import('../routes/Middleware.js');
  const socketIdentity = await import('../utils/socketIdentity.js');

  const app = express();
  app.get('/probe', authenticateToken, (req, res) =>
    res.json({ id: req.user.id, email: req.user.email, auth_type: req.user.auth_type })
  );
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { bootstrap, ownership, socketIdentity };
}

const probe = async (token) => {
  // The real fetch is stubbed to be the issuer; reach our own server through
  // http directly so the two cannot be confused.
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${baseUrl}/probe`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            /* non-JSON */
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
  });
};

// ---------------------------------------------------------------------------

describe('the shipped artefacts say what this test assumes (anti-vacuity)', () => {
  it('compose requires an owner, defaults verify-remote, and sets no secret', () => {
    expect(compose.required.has('AGNT_TENANT_OWNER')).toBe(true);
    expect(compose.env.AGNT_AUTH_MODE).toBe('verify-remote');
    expect(dockerfile.AGNT_AUTH_MODE).toBe('verify-remote');
    expect(dockerfile.BIND_HOST).toBe('0.0.0.0');
    for (const name of ['JWT_SECRET', 'SESSION_SECRET', 'ENCRYPTION_KEY']) {
      expect(name in compose.env, `${name} is set in docker-compose.yml`).toBe(false);
      expect(compose.required.has(name), `${name} is required by docker-compose.yml`).toBe(false);
    }
    expect(compose.env.TRUST_REMOTE_AUTH).toBe('false');
  });

  it('the parser understands every default shape the compose file uses', () => {
    // A parser that silently drops a line makes every test below vacuous.
    expect(compose.env.NODE_ENV).toBe('production');
    expect(compose.env.REMOTE_URL).toBe('https://api.agnt.gg');
    expect(compose.env.AGNT_TENANT_MEMBERS).toBe('');
  });
});

describe('a default container boots with a private secret', () => {
  it('generates JWT_SECRET, persists it under the data dir, and it is not any published value', async () => {
    applyContainerEnvironment();
    simulateIssuer();
    const { bootstrap } = await boot();
    const { SHARED_JWT_SECRET, PLACEHOLDER_SECRETS } = await import('../utils/legacySecrets.js');

    expect(process.env.JWT_SECRET).toBeTruthy();
    expect(process.env.JWT_SECRET).not.toBe(SHARED_JWT_SECRET);
    expect(PLACEHOLDER_SECRETS).not.toContain(process.env.JWT_SECRET);
    expect(process.env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);

    const { secretFilePath } = await import('../utils/secretResolver.js');
    expect(fs.existsSync(secretFilePath('JWT_SECRET'))).toBe(true);
    expect(secretFilePath('JWT_SECRET').startsWith(dataDir)).toBe(true);

    expect(bootstrap.auditSecretDefaults().ok).toBe(true);
  });
});

describe('who gets in', () => {
  it('the owner, named by email in the compose file, is admitted on a genuine token', async () => {
    applyContainerEnvironment();
    simulateIssuer();
    await boot();

    const { status, body } = await probe(issued(OWNER));
    expect(status).toBe(200);
    expect(body.id).toBe(OWNER.id);
    expect(body.auth_type).toBe('issuer-verified');
    expect(issuerCalls.length, 'the issuer was asked').toBe(1);
  });

  it('REFUSES a different genuine account with 403 not_tenant_member, and leaves no user row', async () => {
    // The defect the tenant fix closed on 2026-08-21, one shape over: without
    // this, any of the accounts signup hands out could log into this box.
    applyContainerEnvironment();
    simulateIssuer();
    await boot();

    const { status, body } = await probe(issued(STRANGER));
    expect(status).toBe(403);
    expect(body.reason).toBe('not_tenant_member');
    expect(syncedUsers).toEqual([]);

    // Anti-vacuity: the same path DOES sync when the caller is allowed.
    await probe(issued(OWNER));
    expect(syncedUsers).toEqual([OWNER.id]);
  });

  it('a teammate named by email in AGNT_TENANT_MEMBERS is admitted, case-insensitively', async () => {
    applyContainerEnvironment({ members: ` TEAMMATE@example.test , ` });
    simulateIssuer();
    await boot();

    expect((await probe(issued(TEAMMATE))).status).toBe(200);
    expect((await probe(issued(STRANGER))).status).toBe(403);
  });

  it('AGNT_TENANT_MEMBERS=* admits every genuine account — because the operator wrote it', async () => {
    applyContainerEnvironment({ members: '*' });
    simulateIssuer();
    await boot();

    expect((await probe(issued(STRANGER))).status).toBe(200);
  });

  it('the websocket handshake applies the same boundary', async () => {
    applyContainerEnvironment();
    simulateIssuer();
    const { socketIdentity } = await boot();

    // The socket path reads the verdict the HTTP path cached for the same token.
    await probe(issued(OWNER));
    await probe(issued(STRANGER));
    expect(socketIdentity.resolveSocketIdentity({ token: issued(OWNER) }).ok).toBe(true);
    const refused = socketIdentity.resolveSocketIdentity({ token: issued(STRANGER) });
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('not_tenant_member');

    // And an unverified legacy claim is never a way in on a container.
    expect(socketIdentity.isStrictSocketAuth()).toBe(true);
    expect(socketIdentity.resolveSocketIdentity({ userId: OWNER.id }).ok).toBe(false);
  });
});

describe('what is refused', () => {
  it('a token signed with the old compose placeholder — issue #144 — gets 401', async () => {
    applyContainerEnvironment();
    simulateIssuer();
    await boot();

    const forged = jwt.sign({ userId: OWNER.id }, 'CHANGE_ME_IN_PRODUCTION');
    const { status, body } = await probe(forged);
    expect(status).toBe(401);
    expect(body.reason).toBe('invalid');
  });

  it('a token signed with the published desktop key gets 401', async () => {
    // The container holds a private secret, so local verification fails, and
    // the issuer refuses it: a valid signature without the proof claim is not
    // a session. Simulated here as "not a token I issued".
    applyContainerEnvironment();
    simulateIssuer();
    await boot();
    const { SHARED_JWT_SECRET } = await import('../utils/legacySecrets.js');

    const forged = jwt.sign({ id: OWNER.id, email: OWNER.email }, SHARED_JWT_SECRET);
    expect((await probe(forged)).status).toBe(401);
  });

  it('no token at all gets 401, not 403', async () => {
    applyContainerEnvironment();
    simulateIssuer();
    await boot();
    expect((await probe(null)).status).toBe(401);
  });
});

describe('what refuses to boot', () => {
  it('a container that names nobody', async () => {
    applyContainerEnvironment({ owner: null });
    simulateIssuer();
    const { ownership } = await boot();

    const verdict = ownership.assertTenantBinding();
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/AGNT_TENANT_OWNER/);
    expect(verdict.reason).toMatch(/AGNT_AUTH_MODE=verify-remote/);
    expect(verdict.reason).toMatch(/AGNT_TENANT_MEMBERS=\*/);

    // server.js turns that verdict into an exit before the listener opens.
    const serverSource = fs.readFileSync(path.join(REPO_ROOT, 'backend/server.js'), 'utf8');
    expect(serverSource).toMatch(/assertTenantBinding\(\)/);
    expect(serverSource).toMatch(/process\.exit\(78\)/);
  });

  it.each(['JWT_SECRET', 'SESSION_SECRET', 'ENCRYPTION_KEY'])(
    '%s set to the published placeholder, before anything else runs',
    async (name) => {
      applyContainerEnvironment();
      process.env[name] = 'CHANGE_ME_IN_PRODUCTION';
      const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(import('./secretsBootstrap.js')).rejects.toThrow('process.exit(78)');
      expect(exit).toHaveBeenCalledWith(78);
      expect(error.mock.calls.flat().join('\n')).toMatch(new RegExp(`${name} is set to a published placeholder`));
    }
  );

  it('the audit is pure and names the offender', async () => {
    const { auditSecretDefaults } = await import('./secretsBootstrap.js');
    expect(auditSecretDefaults({ JWT_SECRET: 'a-real-secret-of-reasonable-length' })).toEqual({ ok: true });
    const verdict = auditSecretDefaults({ ENCRYPTION_KEY: 'your-random-encryption-key-here' });
    expect(verdict.ok).toBe(false);
    expect(verdict.name).toBe('ENCRYPTION_KEY');
  });
});

describe('an operator who brings their own JWT_SECRET', () => {
  it('still logs in — the README docker run recipe works in verify-remote', async () => {
    // Before this change a random JWT_SECRET (as the README told people to
    // generate) rejected every genuine token, because local verification
    // needs the issuer's key. Under verify-remote the issuer is asked and the
    // local secret is simply private.
    applyContainerEnvironment();
    process.env.JWT_SECRET = 'operator-supplied-random-value-Kf93kdj39dk3j';
    simulateIssuer();
    await boot();

    expect(process.env.JWT_SECRET).toBe('operator-supplied-random-value-Kf93kdj39dk3j');
    expect((await probe(issued(OWNER))).status).toBe(200);
  });
});

describe('the desktop install is untouched', () => {
  it('with no AGNT_AUTH_MODE the blank is filled with the shared secret and every account is admitted', async () => {
    // THE PROPERTY MOST WORTH PROTECTING. No container variable is set, no
    // owner, no mode. This is every desktop and `npm start` install.
    process.env.USER_DATA_PATH = dataDir;
    process.env.AGNT_SKIP_DB_INIT = '1';
    simulateIssuer();
    const { ownership } = await boot();
    const { SHARED_JWT_SECRET } = await import('../utils/legacySecrets.js');

    expect(process.env.JWT_SECRET).toBe(SHARED_JWT_SECRET);
    expect(ownership.isRestrictedInstance()).toBe(false);
    expect(ownership.assertTenantBinding().ok).toBe(true);

    const desktopToken = jwt.sign({ id: STRANGER.id, email: STRANGER.email }, SHARED_JWT_SECRET);
    const { status, body } = await probe(desktopToken);
    expect(status).toBe(200);
    expect(body.auth_type).toBe('local');
    expect(issuerCalls, 'a desktop install never asks the issuer').toEqual([]);

    // And the compose placeholder does not verify here either.
    expect((await probe(jwt.sign({ userId: OWNER.id }, 'CHANGE_ME_IN_PRODUCTION'))).status).toBe(401);
  });

  it('an owner set without verify-remote does not restrict a desktop install', async () => {
    // Ambiguous config on a desktop must resolve to today's behaviour.
    process.env.USER_DATA_PATH = dataDir;
    process.env.AGNT_SKIP_DB_INIT = '1';
    process.env.AGNT_TENANT_OWNER = OWNER.email;
    const { ownership } = await boot();
    expect(ownership.isRestrictedInstance()).toBe(false);
    expect(ownership.isPermittedUser(STRANGER.id, null, STRANGER.email)).toBe(true);
  });
});
