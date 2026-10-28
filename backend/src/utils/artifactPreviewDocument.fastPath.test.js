/**
 * The landmark scan is an optimisation of planWithFullParse, never a second
 * opinion: wherever it answers, the output must be byte-identical to the full
 * parse, and wherever parse5 could place a landmark differently it must
 * decline. (The same property was checked against every HTML artifact in a
 * real workspace: 9.7k files, 4.7 GB.)
 */
import { describe, it, expect } from 'vitest';
import { preparePreviewHTML, planWithFullParse, planPreviewDocument, withPreviewReporter, scanPreviewLandmarks } from './artifactPreviewDocument.js';

const channel = 'abcdefghijklmnop1234';
const documentURL = '/api/local-preview/C:/work/site/page.html';
const optionSets = [{ documentURL, channel }, { channel }, { documentURL }];
const reference = (source, options) => withPreviewReporter(planWithFullParse(source, options), options.channel ?? '');

const SCANNABLE = {
  'a complete document': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>x &lt; y</title></head><body><h1>Hi</h1><script>let a = 1 < 2; const s = "</div>";</script></body></html>',
  'uppercase tags and a CSP meta': '<!DOCTYPE HTML><HTML><HEAD><META HTTP-EQUIV="Content-Security-Policy" content="default-src \'self\'"><link rel=stylesheet href=a.css></HEAD><BODY>x</BODY></HTML>',
  'a bare fragment': '<h1>Hello</h1><p>world</p>',
  'comments and whitespace before the head': '<!-- a --> \n<!doctype html>\n<!-- b --><html><!-- c -->\n<head></head><body></body></html>',
  'no head tag': '<!doctype html><html><body><p>x</p></body></html>',
  'no html or head tag': '<!doctype html><body><p>x</p></body>',
  'an existing base': '<html><head><base href="https://cdn.example/"></head><body></body></html>',
  'head content after </head>': '<html><head></head><script>1</script><style>a{}</style><body><p>x</p></body></html>',
  'a body that is never closed': '<!doctype html><html><head></head><body><p>open',
  'an empty document': '',
  'a large self-contained page': `<html><head><style>${'a{b:c}'.repeat(5000)}</style></head><body><img src="data:image/png;base64,${'A'.repeat(200000)}"><script>${'var x="</div><p>";'.repeat(3000)}</script></body></html>`,
  'remote URLs only': '<html><head><link href="https://example.com/a.css" rel="stylesheet"></head><body><img src="/images/x.png" srcset="a.png 1x, b.png 2x"><a href="https://example.com/?a=1&amp;b=2&#38;c=3">x</a></body></html>',
};

const FULL_PARSE = {
  'a file:// reference': '<img src="file:///C:/x.png">',
  'an entity-encoded local reference': '<img src="file&#58;///C:/x.png">',
  'a hex-encoded local reference without semicolons': '<img src="&#x66ile&#x3a///C:/x.png">',
  'a named-entity colon': '<a href="file&colon;///C:/x.html">x</a>',
  'an encoded local-file path': '<img src="/api/local&#45;file/C:/x.png">',
  'an encoded CSP http-equiv': '<html><head><meta http-equiv="content&#45;security-policy" content="x"></head><body></body></html>',
  'a local-file URL in a style attribute': '<div style="background:url(/api/local-file/C:/x.png)"></div>',
  'a template': '<template><meta http-equiv="Content-Security-Policy" content="x"></template>',
  'a landmark parse5 reads as noscript text': '<html><head><noscript><meta http-equiv="Content-Security-Policy" content="x"></noscript></head><body></body></html>',
  'a </body> that closes open elements': '<html><body><div>unclosed</body></html>',
  'a </body> inside an open table': '<html><body><table><tr><td>x</body></html>',
  'a script that may be double-escaped': '<html><body><script><!--<script>x</script>--></script><p>after</p></body></html>',
  'misnested formatting': '<html><body><p><b>x</p>y</body></html>',
  '</html> without </body>': '<html><body><p>x</p></html>',
  'a head after content': '<p>x</p><head></head><body></body>',
  'a leading byte-order mark': '\uFEFF<html><head></head><body></body></html>',
  'two body tags': '<html><body></body><body></body></html>',
  'text before <body>': '<html><head></head>text<body></body></html>',
  'an abrupt comment': '<html><head><!--></head><body></body></html>',
  'a landmark written inside a script string': "<html><head></head><body><script>document.write('<meta http-equiv=refresh>')</script></body></html>",
  'a CDATA section': '<html><head></head><body><![CDATA[ <body> ]]></body></html>',
  'a processing instruction before the head': '<?xml version="1.0"?><html><head></head><body></body></html>',
  // Found by the workspace corpus run: parse5 reads everything after an
  // unclosed iframe as text, so it never sees this </body>.
  'a "self-closed" iframe': '<html><body><div><iframe src="old.html" /></div></body></html>',
  'an unclosed noscript': '<html><body><noscript><p>x</body></html>',
};

describe('landmark scan: byte-identical to the full parse where it answers', () => {
  it.each(Object.entries(SCANNABLE))('plans %s without the full parse', (_label, source) => {
    expect(scanPreviewLandmarks(source)).not.toBeNull();
    for (const options of optionSets) expect(preparePreviewHTML(source, options)).toBe(reference(source, options));
  });
});

describe('landmark scan: declines whenever parse5 could disagree', () => {
  it.each(Object.entries(FULL_PARSE))('sends %s to the full parse', (_label, source) => {
    expect(scanPreviewLandmarks(source)).toBeNull();
    for (const options of optionSets) expect(preparePreviewHTML(source, options)).toBe(reference(source, options));
  });
});

describe('the reporter is spliced per request into a reusable plan', () => {
  it('differs between two frames only by channel, before </body>', () => {
    const source = '<html><head></head><body><p>x</p></body></html>';
    const plan = planPreviewDocument(source, { documentURL });
    const first = withPreviewReporter(plan, 'aaaaaaaaaaaaaaaa');
    const second = withPreviewReporter(plan, 'bbbbbbbbbbbbbbbb');
    expect(first.replaceAll('aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb')).toBe(second);
    expect(first.indexOf('aaaaaaaaaaaaaaaa')).toBeLessThan(first.indexOf('</body>'));
    expect(first.indexOf('<base href=')).toBeLessThan(first.indexOf('<script>'));
  });

  it('keeps the base ahead of the reporter when both land on the same offset', () => {
    expect(preparePreviewHTML('', { documentURL, channel })).toBe(reference('', { documentURL, channel }));
    expect(preparePreviewHTML('', { documentURL, channel }).startsWith('<base href=')).toBe(true);
  });

  it('returns the plan untouched for an invalid channel', () => {
    const plan = planPreviewDocument('<p>x</p>', {});
    expect(withPreviewReporter(plan, 'short')).toBe(plan.html);
  });
});
