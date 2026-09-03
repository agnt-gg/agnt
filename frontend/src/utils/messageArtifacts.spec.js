import { describe, it, expect } from 'vitest';
import { extractMessageArtifacts } from './messageArtifacts.js';

const WIN = 'file:///C:/Users/Studio/AppData/Roaming/AGNT/projects/whitney/index.html';

describe('extractMessageArtifacts', () => {
  it('finds a markdown link and names it by file', () => {
    expect(extractMessageArtifacts(`Done — [open it](${WIN}).`)).toEqual([{ href: WIN, name: 'index.html' }]);
  });

  it('finds HTML src/href attributes and bare URLs', () => {
    const md = `<video src="file:///C:/x/clip.mp4" controls></video> see also file:///C:/x/notes.md`;
    expect(extractMessageArtifacts(md).map((a) => a.name)).toEqual(['clip.mp4', 'notes.md']);
  });

  it('does not swallow inline-code backticks or trailing punctuation', () => {
    const md = 'Saved to `file:///C:/x/report.pdf`, and also file:///C:/x/a.png.';
    expect(extractMessageArtifacts(md)).toEqual([
      { href: 'file:///C:/x/report.pdf', name: 'report.pdf' },
      { href: 'file:///C:/x/a.png', name: 'a.png' },
    ]);
  });

  it('ignores prose mentions of the scheme and elided paths', () => {
    const md = 'Use a `file:///` URL. The renderer maps `file:///C:/…/report.html` for you.';
    expect(extractMessageArtifacts(md)).toEqual([]);
  });

  it('decodes percent-encoding in the display name and dedupes', () => {
    const md = `${WIN}\n\nfile:///C:/My%20Site/a%20b.html and again ${WIN}`;
    expect(extractMessageArtifacts(md).map((a) => a.name)).toEqual(['index.html', 'a b.html']);
  });

  it('returns nothing for non-strings', () => {
    expect(extractMessageArtifacts(undefined)).toEqual([]);
    expect(extractMessageArtifacts(42)).toEqual([]);
  });
});
