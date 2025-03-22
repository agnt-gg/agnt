
export async function execute(params, inputData) {
  try {
    // Create a function that has access to inputData
    const func = new Function('inputData', params.code);
    const result = func(inputData);
    return result || { result: null };
  } catch (error) {
    return { error: error.message };
  }
}
