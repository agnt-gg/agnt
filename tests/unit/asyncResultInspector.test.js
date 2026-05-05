/**
 * Unit tests for inspectAsyncResult().
 *
 * The inspector walks an async tool result (string / object / periodic) and
 * reports whether the inner business-logic operation actually succeeded.
 * Used by the queue's businessFailed counter and the autonomous-message
 * banner — both rely on the same parsing logic, so this is the single place
 * to lock the contract down.
 *
 * Run: npm test  (vitest run)
 *   or: node --test tests/unit/asyncResultInspector.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { inspectAsyncResult } from '../../backend/src/services/asyncResultInspector.js';

describe('inspectAsyncResult', () => {
  describe('null / unknown inputs', () => {
    it('treats null as ok with unknown=true (no signal)', () => {
      const r = inspectAsyncResult(null);
      assert.equal(r.ok, true);
      assert.equal(r.unknown, true);
      assert.equal(r.errorSummary, null);
    });

    it('treats undefined as ok with unknown=true', () => {
      const r = inspectAsyncResult(undefined);
      assert.equal(r.ok, true);
      assert.equal(r.unknown, true);
    });

    it('treats unparseable JSON string as ok with unknown=true', () => {
      const r = inspectAsyncResult('malformed json{');
      assert.equal(r.ok, true);
      assert.equal(r.unknown, true);
    });

    it('treats non-object primitive as ok with unknown=true', () => {
      const r = inspectAsyncResult(42);
      assert.equal(r.ok, true);
      assert.equal(r.unknown, true);
    });
  });

  describe('single-execution results', () => {
    it('reports ok for a plain success object', () => {
      const r = inspectAsyncResult({ success: true, total: 5 });
      assert.equal(r.ok, true);
      assert.equal(r.unknown, false);
      assert.equal(r.errorSummary, null);
    });

    it('reports ok for an object with no success/error fields (assume ok)', () => {
      const r = inspectAsyncResult({ data: 'whatever' });
      assert.equal(r.ok, true);
      assert.equal(r.unknown, false);
    });

    it('reports failure for success: false with an error message', () => {
      const r = inspectAsyncResult({ success: false, error: 'ENOENT: no such file' });
      assert.equal(r.ok, false);
      assert.equal(r.unknown, false);
      assert.match(r.errorSummary, /ENOENT/);
    });

    it('parses a JSON-string failure result', () => {
      const r = inspectAsyncResult('{"success":false,"error":"EPERM"}');
      assert.equal(r.ok, false);
      assert.equal(r.unknown, false);
      assert.match(r.errorSummary, /EPERM/);
    });

    it('falls back to a generic message when failure has no error field', () => {
      const r = inspectAsyncResult({ success: false });
      assert.equal(r.ok, false);
      assert.match(r.errorSummary, /failed/i);
    });
  });

  describe('periodic-execution results', () => {
    it('reports ok when every iteration succeeded', () => {
      const r = inspectAsyncResult({
        periodicExecution: true,
        results: [
          { iteration: 1, result: '{"success":true,"total":17}' },
          { iteration: 2, result: '{"success":true,"total":12}' },
          { iteration: 3, result: '{"success":true,"total":4}' },
        ],
      });
      assert.equal(r.ok, true);
      assert.equal(r.unknown, false);
    });

    it('reports failure when one iteration has an inner success: false (nested JSON-string)', () => {
      const r = inspectAsyncResult({
        periodicExecution: true,
        results: [
          { iteration: 1, result: '{"success":true}' },
          { iteration: 2, result: '{"success":false,"error":"timeout"}' },
          { iteration: 3, result: '{"success":true}' },
        ],
      });
      assert.equal(r.ok, false);
      assert.equal(r.unknown, false);
      assert.match(r.errorSummary, /1 of 3/);
      assert.match(r.errorSummary, /iteration.*2/i);
    });

    it('reports failure when an iteration has a top-level error field', () => {
      const r = inspectAsyncResult({
        periodicExecution: true,
        results: [
          { iteration: 1, result: '{"success":true}' },
          { iteration: 2, error: 'thrown by tool' },
        ],
      });
      assert.equal(r.ok, false);
      assert.match(r.errorSummary, /1 of 2/);
    });

    it('handles empty periodic results vacuously as ok', () => {
      const r = inspectAsyncResult({ periodicExecution: true, results: [] });
      assert.equal(r.ok, true);
      assert.equal(r.unknown, false);
    });

    it('handles iterations whose result is already an object (not a string)', () => {
      const r = inspectAsyncResult({
        periodicExecution: true,
        results: [
          { iteration: 1, result: { success: true } },
          { iteration: 2, result: { success: false, error: 'bad' } },
        ],
      });
      assert.equal(r.ok, false);
      assert.match(r.errorSummary, /iteration.*2/i);
    });
  });
});
