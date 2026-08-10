import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, 'chatConfigs.js'), 'utf8');

/**
 * EVERY tool-surface path must emit append-only, not just the discovery one.
 *
 * The hazard, measured on the raw registry filter (334 tools, 26 defaults,
 * 29,551-char tools block):
 *
 *   group 'media'               43.2% of the block survives  (inserts at slot 8)
 *   group 'workflow_authoring'  61.0% survives               (slot 15)
 *   group 'shell'                0.1% survives               (slot 0)
 *   replayed first-seen order  100.0% survives               (pure append)
 *
 * A tool inserted at slot 0 shifts all 26 previously-cached schemas, so the
 * serialized prefix diverges at the very start of the tools block — discarding
 * the cached tools AND every message behind them. On GPT-5.6+ that is not even
 * cost-neutral: the re-written prefix bills at 1.25x.
 *
 * applyStableToolOrder already solved this for the discovery and saved-agent
 * paths. It was NOT applied to the whitelist path (the user's checkbox
 * selection, which they can change mid-conversation) or the sidebar specialty
 * path (stable set, but a mid-session plugin install renumbers the registry
 * underneath it). This pins all four, because the next path added will be
 * copy-pasted from one of them.
 */
describe('append-only tool ordering covers every surface path', () => {
  // Split on the CALL SITE rather than regex-matching a whole balanced call:
  // the first version of this used a 400-char window and silently saw only 2
  // of the 4 paths, which its own anti-vacuity assertion caught.
  const manifestCalls = SRC.split('recordToolManifest(context, {')
    .slice(1)                    // drop everything before the first call
    .map((chunk) => chunk.slice(0, 1500));

  it('ANTI-VACUITY: every tool-surface path was found', () => {
    // agent, whitelist, specialty, auto. If a path is added and this count
    // does not move, the coverage assertion below stops covering it.
    expect(manifestCalls.length).toBeGreaterThanOrEqual(4);
  });

  it('every path passes its schemas through applyStableToolOrder', () => {
    const unwrapped = manifestCalls
      .map((body) => body.match(/schemas:\s*([^,\n]+)/)?.[1]?.trim())
      .filter((expr) => expr && !expr.startsWith('applyStableToolOrder('));
    expect(
      unwrapped,
      'a path emitting registry-ordered schemas re-inserts new tools mid-block and voids the cached prefix'
    ).toEqual([]);
  });

  it('each mode is represented, so the check is not passing on one path four times', () => {
    const modes = manifestCalls
      .map((body) => body.match(/mode:\s*'?([\w-]+)'?/)?.[1])
      .filter(Boolean);
    for (const expected of ['agent', 'whitelist', 'specialty', 'ceiling']) {
      expect(modes, `mode '${expected}' must be covered`).toContain(expected);
    }
  });
});
