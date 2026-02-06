/**
 * Async Tools
 * Long-running tools that execute in the background with progress updates
 */

/**
 * Roll dice periodically for a specified duration
 * This is an async tool that reports progress after each roll
 * @param {object} args - Tool arguments
 * @param {function} onProgress - Progress callback
 * @returns {Promise<object>} - Final result
 */
export async function roll_dice_periodically(args, onProgress) {
  const {
    diceCount = 2,
    sides = 6,
    intervalSeconds = 60,
    durationMinutes = 60,
  } = args;

  const intervalMs = intervalSeconds * 1000;
  const totalDuration = durationMinutes * 60 * 1000;
  const totalRolls = Math.floor(totalDuration / intervalMs);
  const allRolls = [];

  console.log(`[AsyncTool:DiceRoller] Starting: ${totalRolls} rolls over ${durationMinutes} minutes`);

  for (let rollNum = 1; rollNum <= totalRolls; rollNum++) {
    // Roll dice
    const rolls = [];
    for (let i = 0; i < diceCount; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }
    const total = rolls.reduce((sum, val) => sum + val, 0);

    const rollData = {
      rollNumber: rollNum,
      totalRolls,
      rolls,
      total,
      timestamp: new Date().toISOString(),
      percentComplete: Math.round((rollNum / totalRolls) * 100),
    };

    allRolls.push(rollData);

    // Report progress
    console.log(`[AsyncTool:DiceRoller] Roll ${rollNum}/${totalRolls}: ${rolls.join(', ')} = ${total}`);

    if (onProgress) {
      onProgress(rollData);
    }

    // Wait for next interval (unless this is the last roll)
    if (rollNum < totalRolls) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const finalResult = {
    success: true,
    totalRolls: allRolls.length,
    allRolls,
    summary: {
      highest: Math.max(...allRolls.map((r) => r.total)),
      lowest: Math.min(...allRolls.map((r) => r.total)),
      average: Math.round(
        allRolls.reduce((sum, r) => sum + r.total, 0) / allRolls.length
      ),
    },
    message: `Completed ${allRolls.length} dice rolls over ${durationMinutes} minutes`,
  };

  console.log(`[AsyncTool:DiceRoller] Completed:`, finalResult.summary);

  return finalResult;
}

/**
 * Schema for roll_dice_periodically tool
 */
export const ASYNC_TOOLS = {
  roll_dice_periodically: {
    schema: {
      type: 'function',
      function: {
        name: 'roll_dice_periodically',
        description: 'Roll dice periodically at specified intervals for a duration. This is a long-running async tool that reports progress after each roll. Perfect for tasks like "roll dice every minute for an hour".',
        parameters: {
          type: 'object',
          properties: {
            diceCount: {
              type: 'number',
              description: 'Number of dice to roll each time (default: 2)',
            },
            sides: {
              type: 'number',
              description: 'Number of sides on each die (default: 6)',
            },
            intervalSeconds: {
              type: 'number',
              description: 'Interval between rolls in seconds (default: 60)',
            },
            durationMinutes: {
              type: 'number',
              description: 'Total duration to keep rolling in minutes (default: 60)',
            },
          },
          required: [],
        },
      },
    },
    executionMode: 'async', // This marks it as an async tool
    estimatedDuration: (args) => {
      const durationMinutes = args?.durationMinutes || 60;
      return durationMinutes * 60 * 1000; // Return in milliseconds
    },
    supportsProgressUpdates: true,
    execute: roll_dice_periodically,
  },
};

export default ASYNC_TOOLS;
