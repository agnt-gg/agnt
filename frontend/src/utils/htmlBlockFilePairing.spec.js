// Pairing an ```html block with the file it came from.
//
// The payoff is the iframe's base URL: a paired block loads from the real file,
// so relative <img>/<link> references resolve. An unpaired block is srcdoc-ed
// and every relative reference is dead. Before 2026-09-01 only READ tools were
// recognised, so "generate a page, write it, show it" — the flow that most
// often ships relative asset paths, because the assets were generated in the
// same turn — always took the dead branch.
import { describe, it, expect } from 'vitest';
import {
  findMatchingFileOnDisk,
  getBaseDirFromToolCalls,
  getFileContentCandidate,
  normalizeForMatch,
} from './htmlBlockFilePairing.js';

const PAGE = `<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="./report.css"></head>
<body>
  <h1>Q3 numbers</h1>
  <img src="../charts/revenue.png" alt="revenue">
  <p>${'Body copy to push this comfortably past the 200-character prefix floor. '.repeat(4)}</p>
</body>
</html>`;

const WIN = 'C:/Users/x/projects/report/index.html';
const NIX = '/home/x/projects/report/index.html';

const writeFileCall = (path = WIN, content = PAGE) => ({
  name: 'write_file',
  args: { path, content },
  result: { success: true, absolutePath: path, bytes: content.length, created: true },
});

const readFileCall = (path = WIN, content = PAGE) => ({
  name: 'read_file',
  args: { path },
  result: { success: true, absolutePath: path, content },
});

describe('a written file pairs, not just a read one', () => {
  it('pairs an html block with the file the turn just wrote', () => {
    // The regression. This returned null before writes were recognised.
    expect(findMatchingFileOnDisk(PAGE, [writeFileCall()])).toBe(WIN);
  });

  it('pairs for every write-shaped tool the surfaces actually use', () => {
    const cases = [
      writeFileCall(),
      { name: 'file_operations', args: { operation: 'write', path: WIN, content: PAGE }, result: { success: true, absolutePath: WIN } },
      { name: 'file_system_operation', args: { operation: 'writeFile', rootDirectory: 'C:/Users/x/projects', path: 'report/index.html', content: PAGE }, result: { success: true } },
      { name: 'file_system_operation', args: { operation: 'appendFile', path: NIX, content: PAGE }, result: { success: true } },
    ];
    for (const call of cases) {
      const label = `${call.name}/${call.args.operation || ''}`;
      expect(findMatchingFileOnDisk(PAGE, [call]), label).toBeTruthy();
    }
  });

  it('still pairs on reads — the original behaviour is intact', () => {
    expect(findMatchingFileOnDisk(PAGE, [readFileCall()])).toBe(WIN);
    expect(
      findMatchingFileOnDisk(PAGE, [
        { name: 'file_operations', args: { operation: 'read', path: NIX }, result: { content: PAGE, absolutePath: NIX } },
      ]),
    ).toBe(NIX);
    expect(
      findMatchingFileOnDisk(PAGE, [
        { name: 'file_system_operation', args: { operation: 'readFile', rootDirectory: '/home/x/projects', path: 'report/index.html' }, result: { result: PAGE } },
      ]),
    ).toBe(NIX);
  });

  it('reads content from the argument on a write and the result on a read', () => {
    // The two shapes genuinely differ: a write result carries only metadata, so
    // taking content from the result would silently never match.
    expect(getFileContentCandidate(writeFileCall()).content).toBe(PAGE);
    expect(getFileContentCandidate(readFileCall()).content).toBe(PAGE);
  });
});

describe('a pairing must be earned', () => {
  it('refuses a write that failed', () => {
    const failed = { ...writeFileCall(), result: { success: false, error: 'EACCES' } };
    expect(findMatchingFileOnDisk(PAGE, [failed])).toBeNull();
  });

  it('refuses a tool call that never returned', () => {
    expect(findMatchingFileOnDisk(PAGE, [{ name: 'write_file', args: { path: WIN, content: PAGE }, result: null }])).toBeNull();
  });

  it('refuses when the block is not the file', () => {
    expect(findMatchingFileOnDisk('<p>something else entirely</p>', [writeFileCall()])).toBeNull();
  });

  it('refuses a relative path — the iframe needs an absolute one', () => {
    const relative = { name: 'write_file', args: { path: 'report/index.html', content: PAGE }, result: { success: true, path: 'report/index.html' } };
    expect(findMatchingFileOnDisk(PAGE, [relative])).toBeNull();
  });

  it('does not pair two different files on shared boilerplate', () => {
    // The 200-char prefix floor exists for exactly this. Every generated page
    // opens with the same doctype/head; without the floor the first file the
    // turn touched would capture every later block.
    const short = '<!DOCTYPE html>\n<html>\n<head></head>\n';
    const other = { ...writeFileCall('C:/Users/x/other.html', `${short}<body>totally different</body></html>`) };
    expect(findMatchingFileOnDisk(`${short}<body>the real one</body></html>`, [other])).toBeNull();
  });
});

describe('choosing between several candidates', () => {
  it('an exact match beats a longer prefix match on another file', () => {
    const longerPrefix = writeFileCall('C:/Users/x/long.html', `${PAGE}\n<!-- plus a great deal more content appended afterwards -->`);
    const exact = writeFileCall('C:/Users/x/exact.html', PAGE);
    expect(findMatchingFileOnDisk(PAGE, [longerPrefix, exact])).toBe('C:/Users/x/exact.html');
  });

  it('tolerates CRLF on disk against an LF block', () => {
    const crlf = writeFileCall(WIN, PAGE.replace(/\n/g, '\r\n'));
    expect(findMatchingFileOnDisk(PAGE, [crlf])).toBe(WIN);
  });

  it('parses tool calls whose args and result arrived as JSON strings', () => {
    const stringified = {
      name: 'write_file',
      args: JSON.stringify({ path: WIN, content: PAGE }),
      result: JSON.stringify({ success: true, absolutePath: WIN }),
    };
    expect(findMatchingFileOnDisk(PAGE, [stringified])).toBe(WIN);
  });
});

describe('base directory fallback', () => {
  it('is the directory of the last HTML file touched, written or read', () => {
    expect(getBaseDirFromToolCalls([writeFileCall()])).toBe('C:/Users/x/projects/report');
    expect(getBaseDirFromToolCalls([readFileCall(NIX)])).toBe('/home/x/projects/report');
  });

  it('prefers an HTML file over a later non-HTML one', () => {
    // The base is for resolving a page's assets, so a stray .json read after
    // the page must not move it.
    const calls = [writeFileCall(), readFileCall('C:/Users/x/data/rows.json', '{"a":1}')];
    expect(getBaseDirFromToolCalls(calls)).toBe('C:/Users/x/projects/report');
  });

  it('is empty when nothing pairs', () => {
    expect(getBaseDirFromToolCalls([])).toBe('');
    expect(getBaseDirFromToolCalls(undefined)).toBe('');
    expect(getBaseDirFromToolCalls([{ name: 'web_search', args: {}, result: { results: [] } }])).toBe('');
  });
});

describe('normalizeForMatch', () => {
  it('collapses line endings and trims, and survives empty input', () => {
    expect(normalizeForMatch('a\r\nb\r\n')).toBe('a\nb');
    expect(normalizeForMatch('  \n x \n ')).toBe('x');
    expect(normalizeForMatch(null)).toBe('');
    expect(normalizeForMatch(undefined)).toBe('');
  });
});
