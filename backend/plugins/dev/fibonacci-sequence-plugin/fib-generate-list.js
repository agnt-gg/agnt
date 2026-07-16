class FibonacciSequencePlugin {
  constructor() {
    this.name = 'fib-generate-list';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[FibonacciSeq] Executing with params:', JSON.stringify(params, null, 2));

    try {
      const {
        count,
        maxValue,
        includeZero = true,
        method = 'iterative',
      } = params || {};

      const useCount = typeof count === 'number' && !Number.isNaN(count) && count > 0;
      const useMax = typeof maxValue === 'number' && !Number.isNaN(maxValue) && maxValue >= 0;

      if (!useCount && !useMax) {
        throw new Error('Either a positive "count" or a non‑negative "maxValue" must be provided.');
      }

      let sequence;
      if (method === 'recursive') {
        sequence = useCount
          ? this._generateRecursiveByCount(count, includeZero)
          : this._generateRecursiveByMax(maxValue, includeZero);
      } else {
        // default to iterative
        sequence = useCount
          ? this._generateIterativeByCount(count, includeZero)
          : this._generateIterativeByMax(maxValue, includeZero);
      }

      return {
        success: true,
        sequence,
        error: null,
      };
    } catch (error) {
      console.error('[FibonacciSeq] Error:', error);
      return {
        success: false,
        sequence: null,
        error: error.message,
      };
    }
  }

  _generateIterativeByCount(count, includeZero) {
    const seq = [];
    let a = includeZero ? 0 : 1;
    let b = 1;
    for (let i = 0; i < count; i++) {
      seq.push(a);
      const next = a + b;
      a = b;
      b = next;
    }
    return seq;
  }

  _generateIterativeByMax(maxValue, includeZero) {
    const seq = [];
    let a = includeZero ? 0 : 1;
    let b = 1;
    while (a <= maxValue) {
      seq.push(a);
      const next = a + b;
      a = b;
      b = next;
    }
    return seq;
  }

  _generateRecursiveByCount(count, includeZero) {
    const memo = { 0: 0, 1: 1 };
    const fib = (n) => {
      if (memo[n] !== undefined) return memo[n];
      memo[n] = fib(n - 1) + fib(n - 2);
      return memo[n];
    };

    const seq = [];
    const startIdx = includeZero ? 0 : 1;
    for (let i = startIdx; i < startIdx + count; i++) {
      seq.push(fib(i));
    }
    return seq;
  }

  _generateRecursiveByMax(maxValue, includeZero) {
    const memo = { 0: 0, 1: 1 };
    const fib = (n) => {
      if (memo[n] !== undefined) return memo[n];
      memo[n] = fib(n - 1) + fib(n - 2);
      return memo[n];
    };

    const seq = [];
    let index = includeZero ? 0 : 1;
    while (true) {
      const val = fib(index);
      if (val > maxValue) break;
      seq.push(val);
      index++;
    }
    return seq;
  }
}

export default new FibonacciSequencePlugin();