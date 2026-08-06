import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useHarnessImport } from './useHarnessImport.js';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

const ok = (body) => ({ ok: true, json: () => Promise.resolve(body) });

const payload = (over = {}) => ({
  sources: [
    {
      id: 'hermes', label: 'Hermes', icon: 'agent', home: '/h',
      skills: { total: 9, importable: 3, names: ['a', 'b', 'c'] },
      persona: { available: true, origins: ['SOUL.md'] },
      memories: { count: 7 },
    },
    {
      id: 'claude', label: 'Claude Code', icon: 'claude', home: '/c',
      skills: { total: 8, importable: 0, names: [] },
      persona: { available: false },
      memories: { count: 0 },
    },
  ],
  totals: { sources: 2, skillsSeen: 17, skillsImportable: 3, personas: 1, memories: 7 },
  ...over,
});

beforeEach(() => {
  global.fetch = vi.fn();
  localStorage.setItem('token', 'test-token');
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useHarnessImport — detect', () => {
  it('reports what was found', async () => {
    global.fetch.mockResolvedValue(ok(payload()));
    const api = useHarnessImport();
    await api.detect();
    expect(api.sources.value).toHaveLength(2);
    expect(api.hasAnythingToImport.value).toBe(true);
  });

  it('offers only the sources that can contribute', async () => {
    global.fetch.mockResolvedValue(ok(payload()));
    const api = useHarnessImport();
    await api.detect();
    expect(api.offerable.value.map((s) => s.id)).toEqual(['hermes']);
  });

  it('pre-ticks skills, because importing one cannot overwrite anything', async () => {
    global.fetch.mockResolvedValue(ok(payload()));
    const api = useHarnessImport();
    await api.detect();
    expect(api.isSelected('skills', 'hermes')).toBe(true);
  });

  it('leaves persona and memories opt-in', async () => {
    // Both change what the assistant believes about the user, rather than
    // adding a file. That is a decision to make deliberately.
    global.fetch.mockResolvedValue(ok(payload()));
    const api = useHarnessImport();
    await api.detect();
    expect(api.isSelected('personas', 'hermes')).toBe(false);
    expect(api.isSelected('memories', 'hermes')).toBe(false);
  });

  it('says there is nothing when every skill is already here', async () => {
    // Having Claude Code installed with all its skills already in AGNT is a
    // real and common state, and it must not produce a step.
    global.fetch.mockResolvedValue(ok(payload({
      sources: [], totals: { sources: 1, skillsSeen: 8, skillsImportable: 0, personas: 0, memories: 0 },
    })));
    const api = useHarnessImport();
    await api.detect();
    expect(api.hasAnythingToImport.value).toBe(false);
  });
});

describe('useHarnessImport — detect never blocks onboarding', () => {
  it('finds nothing when the request fails', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    const api = useHarnessImport();
    await expect(api.detect()).resolves.toBeUndefined();
    expect(api.hasAnythingToImport.value).toBe(false);
  });

  it('finds nothing on a non-OK response', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
    const api = useHarnessImport();
    await api.detect();
    expect(api.hasAnythingToImport.value).toBe(false);
  });

  it('finds nothing when the body is not the shape we expect', async () => {
    global.fetch.mockResolvedValue(ok({ nope: true }));
    const api = useHarnessImport();
    await api.detect();
    expect(api.sources.value).toEqual([]);
    expect(api.hasAnythingToImport.value).toBe(false);
  });

  it('clears its loading flag even when the request throws', async () => {
    global.fetch.mockRejectedValue(new Error('offline'));
    const api = useHarnessImport();
    await api.detect();
    expect(api.loading.value).toBe(false);
  });
});

describe('useHarnessImport — run', () => {
  const ready = async () => {
    global.fetch.mockResolvedValue(ok(payload()));
    const api = useHarnessImport();
    await api.detect();
    return api;
  };

  it('sends exactly what is ticked', async () => {
    const api = await ready();
    api.toggle('personas', 'hermes');
    global.fetch.mockResolvedValue(ok({ imported: { skills: 3, agents: 1, memories: 0 }, items: [], failures: [] }));

    await api.run();
    const body = JSON.parse(global.fetch.mock.calls.at(-1)[1].body);
    expect(body).toEqual({ skills: ['hermes'], personas: ['hermes'], memories: [] });
  });

  it('refuses to call the server with an empty selection', async () => {
    const api = await ready();
    api.toggle('skills', 'hermes'); // untick the pre-ticked one
    expect(api.selectedCount.value).toBe(0);

    global.fetch.mockClear();
    await api.run();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces a server error instead of claiming success', async () => {
    const api = await ready();
    global.fetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Import failed' }) });
    const result = await api.run();
    expect(result).toBeNull();
    expect(api.error.value).toBe('Import failed');
    expect(api.result.value).toBeNull();
  });

  it('clears its running flag when the request throws', async () => {
    const api = await ready();
    global.fetch.mockRejectedValue(new Error('gone'));
    await api.run();
    expect(api.running.value).toBe(false);
    expect(api.error.value).toBe('gone');
  });

  it('cannot be started twice at once', async () => {
    const api = await ready();
    let release;
    global.fetch.mockReturnValue(new Promise((resolve) => {
      release = () => resolve(ok({ imported: { skills: 3 }, items: [], failures: [] }));
    }));
    const first = api.run();
    const second = api.run();
    expect(await second).toBeNull();
    release();
    await first;
  });
});
