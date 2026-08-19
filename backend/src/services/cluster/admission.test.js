/**
 * The spend gate.
 *
 * The assertion that earns its keep is the asymmetry: planEntitlements fails
 * OPEN and this fails CLOSED, and both are correct. An entitlement check that
 * cannot reach the server risks giving away a feature; a spend check that
 * cannot read the ledger risks a node with live provider credentials and no
 * ceiling. Copying the fail-open pattern here by reflex is the bug this file
 * exists to prevent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const summary = vi.fn();
vi.mock('../../models/LlmCallModel.js', () => ({ default: { summary: (...a) => summary(...a) } }));

const { checkSpendAdmission, __resetAdmissionForTests } = await import('./admission.js');

const HARD = 'AGNT_SPEND_LIMIT_USD';
const SOFT = 'AGNT_SPEND_SOFT_LIMIT_USD';
const USER = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[HARD];
  delete process.env[SOFT];
  __resetAdmissionForTests();
});

afterEach(() => {
  delete process.env[HARD];
  delete process.env[SOFT];
  vi.restoreAllMocks();
});

describe('no policy configured', () => {
  it('admits without touching the ledger at all', async () => {
    const result = await checkSpendAdmission(USER);

    expect(result.admit).toBe(true);
    expect(result.reason).toBe('no_limit_configured');
    // This is the path every install that never asked for a budget takes, on
    // every group of every goal. It must cost nothing — no query, no latency,
    // and no new way for a single-node install to stop working.
    expect(summary).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'abc', '-5'])('treats the unusable limit %j as no policy', async (value) => {
    process.env[HARD] = value;
    const result = await checkSpendAdmission(USER);
    expect(result.admit).toBe(true);
    expect(result.reason).toBe('no_limit_configured');
  });
});

describe('a configured hard ceiling', () => {
  it('admits below the limit', async () => {
    process.env[HARD] = '10';
    summary.mockResolvedValue({ costUsd: 4.25 });

    const result = await checkSpendAdmission(USER);
    expect(result).toMatchObject({ admit: true, reason: 'within_budget', spentUsd: 4.25 });
  });

  it('refuses at and above the limit', async () => {
    process.env[HARD] = '10';
    summary.mockResolvedValue({ costUsd: 10 });

    const result = await checkSpendAdmission(USER);
    expect(result).toMatchObject({ admit: false, reason: 'hard_limit_reached', hardLimitUsd: 10 });
  });

  it('counts charged money only, never notional subscription spend', async () => {
    process.env[HARD] = '10';
    // A Claude Code / Codex user's calls are notional: already paid for by a
    // subscription. Counting them against a dollar ceiling would stop a user
    // whose per-call cost is genuinely zero.
    summary.mockResolvedValue({ costUsd: 0, notionalUsd: 999 });

    expect((await checkSpendAdmission(USER)).admit).toBe(true);
  });

  it('measures the current local day, matching the dashboard window', async () => {
    process.env[HARD] = '10';
    summary.mockResolvedValue({ costUsd: 1 });

    await checkSpendAdmission(USER);

    const [, window] = summary.mock.calls[0];
    // A rolling 24h budget against a calendar-day chart would disagree with
    // the page the operator is looking at, and they would reasonably conclude
    // one of the two was broken.
    expect(window.since).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2} 00:00:00$|^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/);
  });
});

describe('IT FAILS CLOSED', () => {
  it('refuses new work when a configured limit cannot be evaluated', async () => {
    process.env[HARD] = '10';
    summary.mockRejectedValue(new Error('database is locked'));

    const result = await checkSpendAdmission(USER);

    // The mirror of planEntitlements' fail-open reasoning does NOT hold here.
    // An unreadable entitlement costs a rounding error; an unmetered node
    // holding provider keys is unbounded and denominated in real money.
    expect(result.admit).toBe(false);
    expect(result.reason).toBe('budget_unreadable');
  });

  it('still admits when the ledger is unreadable and NO limit is set', async () => {
    summary.mockRejectedValue(new Error('database is locked'));
    // No policy means nothing to enforce. A broken ledger must not invent one.
    expect((await checkSpendAdmission(USER)).admit).toBe(true);
  });
});

describe('the soft ceiling warns and does not stop', () => {
  it('logs once per window, not once per claim', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[SOFT] = '5';
    summary.mockResolvedValue({ costUsd: 7 });

    for (let i = 0; i < 10; i++) {
      const result = await checkSpendAdmission(USER);
      expect(result.admit, 'a soft limit must never stop work').toBe(true);
    }

    // checkSpendAdmission runs on every task group. An unlatched warning is a
    // log flood that buries the message it is trying to deliver.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('soft limit');
  });

  it('a soft limit alone never refuses, however far it is exceeded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env[SOFT] = '1';
    summary.mockResolvedValue({ costUsd: 1000 });

    expect((await checkSpendAdmission(USER)).admit).toBe(true);
  });
});
