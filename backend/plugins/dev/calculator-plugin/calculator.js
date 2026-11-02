/**
 * Calculator plugin: evaluates an arithmetic expression with a real parser.
 *
 * It used to build a JavaScript function from the expression. Basic mode stripped every letter and '^'
 * first, so "2^5" became 25 and "sqrt(144)" became 144; scientific mode passed '^' through as JavaScript's
 * XOR, so "sqrt(144)*3+2^5" came out as 35. A parser gets the arithmetic right and never runs the input
 * as code.
 *
 * Grammar (both modes): numbers, + - * / %, ^ (power, right-associative), unary + and -, parentheses,
 * and functions sqrt abs round floor ceil min max pow exp log ln sin cos tan asin acos atan.
 * Scientific mode with allowConstants also knows pi, π and e.
 */
const FUNCTIONS = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, min: Math.min, max: Math.max,
  pow: Math.pow, exp: Math.exp, log: Math.log, ln: Math.log, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
};
const CONSTANTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };

function tokenize(text) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-zπ_][A-Za-z0-9_]*)|(\*\*|[-+*/%^(),]))/y;
  let index = 0;
  while (index < text.length) {
    if (/^\s*$/.test(text.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (!match) throw new Error(`Unexpected character "${text.slice(index).trim()[0]}" in the expression.`);
    index = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ type: 'number', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ type: 'name', value: match[2] });
    else tokens.push({ type: 'op', value: match[3] === '**' ? '^' : match[3] });
  }
  return tokens;
}

export function evaluateExpression(text, { constants = true } = {}) {
  const tokens = tokenize(String(text));
  let position = 0;
  const peek = () => tokens[position];
  const take = (value) => { const token = tokens[position]; if (value !== undefined && token?.value !== value) throw new Error(`Expected "${value}" in the expression.`); position += 1; return token; };

  function primary() {
    const token = take();
    if (!token) throw new Error('The expression ends too early.');
    if (token.type === 'number') return token.value;
    if (token.type === 'op' && token.value === '(') { const value = expression(); take(')'); return value; }
    if (token.type === 'name') {
      const name = token.value.toLowerCase();
      if (peek()?.value === '(') {
        const fn = FUNCTIONS[name];
        if (!fn) throw new Error(`Unknown function "${token.value}".`);
        take('(');
        const args = [];
        if (peek()?.value !== ')') { args.push(expression()); while (peek()?.value === ',') { take(','); args.push(expression()); } }
        take(')');
        return fn(...args);
      }
      if (constants && Object.prototype.hasOwnProperty.call(CONSTANTS, name)) return CONSTANTS[name];
      throw new Error(`Unknown name "${token.value}".`);
    }
    throw new Error(`Unexpected "${token.value}" in the expression.`);
  }
  function unary() {
    if (peek()?.value === '-') { take(); return -unary(); }
    if (peek()?.value === '+') { take(); return unary(); }
    return power();
  }
  function power() {
    const base = primary();
    if (peek()?.value === '^') { take(); return base ** unary(); } // right-associative: 2^3^2 = 2^9
    return base;
  }
  function term() {
    let value = unary();
    while (['*', '/', '%'].includes(peek()?.value)) {
      const op = take().value; const right = unary();
      value = op === '*' ? value * right : op === '/' ? value / right : value % right;
    }
    return value;
  }
  function expression() {
    let value = term();
    while (['+', '-'].includes(peek()?.value)) { const op = take().value; const right = term(); value = op === '+' ? value + right : value - right; }
    return value;
  }

  const result = expression();
  if (position < tokens.length) throw new Error(`Unexpected "${tokens[position].value}" in the expression.`);
  return result;
}

class CalculatorPlugin {
  constructor() {
    this.name = 'calc-evaluate';
  }

  async execute(params) {
    const mode = params?.mode ?? 'basic';
    const expressionRaw = String(params?.expression ?? '');
    const precision = typeof params?.precision === 'number' ? params.precision : 2;
    const allowConstants = typeof params?.allowConstants === 'boolean' ? params.allowConstants : true;
    try {
      if (!expressionRaw.trim()) throw new Error('Expression is required.');
      let result = evaluateExpression(expressionRaw, { constants: mode === 'scientific' && allowConstants });
      if (typeof result !== 'number' || Number.isNaN(result) || !Number.isFinite(result)) throw new Error('Evaluation did not produce a valid number.');
      if (Number.isInteger(precision) && precision >= 0) result = Number(result.toFixed(precision));
      return { result, success: true, error: null };
    } catch (error) {
      return { result: null, success: false, error: error.message };
    }
  }
}

export default new CalculatorPlugin();
