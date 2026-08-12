/**
 * connectTimeline — the realtime voice handshake, measured.
 *
 * WHY THIS EXISTS
 * ---------------
 * The connect path is a chain of serial awaits — mic open, offer, SDP
 * exchange, ICE/DTLS, session.created — and none of it was timed. Every
 * "voice takes seconds to start" report therefore began as an argument about
 * which step to blame, with numbers on no side. This module ends the
 * argument: every start() leaves one structured line saying where the time
 * went, in the console and (via POST /speech/realtime/timing) in error.log.
 *
 * Pure on purpose: marks in, durations out, no clock of its own beyond the
 * injectable `now`. Reporting is the caller's business — a stopwatch that
 * also owns a network call is two modules wearing one name.
 */

export function createConnectTimeline(
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
) {
  const t0 = now();
  /** @type {{name: string, at: number}[]} */
  const marks = [];

  /** Record that `name` happened now. Call order is step order. */
  function mark(name) {
    marks.push({ name: String(name), at: now() - t0 });
  }

  /**
   * The timeline as durations: each step's cost is the gap since the mark
   * before it — which is the shape "where did the seconds go" actually asks
   * for, not absolute offsets the reader has to subtract in their head.
   */
  function durations() {
    return marks.map((m, i) => ({
      name: m.name,
      at: Math.round(m.at),
      stepMs: Math.round(m.at - (i === 0 ? 0 : marks[i - 1].at)),
    }));
  }

  /** Total elapsed from construction to the latest mark. 0 with no marks. */
  function totalMs() {
    return marks.length === 0 ? 0 : Math.round(marks[marks.length - 1].at);
  }

  /** One human-readable line, identical in the console and the server log. */
  function summary() {
    return durations()
      .map((d) => `${d.name}+${d.stepMs}ms`)
      .join(' ');
  }

  return { mark, durations, totalMs, summary };
}

export default { createConnectTimeline };
