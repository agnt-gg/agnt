/**
 * A GENUINE ACCOUNT IS NOT AUTOMATICALLY WELCOME ON THIS INSTANCE.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS, IN THE EXACT SHAPE IT DOES
 * ---------------------------------------------------------------------------
 * When the edge gate came off, the tenant was checked against two threat
 * models and passed both: an anonymous caller got 401, and a token forged with
 * the published signing key got 401. Neither was the threat. The question that
 * was never asked is the one below — does being a REAL, VALID, DIFFERENT user
 * get you in — and the answer, measured against a live instance, was yes on
 * five routes out of five.
 *
 * So every assertion here uses a token that is genuine in every respect and
 * simply belongs to somebody else. A test that only exercises invalid
 * credentials would have been green throughout the entire exposure.
 *
 * The other half is the 600+ desktop installs. They have no tenant, and if
 * this check ever refuses them the blast radius is far larger than the defect
 * it fixes. That case is asserted first, deliberately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';

const SECRET = 'test-secret-for-tenant-ownership';
const OWNER = 'owner-account-0123456789abcdef';
const TEAMMATE = 'teammate-account-abcdef01234567';
const STRANGER = 'stranger-account-fedcba98765432';

let tenantOwnership;
let authGuard;
let socketIdentity;

const saved = {};
const ENV_KEYS = [
  'JWT_SECRET',
  'TRUST_REMOTE_AUTH',
  'AGNT_TENANT_SLUG',
  'AGNT_TENANT_OWNER',
  'AGNT_TENANT_MEMBERS',
  'SOCKET_AUTH_STRICT',
  'NODE_ENV',
];

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.JWT_SECRET = SECRET;
  process.env.TRUST_REMOTE_AUTH = 'false';

  vi.resetModules();
  tenantOwnership = await import('./tenantOwnership.js');
  authGuard = await import('../../utils/authGuard.js');
  socketIdentity = await import('../../utils/socketIdentity.js');
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

/** Make this process look like a hosted tenant owned by OWNER. */
const bindTenant = (members = '') => {
  process.env.AGNT_TENANT_SLUG = 'acme';
  process.env.AGNT_TENANT_OWNER = OWNER;
  if (members) process.env.AGNT_TENANT_MEMBERS = members;
};

/** A token that is genuine in every respect. The subject is the only variable. */
const genuine = (id) => jwt.sign({ id, email: `${id}@example.test` }, SECRET);

// ---------------------------------------------------------------------------

describe('a desktop install is never restricted', () => {
  it('admits any user when there is no tenant slug', () => {
    // THE PROPERTY MOST WORTH PROTECTING. Every install in the field lacks a
    // slug, because only tenant.sh sets one. If this ever returns false, the
    // fix has locked out several hundred people who were never exposed.
    expect(tenantOwnership.isTenantInstance()).toBe(false);
    expect(tenantOwnership.isPermittedUser(OWNER)).toBe(true);
    expect(tenantOwnership.isPermittedUser(STRANGER)).toBe(true);
    expect(tenantOwnership.isPermittedUser('anyone-at-all')).toBe(true);
  });

  it('stays unrestricted even if an owner is set without a slug', () => {
    // Ambiguous config on a desktop install must resolve to today's behaviour.
    process.env.AGNT_TENANT_OWNER = OWNER;
    expect(tenantOwnership.isPermittedUser(STRANGER)).toBe(true);
  });
});

describe('a bound tenant admits its members and nobody else', () => {
  it('admits the owner', () => {
    bindTenant();
    expect(tenantOwnership.isPermittedUser(OWNER)).toBe(true);
  });

  it('REFUSES a different genuine account', () => {
    // The defect, stated as directly as it can be.
    bindTenant();
    expect(tenantOwnership.isPermittedUser(STRANGER)).toBe(false);
  });

  it('admits a listed teammate — seats, from the first line', () => {
    bindTenant(TEAMMATE);
    expect(tenantOwnership.isPermittedUser(TEAMMATE)).toBe(true);
    expect(tenantOwnership.isPermittedUser(STRANGER)).toBe(false);
  });

  it('keeps the owner even when the member list omits them', () => {
    // An operator editing only AGNT_TENANT_MEMBERS must not be able to lock
    // the paying customer out of their own instance.
    bindTenant(TEAMMATE);
    expect(tenantOwnership.tenantMemberIds()).toContain(OWNER);
    expect(tenantOwnership.isPermittedUser(OWNER)).toBe(true);
  });

  it('ignores blanks and duplicates in the list', () => {
    // A trailing comma is a typo, not a member with an empty id.
    bindTenant(`, ${TEAMMATE} ,,${OWNER},`);
    expect(tenantOwnership.tenantMemberIds().sort()).toEqual([OWNER, TEAMMATE].sort());
    expect(tenantOwnership.isPermittedUser('')).toBe(false);
    expect(tenantOwnership.isPermittedUser(null)).toBe(false);
    expect(tenantOwnership.isPermittedUser(undefined)).toBe(false);
  });
});

describe('a tenant that names nobody refuses to start', () => {
  it('fails the boot assertion when a slug is set with no members', () => {
    // The alternative readings are both silent failures: "allow all" reopens
    // the hole on a tenant.sh bug, "allow none" locks out a paying customer
    // with no explanation. Exiting is neither.
    process.env.AGNT_TENANT_SLUG = 'acme';
    const verdict = tenantOwnership.assertTenantBinding();
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/admit every AGNT account/);
    expect(verdict.reason).toMatch(/--owner/);
  });

  it('passes once an owner is named', () => {
    bindTenant();
    expect(tenantOwnership.assertTenantBinding().ok).toBe(true);
  });

  it('passes on a desktop install, which has nothing to bind', () => {
    expect(tenantOwnership.assertTenantBinding().ok).toBe(true);
  });
});

