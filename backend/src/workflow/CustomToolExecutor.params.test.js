import { it, expect } from 'vitest';
import CustomToolExecutor from './CustomToolExecutor.js';

// bravo retest #2: a Python custom tool doubling n got "2121" for n = 21; every parameter arrived as text.
const engine = { parameterResolver: { resolveTemplate: async (value) => String(value).replace('{{Prev.output}}', '5') } };

it('keeps numbers, booleans and lists as they are, and resolves only text', async () => {
  const params = await new CustomToolExecutor(engine).resolveCodeParams({ n: 21, ok: true, items: [1, 2], word: 'hi', ref: '{{Prev.output}}' });
  expect(params).toEqual({ n: 21, ok: true, items: [1, 2], word: 'hi', ref: '5' });
});

it('turns a declared number parameter into a number, including after a template resolves', async () => {
  const params = await new CustomToolExecutor(engine).resolveCodeParams({ a: { type: 'number', value: '21' }, b: { type: 'number', value: '{{Prev.output}}' }, c: { type: 'number', value: '' }, d: { type: 'text', value: '007' } });
  expect(params).toEqual({ a: 21, b: 5, c: '', d: '007' });
});
