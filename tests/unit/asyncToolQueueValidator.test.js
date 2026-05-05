/**
 * Unit tests for AsyncToolQueue.validateAsyncParams().
 *
 * These cover the silent-degradation cases that previously slipped through:
 * _interval <= 0 used to one-shot, and orphan _stopAfter / _duration /
 * _delayFirst (without _interval) were silently dropped. The validator now
 * returns a structured error so the orchestrator surfaces it to the LLM
 * instead of running the wrong shape.
 *
 * Run: npm test  (vitest run)
 *   or: node --test tests/unit/asyncToolQueueValidator.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import asyncToolQueue from '../../backend/src/services/AsyncToolQueue.js';

describe('AsyncToolQueue.validateAsyncParams', () => {
  it('accepts an empty arg object', () => {
    const r = asyncToolQueue.validateAsyncParams({});
    assert.equal(r.valid, true);
  });

  it('accepts _executeAsync alone (one-shot background)', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true });
    assert.equal(r.valid, true);
  });

  it('accepts _executeAsync + _interval + _stopAfter', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: 1, _stopAfter: 5 });
    assert.equal(r.valid, true);
  });

  it('accepts both _stopAfter and _duration together (whichever-first wins)', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: 1, _stopAfter: 100, _duration: 60 });
    assert.equal(r.valid, true);
  });

  it('accepts _delayFirst with _interval (delayed one-shot pattern)', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: 60, _stopAfter: 1, _delayFirst: true });
    assert.equal(r.valid, true);
  });

  it('accepts a numeric-string _interval (Number coerces "1" → 1)', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: '1' });
    assert.equal(r.valid, true);
  });

  it('rejects _interval: 0 (used to silently one-shot)', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: 0, _stopAfter: 5 });
    assert.equal(r.valid, false);
    assert.match(r.error, /_interval/);
  });

  it('rejects negative _interval', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: -1 });
    assert.equal(r.valid, false);
    assert.match(r.error, /_interval/);
  });

  it('rejects non-numeric _interval', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: 'abc' });
    assert.equal(r.valid, false);
    assert.match(r.error, /_interval/);
  });

  it('rejects orphan _stopAfter (without _interval)', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _stopAfter: 7 });
    assert.equal(r.valid, false);
    assert.match(r.error, /_stopAfter requires _interval/);
  });

  it('rejects orphan _duration (without _interval)', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _duration: 5 });
    assert.equal(r.valid, false);
    assert.match(r.error, /_duration requires _interval/);
  });

  it('rejects orphan _delayFirst (without _interval)', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _delayFirst: true });
    assert.equal(r.valid, false);
    assert.match(r.error, /_delayFirst requires _interval/);
  });

  it('rejects _stopAfter: 0 (with valid _interval)', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: 1, _stopAfter: 0 });
    assert.equal(r.valid, false);
    assert.match(r.error, /_stopAfter/);
  });

  it('rejects non-integer _stopAfter', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: 1, _stopAfter: 1.5 });
    assert.equal(r.valid, false);
    assert.match(r.error, /_stopAfter/);
  });

  it('rejects negative _duration', () => {
    const r = asyncToolQueue.validateAsyncParams({ _executeAsync: true, _interval: 1, _duration: -3 });
    assert.equal(r.valid, false);
    assert.match(r.error, /_duration/);
  });
});
