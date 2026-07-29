import { describe, it, expect } from 'vitest';
import { parseChartConfig, repairJsonish, chartErrorHtml } from './chartConfig';

// The exact block that failed in production, recovered from agent_executions.
// It is the full config minus its final '}' — 205 chars instead of 206.
const PRODUCTION_FAILURE =
  '{"type":"bar","data":{"labels":["m=8 (HAWK)","m=12","m=24","m=40","m=48","m=60","m=84","m=105","m=120"],'
  + '"datasets":[{"label":"usable \u03C4 (non-conjugation, complex fixed field)","data":[2,2,6,6,6,6,6,6,14]}]}';

// Every invalid chart block found in this install's history (10 of 1240).
const REAL_WORLD_FAILURES = [
  // 5x missing exactly one closing brace
  PRODUCTION_FAILURE,
  '{"type":"bar","data":{"labels":["C1 hand","C2 trace","C3 external"],"datasets":[{"label":"certified","data":[0,1,0]}]}',
  '{"type":"bar","data":{"labels":["Source (NN)","Lanczos","Real-ESRGAN"],"datasets":[{"label":"Laplacian variance (edge acutance)","data":[1553.4,62.0,1629.0],"backgroundColor":["#7d3de5","#ffd700","#19ef83"]}]}',
  '{"type":"bar","data":{"labels":["Atlas","Dreamina"],"datasets":[{"label":"$ per second of video","data":[0.022,0.011]}]}',
  '{"type":"bar","data":{"labels":["Higgsfield (Business plan)","OpenRouter (720p, pay-per-sec)"],"datasets":[{"label":"USD / month for 100\u00D7 10s videos","data":[148.00,151.20],"backgroundColor":["#e53d8f","#12e0ff"]}]}',
  // 3x one closing brace too many
  '{"type":"bar","data":{"labels":["AGNT","Hermes"],"datasets":[{"label":"seconds","data":[3.5,69.1]}]},"options":{"indexAxis":"y","plugins":{"legend":{"display":false},"title":{"display":true,"text":"Agentic suite"}}}}}',
  '{"type":"bar","data":{"labels":["Tier 2","Tier 3"],"datasets":[{"label":"AGNT (sec)","data":[5,3]}]},"options":{"indexAxis":"y","plugins":{"title":{"display":true,"text":"Tier 2 & 3"}}}}}',
  '{"type":"bar","data":{"labels":["Bubble Mew","Rayquaza"],"datasets":[{"label":"Pre-Boom CAGR %","data":[12,9]}]},"options":{"plugins":{"title":{"display":true,"text":"CAGR","color":"#e6e6f0"}}}}}',
  // 1x trailing comma
  '{"type":"doughnut","data":{"labels":["Already shipped (18)","Partial (1)","Missing (13)"],"datasets":[{"data":[18,1,13,],"backgroundColor":["#19ef83","#ffd700","#e53d8f"]}]},"options":{"plugins":{"title":{"display":true,"text":"Coverage"}}}}',
  // 1x U+2212 MINUS SIGN used where '-' belongs
  '{"type":"bar","data":{"labels":["IBIT","FBTC","MSBT","Others"],"datasets":[{"label":"YTD Net Flows","data":[85,\u221245,31,15],"backgroundColor":["#12e0ff","#e53d8f","#7d3de5","#19ef83"]}]},"options":{"plugins":{"title":{"display":true,"text":"Flows"}}}}',
];

const VALID = '{"type":"bar","data":{"labels":["Jan","Feb"],"datasets":[{"label":"Revenue","data":[12,19]}]}}';

