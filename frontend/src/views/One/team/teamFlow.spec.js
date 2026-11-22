import { describe, it, expect } from 'vitest';
import { cardStateLine, timeInColumn, reviewOutcome, nextUpTaskId, columnLoad, agentStateLabel, spaceFlow, teamFlowLine, spaceMark, byWhatTheyHoldUp, checksSummary } from './teamModel.js';

const NOW = Date.parse('2026-11-02T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();

describe('flow on the board: what a card says about its agent', () => {
  it('names a stop and a wait with their reasons, and an approval as an approval', () => {
    expect(cardStateLine({ agentState: 'blocked', stopReason: 'not published here yet' })).toEqual({ label: 'Stopped: not published here yet', tone: 'amber' });
    expect(cardStateLine({ agentState: 'queued', stopReason: 'Review is full' })).toEqual({ label: 'Waiting: Review is full', tone: 'blue' });
    expect(cardStateLine({ agentState: 'waiting' })).toEqual({ label: 'Needs approval', tone: 'pink' });
    // A stop recorded before reasons existed still reads as a sentence.
    expect(cardStateLine({ agentState: 'blocked' }).label).toBe('Stopped: needs a look');
    expect(cardStateLine({ agentState: 'running' })).toBeNull();
    expect(cardStateLine({ agentState: null })).toBeNull();
    expect(agentStateLabel('queued')).toBe('Waiting');
  });

  it('time in a column turns amber after a day, and falls back to the last update', () => {
    expect(timeInColumn({ statusChangedAt: hoursAgo(6) }, NOW)).toEqual({ label: '6h', warn: false });
    expect(timeInColumn({ statusChangedAt: hoursAgo(49) }, NOW)).toEqual({ label: '2d', warn: true });
    expect(timeInColumn({ updatedAt: hoursAgo(1) }, NOW)).toEqual({ label: '1h', warn: false });
    expect(timeInColumn({}, NOW)).toBeNull();
  });

  it('review outcome only for approved cards: first time, or how often it was sent back', () => {
    expect(reviewOutcome({ approvedAt: hoursAgo(1), sendBackCount: 0 })).toEqual({ label: 'Accepted first time', tone: 'green' });
    expect(reviewOutcome({ approvedAt: hoursAgo(1), sendBackCount: 2 })).toEqual({ label: 'Sent back 2×', tone: 'amber' });
    expect(reviewOutcome({ approvedAt: null, sendBackCount: 3 })).toBeNull();
  });

  it('next up is the card that has waited longest for room', () => {
    const tasks = [
      { id: 'late', agentState: 'queued', agentStateAt: hoursAgo(1) },
      { id: 'early', agentState: 'queued', agentStateAt: hoursAgo(5) },
      { id: 'busy', agentState: 'running', agentStateAt: hoursAgo(9) },
    ];
    expect(nextUpTaskId(tasks)).toBe('early');
    expect(nextUpTaskId([{ id: 'x', agentState: 'blocked' }])).toBeNull();
  });

  it('a teamspace\u2019s flow: working, stopped, waiting for room, full columns, first-time acceptance over 7 days', () => {
    const tasks = [
      { status: 'doing', agentState: 'running' },
      { status: 'todo', agentState: 'blocked' },
      { status: 'todo', agentState: 'queued' },
      { status: 'review', agentState: 'waiting' },
      { status: 'review', agentState: 'waiting' },
      { status: 'done', approvedAt: hoursAgo(5), sendBackCount: 0 },
      { status: 'done', approvedAt: hoursAgo(30), sendBackCount: 2 },
      { status: 'done', approvedAt: hoursAgo(24 * 9), sendBackCount: 0 },
    ];
    const flow = spaceFlow(tasks, { doing: 3, review: 2 }, NOW);
    expect(flow).toMatchObject({ open: 5, working: 1, stopped: 1, toReview: 2, waitingForRoom: 1, fullColumns: ['review'], atLimit: true, reviewed: 2, firstTimeRate: 50 });
    expect(teamFlowLine(flow)).toEqual({ text: '1 working · 1 stopped · 2 to review · 1 waiting for room · 50% accepted first time', tag: { label: '1 stopped', tone: 'amber' } });
    expect(spaceMark(flow)).toBe('1 stopped');
    const quiet = spaceFlow([{ status: 'todo' }], {}, NOW);
    expect(teamFlowLine(quiet)).toEqual({ text: '1 open card, none with an agent', tag: null });
    expect(spaceMark(quiet)).toBe('');
    expect(spaceMark(spaceFlow([{ status: 'doing' }], { doing: 1 }, NOW))).toBe('At limit');
  });

  it('stopped cards: most held up first, then the longest stopped; checks summarised for review', () => {
    const cards = [
      { id: 'new', holdingUp: 0, agentStateAt: hoursAgo(1) },
      { id: 'old', holdingUp: 0, agentStateAt: hoursAgo(9) },
      { id: 'blocking', holdingUp: 3, agentStateAt: hoursAgo(1) },
    ];
    expect(byWhatTheyHoldUp(cards).map((c) => c.id)).toEqual(['blocking', 'old', 'new']);
    expect(checksSummary([{ label: 'A', ok: true }, { label: 'B', ok: true }])).toEqual({ label: '2 of 2 checks passed', tone: 'green' });
    expect(checksSummary([{ label: 'A', ok: true }, { label: 'Totals add up', ok: false }])).toEqual({ label: '1 check failed: Totals add up', tone: 'amber' });
    expect(checksSummary([{ label: 'A', ok: null }])).toBeNull();
    expect(checksSummary([])).toBeNull();
  });

  it('a column against its limit: full at the limit, over past it, and how many must leave', () => {
    expect(columnLoad(3, null)).toMatchObject({ full: false, over: false, label: '3', toFree: 0 });
    expect(columnLoad(3, 4)).toMatchObject({ full: false, over: false, label: '3 of 4', toFree: 0 });
    expect(columnLoad(4, 4)).toMatchObject({ full: true, over: false, label: '4 of 4', toFree: 1 });
    expect(columnLoad(6, 4)).toMatchObject({ full: true, over: true, label: '6 of 4', toFree: 3 });
  });
});
