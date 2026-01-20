import { randomInt } from 'crypto';

class DiceRollerPlugin {
  constructor() {
    this.name = 'roll-dice';
  }

  async execute(params, inputData, workflowEngine) {
    console.log('[DiceRoller] Executing with params:', JSON.stringify(params, null, 2));

    try {
      // Validate and parse dieType
      const dieType = params?.dieType;
      if (typeof dieType !== 'string' || !/^d\d+$/.test(dieType)) {
        throw new Error(`Invalid dieType "${dieType}". Expected format like "d6".`);
      }
      const sides = parseInt(dieType.substring(1), 10);
      if (isNaN(sides) || sides < 1) {
        throw new Error(`Die type "${dieType}" does not represent a valid number of sides.`);
      }

      // Count handling with defaults and bounds
      let count = params?.count;
      if (count === undefined || count === null) {
        count = 1;
      }
      count = Number(count);
      if (!Number.isInteger(count) || count < 1 || count > 100) {
        throw new Error(`Count must be an integer between 1 and 100. Received: ${params?.count}`);
      }

      // Modifier handling with default
      let modifier = params?.modifier;
      if (modifier === undefined || modifier === null) {
        modifier = 0;
      }
      modifier = Number(modifier);
      if (isNaN(modifier)) {
        throw new Error(`Modifier must be a number. Received: ${params?.modifier}`);
      }

      // Roll dice
      const individualRolls = [];
      for (let i = 0; i < count; i++) {
        // Using crypto randomInt for better randomness if available, fallback to Math.random
        const roll = typeof randomInt === 'function'
          ? randomInt(1, sides + 1) // randomInt min inclusive, max exclusive
          : Math.floor(Math.random() * sides) + 1;
        individualRolls.push(roll);
      }

      const sum = individualRolls.reduce((acc, val) => acc + val, 0);
      const total = sum + modifier;

      console.log('[DiceRoller] Roll result:', {
        individualRolls,
        sum,
        modifier,
        total,
      });

      return {
        success: true,
        total: total,
        individualRolls: individualRolls,
        error: null,
      };
    } catch (error) {
      console.error('[DiceRoller] Error:', error);
      return {
        success: false,
        total: null,
        individualRolls: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export default new DiceRollerPlugin();