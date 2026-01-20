import BaseAction from '../BaseAction.js';

class RandomNumber extends BaseAction {
  static schema = {
    title: 'Random Number',
    category: 'utility',
    type: 'random-number',
    icon: 'dice',
    description: 'Generates a random number within a specified range.',
    parameters: {
      min: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'The minimum value (inclusive)',
      },
      max: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'The maximum value (inclusive)',
      },
    },
    outputs: {
      randomNumber: {
        type: 'number',
        description: 'The generated random number',
      },
    },
  };

  constructor() {
    super('random-number');
  }

  async execute(params, inputData, workflowEngine) {
    // Call parent execute() to trigger automatic validation
    await super.execute(params, inputData, workflowEngine);

    // Additional custom validation if needed
    const min = parseInt(params.min);
    const max = parseInt(params.max);

    if (min >= max) {
      throw new Error('Min must be less than max');
    }

    const randomNumber = Math.floor(Math.random() * (max - min + 1)) + min;

    return { randomNumber };
  }
}

export default new RandomNumber();
