import { describe, expect, it } from 'vitest';
import { raceWithAbort, GoalCancelledError, isCancellationError } from './abortUtils.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('abortUtils', () => {
  describe('raceWithAbort', () => {
    it('resolves normally when not aborted', async () => {
      const ac = new AbortController();
      await expect(raceWithAbort(() => Promise.resolve(42), ac.signal)).resolves.toBe(42);
    });

    it('passes original rejections through, unclassified as cancellation', async () => {
      const ac = new AbortController();
      let caught;
      try {
        await raceWithAbort(() => Promise.reject(new Error('provider 500')), ac.signal);
      } catch (e) {
        caught = e;
      }
      expect(caught.message).toBe('provider 500');
      expect(isCancellationError(caught)).toBe(false);
    });

    it('unblocks immediately on abort instead of waiting out the operation', async () => {
      const ac = new AbortController();
      const slowLlmCall = () => sleep(5000).then(() => 'never seen');
      const t0 = Date.now();
      setTimeout(() => ac.abort(new GoalCancelledError('goal-123', 'paused')), 50);

      let caught;
      try {
        await raceWithAbort(slowLlmCall, ac.signal);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(GoalCancelledError);
      expect(caught.reason).toBe('paused');
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(isCancellationError(caught)).toBe(true);
    });

    it('never invokes the factory when the signal is already aborted', async () => {
      const ac = new AbortController();
      ac.abort(new GoalCancelledError('goal-456', 'stopped'));
      let factoryFired = false;

      let caught;
      try {
        await raceWithAbort(() => {
          factoryFired = true;
          return sleep(1000);
        }, ac.signal);
      } catch (e) {
        caught = e;
      }
      expect(factoryFired).toBe(false);
      expect(caught.reason).toBe('stopped');
    });

    it('runs unwrapped with a null signal', async () => {
      await expect(raceWithAbort(() => Promise.resolve('ok'), null)).resolves.toBe('ok');
    });

    it('swallows the orphaned promise rejection after abort (no unhandledRejection)', async () => {
      const leaks = [];
      const onUnhandled = (e) => leaks.push(e);
      process.on('unhandledRejection', onUnhandled);

      try {
        const ac = new AbortController();
        const orphan = () =>
          sleep(50).then(() => {
            throw new Error('late failure from abandoned call');
          });
        setTimeout(() => ac.abort(new GoalCancelledError('goal-789', 'stopped')), 10);
        await expect(raceWithAbort(orphan, ac.signal)).rejects.toThrow();
        await sleep(150); // give the orphan time to reject
        expect(leaks).toHaveLength(0);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('stops a multi-round tool loop mid-flight (executeWithTools pattern)', async () => {
      const ac = new AbortController();
      let roundsExecuted = 0;
      const fakeAdapterCall = () =>
        sleep(80).then(() => {
          roundsExecuted++;
          return { toolCalls: [1] };
        });

      const loop = (async () => {
        await raceWithAbort(fakeAdapterCall, ac.signal);
        for (let round = 0; round < 10; round++) {
          await raceWithAbort(fakeAdapterCall, ac.signal);
        }
        return 'completed all rounds';
      })();

      setTimeout(() => ac.abort(new GoalCancelledError('goal-loop', 'paused')), 200);

      let caught;
      try {
        await loop;
      } catch (e) {
        caught = e;
      }
      expect(isCancellationError(caught)).toBe(true);
      expect(roundsExecuted).toBeLessThanOrEqual(4); // not all 11
    });

    it('accepts a live promise (non-factory) and detaches it when already aborted', async () => {
      const ac = new AbortController();
      ac.abort(new GoalCancelledError('goal-live', 'stopped'));
      const live = sleep(20).then(() => {
        throw new Error('late orphan');
      });
      await expect(raceWithAbort(live, ac.signal)).rejects.toMatchObject({ reason: 'stopped' });
      await sleep(60); // orphan rejection must not leak
    });
  });

  describe('isCancellationError', () => {
    it('recognizes GoalCancelledError and AbortError by name', () => {
      expect(isCancellationError(new GoalCancelledError('g', 'paused'))).toBe(true);
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      expect(isCancellationError(abortErr)).toBe(true);
    });

    it('rejects ordinary errors and nullish values', () => {
      expect(isCancellationError(new Error('boom'))).toBe(false);
      expect(isCancellationError(null)).toBe(false);
      expect(isCancellationError(undefined)).toBe(false);
    });
  });
});