describe('parseChartConfig — valid input is never touched', () => {
  it('parses a well-formed config with zero repairs', () => {
    const { config, repairs } = parseChartConfig(VALID);
    expect(repairs).toEqual([]);
    expect(config.type).toBe('bar');
    expect(config.data.datasets[0].data).toEqual([12, 19]);
  });

  it('is byte-identical to JSON.parse for valid input', () => {
    const { config } = parseChartConfig(VALID);
    expect(config).toEqual(JSON.parse(VALID));
  });

  it('tolerates surrounding whitespace and newlines', () => {
    const { config, repairs } = parseChartConfig(`\n  ${VALID}\n`);
    expect(repairs).toEqual([]);
    expect(config.type).toBe('bar');
  });

  it('leaves a valid multi-line config unchanged', () => {
    const pretty = JSON.stringify(JSON.parse(VALID), null, 2);
    expect(parseChartConfig(pretty).repairs).toEqual([]);
  });
});

describe('parseChartConfig — the four real-world defect classes', () => {
  it('recovers the exact production failure (missing final brace)', () => {
    const { config, repairs } = parseChartConfig(PRODUCTION_FAILURE);
    expect(repairs).toContain('added missing closing bracket');
    expect(config.type).toBe('bar');
    expect(config.data.labels).toHaveLength(9);
    expect(config.data.labels[0]).toBe('m=8 (HAWK)');
    expect(config.data.datasets[0].data).toEqual([2, 2, 6, 6, 6, 6, 6, 6, 14]);
    // the label's comma, parens and non-ASCII tau must survive untouched
    expect(config.data.datasets[0].label).toBe('usable \u03C4 (non-conjugation, complex fixed field)');
  });

  it('drops a surplus trailing brace', () => {
    const { config, repairs } = parseChartConfig('{"type":"pie","data":{"labels":["a"],"datasets":[{"data":[1]}]}}}');
    expect(repairs).toContain('removed extra closing bracket');
    expect(config.type).toBe('pie');
    expect(config.data.datasets[0].data).toEqual([1]);
  });

  it('drops trailing commas in arrays and objects', () => {
    const { config, repairs } = parseChartConfig('{"type":"pie","data":{"datasets":[{"data":[18,1,13,]},],},}');
    expect(repairs).toContain('removed trailing comma');
    expect(config.data.datasets[0].data).toEqual([18, 1, 13]);
  });

  it('converts a typographic minus into a real minus', () => {
    const { config, repairs } = parseChartConfig('{"type":"bar","data":{"datasets":[{"data":[85,\u221245,31]}]}}');
    expect(repairs).toContain('replaced typographic dash with "-"');
    expect(config.data.datasets[0].data).toEqual([85, -45, 31]);
  });

  it('recovers every invalid block found in production history', () => {
    for (const raw of REAL_WORLD_FAILURES) {
      expect(() => JSON.parse(raw)).toThrow(); // precondition: genuinely broken
      const { config, repairs } = parseChartConfig(raw);
      expect(repairs.length).toBeGreaterThan(0);
      expect(config).toBeTypeOf('object');
      expect(config.type).toBeTruthy();
      expect(config.data).toBeTypeOf('object');
    }
  });
});

describe('repairJsonish — string literals are never modified', () => {
  const survives = (label) => {
    const raw = `{"type":"bar","data":{"labels":[${JSON.stringify(label)}],"datasets":[{"data":[1]}]}`;
    const { config } = parseChartConfig(raw); // broken by a missing brace, forcing the repair path
    expect(config.data.labels[0]).toBe(label);
  };

  it('preserves braces and brackets inside labels', () => survives('a } b { c ] d ['));
  it('preserves commas inside labels', () => survives('Q1, 2025, revenue'));
  it('preserves comment-like text inside labels', () => survives('http://example.com // not a comment /* nor this */'));
  it('preserves NaN / Infinity / undefined as words', () => survives('NaN vs Infinity vs undefined'));
  it('preserves a typographic minus inside labels', () => survives('\u221245 degrees \u2013 cold \u2014 indeed'));
  it('preserves smart quotes inside labels', () => survives('He said \u201Chello\u201D loudly'));
  it('preserves escaped quotes and backslashes', () => survives('say "hi" \\ then C:\\path'));
  it('preserves zero-width characters inside labels', () => survives('zero\u200Bwidth'));

  it('does not alter a valid document at all', () => {
    const { text, repairs } = repairJsonish(VALID);
    expect(text).toBe(VALID);
    expect(repairs).toEqual([]);
  });

  it('does not alter a valid document containing tricky strings', () => {
    const tricky = '{"a":"}],//","b":"NaN","c":"\u2212","d":"\u201Cq\u201D"}';
    const { text, repairs } = repairJsonish(tricky);
    expect(text).toBe(tricky);
    expect(repairs).toEqual([]);
    expect(JSON.parse(text)).toEqual(JSON.parse(tricky));
  });
});

