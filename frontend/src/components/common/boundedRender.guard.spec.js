import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural guard for the size-cap contract.
 *
 * The bug: a surface renders an accident-sized payload (tool result, trace
 * input/output, goal task output, execution log) into the DOM in full, so a
 * multi-megabyte result freezes layout and scrolls forever.
 *
 * The realistic failure mode is a NEW or edited surface quietly re-introducing
 * the raw dump — not someone deleting the fix. So the guard is on the pattern.
 *
 * A payload may reach the DOM only via a capping accessor: `payloadHtml()`
 * (MessageItem) or the `<BoundedJson>` component (panels).
 */

const ROOT = 'src/views';

const PAYLOAD_EXPRESSIONS = [
  /formatJSON\(/,
  /formatToolResponse\(/,
  /toolCall\.(result|args|error)/,
  /\.(initialPrompt|finalResponse|executionLog)\b/,
];

const CAPPED_ACCESSORS = [/payloadHtml\(/, /BoundedJson/];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.vue')) out.push(full);
  }
  return out;
}

function templateOf(source) {
  const start = source.indexOf('<template>');
  if (start === -1) return '';
  const end = source.lastIndexOf('</template>');
  return end > start ? source.slice(start, end) : source.slice(start);
}

const isCapped = (block) => CAPPED_ACCESSORS.some((re) => re.test(block));

describe('payload size-cap contract', () => {
  const files = walk(ROOT);

  it('finds the Vue surfaces to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('never renders an uncapped payload inside a <pre>', () => {
    const offenders = [];
    for (const file of files) {
      for (const match of templateOf(readFileSync(file, 'utf8')).matchAll(/<pre\b[\s\S]*?<\/pre>/g)) {
        const block = match[0];
        if (PAYLOAD_EXPRESSIONS.some((re) => re.test(block)) && !isCapped(block)) {
          offenders.push(`${file}: ${block.slice(0, 120)}`);
        }
      }
    }
    expect(offenders, `Route these through payloadHtml() or <BoundedJson>:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('never renders an uncapped payload through v-html', () => {
    const offenders = [];
    for (const file of files) {
      for (const match of templateOf(readFileSync(file, 'utf8')).matchAll(/v-html="([^"]*)"/g)) {
        const expr = match[1];
        const isPayload = /formatJSON\(|formatToolResponse\(|toolCall\.(result|args|error)/.test(expr);
        if (isPayload && !isCapped(expr)) offenders.push(`${file}: v-html="${expr}"`);
      }
    }
    expect(offenders, `Route these through payloadHtml():\n${offenders.join('\n')}`).toEqual([]);
  });

  it('escapes whatever payloadHtml returns, since it feeds v-html', () => {
    const source = readFileSync(
      'src/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue',
      'utf8',
    );
    const start = source.indexOf('const payloadHtml =');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('const payloadInfo =', start));
    // Every return path escapes. JSON.stringify does not escape < or >.
    for (const ret of body.matchAll(/return ([^;]+);/g)) {
      expect(ret[1], `unescaped return in payloadHtml: ${ret[1]}`).toMatch(/escapeToolHtml\(/);
    }
  });

  it('sanitizes markdown before v-html in trace and goal panels', () => {
    // showdown emits raw HTML verbatim, and these panels render agent/tool output.
    for (const file of [
      'src/views/Terminal/RightPanel/types/TracesPanel/TracesPanel.vue',
      'src/views/Terminal/RightPanel/types/GoalsPanel/GoalsPanel.vue',
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} must import DOMPurify`).toMatch(/import DOMPurify from 'dompurify'/);
      expect((source.match(/mdConverter\.makeHtml\(/g) || []).length, `${file} unsanitized call site`).toBe(1);
      expect(source).toMatch(/DOMPurify\.sanitize\(mdConverter\.makeHtml\(/);
    }
  });
});
