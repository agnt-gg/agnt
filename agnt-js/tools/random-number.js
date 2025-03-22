/**
 * Random Number Generator Tool
 * Generates a random number within a specified range (min to max, inclusive)
 */
export async function execute(params, inputData) {
  // Validate parameters
  if (!params.min || !params.max) {
    return { error: "Both min and max parameters are required" };
  }
  
  // Parse parameters to numbers
  const min = parseInt(params.min, 10);
  const max = parseInt(params.max, 10);
  
  // Validate parameter values
  if (isNaN(min) || isNaN(max)) {
    return { error: "Min and max must be valid numbers" };
  }
  
  if (min >= max) {
    return { error: "Min must be less than max" };
  }
  
  // Generate random number
  const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;
  
  // Return result
  return {
    success: true,
    randomNumber: randomNumber
  };
}