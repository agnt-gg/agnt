/**
 * Pack approved tickets into waves whose footprints do not overlap.
 *
 * Build a conflict graph — a node per ticket, an edge wherever two footprints
 * share a file — and take a greedy maximal independent set in score order.
 * Greedy is enough: the goal is a correct wave in milliseconds, not an
 * optimal one. A collision excluded here is one the merge train never sees.
 *
 * Three refinements on top of plain disjointness:
 *
 *   - a ticket whose footprint is EMPTY cannot be reasoned about, so it runs
 *     alone. Unknown is treated as "everything".
 *   - `risk: high` runs alone. Auth, payments and migrations do not share a
 *     wave with anything.
 *   - at most ONE ticket per wave may touch a chokepoint file. Disjointness
 *     already stops two tickets sharing a file; this stops two tickets from
 *     editing two different hot files in the same wave, because that is where
 *     semantic (non-textual) conflicts cluster.
 *
 * A ticket whose `blockedBy` names an unlanded ticket is not ready and is
 * left out entirely; the caller sees it under `deferred`.
 */

export function conflictGraph(tickets) {
  const edges = [];
  for (let i = 0; i < tickets.length; i++) {
    for (let j = i + 1; j < tickets.length; j++) {
      const a = new Set(tickets[i].footprint ?? []);
      const shared = (tickets[j].footprint ?? []).filter((f) => a.has(f));
      if (shared.length) edges.push({ a: tickets[i].id, b: tickets[j].id, shared });
    }
  }
  return edges;
}

export function packWaves(tickets, { chokepoints = new Set(), maxWave = Infinity, landed = new Set() } = {}) {
  const deferred = [];
  const ready = [];
  for (const t of tickets) {
    const blockers = (t.blockedBy ?? []).filter((b) => !landed.has(b));
    if (blockers.length) deferred.push({ id: t.id, blockedBy: blockers });
    else ready.push(t);
  }

  let remaining = [...ready].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const waves = [];

  while (remaining.length) {
    const wave = [];
    const held = new Set();
    let chokepointHeld = false;
    let soloWave = false;
    const next = [];

    for (const t of remaining) {
      const fp = t.footprint ?? [];
      const solo = fp.length === 0 || t.risk === 'high';
      const touchesChokepoint = fp.some((f) => chokepoints.has(f));

      const fits =
        wave.length < maxWave &&
        !soloWave &&
        !(solo && wave.length > 0) &&
        !fp.some((f) => held.has(f)) &&
        !(touchesChokepoint && chokepointHeld);

      if (!fits) {
        next.push(t);
        continue;
      }
      wave.push(t);
      for (const f of fp) held.add(f);
      if (touchesChokepoint) chokepointHeld = true;
      if (solo) soloWave = true;
    }

    if (!wave.length) wave.push(next.shift()); // cannot happen, but never loop forever
    waves.push(wave);
    remaining = next;
  }

  return { waves, deferred };
}
