export async function execute(params, inputData) {
  try {
    // Create a function that has access to inputData
    const code = params.code || '';
    console.log("Executing JS code:", code);
    
    // Make sure we return the result by adding 'return' if it's not already there
    // This is needed because Function constructor body needs explicit returns
    let modifiedCode = code.trim();
    if (!modifiedCode.includes('return ') && !modifiedCode.startsWith('return ')) {
      modifiedCode = `return ${modifiedCode}`;
    }
    
    // Create and execute the function
    const func = new Function('inputData', modifiedCode);
    const rawResult = func(inputData);
    
    console.log("JavaScript execution result:", rawResult);
    
    // Ensure we always return a proper object with a result property
    if (rawResult === null || rawResult === undefined) {
      return { result: null, executed: true };
    } else if (typeof rawResult === 'object') {
      // If already an object, ensure it has a result property
      return { ...rawResult, executed: true };
    } else {
      // Otherwise wrap the primitive value as a result
      return { result: rawResult, executed: true };
    }
  } catch (error) {
    console.error("JavaScript execution error:", error);
    return { error: error.message, executed: false };
  }
}