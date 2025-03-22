import { evaluate } from 'mathjs';

export async function execute(params) {
  try {
    // If the expression is provided directly, use it
    let expression = params.expression;
    
    // Log the incoming parameters for debugging
    console.log("Calculator received params:", params);
    
    if (!expression) {
      return { 
        result: null, 
        error: "Missing expression parameter"
      };
    }
    
    // Ensure the expression is treated as a string
    const result = evaluate(String(expression));
    return { result: result };
  } catch (error) {
    console.error("Error evaluating expression:", error);
    return { result: null, error: error.message };
  }
}