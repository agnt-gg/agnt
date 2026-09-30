import { describe, it, expect } from 'vitest';
import { markBoot, bootMarks, startBootHealthMonitor } from './bootTimeline.js';

const busyWait = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* block the loop */ } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('boot timeline', () => {
  it('records named phases in order, in ms since process start', () => {
    markBoot('phase-a');
    markBoot('phase-b');
    const marks = bootMarks().filter((m) => m.name.startsWith('phase-'));
    expect(marks.map((m) => m.name)).toEqual(['phase-a', 'phase-b']);
    expect(marks[1].atMs).toBeGreaterThanOrEqual(marks[0].atMs);
  });

  it('reports a second in which the event loop was blocked, and keeps the worst in its summary', async () => {
    const warnings = [];
    const monitor = startBootHealthMonitor({ intervalMs: 100, reportAboveMs: 300, durationMs: 60_000, warn: (line) => warnings.push(line) });
    await sleep(150);
    busyWait(600);
    await sleep(250);
    const summary = monitor.stop();

    expect(warnings.some((line) => /event loop blocked \d+ ms/.test(line))).toBe(true);
    expect(summary.worstLoopBlockMs).toBeGreaterThanOrEqual(300);
    expect(summary.slowSeconds).toBeGreaterThanOrEqual(1);
  });

  it('stays quiet when nothing is slow', async () => {
    const warnings = [];
    const monitor = startBootHealthMonitor({ intervalMs: 50, reportAboveMs: 400, durationMs: 60_000, warn: (line) => warnings.push(line) });
    await sleep(300);
    monitor.stop();
    expect(warnings).toEqual([]);
  });
});
