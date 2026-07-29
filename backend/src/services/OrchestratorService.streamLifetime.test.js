/**
 * Source-contract tests for the stream-lifetime wiring.
 *
 * activeRuns.test.js proves the registry behaves correctly in isolation. That is
 * not the thing that broke. The defect was WIRING: OrchestratorService treated a
 * closed socket as a cancel, and every layer downstream inherited that decision.
 * A registry that is never consulted, or consulted behind an early return, would
 * pass every unit test in that file while the product stayed broken.
 *
 * These tests read the real source and pin the handful of positional facts that
 * make a refresh survivable. They are deliberately structural: the behaviour
 * they describe cannot be provoked from a unit test without standing up an HTTP
 * server, an LLM provider and a real socket teardown.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = fs.readFileSync(path.join(__dirname, 'OrchestratorService.js'), 'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '../routes/OrchestratorRoutes.js'), 'utf8');

/** Strip comments so prose can never satisfy an assertion about code. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CODE = stripComments(SERVICE);
const ROUTES_CODE = stripComments(ROUTES);

/** Extract a balanced brace block starting at the first match of `anchor`. */
function blockAfter(src, anchor) {
  const start = src.indexOf(anchor);
  if (start === -1) return null;
  let depth = 0;
  let i = src.indexOf('{', start);
  if (i === -1) return null;
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return null;
}

describe('losing the socket does not cancel the run', () => {
  it('the close handler never aborts generation', () => {
    const body = blockAfter(CODE, "res.on('close'");
    expect(body, "res.on('close') handler not found").toBeTruthy();

    // THE REGRESSION THIS EXISTS TO CATCH. Restoring `streamAbortController.abort()`
    // here re-creates the original bug exactly: a refresh destroys the work.
    expect(body).not.toMatch(/\.abort\s*\(/);
  });

  it('the close handler closes only the transport', () => {
    const body = blockAfter(CODE, "res.on('close'");
    expect(body).toMatch(/sseOpen\s*=\s*false/);
  });

  it('the whole disconnect-equals-cancel concept is gone from the file', () => {
    // The old flag conflated "this socket is dead" with "this run is dead".
    // Its return would mean the two ideas have been merged again.
    expect(CODE).not.toMatch(/isClientDisconnected/);
  });

  it('the tool loop continues across a dead socket, stopping only on an explicit abort', () => {
    const loop = CODE.match(/while\s*\(\s*toolCalls[^)]*\)/);
    expect(loop, 'tool-round loop condition not found').toBeTruthy();
    expect(loop[0]).toMatch(/streamAbortController\.signal\.aborted/);
  });
});

describe('every event reaches the replay log, not just the live socket', () => {
  it('publishes to the run outside the SSE-write guard', () => {
    const body = blockAfter(CODE, 'const rawSendEvent');
    expect(body, 'rawSendEvent not found').toBeTruthy();

    // The original defect was an early `if (isClientDisconnected) return;` at the
    // top of this function, which silenced the cross-tab broadcast too. Anything
    // that returns before the publish reintroduces it.
    expect(body).toMatch(/publishToRun\(activeRun/);

    const guardIndex = body.indexOf('if (sseOpen)');
    const publishIndex = body.indexOf('publishToRun');
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThan(guardIndex);

    // Not nested inside the sseOpen branch...
    const sseBlock = blockAfter(body, 'if (sseOpen)');
    expect(sseBlock).not.toMatch(/publishToRun/);

    // ...and not conditional on transport health by any other route. Nesting is
    // only one way to couple the two; `if (activeRun && sseOpen)` reintroduces
    // exactly the same defect while leaving the statement textually outside the
    // block, which an ordering-only assertion cannot see.
    const publishLine = body.split('\n').find((l) => l.includes('publishToRun'));
    expect(publishLine).not.toMatch(/sseOpen/);
  });

  it('registers the run before the first event is emitted', () => {
    const startIdx = CODE.indexOf('activeRun = startRun(');
    const firstEventIdx = CODE.indexOf("sendEvent('conversation_started'");
    expect(startIdx).toBeGreaterThan(-1);
    expect(firstEventIdx).toBeGreaterThan(-1);
    // Otherwise the replay log starts mid-turn and a reattaching client never
    // learns the conversation id it is already attached to.
    expect(startIdx).toBeLessThan(firstEventIdx);
  });

  it('releases the run when the turn ends, after the terminator is sent', () => {
    // Exactly one release site. Searching *after* the terminator would happily
    // ignore an additional earlier call that closes reattached sockets before
    // they ever receive 'done'.
    const releases = CODE.match(/endRun\(conversationId/g) || [];
    expect(releases).toHaveLength(1);

    const doneIdx = CODE.lastIndexOf("sendEvent('done'");
    const endIdx = CODE.indexOf('endRun(conversationId');
    expect(doneIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(doneIdx);
  });
});

describe('run lifecycle routes', () => {
  const routeLine = (pattern) =>
    ROUTES_CODE.split('\n').find((l) => pattern.test(l));

  it('exposes status, reattach and cancel', () => {
    expect(routeLine(/router\.get\('\/runs\/:conversationId'/)).toBeTruthy();
    expect(routeLine(/router\.get\('\/runs\/:conversationId\/stream'/)).toBeTruthy();
    expect(routeLine(/router\.post\('\/runs\/:conversationId\/cancel'/)).toBeTruthy();
  });

  it('exposes the persisted transcript that had no reader', () => {
    expect(routeLine(/router\.get\('\/conversations\/:conversationId'/)).toBeTruthy();
  });

  it('guards every one of them', () => {
    const patterns = [
      /router\.get\('\/runs\/:conversationId'/,
      /router\.get\('\/runs\/:conversationId\/stream'/,
      /router\.post\('\/runs\/:conversationId\/cancel'/,
      /router\.get\('\/conversations\/:conversationId'/,
    ];
    for (const p of patterns) {
      const line = routeLine(p);
      expect(line, `route not found for ${p}`).toBeTruthy();
      // A conversation id would otherwise be a bearer token for its own contents.
      expect(line).toMatch(/authenticateToken/);
    }
  });
});

describe('the persisted transcript is readable', () => {
  it('ConversationLogModel has a reader, not just writers', async () => {
    const model = (await import('../models/ConversationLogModel.js')).default;
    // This model was write-only: the complete copy of every interrupted answer
    // sat in a table no code path could reach.
    expect(typeof model.getByConversationId).toBe('function');
  });
});
