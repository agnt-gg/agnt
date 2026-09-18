import {
  describe,
  it,
  expect
} from 'vitest';
import {
  collectChatArtifacts,
  parseCsv,
  artifactKind
} from './chatArtifacts.js';
describe('chat artifact identity and bounded parsing', () => {
  it('deduplicates real file references and classifies formats', () => {
    const rows = collectChatArtifacts('[a](file:///C:/a.csv) file:///C:/a.csv file:///C:/b.md', 'm');
    expect(rows.map(r => r.kind)).toEqual(['csv', 'markdown']);
    expect(rows[0].messageId).toBe('m')
  });
  it('ignores unfinished fences while streaming', () => {
    expect(collectChatArtifacts('```html\n<h1>draft')).toEqual([])
  });
  it('gives completed fences stable identities across trailing prose', () => {
    const a = '```html\n<h1>Hello</h1>\n```';
    expect(collectChatArtifacts(a, 'm')[0]).toEqual(collectChatArtifacts(a + '\nMore text', 'm')[0])
  });
  it('keeps a paired file authoritative', () => {
    expect(collectChatArtifacts('file:///C:/page.html\n```html\n<h1>Hi</h1>\n```')).toHaveLength(1)
  });
  it('bounds previews and card count', () => {
    expect(collectChatArtifacts('```md\n' + 'a'.repeat(210000) + '\n```')[0]).toMatchObject({
      truncated: true
    });
    expect(collectChatArtifacts(Array.from({
      length: 40
    }, (_, i) => 'file:///C:/' + i + '.txt').join(' '))).toHaveLength(24)
  });
  it('parses quoted delimiters, embedded newlines and escaped quotes', () => {
    expect(parseCsv('name,note\r\n"A, B","first\nsecond"\r\n"Quote ""Q""",x')).toEqual([
      ['name', 'note'],
      ['A, B', 'first\nsecond'],
      ['Quote "Q"', 'x']
    ])
  });
  it('caps rows and columns without evaluating formulas', () => {
    const table = parseCsv('=CMD(),x,y\na,b,c\nd,e,f', 2, 2);
    expect(table).toEqual([
      ['=CMD()', 'x'],
      ['a', 'b']
    ])
  });
  it('uses extension classification not executable input', () => expect(artifactKind('notes.MD')).toBe('markdown'));
});
