/**
 * A TOOL-INITIATED AGENT TURN IS TURN-SCOPED. IT NEVER REWRITES THE DEFAULT.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 * ---------------------------------------------------------------------------
 * The orchestrator's write-back guard asks one question: did the REQUEST name a
 * provider/model pair? (`requestHasPin`). If it did, the pair is treated as a
 * deliberate choice and persisted as the account default.
 *
 * The `agnt_chat` tool defeats that question. Before dispatching, it RESOLVES a
 * pair on the caller's behalf — agent config, then user defaults, then a
 * hardcoded 'Anthropic' / 'claude-3-5-sonnet-20240620' — and puts the result in
 * the request body. The request therefore always looks pinned, the guard always
 * passes, and the account default becomes whichever agent last took a turn.
 *
 * Measured live against a running backend, same agent, same body, one field
 * different:
 *
 *   no persistDefault      Claude-Code/claude-opus-5 -> Anthropic/claude-sonnet-4-5-20250929
 *   persistDefault: false  Claude-Code/claude-opus-5 -> Claude-Code/claude-opus-5
 *
 * This is a SOURCE-TEXT guard rather than a behavioural one on purpose: the
 * defect is a missing field in a request literal, so the literal is the thing
 * worth asserting on. A behavioural test would need the whole HTTP stack stood
 * up to observe a field that is either present or absent in one object.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = fs.readFileSync(path.join(HERE, 'tools.js'), 'utf8');

/** Every fetch in tools.js that starts an agent chat turn. */
const DISPATCH_MARKER = '/agents/${agent_id}/chat';

/**
 * The `const requestBody = { ... }` literal that feeds a given dispatch.
 * Walks BACKWARDS from the fetch, which is how the two are actually related —
 * matching forwards would pair a body with the next dispatch instead of its own.
 */
function bodyFeeding(dispatchIndex) {
  const open = TOOLS.lastIndexOf('const requestBody = {', dispatchIndex);
  if (open === -1) return null;
  const close = TOOLS.indexOf('};', open);
  if (close === -1 || close > dispatchIndex) return null;
  return TOOLS.slice(open, close + 2);
}

function dispatchSites() {
  const sites = [];
  let i = -1;
  while ((i = TOOLS.indexOf(DISPATCH_MARKER, i + 1)) !== -1) sites.push(i);
  return sites;
}

describe('agnt_chat agent dispatch — persistence scope', () => {
  it('ANTI-VACUITY: the dispatch sites are found and each has a request body', () => {
    // A scanner that finds nothing passes everything. Both known sites are
    // /chat and /chat-stream; if a third is added this count fails loudly and
    // whoever added it has to decide the persistence question deliberately.
    const sites = dispatchSites();
    expect(sites.length, 'expected the /chat and /chat-stream dispatches').toBe(2);
    for (const site of sites) {
      const body = bodyFeeding(site);
      expect(body, `no requestBody literal found for dispatch at ${site}`).toBeTruthy();
      expect(body).toMatch(/provider:/);
      expect(body).toMatch(/model:/);
    }
  });

  it('every agent-chat dispatch declares persistDefault: false', () => {
    for (const site of dispatchSites()) {
      const body = bodyFeeding(site);
      expect(
        body,
        'An agent-chat request body carries a RESOLVED provider/model pair. ' +
          'Without persistDefault: false the orchestrator reads it as a user pin ' +
          'and rewrites default_provider to that agent\'s provider.'
      ).toMatch(/persistDefault:\s*false/);
    }
  });

  it('the guard it depends on is still spelled the way the backend reads it', () => {
    // persistDefault is honoured by OrchestratorService via persistDefaultNormalized.
    // If that field is ever renamed, `persistDefault: false` becomes a no-op that
    // still reads correct at every call site — silent re-regression.
    const orchestrator = fs.readFileSync(
      path.join(HERE, '..', 'OrchestratorService.js'),
      'utf8'
    );
    expect(orchestrator).toMatch(/persistDefault\s*===\s*false/);
    expect(orchestrator).toMatch(/persistDefaultNormalized && requestHasPin/);
  });
});
