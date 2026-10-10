import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Only the HTTP boundary is mocked: the real cloud adapter in searchRouter.js builds the request,
// so this pins the wire contract with search.agnt.gg rather than an injected stand-in.
vi.mock('../agntServices.js', async (importOriginal) => ({
  ...(await importOriginal()),
  callService: vi.fn(async () => ({ results: [], usage: { operation: 'search' } })),
  serviceAllowed: vi.fn(async () => true),
}));

const { callService } = await import('../agntServices.js');
const { searchWeb } = await import('./searchRouter.js');
const { createSearchBudget } = await import('./searchBudget.js');

describe('searchWeb cloud request', () => {
  beforeEach(() => {
    process.env.AGNT_LOCAL_SEARCH = '0';
    callService.mockClear();
  });
  afterEach(() => delete process.env.AGNT_LOCAL_SEARCH);

  // search.agnt.gg (SearchPolicy.normalizeOperation) reads `num` / `numResults` and ignores
  // anything else; a different field name silently returned 5 results whatever was asked.
  it.each([[1], [7], [10]])('asks search.agnt.gg for exactly %i results under the field it reads', async (count) => {
    await searchWeb({ query: ' q ', count }, { budget: createSearchBudget() });
    expect(callService).toHaveBeenCalledTimes(1);
    const [service, path, options] = callService.mock.calls[0];
    expect([service, path, options.method]).toEqual(['search', '/search', 'POST']);
    expect(options.body).toEqual({ query: 'q', num: count });
  });
});
