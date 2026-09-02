/**
 * The repo's own conflict prior, learned from `git log --name-only`.
 *
 * Two numbers come out of the history and both feed the scheduler:
 *
 *   touchRate(file)   fraction of recent commits that touched it. This is the
 *                     contention term in a ticket's score, and past ~3% a file
 *                     is a chokepoint the packer serialises.
 *
 *   P(y | x)          of the commits that touched x, how many also touched y.
 *                     Used to EXPAND a predicted footprint: if a ticket names
 *                     agentAvatar.js and history says AgentAvatarStack.vue
 *                     moves with it 80% of the time, the footprint should say
 *                     so before two agents are dispatched onto both.
 *
 * Every landed commit makes the next prediction better. Nothing is stored;
 * the model is rebuilt from the log on demand, which costs about a second.
 */
import { execFileSync } from 'node:child_process';

export function readCommitFiles(repoRoot, count = 600) {
  const raw = execFileSync('git', ['log', `-${count}`, '--pretty=format:===', '--name-only'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  return raw
    .split('===')
    .map((block) => [...new Set(block.split('\n').map((s) => s.trim()).filter(Boolean))])
    .filter((files) => files.length > 0);
}

export function buildModel(commitFiles) {
  const touches = new Map();
  const pairs = new Map();
  for (const files of commitFiles) {
    // A sweeping commit says little about which files belong together.
    const informative = files.length <= 40;
    for (const f of files) {
      touches.set(f, (touches.get(f) ?? 0) + 1);
      if (!informative) continue;
      let row = pairs.get(f);
      if (!row) pairs.set(f, (row = new Map()));
      for (const g of files) if (g !== f) row.set(g, (row.get(g) ?? 0) + 1);
    }
  }
  return { n: commitFiles.length, touches, pairs };
}

export function touchRateOf(model) {
  return (file) => (model.n ? (model.touches.get(file) ?? 0) / model.n : 0);
}

export function hotFiles(model, { minRate = 0.03 } = {}) {
  const rate = touchRateOf(model);
  return [...model.touches.keys()]
    .map((file) => ({ file, rate: rate(file), touches: model.touches.get(file) }))
    .filter((x) => x.rate >= minRate)
    .sort((a, b) => b.rate - a.rate);
}

/**
 * Add to `footprint` every file that historically moves with one of its
 * members at least `threshold` of the time, given at least `minSupport`
 * observations. Returns the expanded list and what was added, with why.
 */
export function expandFootprint(footprint, model, { threshold = 0.5, minSupport = 3 } = {}) {
  const have = new Set(footprint);
  const added = [];
  for (const f of footprint) {
    const row = model.pairs.get(f);
    const support = model.touches.get(f) ?? 0;
    if (!row || support < minSupport) continue;
    for (const [g, count] of row) {
      const p = count / support;
      if (p >= threshold && !have.has(g)) {
        have.add(g);
        added.push({ file: g, because: f, p: Number(p.toFixed(2)) });
      }
    }
  }
  return { footprint: [...have].sort(), added };
}
