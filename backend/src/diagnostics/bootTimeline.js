/**
 * Boot timeline and boot-health monitor.
 *
 * Every earlier boot investigation reconstructed the timeline from gaps
 * between unrelated log lines, and could not tell "slow" from "frozen". This
 * records named phases (seconds since process start) and, for the first few
 * minutes, samples the two things that actually stalled boots:
 *
 *   - event-loop delay: nothing in this process can run (a synchronous write
 *     to a blocked pipe, a long synchronous loop);
 *   - libuv pool wait: the loop is free, but every file read, SQLite query and
 *     import() is queued behind busy pool threads.
 *
 * One line per slow second, one summary at the end. Timers are unref'd, so the
 * monitor never keeps the process alive.
 */
import fs from 'fs';
import { monitorEventLoopDelay } from 'perf_hooks';
import { fileURLToPath } from 'url';

const SELF = fileURLToPath(import.meta.url);
const marks = [];

const sinceStartMs = () => Math.round(process.uptime() * 1000);

/** Record a named boot phase. Cheap; safe to call from anywhere. */
export function markBoot(name) {
  marks.push({ name, atMs: sinceStartMs() });
}

export function bootMarks() {
  return marks.slice();
}

/** One INFO line with every phase so far, e.g. "[boot] listening=2.1s plugins-ready=4.0s". */
export function logBootSummary(label = 'phases') {
  const text = marks.map(({ name, atMs }) => `${name}=${(atMs / 1000).toFixed(1)}s`).join(' ');
  console.log(`[boot] ${label}: ${text}`);
}

/**
 * @param {object} [opts]
 * @param {number} [opts.durationMs=180000]  how long to watch after start
 * @param {number} [opts.intervalMs=1000]
 * @param {number} [opts.reportAboveMs=500]  a second is "slow" above this
 * @param {(line: string) => void} [opts.warn]
 * @returns {{ stop: () => object }} stop() returns the summary
 */
export function startBootHealthMonitor({ durationMs = 180_000, intervalMs = 1000, reportAboveMs = 500, warn = console.warn } = {}) {
  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  const summary = { slowSeconds: 0, worstLoopBlockMs: 0, worstPoolWaitMs: 0 };
  let probeInFlight = false;
  let probeStartedAt = 0;
  let lastPoolWaitMs = 0;
  let stopped = false;

  // fs.stat runs on the libuv pool, so its latency is the time any file read,
  // SQLite query or import() would wait for a thread right now.
  const probePool = () => {
    if (probeInFlight) return; // a probe still waiting IS the measurement
    probeInFlight = true;
    probeStartedAt = Date.now();
    fs.stat(SELF, () => {
      lastPoolWaitMs = Date.now() - probeStartedAt;
      probeInFlight = false;
    });
  };

  const sample = () => {
    const loopBlockMs = Math.round(loopDelay.max / 1e6);
    loopDelay.reset();
    const poolWaitMs = probeInFlight ? Date.now() - probeStartedAt : lastPoolWaitMs;
    lastPoolWaitMs = 0;
    summary.worstLoopBlockMs = Math.max(summary.worstLoopBlockMs, loopBlockMs);
    summary.worstPoolWaitMs = Math.max(summary.worstPoolWaitMs, poolWaitMs);
    if (loopBlockMs > reportAboveMs || poolWaitMs > reportAboveMs) {
      summary.slowSeconds += 1;
      warn(`[boot] slow at ${(sinceStartMs() / 1000).toFixed(1)}s: event loop blocked ${loopBlockMs} ms, libuv pool wait ${poolWaitMs} ms`);
    }
    probePool();
  };

  const timer = setInterval(sample, intervalMs);
  timer.unref?.();
  const deadline = setTimeout(() => stop(), durationMs);
  deadline.unref?.();
  probePool();

  function stop() {
    if (stopped) return summary;
    stopped = true;
    clearInterval(timer);
    clearTimeout(deadline);
    loopDelay.disable();
    console.log(
      `[boot] health: ${summary.slowSeconds} slow second(s); worst event-loop block ${summary.worstLoopBlockMs} ms; worst libuv pool wait ${summary.worstPoolWaitMs} ms`
    );
    return summary;
  }

  return { stop };
}
