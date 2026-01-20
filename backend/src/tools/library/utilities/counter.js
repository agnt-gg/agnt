import BaseAction from '../BaseAction.js';

class Counter extends BaseAction {
  static schema = {
    title: 'Counter',
    category: 'utility',
    type: 'counter',
    icon: 'abacus',
    description: 'Increments a counter each time it is executed.',
    parameters: {
      initialValue: {
        type: 'string',
        inputType: 'text',
        description: 'The initial value of the counter',
        default: '0',
      },
    },
    outputs: {
      count: {
        type: 'number',
        description: 'The current count value',
      },
    },
  };

  constructor() {
    super('counter');
    this.count = 0; // Instance variable to maintain state
  }

  async execute(params, inputData, workflowEngine) {
    // Automatic validation happens here
    await super.execute(params);

    const initialValue = Number(params.initialValue) || 0;
    this.count = Number(inputData.count) || this.count || initialValue;
    this.count++;
    return { count: this.count };
  }

  reset() {
    this.count = 0;
  }
}

export default new Counter();
