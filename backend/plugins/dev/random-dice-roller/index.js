class FlipCoinTool {
  constructor() {
    this.name = 'flip-coin';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[FlipCoinTool] Executing coin flip...');

    try {
      // Generate a random boolean (true for Heads, false for Tails)
      // Math.random() returns a float between 0 and 1
      const isHeads = Math.random() < 0.5;
      const resultString = isHeads ? 'Heads' : 'Tails';

      console.log(`[FlipCoinTool] Result: ${resultString}`);

      return {
        result: resultString,
        is_heads: isHeads
      };
    } catch (error) {
      console.error('[FlipCoinTool] Error:', error);
      // Even though a coin flip shouldn't fail, we maintain the error structure
      throw new Error(`Failed to flip coin: ${error.message}`);
    }
  }
}

export default new FlipCoinTool();