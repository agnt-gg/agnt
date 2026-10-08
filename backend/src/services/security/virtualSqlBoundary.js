// database-operation serves the user's virtual tables, NOT arbitrary SQL on
// AGNT's internal database. Keep existing table data and operations, but reject
// expressions that could escape into another table or a filesystem extension.
const RESERVED = /^(select|union|intersect|except|from|join|with|pragma|attach|detach|insert|update|delete|drop|alter|create|replace|vacuum|reindex|sqlite_master|sqlite_schema|load_extension|readfile|writefile)$/i;
export function validateVirtualSql({columns, condition, operation} = {}) {
  if (columns && columns !== '*') {
    const names = columns.split(',').map(x=>x.trim());
    if (names.some(x=>! /^[A-Za-z_][A-Za-z0-9_]*$/.test(x) || RESERVED.test(x))) throw new Error('Virtual table columns must be identifiers');
  }
  if (!condition) return;
  // The existing UPDATE handler supports one column=value predicate; allowing
  // boolean operators in its LHS would escape the preceding user_id guard.
  if (operation === 'update' && !/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(condition)) throw new Error('Updates require one column=value condition');
  if (typeof condition !== 'string' || condition.length > 8192) throw new Error('Invalid virtual table condition');
  let depth = 0;
  for (let at = 0; at < condition.length;) {
    const rest=condition.slice(at);
    if (/^\s/.test(rest)) {at++;continue;}
    const literal=/^'(?:[^']|'')*'/.exec(rest);
    if (literal) {at+=literal[0].length;continue;}
    const word=/^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if(word){if(RESERVED.test(word[0]))throw new Error('Cross-table SQL is not allowed');at+=word[0].length;continue;}
    const number=/^(?:\d+(?:\.\d+)?)/.exec(rest);if(number){at+=number[0].length;continue;}
    const symbol=rest[0];
    if(symbol==='(')depth++;
    else if(symbol===')'){if(--depth<0)throw new Error('Unbalanced virtual table condition');}
    else if(!/[=<>!+*,.%\/-]/.test(symbol))throw new Error('Invalid virtual table expression');
    if(rest.startsWith('--')||rest.startsWith('/*')||rest.startsWith('*/'))throw new Error('SQL comments are not allowed');
    at++;
  }
  if(depth!==0)throw new Error('Unbalanced virtual table condition');
}
