/**
 * The main-process net: any URL that names a file on THIS machine gets opened
 * from its real path instead of being handed to an unauthenticated browser.
 */

import { describe, it, expect } from 'vitest';
import { localFilePathFromUrl, LOCAL_FILE_ROUTE } from './localFileLink.js';

const posix = { port: 3333, platform: 'linux' };
const win = { port: 3333, platform: 'win32' };

describe('URLs that name a local file', () => {
  it('recovers a windows path from the streaming route', () => {
    expect(localFilePathFromUrl('http://localhost:3333/api/local-file/C:/Users/Studio/report.html', win)).toBe(
      'C:\\Users\\Studio\\report.html'
    );
  });

  it('recovers a posix path, re-adding the root the URL form drops', () => {
    // buildLocalFileUrl produces BOTH shapes depending on the leading slash of
    // the source path, and LocalFileRoutes.js accepts both. So must this.
    expect(localFilePathFromUrl('http://localhost:3333/api/local-file/home/nathan/r.html', posix)).toBe(
      '/home/nathan/r.html'
    );
    expect(localFilePathFromUrl('http://localhost:3333/api/local-file//home/nathan/r.html', posix)).toBe(
      '/home/nathan/r.html'
    );
  });

  it('accepts 127.0.0.1 as readily as localhost', () => {
    expect(localFilePathFromUrl('http://127.0.0.1:3333/api/local-file/C:/x.html', win)).toBe('C:\\x.html');
  });

  it('decodes percent-escapes', () => {
    expect(localFilePathFromUrl('http://localhost:3333/api/local-file/C:/My%20Files/a.html', win)).toBe(
      'C:\\My Files\\a.html'
    );
  });

  it('handles a bare file:// URL, which is what an unhandled anchor produces', () => {
    expect(localFilePathFromUrl('file:///C:/Users/Studio/report.html', win)).toBe('C:\\Users\\Studio\\report.html');
    expect(localFilePathFromUrl('file:///home/nathan/r.html', posix)).toBe('/home/nathan/r.html');
    expect(localFilePathFromUrl('agnt-file:///C:/x.mp4', win)).toBe('C:\\x.mp4');
  });

  it('keeps a UNC host, which is part of the path', () => {
    expect(localFilePathFromUrl('file://server/share/r.html', win)).toBe('\\\\server\\share\\r.html');
  });

  it('follows the configured port', () => {
    expect(localFilePathFromUrl('http://localhost:4444/api/local-file/C:/x.html', { ...win, port: 4444 })).toBe(
      'C:\\x.html'
    );
  });
});

describe('URLs that must be left to shell.openExternal', () => {
  it('ignores a REMOTE backend serving the same route', () => {
    // THE ONE THAT MATTERS. In remote mode /api/local-file/ names a file on the
    // SERVER's disk. Opening that path here would open a different file, or
    // nothing, on the wrong machine.
    expect(localFilePathFromUrl('https://api.agnt.gg/api/local-file/home/x/r.html', posix)).toBeNull();
    expect(localFilePathFromUrl('http://192.168.1.50:3333/api/local-file/C:/x.html', win)).toBeNull();
  });

  it('ignores loopback on a port that is not our backend', () => {
    expect(localFilePathFromUrl('http://localhost:5173/api/local-file/C:/x.html', win)).toBeNull();
  });

  it('ignores every other route on our own backend', () => {
    expect(localFilePathFromUrl('http://localhost:3333/api/filesystem/raw?path=C:/x', win)).toBeNull();
    expect(localFilePathFromUrl('http://localhost:3333/', win)).toBeNull();
  });

  it('ignores ordinary web links, mail links and junk', () => {
    for (const u of ['https://agnt.gg/docs', 'mailto:a@b.c', 'not a url', '', null, undefined, 42]) {
      expect(localFilePathFromUrl(u, win)).toBeNull();
    }
  });

  it('refuses a route with no path after it', () => {
    expect(localFilePathFromUrl(`http://localhost:3333${LOCAL_FILE_ROUTE}`, win)).toBeNull();
  });

  it('refuses a NUL byte rather than passing it to the shell', () => {
    expect(localFilePathFromUrl('http://localhost:3333/api/local-file/C:/x%00.html', win)).toBeNull();
  });
});
