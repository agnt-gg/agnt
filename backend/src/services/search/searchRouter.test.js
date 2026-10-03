import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchWeb, localSearchUnavailableReason } from './searchRouter.js';
import { createSearchBudget } from './searchBudget.js';
import { ServiceError, serviceFailure } from '../agntServices.js';

const RESULT = { title: 'T', link: 'https://example.com/', snippet: 'S', source: 'example.com' };
const CLOUD_USAGE = { operation: 'search', chargedMicroUSD: 0, includedUnits: 1 };

function engines(overrides = {}) {
  return {
    allowed: vi.fn(async () => true),
    unavailableReason: vi.fn(() => null),
    local: vi.fn(async () => ({ status: 'ok', results: [RESULT] })),
    resetLocal: vi.fn(async () => {}),
    cloud: vi.fn(async () => ({ results: [{ ...RESULT, link: 'https://cloud.example/' }], usage: CLOUD_USAGE })),
    ...overrides,
  };
}

const run = (input, e, budget = createSearchBudget()) => searchWeb(input, { engines: e, budget });

afterEach(() => vi.restoreAllMocks());

describe('searchWeb', () => {
  it('searches locally first, and says so', async () => {
    const e = engines();
    expect(await run({ query: ' best pizza ', count: 3 }, e)).toEqual({ success: true, query: 'best pizza', results: [RESULT], resultsCount: 1, engine: 'local' });
    expect(e.local).toHaveBeenCalledWith({ query: 'best pizza', count: 3 });
    expect(e.cloud).not.toHaveBeenCalled();
  });

  it('answers a repeated query from the cache without searching again', async () => {
    const e = engines();
    const budget = createSearchBudget();
    await run({ query: 'q' }, e, budget);
    expect(await run({ query: 'Q' }, e, budget)).toMatchObject({ engine: 'cache', results: [RESULT] });
    expect(e.local).toHaveBeenCalledTimes(1);
  });

  it.each([['disabled'], ['hosted_instance'], ['container'], ['no_chrome']])('uses the cloud when local search is unavailable (%s)', async (reason) => {
    const e = engines({ unavailableReason: () => reason });
    expect(await run({ query: 'q' }, e)).toMatchObject({ engine: 'cloud', usage: CLOUD_USAGE });
    expect(e.local).not.toHaveBeenCalled();
  });

  it('falls back to the cloud when local search fails, without surfacing the failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const failure of [{ status: 'error', error: 'no_results_parsed' }, { status: 'unavailable', error: 'browser_not_found' }]) {
      const e = engines({ local: vi.fn(async () => failure) });
      expect(await run({ query: 'q' }, e)).toMatchObject({ success: true, engine: 'cloud' });
      expect(e.resetLocal).not.toHaveBeenCalled();
    }
    const throwing = engines({ local: vi.fn(async () => { throw new Error('chrome crashed'); }) });
    expect(await run({ query: 'q' }, throwing)).toMatchObject({ engine: 'cloud' });
  });

  it('on a refusal from Google: pauses local search, wipes the profile, and uses the cloud', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = engines({ local: vi.fn(async () => ({ status: 'blocked' })) });
    const budget = createSearchBudget();
    expect(await run({ query: 'first' }, e, budget)).toMatchObject({ engine: 'cloud' });
    expect(e.resetLocal).toHaveBeenCalledTimes(1);
    await run({ query: 'second' }, e, budget);
    expect(e.local).toHaveBeenCalledTimes(1);
    expect(e.cloud).toHaveBeenCalledTimes(2);
  });

  it('sends a burst past the local budget to the cloud instead of queueing it', async () => {
    const e = engines();
    const budget = createSearchBudget();
    const answers = await Promise.all(Array.from({ length: 8 }, (_, i) => run({ query: 'q' + i }, e, budget)));
    expect(answers.filter((a) => a.engine === 'local')).toHaveLength(5);
    expect(answers.filter((a) => a.engine === 'cloud')).toHaveLength(3);
  });

  it('keeps the plan gate: local search does not open web search to a plan without it', async () => {
    const e = engines({ allowed: async () => false });
    const error = await run({ query: 'q' }, e).catch((caught) => caught);
    expect(serviceFailure(error)).toMatchObject({ success: false, code: 'pro_required', service: 'search' });
    expect(e.local).not.toHaveBeenCalled();
    expect(e.cloud).not.toHaveBeenCalled();
  });

  it("passes the cloud's own errors through unchanged", async () => {
    const e = engines({ unavailableReason: () => 'no_chrome', cloud: async () => { throw new ServiceError('search', 402, 'allowance_exhausted', {}); } });
    await expect(run({ query: 'q' }, e)).rejects.toMatchObject({ code: 'allowance_exhausted' });
  });

  it('clamps the result count to 1..10 and refuses an empty query', async () => {
    const e = engines();
    await run({ query: 'a', count: 50 }, e);
    await run({ query: 'b', count: 0 }, e);
    await run({ query: 'c', count: 'seven' }, e);
    expect(e.local.mock.calls.map(([input]) => input.count)).toEqual([10, 5, 5]);
    await expect(run({ query: '   ' }, e)).rejects.toThrow('Search query is required.');
  });
});

describe('localSearchUnavailableReason', () => {
  afterEach(() => {
    delete process.env.AGNT_LOCAL_SEARCH;
    delete process.env.AGNT_TENANT_SLUG;
  });

  it('is off when switched off, and on a hosted instance', () => {
    process.env.AGNT_LOCAL_SEARCH = '0';
    expect(localSearchUnavailableReason()).toBe('disabled');
    delete process.env.AGNT_LOCAL_SEARCH;
    process.env.AGNT_TENANT_SLUG = 'acme';
    expect(localSearchUnavailableReason()).toBe('hosted_instance');
  });
});
