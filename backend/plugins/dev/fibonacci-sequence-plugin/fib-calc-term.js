class FibonacciSequencePlugin {
  constructor() {
    this.name = 'fib-calc-term';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[FibonacciSeqPlugin] Executing with params:', JSON.stringify(params, null, 2));

    try {
      const n = params.n;
      if (typeof n !== 'number' || isNaN(n) || n < 0 || !Number.isInteger(n)) {
        throw new Error('Parameter "n" must be a non‑negative integer.');
      }

      const method = params.method || 'iterative';
      let result;

      switch (method) {
        case 'iterative':
          result = this.iterativeFib(n);
          break;
        case 'matrix':
          result = this.matrixFib(n);
          break;
        case 'recursive':
          result = this.recursiveFib(n);
          break;
        default:
          throw new Error(`Unsupported method "${method}". Available methods: iterative, matrix, recursive.`);
      }

      console.log('[FibonacciSeqPlugin] Computation successful. n=', n, 'method=', method, 'result=', result);

      return {
        result: result,
        success: true,
        error: null,
      };
    } catch (error) {
      console.error('[FibonacciSeqPlugin] Error during execution:', error);
      return {
        result: null,
        success: false,
        error: error.message,
      };
    }
  }

  iterativeFib(n) {
    if (n === 0) return 0;
    if (n === 1) return 1;
    let a = 0, b = 1, temp;
    for (let i = 2; i <= n; i++) {
      temp = a + b;
      a = b;
      b = temp;
    }
    return b;
  }

  // Fast doubling method (matrix exponentiation equivalent) for O(log n)
  matrixFib(n) {
    const multiply = (m1, m2) => {
      return [
        [
          m1[0][0] * m2[0][0] + m1[0][1] * m2[1][0],
          m1[0][0] * m2[0][1] + m1[0][1] * m2[1][1],
        ],
        [
          m1[1][0] * m2[0][0] + m1[1][1] * m2[1][0],
          m1[1][0] * m2[0][1] + m1[1][1] * m2[1][1],
        ],
      ];
    };

    const power = (matrix, exp) => {
      if (exp === 0) return [[1, 0], [0, 1]]; // Identity
      if (exp === 1) return matrix;
      let half = power(matrix, Math.floor(exp / 2));
      let full = multiply(half, half);
      if (exp % 2 === 1) {
        full = multiply(full, matrix);
      }
      return full;
    };

    if (n === 0) return 0;
    const base = [[1, 1], [1, 0]];
    const resultMatrix = power(base, n - 1);
    return resultMatrix[0][0];
  }

  recursiveFib(n) {
    // Simple recursion with memoization to avoid extreme depth
    const memo = { 0: 0, 1: 1 };
    const helper = (k) => {
      if (memo.hasOwnProperty(k)) return memo[k];
      memo[k] = helper(k - 1) + helper(k - 2);
      return memo[k];
    };
    return helper(n);
  }
}

export default new FibonacciSequencePlugin();