/**
 * Random Number Generator Tool
 * Generates a random number within a specified range (min to max, inclusive)
 */
export async function execute(params, inputData) {
  // Set default values if parameters are not provided
  const min = parseInt(params.min || 1, 10);
  const max = parseInt(params.max || 100, 10);
  
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
    randomNumber: randomNumber,
    range: {
      min: min,
      max: max
    }
  };
}