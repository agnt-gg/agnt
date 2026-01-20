import { readFile } from 'fs/promises';

class CalculatorPlugin {
  constructor() {
    this.name = 'calc-evaluate';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[CalculatorPlugin] Executing with params:', JSON.stringify(params, null, 2));

    // Set defaults
    const mode = params.mode ?? 'basic';
    const expressionRaw = params.expression ?? '';
    const precision = typeof params.precision === 'number' ? params.precision : 2;
    const allowConstants = typeof params.allowConstants === 'boolean' ? params.allowConstants : true;

    try {
      if (!expressionRaw.trim()) {
        throw new Error('Expression is required.');
      }

      // Prepare expression
      let expression = expressionRaw;

      // Replace Unicode pi if allowed
      if (mode === 'scientific' && allowConstants) {
        expression = expression.replace(/π/g, 'Math.PI').replace(/\bpi\b/gi, 'Math.PI');
        expression = expression.replace(/\be\b/g, 'Math.E');
      }

      // Build sandbox for scientific mode
      const sandbox = {
        sin: Math.sin,
        cos: Math.cos,
        tan: Math.tan,
        asin: Math.asin,
        acos: Math.acos,
        atan: Math.atan,
        sqrt: Math.sqrt,
        log: Math.log,
        ln: Math.log,
        abs: Math.abs,
        pow: Math.pow,
        exp: Math.exp,
        min: Math.min,
        max: Math.max,
        round: Math.round,
        floor: Math.floor,
        ceil: Math.ceil,
        PI: Math.PI,
        E: Math.E,
        // Alias for convenience
        pi: Math.PI,
        e: Math.E,
      };

      let result;

      if (mode === 'scientific') {
        // Allow Math functions and constants
        const sandboxKeys = Object.keys(sandbox);
        const sandboxValues = Object.values(sandbox);
        const func = new Function(...sandboxKeys, `return ${expression};`);
        result = func(...sandboxValues);
      } else {
        // Basic mode: only arithmetic operators
        // Remove any characters that are not numbers, operators, parentheses, decimal point, whitespace
        const safeExpression = expression.replace(/[^0-9+\-*/().\s]/g, '');
        const func = new Function(`return ${safeExpression};`);
        result = func();
        if (typeof precision === 'number') {
          result = Number(parseFloat(result).toFixed(precision));
        }
      }

      if (typeof result !== 'number' || Number.isNaN(result) || !Number.isFinite(result)) {
        throw new Error('Evaluation did not produce a valid number.');
      }

      return {
        result,
        success: true,
        error: null,
      };
    } catch (error) {
      console.error('[CalculatorPlugin] Error:', error);
      return {
        result: null,
        success: false,
        error: error.message,
      };
    }
  }
}

export default new CalculatorPlugin();