describe('repairJsonish — additional mechanical defects', () => {
  it('strips line and block comments outside strings', () => {
    const { config } = parseChartConfig('{"type":"bar", // kind\n"data":{/* payload */"datasets":[]}}');
    expect(config.type).toBe('bar');
    expect(config.data.datasets).toEqual([]);
  });

  it('replaces non-finite numbers with null so the chart still renders', () => {
    const { config } = parseChartConfig('{"type":"bar","data":{"datasets":[{"data":[1,NaN,Infinity,-Infinity,undefined]}]}}');
    expect(config.data.datasets[0].data).toEqual([1, null, null, null, null]);
  });

  it('normalises smart quotes used as string delimiters', () => {
    const { config, repairs } = parseChartConfig('{\u201Ctype\u201D:\u201Cbar\u201D,"data":{"datasets":[]}}');
    expect(repairs).toContain('normalised smart quotes');
    expect(config.type).toBe('bar');
  });

  it('strips a leading byte-order mark', () => {
    const { config } = parseChartConfig('\uFEFF{"type":"bar","data":{"datasets":[]},}');
    expect(config.type).toBe('bar');
  });

  it('closes several unterminated containers at once', () => {
    const { config } = parseChartConfig('{"type":"bar","data":{"datasets":[{"data":[1,2');
    expect(config.data.datasets[0].data).toEqual([1, 2]);
  });

  it('closes an inner container the author forgot to close', () => {
    const { config } = parseChartConfig('{"type":"bar","data":{"datasets":[{"data":[1,2}]}}');
    expect(config.data.datasets[0].data).toEqual([1, 2]);
  });
});

describe('parseChartConfig — unrecoverable input still fails', () => {
  it('rejects an empty config', () => {
    expect(() => parseChartConfig('')).toThrow(/empty/i);
    expect(() => parseChartConfig('   ')).toThrow(/empty/i);
    expect(() => parseChartConfig(null)).toThrow(/empty/i);
  });

  it('rejects prose that is not a config at all', () => {
    expect(() => parseChartConfig('Here is your chart!')).toThrow();
  });

  it('rejects a JSON array (Chart.js needs an object)', () => {
    expect(() => parseChartConfig('[1,2,3]')).toThrow(/object/i);
  });

  it('rejects a bare JSON scalar', () => {
    expect(() => parseChartConfig('42')).toThrow(/object/i);
  });

  it('reports the ORIGINAL parse error, not a repair artifact', () => {
    let original;
    try { JSON.parse('{"a":@@@}'); } catch (e) { original = e.message; }
    expect(() => parseChartConfig('{"a":@@@}')).toThrow(original);
  });

  it('does not invent a config from a truncated string literal', () => {
    expect(() => parseChartConfig('{"type":"ba')).toThrow();
  });
});

describe('chartErrorHtml', () => {
  it('never emits an unescaped tag from a model-authored message', () => {
    const html = chartErrorHtml('<script>alert(1)</script>', '<img onerror=1>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows the source so the data is not lost', () => {
    const html = chartErrorHtml('boom', '{"type":"bar"}');
    expect(html).toContain('Chart Render Failed');
    expect(html).toContain('boom');
    expect(html).toContain('{&quot;type&quot;:&quot;bar&quot;}');
  });

  it('omits the source block when there is no source', () => {
    expect(chartErrorHtml('boom', '')).not.toContain('<pre');
  });
});
