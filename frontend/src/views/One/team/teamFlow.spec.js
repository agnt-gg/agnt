import { describe, it, expect } from 'vitest';
import { cardStateLine, timeInColumn, reviewOutcome, nextUpTaskId, columnLoad, agentStateLabel } from './teamModel.js';

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

  it('a column against its limit: full at the limit, over past it, and how many must leave', () => {
    expect(columnLoad(3, null)).toMatchObject({ full: false, over: false, label: '3', toFree: 0 });
    expect(columnLoad(3, 4)).toMatchObject({ full: false, over: false, label: '3 of 4', toFree: 0 });
    expect(columnLoad(4, 4)).toMatchObject({ full: true, over: false, label: '4 of 4', toFree: 1 });
    expect(columnLoad(6, 4)).toMatchObject({ full: true, over: true, label: '6 of 4', toFree: 3 });
  });
});
