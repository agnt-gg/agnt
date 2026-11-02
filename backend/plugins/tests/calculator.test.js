import { it, expect } from 'vitest';
import calculator, { evaluateExpression } from '../dev/calculator-plugin/calculator.js';

// bravo, Nov 2026: 2^5 gave 25, sqrt(144) gave 144, sqrt(144)*3+2^5 gave 457 (basic) or 35 (scientific).
it.each([
  ['2^5', 'basic', 32], ['sqrt(144)', 'basic', 12], ['sqrt(144)*3+2^5', 'basic', 68], ['sqrt(144)*3+2^5', 'scientific', 68],
  ['2^3^2', 'basic', 512], ['-2^2', 'basic', -4], ['(1+2)*3', 'basic', 9], ['10/4', 'basic', 2.5], ['7 % 3', 'basic', 1], ['2**10', 'basic', 1024],
])('%s (%s) = %s', async (expression, mode, expected) => {
  expect(await calculator.execute({ expression, mode })).toEqual({ result: expected, success: true, error: null });
});

it('knows constants only in scientific mode, and never runs the input as code', async () => {
  expect((await calculator.execute({ expression: 'pi*2', mode: 'scientific' })).result).toBe(6.28);
  expect((await calculator.execute({ expression: 'pi*2', mode: 'basic' })).success).toBe(false);
  for (const attack of ['process.exit()', 'constructor.constructor("return 1")()', '1;2']) {
    expect((await calculator.execute({ expression: attack, mode: 'scientific' })).success).toBe(false);
  }
  expect(() => evaluateExpression('(1+2')).toThrow();
});
