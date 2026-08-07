/**
 * TENANT SCOPING AND CREDENTIAL CONTAINMENT
 *
 * Three properties, and the mechanisms that make them easy to lose. Per-site
 * patches would leave every mechanism intact, so each block below asserts the
 * mechanism, not just one instance of it.
 *
 *   1. WEBHOOK AUTH FAILS CLOSED.  Credentials are not restored from the
 *      database, so a webhook can declare an authType while holding no secret.
 *      Comparing against an absent secret is not a check — interpolation turns
 *      it into a fixed literal. Establish presence first, then compare in
 *      constant time.
 *
 *   2. TENANT SCOPING IS CARRIED BY THE SIGNATURE.  Scoping used to be applied
 *      ad-hoc inside individual model methods, so route safety depended on
 *      which method it happened to call — `AgentMemoryModel.delete` was scoped
 *      and `update`, two methods away, was not.
 *
 *   3. CREDENTIALS STAY OUT OF THE TRANSCRIPT.  A tool result is sent to the
 *      model provider, persisted in the conversations table, and rendered on
 *      screen, so no tool may return a stored credential value.
 *
 * The model-layer assertions deliberately test that the unsafe call is
 * IMPOSSIBLE (it rejects), not merely that the current callers get it right.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// Set BEFORE any dynamic import below. tools.js constructs the trigger
// receivers at module scope and EmailReceiver starts a 10s poll loop in its
// constructor; a unit test must not start live infrastructure. Setting this at
// module scope (rather than around each import) means the very first load
// already sees it, so no vi.resetModules() dance is needed — that dance was
// re-importing a ~235KB module three times and intermittently blowing the 5s
// default test timeout under parallel load, which showed up as a suite that
// passed alone and failed in the full run.
process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';

// ---------------------------------------------------------------------------
// A database double that records the SQL it is handed, so the assertions can be
// about the STATEMENT rather than about a row count that a fixture could fake.
// ---------------------------------------------------------------------------
const statements = [];

vi.mock('../models/database/index.js', () => {
  const record = (sql, params, cb) => {
    statements.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
    if (typeof params === 'function') return params.call({ changes: 1 }, null, undefined);
    if (typeof cb === 'function') return cb.call({ changes: 1 }, null, undefined);
    return undefined;
  };
  return {
    default: { run: record, get: record, all: record, each: record, exec: record },
  };
});

beforeEach(() => {
  statements.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Webhook authentication
// ---------------------------------------------------------------------------
describe('webhook authentication fails closed when the credential did not survive a restart', () => {
  /** Build a receiver without touching the network, the DB or a timer. */
  async function makeReceiver() {
    const previous = process.env.AGNT_DISABLE_EXTERNAL_POLLING;
    process.env.AGNT_DISABLE_EXTERNAL_POLLING = 'true';
    const { default: LocalWebhookReceiver } = await import('../tools/triggers/WebhookReceiver.js');
    const receiver = new LocalWebhookReceiver({ activeWorkflows: new Map() });
    if (previous === undefined) delete process.env.AGNT_DISABLE_EXTERNAL_POLLING;
    else process.env.AGNT_DISABLE_EXTERNAL_POLLING = previous;

    // Success path would reach the workflow engine; we only care about the gate.
    receiver._triggerWorkflow = vi.fn().mockResolvedValue({ status: 200, message: 'ran' });
    return receiver;
  }

  const headers = (h) => ({ method: 'POST', headers: h });

  it('rejects a coerced placeholder credential after a restart drops the token', async () => {
    const receiver = await makeReceiver();
    // Exactly what loadWebhooksFromDatabase() puts back: metadata, no secret.
    receiver.webhooks.set('wf-1', { method: null, authType: 'Bearer', workflowId: 'wf-1' });

    const result = await receiver._processWebhookTrigger('wf-1', headers({ authorization: 'Bearer undefined' }));

    expect(result).toEqual({ status: 401, message: 'Unauthorized' });
    expect(receiver._triggerWorkflow, 'the workflow ran for an unauthenticated caller').not.toHaveBeenCalled();
  });

  it('rejects the same placeholder on the x-webhook-token carrier too', async () => {
    const receiver = await makeReceiver();
    receiver.webhooks.set('wf-1', { authType: 'webhook', workflowId: 'wf-1' });

    const result = await receiver._processWebhookTrigger('wf-1', headers({ 'x-webhook-token': 'Bearer undefined' }));

    expect(result.status).toBe(401);
    expect(receiver._triggerWorkflow).not.toHaveBeenCalled();
  });

  it('rejects basic auth built from the same coercion', async () => {
    const receiver = await makeReceiver();
    receiver.webhooks.set('wf-1', { authType: 'Basic', workflowId: 'wf-1' });

    const creds = Buffer.from('undefined:undefined').toString('base64');
    const result = await receiver._processWebhookTrigger('wf-1', headers({ authorization: `Basic ${creds}` }));

    expect(result.status).toBe(401);
    expect(receiver._triggerWorkflow).not.toHaveBeenCalled();
  });

  it('STILL ACCEPTS a genuine token — the fix must not be "reject everything"', async () => {
    const receiver = await makeReceiver();
    receiver.webhooks.set('wf-1', { authType: 'Bearer', authToken: 's3cret-real-token', workflowId: 'wf-1' });

    const result = await receiver._processWebhookTrigger('wf-1', headers({ authorization: 'Bearer s3cret-real-token' }));

    expect(receiver._triggerWorkflow, 'a legitimate webhook call was refused').toHaveBeenCalled();
    expect(result.status).not.toBe(401);
  });

  it('still rejects a wrong token when the real one IS present', async () => {
    const receiver = await makeReceiver();
    receiver.webhooks.set('wf-1', { authType: 'Bearer', authToken: 's3cret-real-token', workflowId: 'wf-1' });

    const result = await receiver._processWebhookTrigger('wf-1', headers({ authorization: 'Bearer wrong' }));

    expect(result.status).toBe(401);
    expect(receiver._triggerWorkflow).not.toHaveBeenCalled();
  });

  it('compares webhook secrets in constant time, not with !==', async () => {
    // Source-level on purpose. Timing-safety is not observable from a unit
    // test: with the absence check in place, reverting this line to
    // `providedToken !== \`Bearer ${webhook.authToken}\`` changes NO reachable
    // behaviour, so every behavioural assertion above still passes. (Confirmed
    // by negative control NC2, which went green until this test existed.)
    //
    // The requirement is real even though it is invisible: `!==` on a secret
    // short-circuits at the first differing byte and leaks a prefix through
    // response timing. It is also the interpolation shape this suite exists to
    // keep out, so it should not quietly return.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = await fs.readFile(
      path.join(here, '..', 'tools', 'triggers', 'WebhookReceiver.js'),
      'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code, 'the constant-time comparison helper is gone').toMatch(/function safeEqual\(/);
    expect(code, 'the bearer check no longer uses safeEqual').toMatch(
      /!safeEqual\(providedToken, `Bearer \$\{webhook\.authToken\}`\)/
    );
    // Anti-vacuity: the direct-comparison shape must be absent, and the regex
    // that looks for it must be able to match it.
    const reintroduced = 'if (!providedToken || providedToken !== `Bearer ${webhook.authToken}`) {';
    const DIRECT = /providedToken\s*!==\s*`Bearer/;
    expect(DIRECT.test(reintroduced), 'the offender pattern cannot match its own defect').toBe(true);
    expect(DIRECT.test(code), 'the direct !== comparison is back').toBe(false);
  });

  it('leaves authType "none" webhooks open, as configured', async () => {
    const receiver = await makeReceiver();
    receiver.webhooks.set('wf-1', { authType: 'none', workflowId: 'wf-1' });

    await receiver._processWebhookTrigger('wf-1', headers({}));

    expect(receiver._triggerWorkflow, 'an unauthenticated webhook stopped working').toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Model-layer tenant scoping
// ---------------------------------------------------------------------------
describe('destructive model operations cannot be called without a tenant', () => {
  it('WebhookModel.deleteByWorkflowId REJECTS with no userId', async () => {
    const { default: WebhookModel } = await import('../models/WebhookModel.js');

    await expect(WebhookModel.deleteByWorkflowId('wf-1')).rejects.toThrow(/userId/i);
    expect(statements, 'a statement was issued despite the missing tenant').toEqual([]);
  });

  it('WebhookModel.deleteByWorkflowId scopes the DELETE by user_id', async () => {
    const { default: WebhookModel } = await import('../models/WebhookModel.js');

    await WebhookModel.deleteByWorkflowId('wf-1', 'user-a');

    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toMatch(/DELETE FROM webhooks WHERE workflow_id = \? AND user_id = \?/i);
    expect(statements[0].params).toEqual(['wf-1', 'user-a']);
  });

  it('AgentMemoryModel.update REJECTS with no userId', async () => {
    const { default: AgentMemoryModel } = await import('../models/AgentMemoryModel.js');

    await expect(AgentMemoryModel.update('mem-1', undefined, { content: 'x' })).rejects.toThrow(/userId/i);
    expect(statements).toEqual([]);
  });

  it('AgentMemoryModel.update scopes the UPDATE by user_id', async () => {
    const { default: AgentMemoryModel } = await import('../models/AgentMemoryModel.js');

    await AgentMemoryModel.update('mem-1', 'user-a', { content: 'new content' });

    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toMatch(/UPDATE agent_memory SET .* WHERE id = \? AND user_id = \?/i);
    // id then userId, in that order, as the last two bindings.
    expect(statements[0].params.slice(-2)).toEqual(['mem-1', 'user-a']);
  });

  it('WebhookModel.findByWorkflowId scopes the SELECT when given a userId', async () => {
    const { default: WebhookModel } = await import('../models/WebhookModel.js');

    await WebhookModel.findByWorkflowId('wf-1', 'user-a');

    expect(statements[0].sql).toMatch(/w\.workflow_id = \? AND w\.user_id = \?/i);
    expect(statements[0].params).toEqual(['wf-1', 'user-a']);
  });

  it('anti-vacuity: the recorder actually sees statements', async () => {
    // If the db mock silently stopped being applied, every assertion above
    // would pass vacuously against an empty `statements` array.
    const { default: WebhookModel } = await import('../models/WebhookModel.js');
    await WebhookModel.findByWorkflowId('wf-1', 'user-a');
    expect(statements.length).toBeGreaterThan(0);
    expect(statements[0].sql.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// 3. Credentials must not be reachable from the model-facing tool surface
// ---------------------------------------------------------------------------
describe('the agnt_auth tool exposes no operation that returns a credential', () => {
  /** Loaded once. tools.js is ~235KB and takes seconds to transform. */
  let operations;

  beforeAll(async () => {
    const { TOOLS } = await import('../services/orchestrator/tools.js');
    operations = TOOLS.agnt_auth.schema.function.parameters.properties.operation.enum;
  }, 60_000);

  it('has no get_valid_token / retrieve_api_key in its operation enum', () => {
    expect(operations, 'get_valid_token is reachable by the model again').not.toContain('get_valid_token');
    expect(operations, 'retrieve_api_key is reachable by the model again').not.toContain('retrieve_api_key');
  });

  it('still offers the operations that do not disclose a value', () => {
    // Anti-vacuity: an empty or missing enum would satisfy the test above.
    expect(operations).toContain('list_providers');
    expect(operations).toContain('get_connected_apps');
    expect(operations).toContain('check_provider_token');
  });

  it('never assigns a credential-returning call straight to the tool result', async () => {
    // Source-level, and deliberately so. The enum controls what the MODEL can
    // ask for; this controls what the HANDLER can put on the wire. Both have to
    // hold: re-adding the enum entry alone is harmless, but re-adding
    // `result = await agnt.auth.getValidToken(...)` puts the value back into
    // `JSON.stringify({ success, operation, result })` and therefore into the
    // provider request, the conversations table and the UI.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = await fs.readFile(path.join(here, '..', 'services', 'orchestrator', 'tools.js'), 'utf8');

    // Strip block comments — the fix documents the removed lines on purpose.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '');

    const offenders = code
      .split('\n')
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => /\bresult\s*=\s*await\s+agnt\.auth\.(getValidToken|retrieveApiKey)\s*\(/.test(line));

    expect(
      offenders,
      'a credential value is assigned to the tool result again:\n' +
        offenders.map((o) => `  line ${o.number}: ${o.line}`).join('\n')
    ).toEqual([]);
  });

  it('anti-vacuity: that scan matches the shape it is meant to catch', () => {
    // If the pattern silently stopped matching, the test above would pass
    // forever while the leak walked back in.
    const reintroduced = 'result = await agnt.auth.getValidToken(provider_id);';
    expect(/\bresult\s*=\s*await\s+agnt\.auth\.(getValidToken|retrieveApiKey)\s*\(/.test(reintroduced)).toBe(true);
  });
});
