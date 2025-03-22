import { evaluate } from 'mathjs';

export async function execute(params) {
  const { expression } = params;
  try {
    const result = evaluate(expression);
    return { result: result };
  } catch (error) {
    console.error("Error evaluating expression:", error);
    return { result: null, error: error.message };
  }
}