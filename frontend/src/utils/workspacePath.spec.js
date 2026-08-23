import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333/api' } }));

const getSettings = vi.fn();
vi.mock('@/services/fileSystemService.js', () => ({ getSettings: (...args) => getSettings(...args) }));

import {
  localFileUrlToAbsolutePath,
  isPublishableEntry,
  toWorkspaceRelative,
  getWorkspaceRoot,
  resetWorkspaceRootCache,
  resolveWorkspaceEntry,
  titleFromEntryPath,
} from './workspacePath.js';

beforeEach(() => {
  getSettings.mockReset();
  resetWorkspaceRootCache();
});
afterEach(() => resetWorkspaceRootCache());

describe('localFileUrlToAbsolutePath', () => {
  it('inverts buildLocalFileUrl for a Windows path', () => {
    expect(localFileUrlToAbsolutePath('http://localhost:3333/api/local-file/C:/Users/Studio/projects/whitney/index.html')).toBe(
      'C:/Users/Studio/projects/whitney/index.html',
    );
  });

  it('drops the cache-bust query buildLocalFileUrl appends', () => {
    expect(localFileUrlToAbsolutePath('http://localhost:3333/api/local-file/C:/x/a.html?_=msg-42')).toBe('C:/x/a.html');
  });

  it('decodes percent-encoded segments', () => {
    expect(localFileUrlToAbsolutePath('http://localhost:3333/api/local-file/C:/My%20Files/site/index.html')).toBe(
      'C:/My Files/site/index.html',
    );
  });

  it('accepts the same-origin relative form', () => {
    expect(localFileUrlToAbsolutePath('/api/local-file/C:/x/a.html')).toBe('C:/x/a.html');
  });

  // A YouTube embed and a CDN URL are the two things most likely to sit in an
  // assistant iframe next to a real preview. Neither is a file.
  it.each([
    'https://www.youtube.com/embed/abc123',
    'https://cdn.example.com/local-file/C:/x/a.html',
    'https://evil.example.com/api/local-file/C:/Windows/System32/config/SAM',
    'data:text/html,<h1>hi</h1>',
    '',
    null,
  ])('refuses %s', (value) => {
    expect(localFileUrlToAbsolutePath(value)).toBe('');
  });
});

describe('isPublishableEntry', () => {
  it.each(['a.html', 'a.htm', 'A.HTML', 'C:/x/index.html'])('accepts %s', (v) => expect(isPublishableEntry(v)).toBe(true));
  it.each(['a.pdf', 'a.mp4', 'a.html.txt', 'a', ''])('rejects %s', (v) => expect(isPublishableEntry(v)).toBe(false));
});

describe('toWorkspaceRelative', () => {
  const root = 'C:/Users/Studio/AppData/Roaming/AGNT/projects';

  it('relativizes a file inside the root', () => {
    expect(toWorkspaceRelative(`${root}/whitney/index.html`, root)).toBe('whitney/index.html');
  });

  it('normalizes backslashes on both sides', () => {
    expect(toWorkspaceRelative('C:\\work\\site\\index.html', 'C:\\work')).toBe('site/index.html');
  });

  it('ignores a trailing separator on the root', () => {
    expect(toWorkspaceRelative('C:/work/a.html', 'C:/work/')).toBe('a.html');
  });

  it('compares drive-letter paths case-insensitively', () => {
    expect(toWorkspaceRelative('c:/Work/Site/index.html', 'C:/work')).toBe('Site/index.html');
  });

  it('preserves the real casing in the returned path', () => {
    // Lower-casing for comparison must not leak into the value handed to the
    // backend — a case-sensitive volume would then miss the file.
    expect(toWorkspaceRelative('C:/work/MixedCase/Index.HTML', 'c:/WORK')).toBe('MixedCase/Index.HTML');
  });

  it('does not let a sibling directory prefix-match the root', () => {
    expect(toWorkspaceRelative('C:/workspace-other/a.html', 'C:/work')).toBe('');
  });

  it('rejects a path outside the root', () => {
    expect(toWorkspaceRelative('C:/Users/Studio/AppData/Roaming/AGNT/plugin-data/out.html', root)).toBe('');
  });

  it('rejects the root itself', () => {
    expect(toWorkspaceRelative(root, root)).toBe('');
  });

  it('rejects a traversal segment', () => {
    expect(toWorkspaceRelative('C:/work/../secret/a.html', 'C:/work')).toBe('');
  });

  it('is case-SENSITIVE for POSIX roots', () => {
    expect(toWorkspaceRelative('/home/user/Work/a.html', '/home/user/work')).toBe('');
    expect(toWorkspaceRelative('/home/user/work/a.html', '/home/user/work')).toBe('a.html');
  });

  it.each([
    ['', 'C:/work'],
    ['C:/work/a.html', ''],
  ])('returns empty for missing input (%s, %s)', (file, root2) => {
    expect(toWorkspaceRelative(file, root2)).toBe('');
  });
});

describe('getWorkspaceRoot', () => {
  it('fetches once and caches', async () => {
    getSettings.mockResolvedValue({ workspaceRoot: 'C:/work' });
    expect(await getWorkspaceRoot()).toBe('C:/work');
    expect(await getWorkspaceRoot()).toBe('C:/work');
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent callers', async () => {
    getSettings.mockResolvedValue({ workspaceRoot: 'C:/work' });
    await Promise.all([getWorkspaceRoot(), getWorkspaceRoot(), getWorkspaceRoot()]);
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure instead of caching the error', async () => {
    getSettings.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ workspaceRoot: 'C:/work' });
    await expect(getWorkspaceRoot()).rejects.toThrow('offline');
    expect(await getWorkspaceRoot()).toBe('C:/work');
    expect(getSettings).toHaveBeenCalledTimes(2);
  });
});

describe('resolveWorkspaceEntry', () => {
  it('returns the relative entry for a workspace HTML file', async () => {
    getSettings.mockResolvedValue({ workspaceRoot: 'C:/work' });
    expect(await resolveWorkspaceEntry('C:/work/whitney/index.html')).toBe('whitney/index.html');
  });

  it('returns empty for a non-HTML file without asking the server', async () => {
    expect(await resolveWorkspaceEntry('C:/work/clip.mp4')).toBe('');
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('returns empty rather than throwing when settings are unreachable', async () => {
    getSettings.mockRejectedValue(new Error('offline'));
    await expect(resolveWorkspaceEntry('C:/work/a.html')).resolves.toBe('');
  });
});

describe('titleFromEntryPath', () => {
  it('names an index entry after its directory', () => {
    expect(titleFromEntryPath('C:/work/whitney/index.html')).toBe('Whitney');
  });

  it('title-cases a hyphenated directory', () => {
    expect(titleFromEntryPath('C:/work/annie-card-pack/index.html')).toBe('Annie Card Pack');
  });

  it('uses the file stem when it is not an index', () => {
    expect(titleFromEntryPath('C:/work/site/pricing_page.html')).toBe('Pricing Page');
  });

  it('falls back when there is nothing to name', () => {
    expect(titleFromEntryPath('')).toBe('My Creation');
  });
});