describe('the synchronous guard — media, files, SSE, pairing', () => {
  it('admits the owner', () => {
    bindTenant();
    const result = authGuard.verifyAuthToken(genuine(OWNER));
    expect(result.ok).toBe(true);
    expect(result.user.id).toBe(OWNER);
  });

  it('refuses a different genuine account with not_tenant_member', () => {
    // This path guards media, file, image and SSE routes. Closing REST and
    // leaving this open would be one boundary with a hole in it.
    bindTenant();
    const result = authGuard.verifyAuthToken(genuine(STRANGER));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(tenantOwnership.NOT_A_MEMBER);
  });

  it('still refuses a forged token as an AUTH failure, not a membership one', () => {
    // The two refusals must stay distinguishable: one means "get a new
    // credential", the other means "that credential will never work here".
    bindTenant();
    const forged = jwt.sign({ id: OWNER }, 'not-the-real-secret');
    expect(authGuard.verifyAuthToken(forged)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('is inert on a desktop install', () => {
    expect(authGuard.verifyAuthToken(genuine(STRANGER)).ok).toBe(true);
  });
});

describe('the websocket handshake', () => {
  it('refuses a different genuine account', () => {
    // Every realtime fan-out targets user:<id> rooms. A socket that opens is a
    // live read of whatever that room receives.
    bindTenant();
    const result = socketIdentity.resolveSocketIdentity({ token: genuine(STRANGER) });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(tenantOwnership.NOT_A_MEMBER);
  });

  it('admits the owner', () => {
    bindTenant();
    const result = socketIdentity.resolveSocketIdentity({ token: genuine(OWNER) });
    expect(result.ok).toBe(true);
    expect(result.userId).toBe(OWNER);
  });

  it('refuses an unverified legacy claim from a non-member', () => {
    // Unreachable on a real tenant, which is always strict — asserted rather
    // than argued, so loosening that inference cannot silently open a door.
    bindTenant();
    process.env.SOCKET_AUTH_STRICT = 'false';
    const result = socketIdentity.resolveSocketIdentity({ userId: STRANGER });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(tenantOwnership.NOT_A_MEMBER);
  });
});

describe('over the wire, through the real REST middleware', () => {
  let server;
  let baseUrl;
  let syncedUsers;

  const start = async () => {
    vi.resetModules();
    syncedUsers = [];

    // The local users table is the thing a refused caller must not touch: a
    // stranger who leaves a row behind has changed the owner's install.
    vi.doMock('../../models/database/index.js', () => ({
      default: {
        get: (_sql, _params, cb) => cb(null, undefined),
        run: (sql, params, cb) => {
          if (/INSERT INTO users/i.test(sql)) syncedUsers.push(params?.[0]);
          if (typeof cb === 'function') cb(null);
        },
        all: (_sql, _params, cb) => cb(null, []),
      },
    }));

    const { authenticateToken } = await import('../../routes/Middleware.js');
    const app = express();
    app.get('/probe', authenticateToken, (req, res) => res.json({ id: req.user.id }));
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  };

  const get = async (token) => {
    const res = await fetch(`${baseUrl}/probe`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  afterEach(async () => {
    if (server) await new Promise((r) => server.close(r));
    server = null;
    vi.doUnmock('../../models/database/index.js');
  });

  it('admits the owner', async () => {
    bindTenant();
    await start();
    const { status, body } = await get(genuine(OWNER));
    expect(status).toBe(200);
    expect(body.id).toBe(OWNER);
  });

  it('REFUSES a different genuine account with 403', async () => {
    bindTenant();
    await start();
    const { status, body } = await get(genuine(STRANGER));
    expect(status).toBe(403);
    expect(body.reason).toBe('not_tenant_member');
  });

  it('creates no local user row for a refused caller', async () => {
    // My probe against the live instance left a row in the owner's database.
    // The check has to run BEFORE syncRemoteUserToLocal, not after.
    //
    // TRUST_REMOTE_AUTH is on deliberately: that is one of the two branches
    // that actually syncs. The plain local-verify branch never calls it, so
    // asserting there would have been vacuous — green against the broken code
    // and green against the fix, proving nothing.
    process.env.TRUST_REMOTE_AUTH = 'true';
    bindTenant();
    await start();

    const refused = await get(genuine(STRANGER));
    expect(refused.status).toBe(403);
    expect(syncedUsers, 'a refused stranger must leave nothing behind').toEqual([]);

    // Anti-vacuity for the assertion above: the same path DOES sync when the
    // caller is allowed, so an empty array is a decision and not an inert mock.
    const admitted = await get(genuine(OWNER));
    expect(admitted.status).toBe(200);
    expect(syncedUsers).toEqual([OWNER]);
  });

  it('answers 401, not 403, when there is no token at all', async () => {
    // Authentication is unchanged. Only the second question is new.
    bindTenant();
    await start();
    expect((await get(null)).status).toBe(401);
  });

  it('answers 401 for a forged token', async () => {
    bindTenant();
    await start();
    const forged = jwt.sign({ id: STRANGER }, 'not-the-real-secret');
    expect((await get(forged)).status).toBe(401);
  });

  it('admits anyone on a desktop install', async () => {
    await start();
    const { status, body } = await get(genuine(STRANGER));
    expect(status).toBe(200);
    expect(body.id).toBe(STRANGER);
  });
});
