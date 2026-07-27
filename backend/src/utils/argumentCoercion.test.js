import { describe, it, expect } from 'vitest';
import { coerceArgumentTypes } from './argumentCoercion.js';

// Same shape validateToolArguments reads: { function: { parameters: { properties } } }
const schema = (properties) => ({ function: { name: 't', parameters: { properties } } });

describe('coerceArgumentTypes', () => {
  it('coerces the exact live failure: query_data slice with string line numbers', () => {
    // Observed 2026-07-27: model sent startLine/endLine as strings, validator
    // rejected with "expected number, got string" — twice in a row.
    const s = schema({
      dataId: { type: 'string' },
      operation: { type: 'string' },
      startLine: { type: 'number' },
      endLine: { type: 'number' },
    });
    const out = coerceArgumentTypes(
      { dataId: 'data-abc', operation: 'slice', startLine: '440', endLine: '820' },
      s
    );
    expect(out).toEqual({ dataId: 'data-abc', operation: 'slice', startLine: 440, endLine: 820 });
  });

  it('coerces numeric strings for number and integer types', () => {
    const s = schema({ n: { type: 'number' }, i: { type: 'integer' } });
    expect(coerceArgumentTypes({ n: '2.5', i: '30' }, s)).toEqual({ n: 2.5, i: 30 });
    expect(coerceArgumentTypes({ n: ' 7 ', i: '-4' }, s)).toEqual({ n: 7, i: -4 });
    expect(coerceArgumentTypes({ n: '1e3', i: '1e2' }, s)).toEqual({ n: 1000, i: 100 });
  });

  it('refuses lossy or ambiguous numeric coercions', () => {
    const s = schema({ i: { type: 'integer' }, n: { type: 'number' } });
    // Fractional string for an integer: still invalid, validator must report it.
    expect(coerceArgumentTypes({ i: '2.5' }, s).i).toBe('2.5');
    expect(coerceArgumentTypes({ n: 'abc' }, s).n).toBe('abc');
    expect(coerceArgumentTypes({ n: '' }, s).n).toBe('');
    expect(coerceArgumentTypes({ n: '  ' }, s).n).toBe('  ');
    expect(coerceArgumentTypes({ n: 'Infinity' }, s).n).toBe('Infinity');
    expect(coerceArgumentTypes({ n: 'NaN' }, s).n).toBe('NaN');
  });

  it('coerces boolean strings, strictly true/false only', () => {
    const s = schema({ b: { type: 'boolean' } });
    expect(coerceArgumentTypes({ b: 'true' }, s).b).toBe(true);
    expect(coerceArgumentTypes({ b: 'FALSE' }, s).b).toBe(false);
    expect(coerceArgumentTypes({ b: ' True ' }, s).b).toBe(true);
    expect(coerceArgumentTypes({ b: 'yes' }, s).b).toBe('yes');
    expect(coerceArgumentTypes({ b: '1' }, s).b).toBe('1');
  });

  it('coerces numbers and booleans to expected strings', () => {
    const s = schema({ v: { type: 'string' } });
    expect(coerceArgumentTypes({ v: 440 }, s).v).toBe('440');
    expect(coerceArgumentTypes({ v: true }, s).v).toBe('true');
    // Objects/arrays are NOT stringified — that is a semantic change, not a repair.
    const obj = { a: 1 };
    expect(coerceArgumentTypes({ v: obj }, s).v).toBe(obj);
  });

  it('parses JSON strings when array/object is expected, leaves non-JSON alone', () => {
    const s = schema({ arr: { type: 'array' }, obj: { type: 'object' } });
    expect(coerceArgumentTypes({ arr: '[1,2,3]' }, s).arr).toEqual([1, 2, 3]);
    expect(coerceArgumentTypes({ obj: '{"k":1}' }, s).obj).toEqual({ k: 1 });
    expect(coerceArgumentTypes({ arr: 'not json' }, s).arr).toBe('not json');
    expect(coerceArgumentTypes({ arr: '{"k":1}' }, s).arr).toBe('{"k":1}'); // wrong shape
    expect(coerceArgumentTypes({ obj: '[1,2]' }, s).obj).toBe('[1,2]'); // wrong shape
  });

  it('returns the SAME reference when nothing needs coercion (cache/identity safety)', () => {
    const s = schema({ n: { type: 'number' }, t: { type: 'string' } });
    const args = { n: 42, t: 'hello' };
    expect(coerceArgumentTypes(args, s)).toBe(args);
  });

  it('leaves null, undefined, unknown params, and union types untouched', () => {
    const s = schema({ n: { type: 'number' }, u: { type: ['number', 'string'] } });
    const args = { n: null, extra: '5', u: '5' };
    const out = coerceArgumentTypes(args, s);
    expect(out).toBe(args); // no coercible key -> identity
    expect(out.n).toBeNull();
    expect(out.extra).toBe('5'); // not in schema
    expect(out.u).toBe('5'); // union type -> untouched
  });

  it('survives missing/malformed schemas and non-object args', () => {
    expect(coerceArgumentTypes({ a: '1' }, null)).toEqual({ a: '1' });
    expect(coerceArgumentTypes({ a: '1' }, {})).toEqual({ a: '1' });
    expect(coerceArgumentTypes(null, schema({}))).toBeNull();
    expect(coerceArgumentTypes(undefined, schema({}))).toBeUndefined();
  });

  it('does not mutate the input object', () => {
    const s = schema({ n: { type: 'number' } });
    const args = { n: '5' };
    const out = coerceArgumentTypes(args, s);
    expect(args.n).toBe('5');
    expect(out.n).toBe(5);
    expect(out).not.toBe(args);
  });
});
